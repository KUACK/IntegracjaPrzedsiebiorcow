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
    paymentProvider,
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

  const provider = String(paymentProvider).trim().toLowerCase();
  if (!["payu", "stripe", "tpay"].includes(provider)) {
    return new Response("Unknown paymentProvider", { status: 400 });
  }

  const qty = Math.max(1, Math.min(20, parseInt(quantity || "1", 10)));
  if (!Number.isFinite(qty)) {
    return new Response("Bad quantity", { status: 400 });
  }

  // --- Bilety i ceny (grosze) ---
  const tickets = {
    premium: { name: "Premium – 1 dzień", unit: 49900 }, // 499 PLN
    biznesplus: { name: "Biznes Plus – 2 dni", unit: 59900 }, // 599 PLN
    vipbankiet: { name: "VIP – 2 dni + bankiet", unit: 99900 }, // 999 PLN
    vip: { name: "VIP z Prezentacją – 2 dni + bankiet", unit: 149900 }, // 1 499 PLN
  };

  const t = tickets[String(ticketType || "").toLowerCase()];
  if (!t) return new Response("Unknown ticketType", { status: 400 });

  // --- Walidacja kodów promocyjnych ---
  const now = new Date();
  const promo = String(promoCode || "")
    .trim()
    .toLowerCase();

  let discountFactor = 1;
  let fixedPriceGrosze = 0;

  if (promo === "kwiecien" || promo === "kwiecień") {
    const deadlineKwiecien = new Date("2026-05-01T00:00:00+02:00");
    if (now < deadlineKwiecien) {
      discountFactor = 0.65;
    }
  } else if (promo === "naskale") {
    const deadline = new Date("2026-04-10T00:00:00+01:00");
    if (now < deadline) {
      discountFactor = 0.5;
    }
  } else if (promo === "talent") {
    const deadline = new Date("2026-05-01T00:00:00+02:00");
    if (now < deadline) {
      discountFactor = 0.5;
    }
  } else if (promo === "asknet12#") {
    fixedPriceGrosze = 200;
  }

  const unitPrice =
    fixedPriceGrosze > 0
      ? fixedPriceGrosze
      : Math.round(t.unit * discountFactor);
  const totalAmount = unitPrice * qty; // grosze

  const parts = String(fullName).trim().split(/\s+/);
  const firstName = parts[0] || "Klient";
  const lastName = parts.slice(1).join(" ") || "-";

  const extOrderId = crypto.randomUUID();

  // URL-e liczone z aktualnego hosta
  const origin = reqUrl.origin;
  const notifyUrl = `${origin}/api/notify`;
  const continueUrl = `${origin}/thanks.html?order=${encodeURIComponent(extOrderId)}`;
  const cancelUrl = `${origin}/buy_form.html?cancelled=1`;

  console.log(
    "CREATE_ORDER_URLS",
    JSON.stringify({
      origin,
      notifyUrl,
      continueUrl,
      cancelUrl,
      extOrderId,
      provider,
    }),
  );

  if (!env.DB) {
    console.log("CREATE_ORDER_ERROR", "Missing D1 binding: DB");
    return new Response("Missing D1 binding: DB", { status: 500 });
  }

  // 0) Zapis PENDING do D1
  try {
    const ins = await env.DB.prepare(
      `
      INSERT INTO orders (
        ext_order_id, status, provider, created_at, updated_at,
        full_name, email, phone, street, city, postal_code,
        ticket_type, quantity, unit_price, total_amount, promo_code, promo_applied
      ) VALUES (?, ?, ?, datetime('now'), datetime('now'),
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `,
    )
      .bind(
        extOrderId,
        "PENDING",
        provider,
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
        discountFactor !== 1 || fixedPriceGrosze > 0 ? 1 : 0,
      )
      .run();

    console.log(
      "CREATE_ORDER_DB_INSERT",
      JSON.stringify({ extOrderId, provider, result: ins }),
    );
  } catch (e) {
    console.log("CREATE_ORDER_DB_INSERT_ERROR", String(e));
    return new Response("DB insert failed", { status: 500 });
  }

  // =========================================================
  // STRIPE
  // =========================================================
  if (provider === "stripe") {
    if (!env.STRIPE_SECRET_KEY) {
      return new Response("Missing STRIPE_SECRET_KEY", { status: 500 });
    }

    try {
      const stripeBody = new URLSearchParams();

      stripeBody.set("mode", "payment");
      stripeBody.set(
        "success_url",
        `${continueUrl}&session_id={CHECKOUT_SESSION_ID}`,
      );
      stripeBody.set("cancel_url", cancelUrl);
      stripeBody.set("customer_email", email);

      stripeBody.set("metadata[extOrderId]", extOrderId);
      stripeBody.set("metadata[provider]", "stripe");
      stripeBody.set("metadata[ticketType]", String(ticketType));
      stripeBody.set("metadata[quantity]", String(qty));
      if (promoCode) {
        stripeBody.set("metadata[promoCode]", String(promoCode));
      }

      stripeBody.set("line_items[0][quantity]", String(qty));
      stripeBody.set("line_items[0][price_data][currency]", "pln");
      stripeBody.set(
        "line_items[0][price_data][unit_amount]",
        String(unitPrice),
      );
      stripeBody.set("line_items[0][price_data][product_data][name]", t.name);

      const stripeRes = await fetch(
        "https://api.stripe.com/v1/checkout/sessions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: stripeBody.toString(),
        },
      );

      const stripeText = await stripeRes.text();
      let stripeJson = {};
      try {
        stripeJson = JSON.parse(stripeText);
      } catch (_) {}

      const redirectUrl = stripeJson.url || null;
      const stripeSessionId = stripeJson.id || null;

      console.log(
        "CREATE_ORDER_STRIPE_CREATE",
        JSON.stringify({
          http: stripeRes.status,
          hasRedirect: !!redirectUrl,
          stripeSessionId,
          extOrderId,
        }),
      );

      if (!stripeRes.ok || !redirectUrl) {
        console.log("STRIPE_ERROR_RAW", stripeText);

        await env.DB.prepare(
          `
    UPDATE orders
    SET status = ?, updated_at = datetime('now')
    WHERE ext_order_id = ?
  `,
        )
          .bind("STRIPE_CREATE_FAILED", extOrderId)
          .run();

        return new Response(
          JSON.stringify({
            error: "Stripe create session failed",
            stripeStatus: stripeRes.status,
            stripeResponse: stripeJson || stripeText,
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          paymentProvider: "stripe",
          redirectUrl,
          redirectUri: redirectUrl,
          extOrderId,
          stripeSessionId,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (e) {
      console.log("CREATE_ORDER_STRIPE_CREATE_ERROR", String(e));

      await env.DB.prepare(
        `
        UPDATE orders
        SET status = ?, updated_at = datetime('now')
        WHERE ext_order_id = ?
      `,
      )
        .bind("STRIPE_CREATE_ERROR", extOrderId)
        .run();

      return new Response("Stripe create order error", { status: 502 });
    }
  }
  // =========================================================
  // TPAY
  // =========================================================
  if (provider === "tpay") {
    // zmień w górnej części kodu dopuszczenie "tpay" obok "stripe" i usuń "payu"
    if (!env.TPAY_CLIENT_ID || !env.TPAY_CLIENT_SECRET) {
      return new Response("Missing Tpay env vars", { status: 500 });
    }

    // W Tpay kwoty przesyłane są jako wartości zmiennoprzecinkowe (np. "499.00")
    // Z uwagi na to, że przechowujesz grosze, dzielimy totalAmount przez 100
    const totalAmountFloat = (totalAmount / 100).toFixed(2);

    // Ustawienie środowiska Tpay na podstawie CLIENT_ID:
    // API produkcyjne (zaczynające się od tpay...) lub sandbox API.
    const tpayBaseUrl = "https://api.tpay.com";

    // 1) OAuth token Tpay (client_credentials)
    let accessToken;
    try {
      const tokenRes = await fetch(`${tpayBaseUrl}/oauth/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: env.TPAY_CLIENT_ID,
          client_secret: env.TPAY_CLIENT_SECRET,
        }),
      });

      const tokenJson = await tokenRes.json().catch(() => ({}));
      accessToken = tokenJson.access_token;

      console.log(
        "CREATE_ORDER_TPAY_AUTH",
        JSON.stringify({
          ok: !!accessToken,
          http: tokenRes.status,
        }),
      );

      if (!accessToken) {
        return new Response(
          JSON.stringify({
            error: "Tpay auth failed",
            status: tokenRes.status,
            tpay_response: tokenJson,
            client_id_used: env.TPAY_CLIENT_ID
              ? env.TPAY_CLIENT_ID.substring(0, 5) + "..."
              : "missing",
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    } catch (e) {
      console.log("CREATE_ORDER_TPAY_AUTH_ERROR", String(e));
      return new Response("Tpay auth error", { status: 502 });
    }

    // 2) Create transaction w Tpay
    const tpayNotifyUrl = origin + "/api/tpay-webhook";

    const tpayPayload = {
      amount: Number(totalAmountFloat),
      description: `Integracja Przedsiębiorców - ${t.name}`,
      hiddenDescription: extOrderId, // ID z Twojej bazy, zwrócone w notyfikacji webhook
      lang: "pl",
      payer: {
        email: email,
        name: `${firstName} ${lastName}`,
        phone: phone,
        address: street,
        city: city,
        postalCode: postalCode,
      },
      callbacks: {
        payerUrls: {
          success: continueUrl,
          error: cancelUrl,
        },
        notification: {
          url: tpayNotifyUrl, // Zmienione z notifyUrl na nową zmienną
        },
      },
    };

    let redirectUri = null;
    let tpayTransactionId = null;

    try {
      const orderRes = await fetch(`${tpayBaseUrl}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(tpayPayload),
      });

      const orderJson = await orderRes.json().catch(() => ({}));

      // Zgodnie z dokumentacją Tpay - link do płatności znajduje się pod kluczem `transactionPaymentUrl`
      redirectUri = orderJson.transactionPaymentUrl || null;
      tpayTransactionId = orderJson.transactionId || null;

      console.log(
        "CREATE_ORDER_TPAY_CREATE",
        JSON.stringify({
          http: orderRes.status,
          hasRedirect: !!redirectUri,
          tpayTransactionId,
          extOrderId,
        }),
      );

      if (!redirectUri || orderJson.result !== "success") {
        await env.DB.prepare(
          `
          UPDATE orders
          SET status = ?, updated_at = datetime('now')
          WHERE ext_order_id = ?
        `,
        )
          .bind("TPAY_CREATE_FAILED", extOrderId)
          .run();

        return new Response("No redirectUri from Tpay", { status: 502 });
      }
    } catch (e) {
      console.log("CREATE_ORDER_TPAY_CREATE_ERROR", String(e));
      await env.DB.prepare(
        `
        UPDATE orders
        SET status = ?, updated_at = datetime('now')
        WHERE ext_order_id = ?
      `,
      )
        .bind("TPAY_CREATE_ERROR", extOrderId)
        .run();

      return new Response("Tpay create order error", { status: 502 });
    }

    // Zapisz tpay_transaction_id do swojej bazy zamówień, aby w webhooku potwierdzić opłacenie (podmień nazwy pól na swoje własne)
    if (tpayTransactionId) {
      try {
        await env.DB.prepare(
          `
          UPDATE orders
          SET tpay_transaction_id = ?, updated_at = datetime('now') 
          WHERE ext_order_id = ?
        `,
        )
          .bind(tpayTransactionId, extOrderId)
          .run();

        console.log(
          "CREATE_ORDER_DB_UPDATE_TPAY_ID_SUCCESS",
          tpayTransactionId,
        );
      } catch (e) {
        console.log("CREATE_ORDER_DB_UPDATE_TPAY_ID_ERROR", String(e));
      }
    }

    // Na koniec zwracamy link przekierowujący
    return new Response(
      JSON.stringify({
        paymentProvider: "tpay",
        redirectUrl: redirectUri,
        extOrderId,
        tpayTransactionId,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  // =========================================================
  // PAYU
  // =========================================================
  if (
    !env.PAYU_BASE_URL ||
    !env.PAYU_CLIENT_ID ||
    !env.PAYU_CLIENT_SECRET ||
    !env.PAYU_POS_ID
  ) {
    return new Response("Missing PayU env vars", { status: 500 });
  }

  // 1) OAuth token (PayU: bez x-www-form-urlencoded będzie 401)
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

  // 2) Create order w PayU
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
    }
  }

  return new Response(
    JSON.stringify({
      paymentProvider: "payu",
      redirectUrl: redirectUri,
      redirectUri,
      extOrderId,
      payuOrderId,
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
