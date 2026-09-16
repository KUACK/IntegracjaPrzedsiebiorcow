// functions/api/admin-add-order.js
//
// Endpoint do RĘCZNEGO dodawania uczestników, którzy zapłacili
// poza stroną (przelew, gotówka, faktura itp.). Tworzy wiersz w
// tabeli `orders` ze statusem COMPLETED i od razu woła
// finalizePaidOrder(), które wygeneruje bilety PDF z QR i wyśle
// maile do uczestnika oraz do admina — dokładnie tak samo jak po
// płatności przez Autopay.
//
// WYMAGA: import z Twojego istniejącego pliku finalize-paid-order.js
// Dostosuj ścieżkę importu do realnej struktury katalogów w projekcie.

import { finalizePaidOrder } from "./finalize-paid-order.js";

function createManualOrderId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `MANUAL${ts}${rand}`.slice(0, 32);
}

function normalizeText(value, max = 255) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8" },
  });
}

// Ten sam słownik typów biletów co w create-order.js — trzymaj go
// zsynchronizowany, jeśli zmieniasz ceny/nazwy tam.
const tickets = {
  jednodniowy9x: { dbName: "Bilet jednodniowy – 9 października", unit: 59900 },
  jednodniowy10x: {
    dbName: "Bilet jednodniowy – 10 października",
    unit: 59900,
  },
  jednodniowy9xbankiet: {
    dbName: "Bilet jednodniowy – 9 października + Bankiet",
    unit: 79600,
  },
  biznesplus: { dbName: "Biznes Plus – 2 dni", unit: 69900 },
  vipbankiet: { dbName: "VIP – 2 dni + bankiet", unit: 109900 },
  vip: { dbName: "VIP z Prezentacją – 2 dni + bankiet", unit: 159900 },
};

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return new Response("Missing D1 binding: DB", { status: 500 });
  }

  // --- Prosta autoryzacja: sekret w nagłówku ---
  const providedSecret = request.headers.get("x-admin-secret");
  if (!env.ADMIN_SECRET || providedSecret !== env.ADMIN_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const fullName = normalizeText(input?.fullName, 120);
  const email = normalizeText(input?.email, 255).toLowerCase();
  const phone = normalizeText(input?.phone, 40) || "-";
  const street = normalizeText(input?.street, 120) || "-";
  const city = normalizeText(input?.city, 80) || "-";
  const postalCode = normalizeText(input?.postalCode, 20) || "-";
  const ticketType = normalizeText(input?.ticketType, 50).toLowerCase();
  const quantity = Math.max(
    1,
    Math.min(20, parseInt(input?.quantity ?? "1", 10) || 1),
  );
  // Opcjonalnie: jeśli podasz totalAmountPLN ręcznie (np. bo była zniżka),
  // użyjemy tej kwoty zamiast cennika.
  const manualTotalPLN = input?.totalAmountPLN;

  if (!fullName || !email || !ticketType) {
    return new Response("Missing fields: fullName, email, ticketType", {
      status: 400,
    });
  }
  if (!isValidEmail(email)) {
    return new Response("Bad email", { status: 400 });
  }

  const t = tickets[ticketType];
  if (!t) {
    return new Response(
      `Unknown ticketType. Use one of: ${Object.keys(tickets).join(", ")}`,
      { status: 400 },
    );
  }

  const unitPrice = manualTotalPLN
    ? Math.round((Number(manualTotalPLN) * 100) / quantity)
    : t.unit;
  const totalAmount = unitPrice * quantity;

  const extOrderId = createManualOrderId();

  try {
    await env.DB.prepare(
      `
      INSERT INTO orders (
        ext_order_id, status, provider, created_at, updated_at, paid_at,
        full_name, email, phone, street, city, postal_code,
        ticket_type, quantity, unit_price, total_amount, promo_code, promo_applied
      ) VALUES (?, 'COMPLETED', 'manual', datetime('now'), datetime('now'), datetime('now'),
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, NULL, 0
      )
      `,
    )
      .bind(
        extOrderId,
        fullName,
        email,
        phone,
        street,
        city,
        postalCode,
        t.dbName,
        quantity,
        unitPrice,
        totalAmount,
      )
      .run();
  } catch (e) {
    return new Response(`DB insert failed: ${String(e)}`, { status: 500 });
  }

  // To wygeneruje bilety (PDF+QR) i wyśle maile do uczestnika + admina
  const finalized = await finalizePaidOrder({
    extOrderId,
    status: "COMPLETED",
    env,
  });

  return json({
    ok: true,
    extOrderId,
    finalized,
  });
}
