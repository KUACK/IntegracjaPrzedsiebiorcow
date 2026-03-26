// functions/api/notify.js
import { finalizePaidOrder } from "./finalize-paid-order.js";

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
  const extOrderId = order.extOrderId || null;
  const status = order.status || null;
  const payuOrderId = order.orderId || null;

  console.log(
    "PAYU_NOTIFY_PARSED",
    JSON.stringify({ extOrderId, status, payuOrderId }),
  );

  if (!extOrderId) {
    return new Response("OK", { status: 200 });
  }

  try {
    await finalizePaidOrder({
      extOrderId,
      provider: "payu",
      status,
      payuOrderId,
      env,
    });
  } catch (e) {
    console.log("PAYU_NOTIFY_FINALIZE_ERROR", String(e));
  }

  return new Response("OK", { status: 200 });
}
