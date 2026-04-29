// functions/api/pay-booked-order.js

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeAutopayDescription(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9 .:\,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 79);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("order");
  const token = url.searchParams.get("token");

  if (!orderId || !token) {
    return new Response("Missing parameters", { status: 400 });
  }

  // Weryfikujemy czy taki token na pewno istnieje w booked_orders w polu notes
  // To zabezpiecza przed próbą "odgadnięcia" linku do cudzego zamówienia
  const searchString = `payment-link-sent|order:${orderId}|token:${token}`;
  const bookedCheck = await env.DB.prepare(
    `SELECT id FROM booked_orders WHERE notes = ? LIMIT 1`,
  )
    .bind(searchString)
    .first();

  if (!bookedCheck) {
    return new Response("Invalid or expired payment link.", { status: 403 });
  }

  // Wyciągamy zamówienie z orders
  const orderRow = await env.DB.prepare(
    `
    SELECT total_amount, email, ticket_type, status 
    FROM orders 
    WHERE ext_order_id = ? LIMIT 1
  `,
  )
    .bind(orderId)
    .first();

  if (!orderRow) {
    return new Response("Order not found.", { status: 404 });
  }

  if (orderRow.status === "COMPLETED") {
    return new Response(
      "To zamówienie zostało już opłacone. Bilety znajdziesz w swojej skrzynce e-mail.",
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  // Generujemy parametry dla Autopay
  const amountForAutopay = (Number(orderRow.total_amount) / 100).toFixed(2);

  const redirectFields = {
    ServiceID: String(env.AUTOPAY_SERVICE_ID).trim(),
    OrderID: orderId,
    Amount: amountForAutopay,
    Description: sanitizeAutopayDescription(
      `Bilet konferencyjny - ${orderRow.ticket_type}`,
    ),
    Currency: String(env.AUTOPAY_CURRENCY || "PLN").trim(),
    CustomerEmail: orderRow.email,
  };

  if (env.AUTOPAY_GATEWAY_ID)
    redirectFields.GatewayID = String(env.AUTOPAY_GATEWAY_ID).trim();
  if (env.AUTOPAY_VALIDITY_TIME)
    redirectFields.ValidityTime = String(env.AUTOPAY_VALIDITY_TIME).trim();
  if (env.AUTOPAY_LINK_VALIDITY_TIME)
    redirectFields.LinkValidityTime = String(
      env.AUTOPAY_LINK_VALIDITY_TIME,
    ).trim();

  const hashParts = [
    redirectFields.ServiceID,
    redirectFields.OrderID,
    redirectFields.Amount,
    redirectFields.Description,
    redirectFields.GatewayID,
    redirectFields.Currency,
    redirectFields.CustomerEmail,
    redirectFields.ValidityTime,
    redirectFields.LinkValidityTime,
  ].filter((v) => v !== undefined && v !== null && String(v).trim() !== "");

  redirectFields.Hash = await sha256Hex(
    `${hashParts.join("|")}|${String(env.AUTOPAY_SHARED_KEY)}`,
  );

  // Tworzymy auto-submitowany HTML
  let formInputs = "";
  for (const [key, value] of Object.entries(redirectFields)) {
    formInputs += `<input type="hidden" name="${key}" value="${value}" />\n`;
  }

  const html = `
    <!DOCTYPE html>
    <html lang="pl">
    <head>
      <meta charset="UTF-8">
      <title>Przekierowanie do płatności...</title>
      <style>
        body { font-family: sans-serif; background: #f9fafb; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .box { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); text-align: center; }
        .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #2563eb; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="spinner"></div>
        <h2>Przekierowujemy do płatności Autopay...</h2>
        <p style="color: #6b7280; font-size: 14px;">Zaraz zostaniesz przeniesiony na bezpieczną stronę bramki.</p>
        
        <form id="autopayForm" method="POST" action="${env.AUTOPAY_GATEWAY_URL}">
          ${formInputs}
          <noscript>
            <p>Twoja przeglądarka nie obsługuje JavaScript. Kliknij przycisk poniżej.</p>
            <button type="submit" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer;">Przejdź do płatności</button>
          </noscript>
        </form>
      </div>
      <script>
        // Automatyczne przesłanie formularza
        window.onload = function() {
          document.getElementById('autopayForm').submit();
        };
      </script>
    </body>
    </html>
  `;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
