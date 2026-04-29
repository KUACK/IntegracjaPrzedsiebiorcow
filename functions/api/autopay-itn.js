import { finalizePaidOrder } from "./finalize-paid-order.js";

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getTagValue(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const m = String(xml || "").match(re);
  return m ? m[1].trim() : null;
}

function decodeBase64Utf8(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readTransactionsParam(request) {
  const ct = String(request.headers.get("content-type") || "").toLowerCase();

  if (
    ct.includes("application/x-www-form-urlencoded") ||
    ct.includes("multipart/form-data")
  ) {
    const form = await request.formData().catch(() => null);
    if (form) {
      const val = form.get("transactions");
      if (val) return String(val);
    }
  }

  const raw = await request.text().catch(() => "");
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  return params.get("transactions");
}

function mapAutopayStatus(paymentStatus) {
  const s = String(paymentStatus || "")
    .trim()
    .toUpperCase();
  if (s === "SUCCESS") return "COMPLETED";
  if (s === "FAILURE") return "CANCELED";
  return "PENDING";
}

function buildConfirmationXml({ serviceID, orderID, confirmation, hash }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<confirmationList>
  <serviceID>${xmlEscape(serviceID)}</serviceID>
  <transactionsConfirmations>
    <transactionConfirmed>
      <orderID>${xmlEscape(orderID)}</orderID>
      <confirmation>${xmlEscape(confirmation)}</confirmation>
    </transactionConfirmed>
  </transactionsConfirmations>
  <hash>${xmlEscape(hash)}</hash>
</confirmationList>`;
}

async function buildConfirmationResponse({
  serviceID,
  orderID,
  confirmation,
  env,
}) {
  const responseHash = await sha256Hex(
    `${serviceID}|${orderID}|${confirmation}|${String(env.AUTOPAY_SHARED_KEY)}`,
  );

  const xml = buildConfirmationXml({
    serviceID,
    orderID,
    confirmation,
    hash: responseHash,
  });

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  console.log(
    "AUTOPAY_ITN_REQUEST",
    JSON.stringify({
      method: request.method,
      path: url.pathname,
      ip: request.headers.get("cf-connecting-ip"),
      ct: request.headers.get("content-type"),
      ua: request.headers.get("user-agent"),
    }),
  );

  if (!env.DB) {
    console.log("AUTOPAY_ITN_CONFIG_ERROR", "Missing D1 binding: DB");
    return new Response("Missing D1 binding: DB", { status: 500 });
  }

  if (!env.AUTOPAY_SERVICE_ID || !env.AUTOPAY_SHARED_KEY) {
    console.log(
      "AUTOPAY_ITN_CONFIG_ERROR",
      "Missing AUTOPAY_SERVICE_ID or AUTOPAY_SHARED_KEY",
    );
    return new Response("Missing AUTOPAY_SERVICE_ID / AUTOPAY_SHARED_KEY", {
      status: 500,
    });
  }

  const transactionsParam = await readTransactionsParam(request);

  if (!transactionsParam) {
    console.log("AUTOPAY_ITN_BAD_REQUEST", "Missing transactions");
    return new Response("Missing transactions", { status: 400 });
  }

  let xml = "";
  try {
    xml = decodeBase64Utf8(transactionsParam);
  } catch (e) {
    console.log("AUTOPAY_ITN_BASE64_ERROR", String(e));
    return new Response("Bad transactions payload", { status: 400 });
  }

  console.log(
    "AUTOPAY_ITN_XML",
    JSON.stringify({
      length: xml.length,
      preview: xml.slice(0, 500),
    }),
  );

  const serviceID = getTagValue(xml, "serviceID");
  const orderID = getTagValue(xml, "orderID");
  const remoteID = getTagValue(xml, "remoteID");
  const amount = getTagValue(xml, "amount");
  const currency = getTagValue(xml, "currency");
  const gatewayID = getTagValue(xml, "gatewayID");
  const paymentDate = getTagValue(xml, "paymentDate");
  const paymentStatus = getTagValue(xml, "paymentStatus");
  const paymentStatusDetails = getTagValue(xml, "paymentStatusDetails");
  const incomingHash = getTagValue(xml, "hash");

  console.log(
    "AUTOPAY_ITN_PARSED",
    JSON.stringify({
      serviceID,
      orderID,
      remoteID,
      amount,
      currency,
      gatewayID,
      paymentDate,
      paymentStatus,
      paymentStatusDetails,
      hasHash: !!incomingHash,
    }),
  );

  if (!serviceID || !orderID || !incomingHash) {
    console.log(
      "AUTOPAY_ITN_MISSING_XML_FIELDS",
      JSON.stringify({ serviceID, orderID, hasHash: !!incomingHash }),
    );
    return new Response("Missing required XML fields", { status: 400 });
  }

  if (String(serviceID).trim() !== String(env.AUTOPAY_SERVICE_ID).trim()) {
    console.log(
      "AUTOPAY_ITN_BAD_SERVICE_ID",
      JSON.stringify({
        serviceID,
        expected: String(env.AUTOPAY_SERVICE_ID),
      }),
    );

    return buildConfirmationResponse({
      serviceID,
      orderID,
      confirmation: "NOTCONFIRMED",
      env,
    });
  }

  const verifyParts = [
    serviceID,
    orderID,
    remoteID,
    amount,
    currency,
    gatewayID,
    paymentDate,
    paymentStatus,
    paymentStatusDetails,
  ].filter((v) => v !== undefined && v !== null && String(v) !== "");

  const verifyString = `${verifyParts.join("|")}|${String(env.AUTOPAY_SHARED_KEY)}`;
  const expectedHash = await sha256Hex(verifyString);

  console.log(
    "AUTOPAY_ITN_HASH_DEBUG",
    JSON.stringify({
      orderID,
      remoteID,
      verifyParts,
      verifyString,
      expectedHash,
      incomingHash,
    }),
  );

  if (
    expectedHash.toLowerCase() !== String(incomingHash).trim().toLowerCase()
  ) {
    console.log(
      "AUTOPAY_ITN_HASH_MISMATCH",
      JSON.stringify({
        orderID,
        remoteID,
        expectedHash,
        incomingHash,
      }),
    );

    return buildConfirmationResponse({
      serviceID,
      orderID,
      confirmation: "NOTCONFIRMED",
      env,
    });
  }

  const order = await env.DB.prepare(
    `
    SELECT
      ext_order_id,
      status,
      total_amount
    FROM orders
    WHERE ext_order_id = ?
    LIMIT 1
    `,
  )
    .bind(orderID)
    .first();

  if (!order) {
    console.log(
      "AUTOPAY_ITN_ORDER_NOT_FOUND",
      JSON.stringify({ orderID, remoteID }),
    );

    return buildConfirmationResponse({
      serviceID,
      orderID,
      confirmation: "NOTCONFIRMED",
      env,
    });
  }

  const expectedAmount = normalizeAmount(Number(order.total_amount || 0) / 100);
  const receivedAmount = normalizeAmount(amount);
  const expectedCurrency = String(env.AUTOPAY_CURRENCY || "PLN")
    .trim()
    .toUpperCase();
  const receivedCurrency = String(currency || "")
    .trim()
    .toUpperCase();

  if (
    receivedAmount !== expectedAmount ||
    receivedCurrency !== expectedCurrency
  ) {
    console.log(
      "AUTOPAY_ITN_AMOUNT_OR_CURRENCY_MISMATCH",
      JSON.stringify({
        orderID,
        remoteID,
        amount,
        receivedAmount,
        expectedAmount,
        currency,
        receivedCurrency,
        expectedCurrency,
      }),
    );

    return buildConfirmationResponse({
      serviceID,
      orderID,
      confirmation: "NOTCONFIRMED",
      env,
    });
  }

  const localStatus = mapAutopayStatus(paymentStatus);

  try {
    await env.DB.prepare(
      `
      UPDATE orders
      SET
        updated_at = datetime('now'),
        autopay_remote_id = COALESCE(autopay_remote_id, ?),
        autopay_payment_status = ?,
        autopay_payment_date = ?,
        autopay_gateway_id = COALESCE(autopay_gateway_id, ?)
      WHERE ext_order_id = ?
      `,
    )
      .bind(
        remoteID || null,
        paymentStatus || null,
        paymentDate || null,
        gatewayID || null,
        orderID,
      )
      .run();
  } catch (e) {
    console.log("AUTOPAY_ITN_META_UPDATE_SKIPPED", String(e));
  }

  let finalized = null;

  try {
    const currentStatus = String(order.status || "")
      .trim()
      .toUpperCase();

    if (currentStatus === "COMPLETED" && localStatus !== "COMPLETED") {
      finalized = {
        ok: true,
        finalized: false,
        reason: "already_completed_ignore_downgrade",
      };
    } else {
      finalized = await finalizePaidOrder({
        extOrderId: orderID,
        provider: "autopay",
        status: localStatus,
        env,
      });
    }
  } catch (e) {
    console.log("AUTOPAY_ITN_FINALIZE_ERROR", String(e));
  }

  console.log(
    "AUTOPAY_ITN_CONFIRMED",
    JSON.stringify({
      orderID,
      remoteID,
      localStatus,
      finalized,
    }),
  );

  return buildConfirmationResponse({
    serviceID,
    orderID,
    confirmation: "CONFIRMED",
    env,
  });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  return new Response(
    JSON.stringify({
      ok: true,
      endpoint: "autopay-itn",
      method: "GET",
      path: url.pathname,
      note: "Use POST for Autopay ITN",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
