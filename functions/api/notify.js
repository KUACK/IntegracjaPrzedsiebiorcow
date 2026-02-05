export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);

  console.log(
    "PAYU_NOTIFY_REQUEST",
    JSON.stringify({
      method: request.method,
      path: url.pathname,
      host: url.host,
      ua: request.headers.get("user-agent"),
      cfRay: request.headers.get("cf-ray"),
      ip: request.headers.get("cf-connecting-ip"),
      ct: request.headers.get("content-type"),
    }),
  );

  if (!env.DB) {
    console.log("PAYU_NOTIFY_ERROR", "Missing D1 binding: DB");
    return new Response("Missing D1 binding: DB", { status: 500 });
  }

  const raw = await request.text();
  console.log(
    "PAYU_NOTIFY_RAW",
    raw.length > 4000 ? raw.slice(0, 4000) + "…(truncated)" : raw,
  );

  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.log("PAYU_NOTIFY_PARSE_ERROR", String(e));
    return new Response("OK", { status: 200 });
  }

  const order = payload?.order || {};
  const extOrderId = order.extOrderId;
  const status = order.status;
  const payuOrderId = order.orderId || null;

  console.log(
    "PAYU_NOTIFY_PARSED",
    JSON.stringify({ extOrderId, status, payuOrderId }),
  );

  if (!extOrderId) return new Response("OK", { status: 200 });

  try {
    const upd = await env.DB.prepare(
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

    console.log("PAYU_NOTIFY_DB_UPDATE", JSON.stringify(upd));
  } catch (e) {
    console.log("PAYU_NOTIFY_DB_UPDATE_ERROR", String(e));
    return new Response("OK", { status: 200 });
  }

  if (status === "COMPLETED") {
    try {
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

      console.log(
        "PAYU_NOTIFY_ORDER_ROW",
        JSON.stringify({
          found: !!row,
          quantity: row?.quantity,
          ticketType: row?.ticket_type,
        }),
      );

      if (row) {
        const q = Number(row.quantity || 0);
        for (let i = 1; i <= q; i++) {
          const ticketNo = `${row.ext_order_id}-${i}`;
          const ins = await env.DB.prepare(
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

          console.log(
            "PAYU_NOTIFY_TICKET_INSERT",
            JSON.stringify({ ticketNo, result: ins }),
          );
        }
      }
    } catch (e) {
      console.log("PAYU_NOTIFY_TICKET_ERROR", String(e));
      return new Response("OK", { status: 200 });
    }
  }

  return new Response("OK", { status: 200 });
}
