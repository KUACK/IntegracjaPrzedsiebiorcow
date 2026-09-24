// functions/api/finalize-donation.js
// Wołane z autopay-itn.js, gdy ext_order_id zaczyna się od "DON".

// ZMIANA: teraz lista adresów zamiast pojedynczego adresu.
const RECIPIENT_EMAILS = ["rafalostrowskix@gmail.com", "grzegorzasknet@gmail.com"];

function donorTypeLabel(t) {
  if (t === "private") return "Osoba prywatna";
  if (t === "company") return "Firma";
  return "Anonimowo";
}

// NOWE: sprawdza, czy podano dane potrzebne do wystawienia zaświadczenia
// (przydatne też dla thanks.html / order-status, żeby wiedzieć, czy
// obiecywać wysyłkę zaświadczenia).
function hasCertificateData(donation) {
  if (donation.donor_type === "private") {
    return Boolean(donation.full_name && donation.address && donation.pesel);
  }
  if (donation.donor_type === "company") {
    return Boolean(
      donation.company_name && donation.nip && donation.company_address,
    );
  }
  return false;
}

function buildEmailBody(donation) {
  const amountPln = (Number(donation.amount_grosze || 0) / 100).toFixed(2);
  const lines = [
    `Nowa darowizna – status: ${donation.status}`,
    `Numer zamówienia: ${donation.ext_order_id}`,
    `Kwota: ${amountPln} PLN`,
    `Forma wpłaty: ${donorTypeLabel(donation.donor_type)}`,
    `E-mail kontaktowy: ${donation.contact_email || "-"}`,
  ];

  if (donation.donor_type === "private") {
    lines.push(`Imię i nazwisko: ${donation.full_name || "-"}`);
    lines.push(`Adres: ${donation.address || "-"}`);
    lines.push(`PESEL: ${donation.pesel || "-"}`);
  }
  if (donation.donor_type === "company") {
    lines.push(`Nazwa firmy: ${donation.company_name || "-"}`);
    lines.push(`NIP: ${donation.nip || "-"}`);
    lines.push(`Adres firmy: ${donation.company_address || "-"}`);
  }
  if (donation.message) {
    lines.push(`Wiadomość / intencja: ${donation.message}`);
  }
  lines.push(
    `Zaświadczenie do wysłania: ${hasCertificateData(donation) ? "TAK" : "NIE (brak kompletu danych)"}`,
  );
  lines.push(
    `Data płatności (AutoPay): ${donation.autopay_payment_date || "-"}`,
  );

  return lines.join("\n");
}

async function sendDonationEmail({ donation, env }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.log(
      "FINALIZE_DONATION_EMAIL_SKIPPED",
      "Missing RESEND_API_KEY / EMAIL_FROM",
    );
    return { sent: false, reason: "missing_email_config" };
  }

  const body = buildEmailBody(donation);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      // ZMIANA: wysyłka do wszystkich adresów z RECIPIENT_EMAILS
      to: RECIPIENT_EMAILS,
      subject: `Darowizna ${donation.ext_order_id} – ${donation.status}`,
      text: body,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.log("FINALIZE_DONATION_EMAIL_ERROR", res.status, errText);
    return { sent: false, reason: `http_${res.status}` };
  }

  return { sent: true };
}

export async function finalizeDonation({ extOrderId, status, env }) {
  const donation = await env.DB.prepare(
    `SELECT * FROM donations WHERE ext_order_id = ? LIMIT 1`,
  )
    .bind(extOrderId)
    .first();

  if (!donation) {
    console.log("FINALIZE_DONATION_NOT_FOUND", extOrderId);
    return { ok: false, reason: "not_found" };
  }

  const currentStatus = String(donation.status || "").toUpperCase();
  if (currentStatus === "COMPLETED" && status !== "COMPLETED") {
    return {
      ok: true,
      finalized: false,
      reason: "already_completed_ignore_downgrade",
    };
  }

  await env.DB.prepare(
    `UPDATE donations SET status = ?, updated_at = datetime('now') WHERE ext_order_id = ?`,
  )
    .bind(status, extOrderId)
    .run();

  donation.status = status;

  let emailResult = { sent: false, reason: "not_attempted" };
  if (status === "COMPLETED" && !donation.email_sent_at) {
    emailResult = await sendDonationEmail({ donation, env });
    if (emailResult.sent) {
      await env.DB.prepare(
        `UPDATE donations SET email_sent_at = datetime('now') WHERE ext_order_id = ?`,
      )
        .bind(extOrderId)
        .run();
    }
  }

  return {
    ok: true,
    finalized: true,
    status,
    emailResult,
    certificateRequested: hasCertificateData(donation),
  };
}
