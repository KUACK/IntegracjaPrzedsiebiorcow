export async function onRequestPost({ request, env }) {
  const input = await request.json().catch(() => null);
  if (!input) return new Response("Bad JSON", { status: 400 });

  const {
    fullName,
    email,
    phone,
    invoiceNeeded,
    companyName,
    nip,
    companyAddress,
    ticketType,
    quantity,
    promoCode,
  } = input;

  if (!fullName || !email || !phone || !ticketType) {
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
  const promoOkUntil = new Date(`${year}-03-01T00:00:00+01:00`); // początek marca czasu PL
  const promo = String(promoCode || "")
    .trim()
    .toLowerCase();
  const discountFactor = promo === "luty" && now < promoOkUntil ? 0.5 : 1;

  const unitPrice = Math.round(t.unit * discountFactor);
  const totalAmount = String(unitPrice * qty);

  const parts = String(fullName).trim().split(/\s+/);
  const firstName = parts[0] || "Klient";
  const lastName = parts.slice(1).join(" ") || "-";

  const extOrderId = crypto.randomUUID();

  // 1) OAuth token
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

  const notifyUrl = `${env.BASE_URL}/api/notify`;
  const continueUrl = `${env.BASE_URL}/thanks.html?order=${encodeURIComponent(extOrderId)}`;

  // 2) Utworzenie zamówienia
  const orderPayload = {
    notifyUrl,
    continueUrl,
    customerIp: request.headers.get("cf-connecting-ip") || "127.0.0.1",
    merchantPosId: env.PAYU_POS_ID,
    description: `Integracja Przedsiebiorcow - ${t.name}`,
    currencyCode: "PLN",
    totalAmount,
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
  if (!redirectUri)
    return new Response("No redirectUri from PayU", { status: 502 });

  // Zapisz “pending” w KV, żeby thanks.html mogło pytać o status
  await env.ORDERS.put(
    extOrderId,
    JSON.stringify({
      extOrderId,
      createdAt: new Date().toISOString(),
      status: "PENDING",
      ticketType: t.name,
      qty,
      email,
      phone,
      invoiceNeeded: !!invoiceNeeded,
      companyName: companyName || null,
      nip: nip || null,
      companyAddress: companyAddress || null,
      promoApplied: discountFactor !== 1,
      totalAmount,
    }),
  );

  return new Response(JSON.stringify({ redirectUri, extOrderId }), {
    headers: { "Content-Type": "application/json" },
  });
}
