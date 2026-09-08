// Plik: functions/api/tickets.js
// Cloudflare Pages Function — endpoint GET /api/tickets
// Wymaga podpięcia bazy D1 "integracja_db" pod binding o nazwie DB
// (Cloudflare Pages -> Settings -> Functions -> D1 database bindings)

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const stmt = env.DB.prepare(
      `SELECT id, ticket_no, email, full_name, ticket_type, created_at, ticket_token
       FROM tickets
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
