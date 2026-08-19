async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createAutopayOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${ts}${rand}`.slice(0, 32);
}

function sanitizeAutopayDescription(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9 .:,\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 79);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function normalizeText(value, max = 255) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return new Response("Missing D1 binding: DB", { status: 500 });
  }

  if (
    !env.AUTOPAY_SERVICE_ID ||
    !env.AUTOPAY_SHARED_KEY ||
    !env.AUTOPAY_GATEWAY_URL
  ) {
    return new Response(
      "Missing AUTOPAY_SERVICE_ID / AUTOPAY_SHARED_KEY / AUTOPAY_GATEWAY_URL",
      { status: 500 },
    );
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const fullName = normalizeText(input?.fullName, 120);
  const email = normalizeText(input?.email, 255).toLowerCase();
  const phone = normalizeText(input?.phone, 40);
  const street = normalizeText(input?.street, 120);
  const city = normalizeText(input?.city, 80);
  const postalCode = normalizeText(input?.postalCode, 20);
  const ticketType = normalizeText(input?.ticketType, 50).toLowerCase();
  const promoCodeRaw = normalizeText(input?.promoCode, 50);

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

  if (!isValidEmail(email)) {
    return new Response("Bad email", { status: 400 });
  }

  const parsedQty = parseInt(String(input?.quantity ?? "1"), 10);
  if (!Number.isFinite(parsedQty)) {
    return new Response("Bad quantity", { status: 400 });
  }
  const qty = Math.max(1, Math.min(20, parsedQty));

  // ==========================================================
  // SŁOWNIK TYPÓW BILETÓW
  // Bilet jednodniowy (dawny "premium") rozbity na 3 warianty,
  // bo dzień oraz udział w bankiecie zmieniają cenę i muszą być
  // rozpoznawalne jako osobne pozycje w zamówieniu / na fakturze.
  // ==========================================================
  const tickets = {
    jednodniowy9x: {
      dbName: "Bilet jednodniowy – 9 października",
      autopayName: "Jednodniowy 9 X",
      unit: 49900, // 499 PLN
    },
    jednodniowy10x: {
      dbName: "Bilet jednodniowy – 10 października",
      autopayName: "Jednodniowy 10 X",
      unit: 49900, // 499 PLN
    },
    jednodniowy9xbankiet: {
      dbName: "Bilet jednodniowy – 9 października + Bankiet",
      autopayName: "Jednodniowy 9 X plus Bankiet",
      unit: 69600, // 499 PLN + 197 PLN bankiet = 696 PLN
    },
    biznesplus: {
      dbName: "Biznes Plus – 2 dni",
      autopayName: "Biznes Plus - 2 dni",
      unit: 59900,
    },
    vipbankiet: {
      dbName: "VIP – 2 dni + bankiet",
      autopayName: "VIP - 2 dni bankiet",
      unit: 99900,
    },
    vip: {
      dbName: "VIP z Prezentacją – 2 dni + bankiet",
      autopayName: "VIP prezentacja - 2 dni bankiet",
      unit: 149900,
    },
  };

  const t = tickets[ticketType];
  if (!t) {
    return new Response("Unknown ticketType", { status: 400 });
  }

  const now = new Date();
  const promo = promoCodeRaw.toLowerCase();

  let discountFactor = 1;
  let fixedPriceGrosze = 0;

  const promoDeadline = new Date("2026-09-01T00:00:00+02:00");
  // Nowe kody promocyjne (wrzesień/październik/integracja/BRFH/Poznań/Talent/Jesień)
  // ważne do 10 października 2026 włącznie.
  const promoDeadline2 = new Date("2026-10-10T23:59:59+02:00");

  if (promo === "lipiec") {
    if (now < promoDeadline) discountFactor = 0.65;
  } else if (promo === "naskale") {
    if (now < promoDeadline) discountFactor = 0.5;
  } else if (promo === "talent") {
    if (now < promoDeadline) discountFactor = 0.5;
  } else if (promo === "asknet12#") {
    fixedPriceGrosze = 300;
  } else if (promo === "talent45") {
    if (now < promoDeadline2) discountFactor = 0.55; // -45%
  } else if (
    promo === "40wrzesien" ||
    promo === "pazdziernik40" ||
    promo === "40brfh"
  ) {
    if (now < promoDeadline2) discountFactor = 0.6; // -40%
  } else if (
    promo === "wrzesien35" ||
    promo === "35pazdziernik" ||
    promo === "integracja35"
  ) {
    if (now < promoDeadline2) discountFactor = 0.65; // -35%
  } else if (
    promo === "brfh30pl" ||
    promo === "wrzesien30" ||
    promo === "30integracja"
  ) {
    if (now < promoDeadline2) discountFactor = 0.7; // -30%
  } else if (
    promo === "brfh20" ||
    promo === "poznan20" ||
    promo === "20integracja"
  ) {
    if (now < promoDeadline2) discountFactor = 0.8; // -20%
  } else if (
    promo === "jesien15" ||
    promo === "pl15brfh" ||
    promo === "15integracja"
  ) {
    if (now < promoDeadline2) discountFactor = 0.85; // -15%
  }

  // Rabat (procentowy lub kod fixed-price) liczony jest od całej ceny
  // wariantu, w tym od biletów z dołączonym bankietem — bez osobnej
  // logiki dla "dodatku", bo cena bankietu jest już wliczona w unit.
  const unitPrice =
    fixedPriceGrosze > 0
      ? fixedPriceGrosze
      : Math.round(t.unit * discountFactor);

  const totalAmount = unitPrice * qty;
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return new Response("Bad amount", { status: 400 });
  }

  const extOrderId = createAutopayOrderId();
  const amountForAutopay = (totalAmount / 100).toFixed(2);

  const redirectFields = {
    ServiceID: String(env.AUTOPAY_SERVICE_ID).trim(),
    OrderID: extOrderId,
    Amount: amountForAutopay,
    Description: sanitizeAutopayDescription(
      `Bilet konferencyjny - ${t.autopayName}`,
    ),
    Currency: String(env.AUTOPAY_CURRENCY || "PLN").trim(),
    CustomerEmail: email,
  };

  if (env.AUTOPAY_GATEWAY_ID) {
    redirectFields.GatewayID = String(env.AUTOPAY_GATEWAY_ID).trim();
  }

  if (env.AUTOPAY_VALIDITY_TIME) {
    redirectFields.ValidityTime = String(env.AUTOPAY_VALIDITY_TIME).trim();
  }

  if (env.AUTOPAY_LINK_VALIDITY_TIME) {
    redirectFields.LinkValidityTime = String(
      env.AUTOPAY_LINK_VALIDITY_TIME,
    ).trim();
  }

  const hashParts = [
    redirectFields.ServiceID,
    redirectFields.OrderID,
    redirectFields.Amount,
    redirectFields.Description,
    redirectFields.GatewayID,
    redirectFields.Currency,
    redirectFields.CustomerEmail,
    redirectFields.ValidityTime,
    redirectFields.LinkValidityTime,
  ].filter((v) => v !== undefined && v !== null && String(v).trim() !== "");

  redirectFields.Hash = await sha256Hex(
    `${hashParts.join("|")}|${String(env.AUTOPAY_SHARED_KEY)}`,
  );

  try {
    await env.DB.prepare(
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
        "autopay",
        fullName,
        email,
        phone,
        street,
        city,
        postalCode,
        t.dbName,
        qty,
        unitPrice,
        totalAmount,
        promoCodeRaw || null,
        discountFactor !== 1 || fixedPriceGrosze > 0 ? 1 : 0,
      )
      .run();
  } catch (e) {
    return new Response(`DB insert failed: ${String(e)}`, { status: 500 });
  }

  return json({
    ok: true,
    paymentProvider: "autopay",
    extOrderId,
    redirectUrl: String(env.AUTOPAY_GATEWAY_URL).trim(),
    redirectMethod: "POST",
    redirectFields,
    amountGrosze: totalAmount,
    amount: amountForAutopay,
    currency: redirectFields.Currency,
  });
}
