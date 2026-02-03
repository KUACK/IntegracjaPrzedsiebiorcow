export async function onRequestPost({ request, env }) {
  const payload = await request.json().catch(() => null);
  if (!payload) return new Response("Bad JSON", { status: 400 });

  if (!env.DB) return new Response("Missing D1 binding: DB", { status: 500 });

  const order = payload.order || {};
  const extOrderId = order.extOrderId;
  const status = order.status;
  const payuOrderId = order.orderId || null;

  if (!extOrderId) return new Response("OK", { status: 200 });

  // 1) Update status w orders
  await env.DB.prepare(
    `
    UPDATE orders
    SET status = COALESCE(?, status),
        payu_order_id = COALESCE(?, payu_order_id),
        updated_at = datetime('now')
    WHERE ext_order_id = ?
  `,
  )
    .bind(status || null, payuOrderId, extOrderId)
    .run();

  // 2) Jeśli opłacone: utwórz bilety (idempotentnie)
  if (status === "COMPLETED") {
    const row = await env.DB.prepare(
      `
      SELECT ext_order_id, email, full_name, ticket_type, quantity
      FROM orders
      WHERE ext_order_id = ?
      LIMIT 1
    `,
    )
      .bind(extOrderId)
      .first();

    if (row) {
      // prosta numeracja: extOrderId-1, extOrderId-2...
      for (let i = 1; i <= Number(row.quantity || 0); i++) {
        const ticketNo = `${row.ext_order_id}-${i}`;
        await env.DB.prepare(
          `
          INSERT OR IGNORE INTO tickets (ticket_no, ext_order_id, email, full_name, ticket_type, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `,
        )
          .bind(
            ticketNo,
            row.ext_order_id,
            row.email,
            row.full_name,
            row.ticket_type,
          )
          .run();
      }
    }
  }

  return new Response("OK", { status: 200 });
}
