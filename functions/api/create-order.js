export async function onRequestPost({ request, env }) {
  // --- request meta (bez PII) ---
  const reqUrl = new URL(request.url);
  console.log(
    "CREATE_ORDER_REQUEST",
    JSON.stringify({
      method: request.method,
      host: reqUrl.host,
      path: reqUrl.pathname,
      ct: request.headers.get("content-type"),
      cfRay: request.headers.get("cf-ray"),
    }),
  );

  const input = await request.json().catch(() => null);
  if (!input) return new Response("Bad JSON", { status: 400 });

  const {
    fullName,
    email,
    phone,
    street,
    city,
    postalCode,
    ticketType,
    quantity,
    promoCode,
  } = input;

  if (
    !fullName ||
    !email ||
    !phone ||
    !street ||
    !city ||
    !postalCode ||
    !ticketType
  ) {
    return new Response("Missing fields", { status: 400 });
  }

  const qty = Math.max(1, Math.min(20, parseInt(quantity || "1", 10)));
  if (!Number.isFinite(qty))
    return new Response("Bad quantity", { status: 400 });

  const tickets = {
    premium: { name: "Premium", unit: 49900 },
    biznes_plus: { name: "Biznes Plus", unit: 59900 },
    vip: { name: "VIP", unit: 99900 },
    premium_online: { name: "Premium Online", unit: 19900 },
    biznes_plus_online: { name: "Biznes Plus Online", unit: 34900 },
  };

  const t = tickets[String(ticketType || "").toLowerCase()];
  if (!t) return new Response("Unknown ticketType", { status: 400 });

  // Kod promocyjny: "Luty" do końca lutego (czas PL), -50%, bez limitu
  const now = new Date();
  const year = now.getFullYear();
  const promoOkUntil = new Date(`${year}-03-01T00:00:00+01:00`);
  const promo = String(promoCode || "")
    .trim()
    .toLowerCase();
  const discountFactor = promo === "luty" && now < promoOkUntil ? 0.5 : 1;

  const unitPrice = Math.round(t.unit * discountFactor);
  const totalAmount = unitPrice * qty; // grosze

  const parts = String(fullName).trim().split(/\s+/);
  const firstName = parts[0] || "Klient";
  const lastName = parts.slice(1).join(" ") || "-";

  const extOrderId = crypto.randomUUID();

  // URL-e liczone z aktualnego hosta (działa na production i preview)
  const origin = reqUrl.origin;
  const notifyUrl = `${origin}/api/notify`;
  const continueUrl = `${origin}/thanks.html?order=${encodeURIComponent(extOrderId)}`;

  console.log(
    "CREATE_ORDER_URLS",
    JSON.stringify({
      origin,
      notifyUrl,
      continueUrl,
      extOrderId,
    }),
  );

  if (!env.DB) {
    console.log("CREATE_ORDER_ERROR", "Missing D1 binding: DB");
    return new Response("Missing D1 binding: DB", { status: 500 });
  }

  // 0) Zapis PENDING do D1 (bez logowania PII)
  try {
    const ins = await env.DB.prepare(
      `
      INSERT INTO orders (
        ext_order_id, status, created_at, updated_at,
        full_name, email, phone, street, city, postal_code,
        ticket_type, quantity, unit_price, total_amount, promo_code, promo_applied
      ) VALUES (?, ?, datetime('now'), datetime('now'),
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `,
    )
      .bind(
        extOrderId,
        "PENDING",
        fullName,
        email,
        phone,
        street,
        city,
        postalCode,
        t.name,
        qty,
        unitPrice,
        totalAmount,
        promoCode ? String(promoCode) : null,
        discountFactor !== 1 ? 1 : 0,
      )
      .run();

    console.log(
      "CREATE_ORDER_DB_INSERT",
      JSON.stringify({ extOrderId, result: ins }),
    );
  } catch (e) {
    console.log("CREATE_ORDER_DB_INSERT_ERROR", String(e));
    return new Response("DB insert failed", { status: 500 });
  }

  // 1) OAuth token (PayU: bez x-www-form-urlencoded będzie 401) [page:0]
  let accessToken;
  try {
    const tokenRes = await fetch(
      `${env.PAYU_BASE_URL}/pl/standard/user/oauth/authorize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: env.PAYU_CLIENT_ID,
          client_secret: env.PAYU_CLIENT_SECRET,
        }),
      },
    );

    const tokenJson = await tokenRes.json().catch(() => ({}));
    accessToken = tokenJson.access_token;

    console.log(
      "CREATE_ORDER_PAYU_AUTH",
      JSON.stringify({
        ok: !!accessToken,
        http: tokenRes.status,
      }),
    );

    if (!accessToken) return new Response("PayU auth failed", { status: 502 });
  } catch (e) {
    console.log("CREATE_ORDER_PAYU_AUTH_ERROR", String(e));
    return new Response("PayU auth error", { status: 502 });
  }

  // 2) Create order w PayU [page:0]
  const orderPayload = {
    notifyUrl,
    continueUrl,
    customerIp: request.headers.get("cf-connecting-ip") || "127.0.0.1",
    merchantPosId: env.PAYU_POS_ID,
    description: `Integracja Przedsiebiorcow - ${t.name}`,
    currencyCode: "PLN",
    totalAmount: String(totalAmount),
    extOrderId,
    buyer: {
      email,
      phone,
      firstName,
      lastName,
      language: "pl",
    },
    products: [
      { name: t.name, unitPrice: String(unitPrice), quantity: String(qty) },
    ],
  };

  let redirectUri = null;
  let payuOrderId = null;

  try {
    const orderRes = await fetch(`${env.PAYU_BASE_URL}/api/v2_1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      redirect: "manual",
      body: JSON.stringify(orderPayload),
    });

    const bodyText = await orderRes.text();
    let orderJson = {};
    try {
      orderJson = JSON.parse(bodyText);
    } catch (_) {}

    redirectUri = orderJson.redirectUri || orderRes.headers.get("location");
    payuOrderId = orderJson.orderId || null;

    console.log(
      "CREATE_ORDER_PAYU_CREATE",
      JSON.stringify({
        http: orderRes.status,
        hasRedirect: !!redirectUri,
        payuOrderId,
        extOrderId,
        // UWAGA: nie logujemy bodyText, bo może zawierać dane
      }),
    );

    if (!redirectUri) {
      await env.DB.prepare(
        `
        UPDATE orders
        SET status = ?, updated_at = datetime('now')
        WHERE ext_order_id = ?
      `,
      )
        .bind("PAYU_CREATE_FAILED", extOrderId)
        .run();

      return new Response("No redirectUri from PayU", { status: 502 });
    }
  } catch (e) {
    console.log("CREATE_ORDER_PAYU_CREATE_ERROR", String(e));
    await env.DB.prepare(
      `
      UPDATE orders
      SET status = ?, updated_at = datetime('now')
      WHERE ext_order_id = ?
    `,
    )
      .bind("PAYU_CREATE_ERROR", extOrderId)
      .run();

    return new Response("PayU create order error", { status: 502 });
  }

  // Zapisz payu_order_id
  if (payuOrderId) {
    try {
      await env.DB.prepare(
        `
        UPDATE orders
        SET payu_order_id = ?, updated_at = datetime('now')
        WHERE ext_order_id = ?
      `,
      )
        .bind(payuOrderId, extOrderId)
        .run();
    } catch (e) {
      console.log("CREATE_ORDER_DB_UPDATE_PAYU_ID_ERROR", String(e));
      // nie blokujemy płatności, bo redirect już mamy
    }
  }

  return new Response(JSON.stringify({ redirectUri, extOrderId }), {
    headers: { "Content-Type": "application/json" },
  });
}
