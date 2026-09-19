// functions/create-donation-order.js
// Endpoint Cloudflare Pages Functions: POST /create-donation-order
// Wzorowany na create-order.js (bilety), ale dla darowizn.

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Prefiks "DON" pozwala ITN odróżnić zamówienia darowizn od biletów
// bez zmiany struktury istniejącej tabeli orders.
function createDonationOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `DON${ts}${rand}`.slice(0, 32);
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

function isValidPesel(pesel) {
  return /^\d{11}$/.test(String(pesel || "").trim());
}

function isValidNip(nip) {
  return /^\d{10}$/.test(String(nip || "").replace(/[\s-]/g, ""));
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

  const donorType = normalizeText(input?.donorType, 20).toLowerCase();
  if (!["anonymous", "private", "company"].includes(donorType)) {
    return new Response("Bad donorType", { status: 400 });
  }

  const contactEmail = normalizeText(input?.contactEmail, 255).toLowerCase();
  if (!contactEmail || !isValidEmail(contactEmail)) {
    return new Response("Bad or missing contactEmail", { status: 400 });
  }

  const message = normalizeText(input?.message, 300);

  // Kwota: przyjmujemy PLN z frontendu, przeliczamy na grosze.
  const rawAmount = Number(input?.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return new Response("Bad amount", { status: 400 });
  }
  const amountGrosze = Math.round(rawAmount * 100);
  const MIN_GROSZE = 100; // 1 PLN
  const MAX_GROSZE = 10000000; // 100 000 PLN – zabezpieczenie przed pomyłką
  if (amountGrosze < MIN_GROSZE || amountGrosze > MAX_GROSZE) {
    return new Response("Amount out of allowed range", { status: 400 });
  }

  let fullName = null,
    address = null,
    pesel = null;
  let companyName = null,
    nip = null,
    companyAddress = null;

  if (donorType === "private") {
    fullName = normalizeText(input?.fullName, 120);
    address = normalizeText(input?.address, 255);
    pesel = normalizeText(input?.pesel, 11);

    if (!fullName || !address || !pesel) {
      return new Response(
        "Missing fields for private donor (fullName, address, pesel)",
        { status: 400 },
      );
    }
    if (!isValidPesel(pesel)) {
      return new Response("Bad PESEL format", { status: 400 });
    }
  }

  if (donorType === "company") {
    companyName = normalizeText(input?.companyName, 200);
    nip = normalizeText(input?.nip, 15);
    companyAddress = normalizeText(input?.companyAddress, 255);

    if (!companyName || !nip || !companyAddress) {
      return new Response(
        "Missing fields for company donor (companyName, nip, companyAddress)",
        { status: 400 },
      );
    }
    if (!isValidNip(nip)) {
      return new Response("Bad NIP format", { status: 400 });
    }
  }

  const extOrderId = createDonationOrderId();
  const amountForAutopay = (amountGrosze / 100).toFixed(2);

  const redirectFields = {
    ServiceID: String(env.AUTOPAY_SERVICE_ID).trim(),
    OrderID: extOrderId,
    Amount: amountForAutopay,
    Description: sanitizeAutopayDescription("Darowizna na cele kultu religijnego"),
    Currency: String(env.AUTOPAY_CURRENCY || "PLN").trim(),
    CustomerEmail: contactEmail,
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
      INSERT INTO donations (
        ext_order_id, status, provider, donor_type,
        full_name, pesel, address,
        company_name, nip, company_address,
        contact_email, amount_grosze, message,
        created_at, updated_at
      ) VALUES (?, 'PENDING', 'autopay', ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        datetime('now'), datetime('now')
      )
      `,
    )
      .bind(
        extOrderId,
        donorType,
        fullName,
        pesel,
        address,
        companyName,
        nip,
        companyAddress,
        contactEmail,
        amountGrosze,
        message || null,
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
    amountGrosze,
    amount: amountForAutopay,
    currency: redirectFields.Currency,
  });
}
