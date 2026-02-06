function safeOneLine(value, maxLen = 140) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const extOrderId = safeOneLine(url.searchParams.get("order") || "", 120);

  if (!extOrderId) {
    return new Response(JSON.stringify({ ok: false, error: "Missing order" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!env.DB) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing D1 binding: DB" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const q = await env.DB.prepare(
    `
      SELECT ticket_no, ticket_token
      FROM tickets
      WHERE ext_order_id = ?
      ORDER BY id ASC
    `,
  )
    .bind(extOrderId)
    .all(); // D1 prepared statements + all() [web:525]

  const tickets = (q.results || []).map((r) => ({
    ticketNo: r.ticket_no,
    token: r.ticket_token,
  }));

  return new Response(JSON.stringify({ ok: true, tickets }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
