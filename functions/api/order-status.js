// functions/api/order-status.js
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const order = url.searchParams.get("order");

  if (!order) return new Response("Missing order", { status: 400 });
  if (!env.DB) return new Response("Missing D1 binding: DB", { status: 500 });

  const row = await env.DB.prepare(
    `
    SELECT
      ext_order_id,
      status,
      provider,
      autopay_remote_id,
      autopay_payment_status,
      ticket_type,
      quantity,
      paid_at,
      updated_at
    FROM orders
    WHERE ext_order_id = ?
    LIMIT 1
    `,
  )
    .bind(order)
    .first();

  if (!row) {
    return new Response(JSON.stringify({ found: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      found: true,
      extOrderId: row.ext_order_id,
      status: row.status,
      provider: row.provider,
      autopayRemoteId: row.autopay_remote_id,
      autopayPaymentStatus: row.autopay_payment_status,
      ticketType: row.ticket_type,
      quantity: row.quantity,
      paidAt: row.paid_at,
      updatedAt: row.updated_at,
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
