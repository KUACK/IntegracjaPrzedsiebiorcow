async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createAutopayOrderId() {
  return (
    "P27" + crypto.randomUUID().replace(/-/g, "").toUpperCase().slice(0, 29)
  );
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
  if (
    !env.DB ||
    !env.AUTOPAY_SERVICE_ID ||
    !env.AUTOPAY_SHARED_KEY ||
    !env.AUTOPAY_GATEWAY_URL
  )
    return json({ error: "Brak konfiguracji płatności lub bazy." }, 500);
  if (
    String(env.AUTOPAY_CURRENCY || "PLN")
      .trim()
      .toUpperCase() !== "PLN"
  )
    return json({ error: "Ta oferta wymaga waluty PLN." }, 500);
  const deadline = Date.parse("2026-10-13T00:00:00+02:00");
  if (Date.now() >= deadline)
    return json({ error: "Sprzedaż zakończona." }, 410);
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Nieprawidłowe dane." }, 400);
  }
  const fullName = normalizeText(input?.fullName, 120);
  const email = normalizeText(input?.email, 255).toLowerCase();
  const phone = normalizeText(input?.phone, 40);
  const street = normalizeText(input?.street, 120);
  const city = normalizeText(input?.city, 80);
  const postalCode = normalizeText(input?.postalCode, 20);
  const ticketType = normalizeText(input?.ticketType, 50).toLowerCase();
  const qty = Number(input?.quantity ?? 1);
  if (
    !fullName ||
    !isValidEmail(email) ||
    !phone ||
    !street ||
    !city ||
    !postalCode
  )
    return json({ error: "Uzupełnij dane kupującego." }, 400);
  if (qty !== 1) {
    return json(
      { error: "Jedno zamówienie może obejmować tylko jeden bilet." },
      400,
    );
  }
  if (input?.consent !== true && input?.consent !== "on")
    return json({ error: "Zaakceptuj regulamin i politykę prywatności." }, 400);
  if (normalizeText(input?.promoCode, 50))
    return json({ error: "Oferta nie obsługuje kodów rabatowych." }, 400);
  const tickets = {
    obra2027nocleg: {
      dbName: "Obra 2027 – pełny bilet z noclegiem (pokój jednoosobowy)",
      autopayName: "Obra 2027 pelny z noclegiem 1 os",
      unit: 79000,
    },
    obra2027bez: {
      dbName: "Obra 2027 – pełny bilet bez noclegu",
      autopayName: "Obra 2027 pelny bez noclegu",
      unit: 300,
    },
  };
  const t = Object.hasOwn(tickets, ticketType) ? tickets[ticketType] : null;
  if (!t) return json({ error: "Nieprawidłowy wariant biletu." }, 400);
  const unitPrice = t.unit,
    totalAmount = unitPrice * qty;
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
    const args = [
      extOrderId,
      fullName,
      email,
      phone,
      street,
      city,
      postalCode,
      ticketType,
      t.dbName,
      qty,
      unitPrice,
      totalAmount,
      Math.floor(deadline / 1000),
    ];
    let sql = `INSERT INTO preorders2027 (ext_order_id,full_name,email,phone,street,city,postal_code,ticket_code,ticket_type,quantity,unit_price,total_amount)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE unixepoch('now') < ?`;
    if (ticketType === "obra2027nocleg") {
      sql += ` AND (SELECT COALESCE(SUM(quantity),0) FROM preorders2027 WHERE ticket_code='obra2027nocleg') + ? <= 50`;
      args.push(qty);
    }
    const result = await env.DB.prepare(sql)
      .bind(...args)
      .run();
    if (Number(result.meta?.changes) !== 1)
      return json(
        {
          error:
            Date.now() >= deadline
              ? "Sprzedaż zakończona."
              : "Brak wystarczającej liczby miejsc z noclegiem.",
        },
        Date.now() >= deadline ? 410 : 409,
      );
  } catch (error) {
    console.error("PREORDER2027_INSERT", String(error));
    return json({ error: "Nie udało się zapisać zamówienia." }, 500);
  }
  return json({
    ok: true,
    extOrderId,
    paymentProvider: "autopay",
    redirectUrl: String(env.AUTOPAY_GATEWAY_URL).trim(),
    redirectMethod: "POST",
    redirectFields,
    amountGrosze: totalAmount,
    amount: amountForAutopay,
    currency: redirectFields.Currency,
  });
}
