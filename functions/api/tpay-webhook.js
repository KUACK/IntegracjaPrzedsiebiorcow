import { finalizePaidOrder } from "./finalize-paid-order.js";

// Funkcja weryfikująca podpis MD5 z Tpay
async function verifyTpaySignature(
  merchantId,
  trId,
  trAmount,
  trCrc,
  securityCode,
  receivedMd5,
) {
  // Według dokumentacji Tpay string do podpisania to: id + tr_id + tr_amount + tr_crc + security_code
  const stringToSign = `${merchantId}${trId}${trAmount}${trCrc}${securityCode}`;

  const msgUint8 = new TextEncoder().encode(stringToSign);
  const hashBuffer = await crypto.subtle.digest("MD5", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const expectedMd5 = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expectedMd5 === receivedMd5;
}

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

  // Zmienna środowiskowa z Kodem Bezpieczeństwa z panelu Tpay
  if (!env.TPAY_SECURITY_CODE) {
    return new Response("Missing TPAY_SECURITY_CODE", { status: 500 });
  }

  // Tpay przesyła dane w formacie form-urlencoded
  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return new Response("Bad request", { status: 400 });
  }

  // Wyciągamy potrzebne dane z payloadu
  const merchantId = formData.get("id");
  const trId = formData.get("tr_id"); // ID transakcji w Tpay
  const trDate = formData.get("tr_date");
  const trCrc = formData.get("tr_crc"); // Tutaj jest nasze extOrderId, które wysłaliśmy jako hiddenDescription
  const trAmount = formData.get("tr_amount");
  const trPaid = formData.get("tr_paid");
  const trDesc = formData.get("tr_desc");
  const trStatus = formData.get("tr_status"); // TRUE, FALSE lub CHARGEBACK
  const trError = formData.get("tr_error"); // 'none' lub komunikaty błędów
  const trEmail = formData.get("tr_email");
  const md5Sum = formData.get("md5sum");

  console.log(
    "TPAY_WEBHOOK_PARSED",
    JSON.stringify({ trId, trCrc, trStatus, trError }),
  );

  // Weryfikacja bezpieczeństwa wiadomości
  const isValid = await verifyTpaySignature(
    merchantId,
    trId,
    trAmount,
    trCrc,
    env.TPAY_SECURITY_CODE,
    md5Sum,
  );

  if (!isValid) {
    console.log("TPAY_WEBHOOK_INVALID_SIGNATURE");
    // Nawet przy złym podpisie dla bezpieczeństwa Tpay oczekuje TRUE,
    // jednak nie podejmujemy żadnej akcji w bazie
    return new Response("TRUE", { status: 200 });
  }

  // Ustalanie statusu do naszej bazy
  let orderStatus = "PENDING";
  if (trStatus === "TRUE" && trError === "none") {
    orderStatus = "COMPLETED";
  } else if (trStatus === "FALSE" || trError !== "none") {
    orderStatus = "CANCELED"; // lub "ERROR", zależnie od tego, jakie masz statusy w bazie
  }

  // Brak extOrderId zrywa proces
  if (!trCrc) {
    return new Response("TRUE", { status: 200 });
  }

  try {
    // Odpalamy wspólną funkcję finalizującą, używając klamerek jako pojedynczego obiektu parametrów!
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

  // Tpay BEZWZGLĘDNIE wymaga odpowiedzi tekstowej "TRUE" w przypadku poprawnego odebrania notyfikacji
  // Inaczej będzie wysyłać to zapytanie co kilka minut przez kilka dni.
  return new Response("TRUE", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
