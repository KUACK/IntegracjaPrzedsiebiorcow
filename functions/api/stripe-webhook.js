// functions/api/stripe-webhook.js
import { finalizePaidOrder } from "../lib/finalize-paid-order.js";

function parseStripeSignature(header) {
  const out = {};
  for (const part of String(header || "").split(",")) {
    const [k, v] = part.split("=");
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parsed = parseStripeSignature(signatureHeader);
  const timestamp = parsed.t;
  const v1 = parsed.v1;

  if (!timestamp || !v1 || !secret) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );

  const expectedHex = bytesToHex(sig);
  return timingSafeEqualHex(expectedHex, v1);
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Missing STRIPE_WEBHOOK_SECRET", { status: 500 });
  }

  const raw = await request.text();
  const signature = request.headers.get("stripe-signature") || "";

  const verified = await verifyStripeSignature(
    raw,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );

  if (!verified) {
    return new Response("Invalid Stripe signature", { status: 400 });
  }

  let event;
  try {
    event = raw ? JSON.parse(raw) : null;
  } catch (e) {
    return new Response("Bad JSON", { status: 400 });
  }

  const type = event?.type || "";
  const obj = event?.data?.object || {};

  console.log(
    "STRIPE_WEBHOOK_EVENT",
    JSON.stringify({
      type,
      id: event?.id || null,
      objectId: obj?.id || null,
      paymentStatus: obj?.payment_status || null,
    }),
  );

  if (
    type !== "checkout.session.completed" &&
    type !== "checkout.session.async_payment_succeeded"
  ) {
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const extOrderId = obj?.metadata?.extOrderId || null;
  const stripeSessionId = obj?.id || null;
  const stripePaymentIntentId =
    typeof obj?.payment_intent === "string"
      ? obj.payment_intent
      : obj?.payment_intent?.id || null;

  if (!extOrderId) {
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await finalizePaidOrder({
    extOrderId,
    provider: "stripe",
    status: "COMPLETED",
    stripeSessionId,
    stripePaymentIntentId,
    env,
  });

  return new Response(
    JSON.stringify({
      received: true,
      finalized: !!result?.finalized,
      extOrderId,
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
