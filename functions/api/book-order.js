function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
}

function normalizePhone(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePostalCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^(\d{2})(\d{3})$/, "$1-$2");
}

function validatePromoAndPrice(ticketType, qty, promoCode) {
  const tickets = {
    premium: { name: "Premium – 1 dzień", unit: 49900 },
    biznesplus: { name: "Biznes Plus – 2 dni", unit: 59900 },
    vipbankiet: { name: "VIP – 2 dni + bankiet", unit: 99900 },
    vip: { name: "VIP z Prezentacją – 2 dni + bankiet", unit: 149900 },
  };

  const t =
    tickets[
      String(ticketType || "")
        .trim()
        .toLowerCase()
    ];
  if (!t) {
    return { error: "Unknown ticketType" };
  }

  const now = new Date();
  const rawPromo = String(promoCode || "").trim();
  const promo = rawPromo.toLowerCase();

  let discountFactor = 1;
  let fixedPriceGrosze = 0;
  let canonicalPromoCode = rawPromo || null;

  if (promo === "kwiecien" || promo === "kwiecień") {
    const deadlineKwiecien = new Date("2026-05-01T00:00:00+02:00");
    if (now < deadlineKwiecien) {
      discountFactor = 0.65;
      canonicalPromoCode = "KWIECIEN";
    }
  } else if (promo === "naskale") {
    const deadline = new Date("2026-03-30T00:00:00+01:00");
    if (now < deadline) {
      discountFactor = 0.5;
      canonicalPromoCode = "NASKALE";
    }
  } else if (promo === "talent") {
    const deadline = new Date("2026-05-01T00:00:00+02:00");
    if (now < deadline) {
      discountFactor = 0.5;
      canonicalPromoCode = "TALENT";
    }
  } else if (promo === "ligotzki022725@") {
    fixedPriceGrosze = 200;
    canonicalPromoCode = "LIGOTZKI022725@";
  }

  const unitPrice =
    fixedPriceGrosze > 0
      ? fixedPriceGrosze
      : Math.round(t.unit * discountFactor);

  const totalAmount = unitPrice * qty;
  const promoApplied = discountFactor !== 1 || fixedPriceGrosze > 0 ? 1 : 0;

  return {
    ticket: t,
    unitPrice,
    totalAmount,
    promoApplied,
    discountFactor,
    fixedPriceGrosze,
    canonicalPromoCode,
  };
}

export async function onRequestPost({ request, env }) {
  const reqUrl = new URL(request.url);

  console.log(
    "BOOK_ORDER_REQUEST",
    JSON.stringify({
      method: request.method,
      host: reqUrl.host,
      path: reqUrl.pathname,
      ct: request.headers.get("content-type"),
      cfRay: request.headers.get("cf-ray"),
    }),
  );

  if (!env.DB) {
    return json({ error: "Missing D1 binding: DB" }, 500);
  }

  const input = await request.json().catch(() => null);
  if (!input) {
    return json({ error: "Bad JSON" }, 400);
  }

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
    return json({ error: "Missing fields" }, 400);
  }

  const normalizedFullName = String(fullName).trim();
  const normalizedEmail = String(email).trim();
  const normalizedPhone = normalizePhone(phone);
  const normalizedStreet = String(street).trim();
  const normalizedCity = String(city).trim();
  const normalizedPostalCode = normalizePostalCode(postalCode);
  const normalizedTicketType = String(ticketType).trim().toLowerCase();

  const parsedQty = parseInt(quantity || "1", 10);
  if (!Number.isFinite(parsedQty)) {
    return json({ error: "Bad quantity" }, 400);
  }

  const qty = Math.max(1, Math.min(20, parsedQty));

  if (normalizedFullName.length < 3) {
    return json({ error: "Podaj imię i nazwisko." }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return json({ error: "Podaj poprawny adres e-mail." }, 400);
  }

  if (!/^[0-9+\s()\-]{6,20}$/.test(normalizedPhone)) {
    return json({ error: "Podaj poprawny numer telefonu." }, 400);
  }

  if (normalizedStreet.length < 3) {
    return json({ error: "Podaj ulicę." }, 400);
  }

  if (normalizedCity.length < 2) {
    return json({ error: "Podaj miasto." }, 400);
  }

  if (!/^\d{2}-\d{3}$/.test(normalizedPostalCode)) {
    return json({ error: "Podaj kod pocztowy w formacie 00-000." }, 400);
  }

  if (qty < 1 || qty > 20) {
    return json({ error: "Ilość biletów musi być od 1 do 20." }, 400);
  }

  const pricing = validatePromoAndPrice(
    normalizedTicketType,
    qty,
    promoCode || "",
  );

  if (pricing.error) {
    return json({ error: pricing.error }, 400);
  }

  const extBookingId = crypto.randomUUID();
  const paymentProviderTarget = "payu";
  const status = "BOOKED";

  try {
    await env.DB.prepare(
      `
      INSERT INTO booked_orders (
        ext_booking_id,
        status,
        full_name,
        email,
        phone,
        street,
        city,
        postal_code,
        ticket_code,
        ticket_name,
        quantity,
        base_unit_price,
        unit_price,
        total_amount,
        promo_code,
        promo_applied,
        discount_factor,
        fixed_price_grosze,
        payment_provider_target,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        datetime('now'),
        datetime('now')
      )
      `,
    )
      .bind(
        extBookingId,
        status,
        normalizedFullName,
        normalizedEmail,
        normalizedPhone,
        normalizedStreet,
        normalizedCity,
        normalizedPostalCode,
        normalizedTicketType,
        pricing.ticket.name,
        qty,
        pricing.ticket.unit,
        pricing.unitPrice,
        pricing.totalAmount,
        pricing.canonicalPromoCode,
        pricing.promoApplied,
        pricing.discountFactor,
        pricing.fixedPriceGrosze,
        paymentProviderTarget,
      )
      .run();
  } catch (e) {
    console.log("BOOK_ORDER_DB_INSERT_ERROR", String(e));
    return json({ error: "DB insert failed" }, 500);
  }

  return json({
    ok: true,
    status,
    extBookingId,
    paymentProviderTarget,
    unitPrice: pricing.unitPrice,
    totalAmount: pricing.totalAmount,
    message:
      "Dziękujemy, zapis został przyjęty. Link do płatności wyślemy mailowo, gdy operator płatności zostanie odblokowany.",
  });
}
