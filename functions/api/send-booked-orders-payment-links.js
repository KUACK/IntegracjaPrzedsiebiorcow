// functions/api/send-booked-orders-payment-links.js

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
    .replace(/[^A-Za-z0-9 .:\,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 79);
}

function safeOneLine(value, maxLen = 140) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return new Response("Missing DB", { status: 500 });
  if (!env.RESEND_API_KEY)
    return new Response("Missing RESEND_API_KEY", { status: 500 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON. Expected { "ids": [1, 2, 3] }', {
      status: 400,
    });
  }

  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) {
    return new Response(
      'No IDs provided. Safety block. Pass { "ids": [1] } to test.',
      { status: 400 },
    );
  }

  const placeholders = ids.map(() => "?").join(",");
  const q = `SELECT * FROM booked_orders WHERE id IN (${placeholders})`;

  const bookedResult = await env.DB.prepare(q)
    .bind(...ids)
    .all();
  const bookedOrders = bookedResult.results || [];

  if (bookedOrders.length === 0) {
    return new Response(`No booked orders found for ids: ${ids.join(",")}`, {
      status: 404,
    });
  }

  const results = [];

  for (const booked of bookedOrders) {
    // Bezpiecznik na notes
    if (String(booked.notes || "").includes("payment-link-sent")) {
      results.push({
        id: booked.id,
        status: "skipped",
        reason: "Already sent",
      });
      continue;
    }

    const extOrderId = createAutopayOrderId();
    const token = crypto.randomUUID();

    // 1. Zapisujemy go w nowej tabeli orders
    try {
      await env.DB.prepare(
        `
        INSERT INTO orders (
          ext_order_id, status, provider, created_at, updated_at,
          full_name, email, phone, street, city, postal_code,
          ticket_type, quantity, unit_price, total_amount, promo_code, promo_applied
        ) VALUES (?, ?, ?, datetime('now'), datetime('now'),
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?)
      `,
      )
        .bind(
          extOrderId,
          "PENDING",
          "autopay",
          booked.full_name,
          booked.email,
          booked.phone,
          booked.street,
          booked.city,
          booked.postal_code,
          booked.ticket_name,
          booked.quantity,
          booked.unit_price,
          booked.total_amount,
          booked.promo_code || null,
          booked.promo_applied,
        )
        .run();
    } catch (e) {
      results.push({
        id: booked.id,
        status: "error",
        step: "insert_order",
        error: String(e),
      });
      continue;
    }

    // 2. Wysyłka e-maila
    const base = env.PUBLIC_BASE_URL || "https://integracjaprzedsiebiorcow.eu";
    const paymentLink = `${base}/api/pay-booked-order?order=${extOrderId}&token=${token}`;

    const ticketCount = booked.quantity;
    const ticketWord =
      ticketCount === 1 ? "bilet" : ticketCount < 5 ? "bilety" : "biletów";
    const amountPLN = (Number(booked.total_amount || 0) / 100).toFixed(2);

    const emailPayload = {
      from:
        env.EMAIL_FROM ||
        "Integracja Przedsiębiorców <noreply@integracjaprzedsiebiorcow.eu>",
      to: [booked.email],
      subject: `Dokończ zakup na Integrację Przedsiębiorców`,
      html: `
        <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
          <div style="background:#0f172a;padding:24px 32px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:22px;">Integracja Przedsiębiorców</h1>
          </div>
          <div style="padding:32px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
            <p style="font-size:16px;margin-top:0;">Cześć <strong>${safeOneLine(booked.full_name, 80)}</strong>,</p>
            <p style="font-size:15px;line-height:1.6;">
              Dziękujemy za wcześniejszą rejestrację i cierpliwość! Zakończyliśmy przerwę techniczną u naszego operatora płatności (Autopay).
            </p>
            <p style="font-size:15px;line-height:1.6;">
              Przepraszamy za wszelkie niedogodności. Twoja rezerwacja na <strong>${ticketCount} ${ticketWord}</strong> typu <strong>${safeOneLine(booked.ticket_name, 80)}</strong> nadal na Ciebie czeka.
            </p>
            
            <div style="text-align:center; margin:32px 0;">
              <a href="${paymentLink}" style="background:#2563eb;color:#fff;text-decoration:none;padding:14px 24px;border-radius:6px;font-weight:bold;font-size:16px;display:inline-block;">
                Opłać zamówienie (${amountPLN} zł)
              </a>
            </div>

            <p style="font-size:14px;color:#6b7280;line-height:1.6;">
              Kliknięcie w przycisk przeniesie Cię na bezpieczną stronę bramki Autopay. Po udanej płatności bilety wygenerują się automatycznie i trafią na ten sam adres e-mail.
            </p>
            <p style="font-size:14px;color:#6b7280;margin-bottom:0;">
              Pozdrawiamy,<br>Zespół Integracji Przedsiębiorców
            </p>
          </div>
        </div>
      `,
    };

    let mailSent = false;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify(emailPayload),
      });
      if (res.ok) mailSent = true;
    } catch (e) {
      console.log("MAIL_ERR", e);
    }

    if (!mailSent) {
      results.push({ id: booked.id, status: "error", step: "email" });
      continue;
    }

    // 3. Oznaczamy w booked_orders
    const newNotes = `payment-link-sent|order:${extOrderId}|token:${token}`;
    try {
      await env.DB.prepare(
        `UPDATE booked_orders SET notes = ?, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(newNotes, booked.id)
        .run();
    } catch (e) {
      results.push({
        id: booked.id,
        status: "warning",
        step: "update_notes",
        msg: "Mail sent, but notes update failed",
      });
      continue;
    }

    results.push({
      id: booked.id,
      status: "success",
      email: booked.email,
      extOrderId,
    });
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "Content-Type": "application/json" },
  });
}
