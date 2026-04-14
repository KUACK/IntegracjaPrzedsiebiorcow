import { finalizePaidOrder } from "./finalize-paid-order.js";

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);

  console.log(
    "TPAY_WEBHOOK_REQUEST",
    JSON.stringify({
      method: request.method,
      path: url.pathname,
      ip: request.headers.get("cf-connecting-ip"),
    }),
  );

  // Tpay przesyła dane w formacie form-urlencoded
  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return new Response("Bad request", { status: 400 });
  }

  // Wyciągamy potrzebne dane z payloadu
  const trId = formData.get("tr_id"); // ID transakcji w Tpay
  const trCrc = formData.get("tr_crc"); // Tutaj jest nasze extOrderId
  const trStatus = formData.get("tr_status"); // TRUE, FALSE lub CHARGEBACK
  const trError = formData.get("tr_error"); // 'none' lub komunikaty błędów

  console.log(
    "TPAY_WEBHOOK_PARSED",
    JSON.stringify({ trId, trCrc, trStatus, trError }),
  );

  // Ustalanie statusu do naszej bazy
  let orderStatus = "PENDING";
  if (trStatus === "TRUE" && trError === "none") {
    orderStatus = "COMPLETED";
  } else if (trStatus === "FALSE" || trError !== "none") {
    orderStatus = "CANCELED";
  }

  // Brak extOrderId (trCrc) zrywa proces
  if (!trCrc) {
    return new Response("TRUE", { status: 200 });
  }

  try {
    // Odpalamy wspólną funkcję finalizującą
    await finalizePaidOrder({
      extOrderId: trCrc,
      provider: "tpay",
      status: orderStatus,
      tpayTransactionId: trId,
      env: env,
    });
  } catch (e) {
    console.log("TPAY_WEBHOOK_FINALIZE_ERROR", String(e));
  }

  // Tpay BEZWZGLĘDNIE wymaga odpowiedzi tekstowej "TRUE"
  return new Response("TRUE", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
