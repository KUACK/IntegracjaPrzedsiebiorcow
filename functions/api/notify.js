export async function onRequestPost({ request, env }) {
  const payload = await request.json().catch(() => null);
  if (!payload) return new Response("Bad JSON", { status: 400 });

  // PayU wysyła informacje o statusie zamówienia, m.in. extOrderId/orderId/status
  const order = payload.order || {};
  const extOrderId = order.extOrderId;
  const status = order.status;

  if (extOrderId) {
    const prev = await env.ORDERS.get(extOrderId);
    const data = prev ? JSON.parse(prev) : { extOrderId };
    data.status = status || data.status || "UNKNOWN";
    data.orderId = order.orderId || data.orderId || null;
    data.updatedAt = new Date().toISOString();
    await env.ORDERS.put(extOrderId, JSON.stringify(data));

    // TODO (następny krok): jeśli status oznacza “opłacone”, generujemy PDF i wysyłamy email.
  }

  return new Response("OK", { status: 200 });
}
