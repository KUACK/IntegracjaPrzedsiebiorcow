export async function onRequestPost({ request, env }) {
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
  const totalAmount = unitPrice * qty; // number (grosze)

  const parts = String(fullName).trim().split(/\s+/);
  const firstName = parts[0] || "Klient";
  const lastName = parts.slice(1).join(" ") || "-";

  const extOrderId = crypto.randomUUID();

  // Zamiast BASE_URL: działa na preview i production
  const origin = new URL(request.url).origin;
  const notifyUrl = `${origin}/api/notify`;
  const continueUrl = `${origin}/thanks.html?order=${encodeURIComponent(extOrderId)}`;

  // 0) Zapisz zamówienie PENDING do D1 (przed PayU, żeby nie zgubić danych)
  // Wymagany binding w Pages: env.DB
  if (!env.DB) return new Response("Missing D1 binding: DB", { status: 500 });

  await env.DB.prepare(
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

  // 1) OAuth token (PayU wymaga x-www-form-urlencoded, inaczej 401) [page:1]
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
  if (!tokenJson.access_token)
    return new Response("PayU auth failed", { status: 502 });
  const accessToken = tokenJson.access_token;

  // 2) Utworzenie zamówienia w PayU [page:1]
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

  const redirectUri = orderJson.redirectUri || orderRes.headers.get("location");
  const payuOrderId = orderJson.orderId || null;

  if (!redirectUri) {
    // Oznacz w DB, że coś poszło nie tak (żebyś widział to w danych)
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

  // Zapisz payu_order_id (jak jest) i zostaw status PENDING
  if (payuOrderId) {
    await env.DB.prepare(
      `
      UPDATE orders
      SET payu_order_id = ?, updated_at = datetime('now')
      WHERE ext_order_id = ?
    `,
    )
      .bind(payuOrderId, extOrderId)
      .run();
  }

  return new Response(JSON.stringify({ redirectUri, extOrderId }), {
    headers: { "Content-Type": "application/json" },
  });
}
