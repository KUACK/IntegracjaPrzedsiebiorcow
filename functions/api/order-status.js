// functions/api/order-status.js
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const order = url.searchParams.get("order");

  if (!order) return new Response("Missing order", { status: 400 });
  if (!env.DB) return new Response("Missing D1 binding: DB", { status: 500 });

  const jsonHeaders = { headers: { "Content-Type": "application/json" } };

  // NOWE: darowizny mają swoją tabelę i inny kształt danych niż bilety.
  const isDonation = /^DON/i.test(order);

  if (isDonation) {
    const donation = await env.DB.prepare(
      `
      SELECT
        ext_order_id,
        status,
        donor_type,
        full_name,
        address,
        pesel,
        company_name,
        nip,
        company_address,
        updated_at
      FROM donations
      WHERE ext_order_id = ?
      LIMIT 1
      `,
    )
      .bind(order)
      .first();

    if (!donation) {
      return new Response(JSON.stringify({ found: false }), jsonHeaders);
    }

    // Ta sama logika co hasCertificateData() w finalize-donation.js —
    // trzymaj je zsynchronizowane, jeśli zmienią się wymagane pola.
    const certificateRequested =
      donation.donor_type === "private"
        ? Boolean(donation.full_name && donation.address && donation.pesel)
        : donation.donor_type === "company"
          ? Boolean(
              donation.company_name &&
                donation.nip &&
                donation.company_address,
            )
          : false;

    return new Response(
      JSON.stringify({
        found: true,
        isDonation: true,
        extOrderId: donation.ext_order_id,
        status: donation.status,
        certificateRequested,
        updatedAt: donation.updated_at,
      }),
      jsonHeaders,
    );
  }

  const row = await env.DB.prepare(
    `
    SELECT
      ext_order_id,
      status,
      provider,
      autopay_remote_id,
      autopay_payment_status,
      ticket_type,
      quantity,
      paid_at,
      updated_at
    FROM orders
    WHERE ext_order_id = ?
    LIMIT 1
    `,
  )
    .bind(order)
    .first();

  if (!row) {
    return new Response(JSON.stringify({ found: false }), jsonHeaders);
  }

  return new Response(
    JSON.stringify({
      found: true,
      isDonation: false,
      extOrderId: row.ext_order_id,
      status: row.status,
      provider: row.provider,
      autopayRemoteId: row.autopay_remote_id,
      autopayPaymentStatus: row.autopay_payment_status,
      ticketType: row.ticket_type,
      quantity: row.quantity,
      paidAt: row.paid_at,
      updatedAt: row.updated_at,
    }),
    jsonHeaders,
  );
}
