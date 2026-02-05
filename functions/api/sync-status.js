export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const extOrderId = url.searchParams.get("order");
  if (!extOrderId) return new Response("Missing order", { status: 400 });
  if (!env.DB) return new Response("Missing D1 binding: DB", { status: 500 });

  const row = await env.DB.prepare(
    `
    SELECT ext_order_id, payu_order_id, status, email, full_name, ticket_type, quantity
    FROM orders
    WHERE ext_order_id = ?
    LIMIT 1
  `,
  )
    .bind(extOrderId)
    .first();

  if (!row) {
    return new Response(JSON.stringify({ found: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const payuOrderId = row.payu_order_id;
  if (!payuOrderId) {
    return new Response(
      JSON.stringify({ found: true, status: row.status, payuOrderId: null }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // OAuth
  const tokenRes = await fetch(
    `${env.PAYU_BASE_URL}/pl/standard/user/oauth/authorize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.PAYU_CLIENT_ID,
        client_secret: env.PAYU_CLIENT_SECRET,
      }),
    },
  );
  const tokenJson = await tokenRes.json().catch(() => ({}));
  const accessToken = tokenJson.access_token;
  if (!accessToken) return new Response("PayU auth failed", { status: 502 });

  async function getPayuStatus() {
    const r = await fetch(
      `${env.PAYU_BASE_URL}/api/v2_1/orders/${payuOrderId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const j = await r.json().catch(() => ({}));
    const status = j?.orders?.[0]?.status || null;
    return { http: r.status, status, raw: j };
  }

  let { status: payuStatus } = await getPayuStatus();

  // Jeśli PayU czeka na capture (auto-receive off) -> zrób capture
  if (String(payuStatus || "").toUpperCase() === "WAITING_FOR_CONFIRMATION") {
    await fetch(
      `${env.PAYU_BASE_URL}/api/v2_1/orders/${payuOrderId}/captures`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: "", // body ma być puste
      },
    );

    ({ status: payuStatus } = await getPayuStatus());
  }

  // Update w D1
  if (payuStatus) {
    await env.DB.prepare(
      `
      UPDATE orders
      SET status = ?, updated_at = datetime('now')
      WHERE ext_order_id = ?
    `,
    )
      .bind(payuStatus, extOrderId)
      .run();
  }

  // Utwórz bilety, jeśli COMPLETED
  if (String(payuStatus || "").toUpperCase() === "COMPLETED") {
    const q = Number(row.quantity || 0);
    for (let i = 1; i <= q; i++) {
      const ticketNo = `${row.ext_order_id}-${i}`;
      await env.DB.prepare(
        `
        INSERT OR IGNORE INTO tickets
          (ticket_no, ext_order_id, email, full_name, ticket_type, created_at)
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

  return new Response(
    JSON.stringify({
      found: true,
      extOrderId,
      payuOrderId,
      payuStatus: payuStatus || null,
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
