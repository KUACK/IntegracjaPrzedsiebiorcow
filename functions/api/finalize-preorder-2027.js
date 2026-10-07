import { sendPreorder2027AdminNotification } from "./send-preorder-2027-admin.js";

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function makeEmail(order, env) {
  const amount = (Number(order.total_amount) / 100)
    .toFixed(2)
    .replace(".", ",");
  const text = `Dziękujemy za zapisanie się, ${order.full_name}!\nTwoja płatność za Integrację Przedsiębiorców 2027 w Obrze została potwierdzona.\nNumer zamówienia: ${order.ext_order_id}\nWariant: ${order.ticket_type}\nLiczba biletów: ${order.quantity}\nZapłacono: ${amount} PLN\nTwój bilet dostarczymy Ci mailowo, kiedy będzie gotowy.\nTo potwierdzenie zamówienia, nie bilet wstępu.`;
  return {
    from:
      env.EMAIL_FROM ||
      "Integracja Przedsiębiorców <noreply@integracjaprzedsiebiorcow.eu>",
    to: [order.email],
    subject: `Potwierdzenie zamówienia ${order.ext_order_id} – Integracja 2027`,
    text,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;color:#243b53"><h1>Integracja Przedsiębiorców 2027</h1><p>Dziękujemy za zapisanie się, ${escapeHtml(order.full_name)}!</p><p>Twoja płatność została potwierdzona.</p><p>Numer zamówienia: <strong>${escapeHtml(order.ext_order_id)}</strong></p><p>Wariant: ${escapeHtml(order.ticket_type)}<br>Liczba biletów: ${order.quantity}<br>Zapłacono: ${amount} PLN</p><p>Twój bilet dostarczymy Ci mailowo, kiedy będzie gotowy!</p><p>To potwierdzenie zamówienia, nie bilet wstępu.</p></div>`,
  };
}
export async function sendPreorder2027Confirmation({ extOrderId, env }) {
  const row = await env.DB.prepare(
    "SELECT * FROM paidpreorders2027 WHERE ext_order_id=?",
  )
    .bind(extOrderId)
    .first();
  if (!row) throw new Error("Paid preorder not found");
  if (row.email_sent) return { ok: true, customerEmailSent: true };
  if (!env.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  const now = Math.floor(Date.now() / 1000),
    token = crypto.randomUUID();
  if (
    row.email_first_attempt_at &&
    now - Number(row.email_first_attempt_at) >= 23 * 3600
  ) {
    await env.DB.prepare(
      "UPDATE paidpreorders2027 SET email_last_error=? WHERE ext_order_id=? AND email_sent=0",
    )
      .bind("Manual review required: retry window exceeded", extOrderId)
      .run();
    throw new Error("Email requires manual review; do not blindly resend");
  }
  const lock = await env.DB.prepare(
    `UPDATE paidpreorders2027 SET email_lock_token=?,email_lock_until=?,
    email_payload=COALESCE(email_payload,?),email_first_attempt_at=COALESCE(email_first_attempt_at,?),email_attempts=email_attempts+1
    WHERE ext_order_id=? AND email_sent=0 AND (email_lock_until IS NULL OR email_lock_until < ?)
    AND (email_first_attempt_at IS NULL OR email_first_attempt_at > ?)`,
  )
    .bind(
      token,
      now + 120,
      JSON.stringify(makeEmail(row, env)),
      now,
      extOrderId,
      now,
      now - 23 * 3600,
    )
    .run();
  if (Number(lock.meta?.changes) !== 1)
    throw new Error("Email already processing or requires review");
  try {
    const locked = await env.DB.prepare(
      "SELECT email_payload FROM paidpreorders2027 WHERE ext_order_id=? AND email_lock_token=?",
    )
      .bind(extOrderId, token)
      .first();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Idempotency-Key": `preorder2027/${extOrderId}`,
      },
      body: locked.email_payload,
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id)
      throw new Error(
        `Resend ${response.status}: ${data.message || "missing email id"}`,
      );
    const saved = await env.DB.prepare(
      `UPDATE paidpreorders2027 SET email_sent=1,email_sent_at=datetime('now'),email_provider_id=?,
      email_lock_token=NULL,email_lock_until=NULL,email_last_error=NULL,updated_at=datetime('now') WHERE ext_order_id=? AND email_lock_token=?`,
    )
      .bind(data.id, extOrderId, token)
      .run();
    if (Number(saved.meta?.changes) !== 1)
      throw new Error(
        "Email accepted but database acknowledgement needs retry",
      );
    return { ok: true, customerEmailSent: true };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE paidpreorders2027 SET email_lock_token=NULL,email_lock_until=NULL,email_last_error=? WHERE ext_order_id=? AND email_lock_token=?",
    )
      .bind(String(error).slice(0, 500), extOrderId, token)
      .run();
    throw error;
  }
}
export async function finalizePreorder2027({
  extOrderId,
  status,
  remoteID,
  paymentDate,
  paymentStatus,
  gatewayID,
  env,
}) {
  const completed = status === "COMPLETED";
  const update = env.DB.prepare(
    `UPDATE preorders2027 SET
    status=CASE WHEN status='COMPLETED' THEN status ELSE ? END,
    paid_at=CASE WHEN ?='COMPLETED' THEN COALESCE(paid_at,datetime('now')) ELSE paid_at END,
    autopay_remote_id=COALESCE(autopay_remote_id,?),
    autopay_payment_status=CASE WHEN status='COMPLETED' THEN autopay_payment_status ELSE ? END,
    autopay_payment_date=COALESCE(autopay_payment_date,?),autopay_gateway_id=COALESCE(autopay_gateway_id,?),updated_at=datetime('now')
    WHERE ext_order_id=?`,
  ).bind(
    status,
    status,
    remoteID || null,
    paymentStatus || null,
    paymentDate || null,
    gatewayID || null,
    extOrderId,
  );
  const statements = [update];
  if (completed)
    statements.push(
      env.DB.prepare(
        `INSERT INTO paidpreorders2027
    (ext_order_id,status,provider,created_at,paid_at,full_name,email,phone,street,city,postal_code,ticket_code,ticket_type,quantity,unit_price,total_amount,currency,autopay_remote_id,autopay_payment_date)
    SELECT ext_order_id,'COMPLETED',provider,created_at,paid_at,full_name,email,phone,street,city,postal_code,ticket_code,ticket_type,quantity,unit_price,total_amount,currency,autopay_remote_id,autopay_payment_date
    FROM preorders2027 WHERE ext_order_id=? AND status='COMPLETED'
    ON CONFLICT(ext_order_id) DO NOTHING`,
      ).bind(extOrderId),
    );
  await env.DB.batch(statements);
  if (!completed) return { ok: true, finalized: false };
  const results = await Promise.allSettled([
    sendPreorder2027Confirmation({ extOrderId, env }),
    sendPreorder2027AdminNotification({ extOrderId, env }),
  ]);

  const failed = results.filter((result) => result.status === "rejected");

  if (failed.length) {
    throw new Error(failed.map((result) => String(result.reason)).join("; "));
  }

  return {
    ok: true,
    finalized: true,
    customerEmailSent: results[0].value.customerEmailSent,
    adminEmailSent: results[1].value.adminEmailSent,
  };
}
