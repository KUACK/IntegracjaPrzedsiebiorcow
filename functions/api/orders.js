// Plik: functions/api/orders.js
// Cloudflare Pages Function — endpoint GET /api/orders
// Wymaga podpięcia bazy D1 "integracja_db" pod binding o nazwie DB
// (Cloudflare Pages -> Settings -> Functions -> D1 database bindings)

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const stmt = env.DB.prepare(
      `SELECT id, ext_order_id, status, full_name, email, phone, promo_code,
              autopay_payment_status, email_sent, email_sent_at
       FROM orders
       ORDER BY id DESC`
    );

    const { results } = await stmt.all();

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Błąd zapytania do bazy: " + err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
