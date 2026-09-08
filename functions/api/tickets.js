// Plik: functions/api/tickets.js
// Cloudflare Pages Function — endpoint GET /api/tickets
// Wymaga podpięcia bazy D1 "integracja_db" pod binding o nazwie DB
// (Cloudflare Pages -> Settings -> Functions -> D1 database bindings)

const EXCLUDED_EMAILS = [
  "grzegorzasknet@gmail.com",
  "test@test.test",
  "test@test.pl",
  "test@gmail.com",
];

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const placeholders = EXCLUDED_EMAILS.map(() => "?").join(", ");

    const stmt = env.DB.prepare(
      `SELECT id, ticket_no, email, full_name, ticket_type, created_at, ticket_token
       FROM tickets
       WHERE email NOT IN (${placeholders})
       ORDER BY id DESC`
    ).bind(...EXCLUDED_EMAILS);

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
