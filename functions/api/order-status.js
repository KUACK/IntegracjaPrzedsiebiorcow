export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const order = url.searchParams.get("order");
  if (!order) return new Response("Missing order", { status: 400 });

  const data = await env.ORDERS.get(order);
  if (!data)
    return new Response(JSON.stringify({ found: false }), {
      headers: { "Content-Type": "application/json" },
    });

  return new Response(JSON.stringify({ found: true, ...JSON.parse(data) }), {
    headers: { "Content-Type": "application/json" },
  });
}
