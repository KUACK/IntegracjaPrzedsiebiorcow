// functions/api/sync-status.js
import { finalizePaidOrder } from "../lib/finalize-paid-order.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const extOrderId = url.searchParams.get("order");

  if (!extOrderId) {
    return new Response("Missing order", { status: 400 });
  }

  if (!env.DB) {
    return new Response("Missing D1 binding: DB", { status: 500 });
  }

  const row = await env.DB.prepare(
    `
    SELECT
      ext_order_id,
      provider,
      payu_order_id,
      stripe_session_id,
      stripe_payment_intent_id,
      status
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

  if (String(row.provider || "").toLowerCase() !== "payu") {
    return new Response(
      JSON.stringify({
        found: true,
        extOrderId,
        provider: row.provider || null,
        status: row.status || null,
        skipped: true,
        reason: "sync-status supports PayU only",
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const payuOrderId = row.payu_order_id;
  if (!payuOrderId) {
    return new Response(
      JSON.stringify({
        found: true,
        extOrderId,
        provider: row.provider || "payu",
        status: row.status || null,
        payuOrderId: null,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

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

  if (!accessToken) {
    return new Response("PayU auth failed", { status: 502 });
  }

  async function getPayuStatus() {
    const r = await fetch(
      `${env.PAYU_BASE_URL}/api/v2_1/orders/${payuOrderId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const j = await r.json().catch(() => ({}));
    const status = j?.orders?.[0]?.status || null;

    return { http: r.status, status, raw: j };
  }

  let { status: payuStatus } = await getPayuStatus();

  if (String(payuStatus || "").toUpperCase() === "WAITING_FOR_CONFIRMATION") {
    await fetch(
      `${env.PAYU_BASE_URL}/api/v2_1/orders/${payuOrderId}/captures`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: "",
      },
    );

    ({ status: payuStatus } = await getPayuStatus());
  }

  let finalized = null;

  if (payuStatus) {
    finalized = await finalizePaidOrder({
      extOrderId,
      provider: "payu",
      status: payuStatus,
      payuOrderId,
      env,
    });
  }

  return new Response(
    JSON.stringify({
      found: true,
      extOrderId,
      provider: "payu",
      payuOrderId,
      payuStatus: payuStatus || null,
      finalized: finalized?.finalized || false,
      customerEmailSent: finalized?.customerEmailSent ?? null,
      adminEmailSent: finalized?.adminEmailSent ?? null,
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
