// functions/lib/finalize-paid-order.js
import { jsPDF } from "jspdf";
import QRCode from "qrcode-generator";

import dejavuNormalBase64 from "../_assets/fonts/DejaVuSans-normal.js";
import dejavuBoldBase64 from "../_assets/fonts/DejaVuSans-bold.js";
import logoPngBase64 from "../_assets/images/logo-png.js";

function safeOneLine(value, maxLen = 140) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function registerFonts(doc) {
  doc.setCharSpace(0);
  if (!dejavuNormalBase64) return;
  doc.addFileToVFS("DejaVuSans.ttf", dejavuNormalBase64);
  doc.addFont("DejaVuSans.ttf", "DejaVuSans", "normal");
  if (dejavuBoldBase64) {
    doc.addFileToVFS("DejaVuSans-Bold.ttf", dejavuBoldBase64);
    doc.addFont("DejaVuSans-Bold.ttf", "DejaVuSans", "bold");
  }
  doc.setFont("DejaVuSans", "normal");
}

function drawQrToPdf(doc, text, x, y, sizeMm) {
  const qr = QRCode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const cell = sizeMm / count;
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        doc.rect(x + c * cell, y + r * cell, cell, cell, "F");
      }
    }
  }
}

function textWrap(doc, text, maxWidth) {
  if (typeof doc.splitTextToSize === "function") {
    return doc.splitTextToSize(text, maxWidth);
  }
  return [text];
}

function makeTicketPdf({
  ticketNo,
  fullName,
  ticketType,
  email,
  verifyUrl,
  devCopy = false,
}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFonts(doc);

  const ink = [17, 24, 39];
  const muted = [107, 114, 128];
  const border = [229, 231, 235];
  const headerBg = [15, 23, 42];

  const pageW = 210;
  const margin = 15;
  const cardX = margin;
  const cardY = 20;
  const cardW = pageW - margin * 2;
  const cardH = 95;

  doc.setDrawColor(...border);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(cardX, cardY, cardW, cardH, 4, 4, "FD");

  doc.setFillColor(...headerBg);
  doc.roundedRect(cardX, cardY, cardW, 18, 4, 4, "F");
  doc.rect(cardX, cardY + 14, cardW, 4, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("DejaVuSans", dejavuBoldBase64 ? "bold" : "normal");
  doc.setFontSize(devCopy ? 13 : 16);
  doc.text(
    devCopy ? "Bilet wstępu - wersja developerska" : "Bilet wstępu",
    cardX + 10,
    cardY + 12,
  );

  const typeText = safeOneLine(ticketType, 50);
  doc.setFontSize(11);
  doc.setFont("DejaVuSans", dejavuBoldBase64 ? "bold" : "normal");
  doc.text(typeText, cardX + cardW - 10, cardY + 12, { align: "right" });

  const leftX = cardX + 10;
  const topY = cardY + 30;
  const labelGap = 14;
  const valueOffset = 5;

  const qrSize = 42;
  const qrX = cardX + cardW - 10 - qrSize;
  const qrY = cardY + 32;

  doc.setTextColor(...muted);
  doc.setFontSize(9);
  doc.setFont("DejaVuSans", "normal");
  doc.text("Numer biletu", leftX, topY);
  doc.text("Imię i nazwisko", leftX, topY + labelGap);
  doc.text("E-mail", leftX, topY + labelGap * 2);

  doc.setTextColor(...ink);
  doc.setFontSize(11);
  doc.setFont("DejaVuSans", dejavuBoldBase64 ? "bold" : "normal");

  const no = safeOneLine(ticketNo, 80);
  const name = safeOneLine(fullName, 80);
  const emailSafe = safeOneLine(email, 80);

  doc.text(textWrap(doc, no, qrX - leftX - 8), leftX, topY + valueOffset);
  doc.text(
    textWrap(doc, name, qrX - leftX - 8),
    leftX,
    topY + labelGap + valueOffset,
  );
  doc.text(
    textWrap(doc, emailSafe, qrX - leftX - 8),
    leftX,
    topY + labelGap * 2 + valueOffset,
  );

  doc.setFont("DejaVuSans", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("Pokaż QR przy wejściu", qrX + qrSize / 2, qrY - 4, {
    align: "center",
  });

  doc.setDrawColor(...border);
  doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 3, 3, "S");
  drawQrToPdf(doc, verifyUrl, qrX, qrY, qrSize);

  if (logoPngBase64) {
    const logoDataUrl = `data:image/png;base64,${logoPngBase64}`;
    const logoH = 20;
    const logoW = 20;
    const logoX = cardX + 10;
    const logoY = cardY + cardH - 10 - logoH;
    doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoW, logoH);
  }

  return doc.output("arraybuffer");
}

async function sendTicketsEmail({ to, fullName, ticketType, tickets, env }) {
  const base =
    env.PUBLIC_BASE_URL || "https://integracjaprzedsiebiorcow.pages.dev";

  const attachments = tickets.map((t) => {
    const verifyUrl = `${base}/verify?t=${encodeURIComponent(t.ticket_token)}`;
    const pdfBuf = makeTicketPdf({
      ticketNo: t.ticket_no,
      fullName: t.full_name,
      ticketType: t.ticket_type,
      email: t.email,
      verifyUrl,
    });

    const bytes = new Uint8Array(pdfBuf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return {
      filename: `bilet-${safeOneLine(t.ticket_no, 60)}.pdf`,
      content: btoa(binary),
    };
  });

  const ticketCount = tickets.length;
  const ticketWord =
    ticketCount === 1 ? "bilet" : ticketCount < 5 ? "bilety" : "biletów";

  const emailPayload = {
    from:
      env.EMAIL_FROM ||
      "Integracja Przedsiębiorców <noreply@integracjaprzedsiebiorcow.eu>",
    to: [to],
    subject: `Twoje ${ticketWord} na Integrację Przedsiębiorców`,
    html: `
      <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
        <div style="background:#0f172a;padding:24px 32px;border-radius:8px 8px 0 0;">
          <h1 style="color:#fff;margin:0;font-size:22px;">Integracja Przedsiębiorców</h1>
        </div>
        <div style="padding:32px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:16px;margin-top:0;">Cześć <strong>${safeOneLine(fullName, 80)}</strong>,</p>
          <p style="font-size:15px;line-height:1.6;">Dziękujemy za zakup! Twoja płatność została potwierdzona.</p>
          <p style="font-size:15px;line-height:1.6;">W załączniku znajdziesz <strong>${ticketCount} ${ticketWord}</strong> typu <strong>${safeOneLine(ticketType, 80)}</strong>.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:24px 0;">
            <p style="margin:0 0 8px 0;font-size:14px;color:#64748b;">📋 Co dalej?</p>
            <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.8;color:#334155;">
              <li>Wydrukuj bilety lub miej je na telefonie</li>
              <li>Pokaż kod QR przy wejściu na event</li>
              <li>Każdy bilet ma unikalny QR — jeden bilet = jedna osoba</li>
            </ul>
          </div>
          <p style="font-size:14px;color:#6b7280;margin-bottom:0;">W razie pytań odpowiedz na tego maila lub napisz do nas.</p>
        </div>
      </div>
    `,
    attachments,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(emailPayload),
  });

  const resJson = await res.json().catch(() => ({}));

  console.log(
    "EMAIL_SEND_RESULT",
    JSON.stringify({
      ok: res.ok,
      status: res.status,
      id: resJson.id || null,
      error: resJson.message || null,
    }),
  );

  return { ok: res.ok, status: res.status, id: resJson.id || null };
}

async function sendAdminNotification({ order, ticketCount, tickets, env }) {
  const adminEmail = env.ADMIN_EMAIL || "konferencja@brfh.eu";
  const base =
    env.PUBLIC_BASE_URL || "https://integracjaprzedsiebiorcow.pages.dev";

  const attachments = tickets.map((t) => {
    const verifyUrl = `${base}/verify?t=${encodeURIComponent(t.ticket_token)}`;
    const pdfBuf = makeTicketPdf({
      ticketNo: t.ticket_no,
      fullName: t.full_name,
      ticketType: t.ticket_type,
      email: t.email,
      verifyUrl,
      devCopy: true,
    });

    const bytes = new Uint8Array(pdfBuf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    return {
      filename: `kopia-bilet-${safeOneLine(t.ticket_no, 60)}.pdf`,
      content: btoa(binary),
    };
  });

  const unitPricePLN = (Number(order.unit_price || 0) / 100).toFixed(2);
  const totalPLN = (Number(order.total_amount || 0) / 100).toFixed(2);
  const promoInfo = order.promo_applied
    ? `<strong>${safeOneLine(order.promo_code, 30)}</strong>`
    : "brak";

  const emailPayload = {
    from:
      env.EMAIL_FROM ||
      "Integracja Przedsiębiorców <noreply@integracjaprzedsiebiorcow.eu>",
    to: [adminEmail],
    subject: `🎟️ Nowy zakup: ${safeOneLine(order.full_name, 50)} — ${safeOneLine(order.ticket_type, 40)}`,
    attachments,
    html: `
      <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
        <div style="background:#0f172a;padding:24px 32px;border-radius:8px 8px 0 0;">
          <h1 style="color:#ffffff;margin:0;font-size:20px;">🎟️ Nowy zakup biletu</h1>
        </div>
        <div style="padding:32px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
          <p style="font-size:15px;margin-top:0;line-height:1.6;">Ktoś właśnie zakupił bilet na Twoją konferencję. Oto szczegóły:</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;width:140px;">Imię i nazwisko</td><td style="padding:10px 0;font-weight:600;">${safeOneLine(order.full_name, 80)}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;">Email</td><td style="padding:10px 0;">${safeOneLine(order.email, 80)}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;">Telefon</td><td style="padding:10px 0;">${safeOneLine(order.phone, 30)}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;">Adres</td><td style="padding:10px 0;">${safeOneLine(order.street, 80)}, ${safeOneLine(order.postal_code, 10)} ${safeOneLine(order.city, 40)}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;">Typ biletu</td><td style="padding:10px 0;font-weight:600;">${safeOneLine(order.ticket_type, 60)}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;">Ilość</td><td style="padding:10px 0;">${ticketCount}</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;">Cena/szt.</td><td style="padding:10px 0;">${unitPricePLN} PLN</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;">Łącznie</td><td style="padding:10px 0;font-weight:600;font-size:16px;">${totalPLN} PLN</td></tr>
            <tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:10px 0;color:#6b7280;">Kod promo</td><td style="padding:10px 0;">${promoInfo}</td></tr>
            <tr><td style="padding:10px 0;color:#6b7280;">ID zamówienia</td><td style="padding:10px 0;font-size:12px;font-family:monospace;">${safeOneLine(order.ext_order_id, 60)}</td></tr>
          </table>
          <p style="font-size:13px;color:#9ca3af;margin-bottom:0;">Bilety zostały wygenerowane i wysłane automatycznie na adres kupującego.</p>
        </div>
      </div>
    `,
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify(emailPayload),
    });

    const resJson = await res.json().catch(() => ({}));
    console.log(
      "ADMIN_EMAIL_RESULT",
      JSON.stringify({
        ok: res.ok,
        status: res.status,
        id: resJson.id || null,
        error: resJson.message || null,
      }),
    );

    return { ok: res.ok, status: res.status, id: resJson.id || null };
  } catch (e) {
    console.log("ADMIN_EMAIL_ERROR", String(e));
    return { ok: false, status: 0, id: null };
  }
}

export async function finalizePaidOrder({
  extOrderId,
  provider = null,
  status = null,
  payuOrderId = null,
  stripeSessionId = null,
  stripePaymentIntentId = null,
  tpayTransactionId = null, // <- Twoja nowa linijka
  env,
}) {
  if (!env.DB) throw new Error("Missing D1 binding DB");

  // Dodaliśmy tpay_transaction_id do komendy SQL
  await env.DB.prepare(
    `
    UPDATE orders
    SET status = COALESCE(?, status),
        provider = COALESCE(?, provider),
        payu_order_id = COALESCE(?, payu_order_id),
        stripe_session_id = COALESCE(?, stripe_session_id),
        stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
        tpay_transaction_id = COALESCE(?, tpay_transaction_id), 
        paid_at = CASE 
          WHEN COALESCE(?, status) = 'COMPLETED' AND paid_at IS NULL THEN datetime('now')
          ELSE paid_at
        END,
        updated_at = datetime('now')
    WHERE ext_order_id = ?
    `,
  )
    .bind(
      status || null,
      provider || null,
      payuOrderId,
      stripeSessionId,
      stripePaymentIntentId,
      tpayTransactionId, // <- Tutaj wysyłamy ID z Tpay do bazy
      status || null,
      extOrderId,
    )
    .run();

  if (status !== "COMPLETED") {
    return { ok: true, finalized: false, reason: "status_not_completed" };
  }

  const row = await env.DB.prepare(
    `
    SELECT
      ext_order_id, email, full_name, phone, street, city, postal_code,
      ticket_type, quantity, unit_price, total_amount,
      promo_code, promo_applied,
      email_sent, email_sent_at,
      admin_email_sent, admin_email_sent_at,
      provider, payu_order_id, stripe_session_id, stripe_payment_intent_id, paid_at
    FROM orders
    WHERE ext_order_id = ?
    LIMIT 1
    `,
  )
    .bind(extOrderId)
    .first();

  if (!row) {
    return { ok: false, finalized: false, reason: "order_not_found" };
  }

  const q = Number(row.quantity || 0);

  for (let i = 1; i <= q; i++) {
    const ticketNo = `${row.ext_order_id}-${i}`;
    const token = crypto.randomUUID();

    await env.DB.prepare(
      `
      INSERT OR IGNORE INTO tickets
        (ticket_no, ext_order_id, email, full_name, ticket_type, created_at, ticket_token)
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
      `,
    )
      .bind(
        ticketNo,
        row.ext_order_id,
        row.email,
        row.full_name,
        row.ticket_type,
        token,
      )
      .run();

    await env.DB.prepare(
      `
      UPDATE tickets
      SET ticket_token = COALESCE(ticket_token, ?)
      WHERE ticket_no = ?
      `,
    )
      .bind(token, ticketNo)
      .run();
  }

  const ticketsResult = await env.DB.prepare(
    `
    SELECT ticket_no, ticket_token, full_name, ticket_type, email
    FROM tickets
    WHERE ext_order_id = ?
    ORDER BY id ASC
    `,
  )
    .bind(extOrderId)
    .all();

  const tickets = ticketsResult.results || [];

  let customerEmailOk = !!row.email_sent;
  let adminEmailOk = !!row.admin_email_sent;

  if (!row.email_sent && env.RESEND_API_KEY && tickets.length > 0) {
    const emailResult = await sendTicketsEmail({
      to: row.email,
      fullName: row.full_name,
      ticketType: row.ticket_type,
      tickets,
      env,
    });

    if (emailResult.ok) {
      customerEmailOk = true;
      await env.DB.prepare(
        `
        UPDATE orders
        SET email_sent = 1,
            email_sent_at = datetime('now'),
            updated_at = datetime('now')
        WHERE ext_order_id = ?
        `,
      )
        .bind(extOrderId)
        .run();
    }
  }

  if (!row.admin_email_sent && env.RESEND_API_KEY && tickets.length > 0) {
    const adminResult = await sendAdminNotification({
      order: row,
      ticketCount: tickets.length,
      tickets,
      env,
    });

    if (adminResult.ok) {
      adminEmailOk = true;
      await env.DB.prepare(
        `
        UPDATE orders
        SET admin_email_sent = 1,
            admin_email_sent_at = datetime('now'),
            updated_at = datetime('now')
        WHERE ext_order_id = ?
        `,
      )
        .bind(extOrderId)
        .run();
    }
  }

  return {
    ok: true,
    finalized: true,
    extOrderId,
    ticketCount: tickets.length,
    customerEmailSent: customerEmailOk,
    adminEmailSent: adminEmailOk,
  };
}
