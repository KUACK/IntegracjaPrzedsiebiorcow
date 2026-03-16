import { jsPDF } from "jspdf";
import QRCode from "qrcode-generator";

import dejavuNormalBase64 from "../_assets/fonts/DejaVuSans-normal.js";
import dejavuBoldBase64 from "../_assets/fonts/DejaVuSans-bold.js";
import logoPngBase64 from "../_assets/images/logo-png.js";

// ─── Helpers (identyczne jak w notify.js) ───────────────────────────────────

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
  if (typeof doc.splitTextToSize === "function")
    return doc.splitTextToSize(text, maxWidth);
  return [text];
}

function makeTicketPdf({ ticketNo, fullName, ticketType, email, verifyUrl }) {
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
  doc.setFontSize(16);
  doc.text("Bilet wstępu", cardX + 10, cardY + 12);

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

// ─── Wysyłka emaila z biletami PDF przez Resend ────────────────────────────

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
    const base64 = btoa(binary);

    return {
      filename: `bilet-${safeOneLine(t.ticket_no, 60)}.pdf`,
      content: base64,
    };
  });

  const ticketCount = tickets.length;
  const ticketWord =
    ticketCount === 1 ? "bilet" : ticketCount < 5 ? "bilety" : "biletów";

  const emailPayload = {
    from: env.EMAIL_FROM || "Integracja Przedsiębiorców <noreply@integracjaprzedsiebiorcow.eu>",
    to: [to],
    subject: `Twoje ${ticketWord} na Integrację Przedsiębiorców`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
        <div style="background: #0f172a; padding: 24px 32px; border-radius: 8px 8px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px;">Integracja Przedsiębiorców</h1>
        </div>
        <div style="padding: 32px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; margin-top: 0;">Cześć <strong>${safeOneLine(fullName, 80)}</strong>,</p>
          <p style="font-size: 15px; line-height: 1.6;">
            Dziękujemy za zakup! Twoja płatność została potwierdzona.
          </p>
          <p style="font-size: 15px; line-height: 1.6;">
            W załączniku znajdziesz <strong>${ticketCount} ${ticketWord}</strong>
            typu <strong>${safeOneLine(ticketType, 80)}</strong>.
          </p>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b;">📋 Co dalej?</p>
            <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8; color: #334155;">
              <li>Wydrukuj bilety lub miej je na telefonie</li>
              <li>Pokaż kod QR przy wejściu na event</li>
              <li>Każdy bilet ma unikalny QR — jeden bilet = jedna osoba</li>
            </ul>
          </div>
          <p style="font-size: 14px; color: #6b7280; margin-bottom: 0;">
            W razie pytań odpowiedz na tego maila lub napisz do nas.
          </p>
        </div>
        <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 16px;">
          Integracja Przedsiębiorców © ${new Date().getFullYear()}
        </p>
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

// ─── Główna funkcja sync-status ─────────────────────────────────────────────

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const extOrderId = url.searchParams.get("order");
  if (!extOrderId) return new Response("Missing order", { status: 400 });
  if (!env.DB) return new Response("Missing D1 binding: DB", { status: 500 });

  const row = await env.DB.prepare(
    `
    SELECT ext_order_id, payu_order_id, status, email, full_name, ticket_type, quantity, email_sent
    FROM orders
    WHERE ext_order_id = ?
    LIMIT 1
  `,
  )
    .bind(extOrderId)
    .first();

  if (!row) {
    return new Response(JSON.stringify({ found: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const payuOrderId = row.payu_order_id;
  if (!payuOrderId) {
    return new Response(
      JSON.stringify({ found: true, status: row.status, payuOrderId: null }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // OAuth
  const tokenRes = await fetch(
    `${env.PAYU_BASE_URL}/pl/standard/user/oauth/authorize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.PAYU_CLIENT_ID,
        client_secret: env.PAYU_CLIENT_SECRET,
      }),
    },
  );

  const tokenJson = await tokenRes.json().catch(() => ({}));
  const accessToken = tokenJson.access_token;
  if (!accessToken) return new Response("PayU auth failed", { status: 502 });

  async function getPayuStatus() {
    const r = await fetch(
      `${env.PAYU_BASE_URL}/api/v2_1/orders/${payuOrderId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const j = await r.json().catch(() => ({}));
    const status = j?.orders?.[0]?.status || null;
    return { http: r.status, status, raw: j };
  }

  let { status: payuStatus } = await getPayuStatus();

  // Jeśli PayU czeka na capture (auto-receive off) -> zrób capture
  if (String(payuStatus || "").toUpperCase() === "WAITING_FOR_CONFIRMATION") {
    await fetch(
      `${env.PAYU_BASE_URL}/api/v2_1/orders/${payuOrderId}/captures`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: "",
      },
    );

    ({ status: payuStatus } = await getPayuStatus());
  }

  // Update w D1
  if (payuStatus) {
    await env.DB.prepare(
      `
      UPDATE orders
      SET status = ?, updated_at = datetime('now')
      WHERE ext_order_id = ?
    `,
    )
      .bind(payuStatus, extOrderId)
      .run();
  }

  // Utwórz bilety, jeśli COMPLETED (z tokenem)
  if (String(payuStatus || "").toUpperCase() === "COMPLETED") {
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

      // Jeśli bilet już istniał bez tokenu → uzupełnij
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

    // ─── Wysyłka emaila (backup — jeśli notify nie wysłał) ──────────────
    // Odczytaj świeży stan email_sent (mógł się zmienić przez notify)
    const freshOrder = await env.DB.prepare(
      `SELECT email_sent FROM orders WHERE ext_order_id = ? LIMIT 1`,
    )
      .bind(extOrderId)
      .first();

    if (!freshOrder?.email_sent && env.RESEND_API_KEY) {
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

      if (tickets.length > 0) {
        console.log(
          "SYNC_STATUS_SENDING_EMAIL",
          JSON.stringify({
            to: row.email,
            ticketCount: tickets.length,
          }),
        );

        const emailResult = await sendTicketsEmail({
          to: row.email,
          fullName: row.full_name,
          ticketType: row.ticket_type,
          tickets,
          env,
        });

        if (emailResult.ok) {
          await env.DB.prepare(
            `
            UPDATE orders
            SET email_sent = 1, email_sent_at = datetime('now'), updated_at = datetime('now')
            WHERE ext_order_id = ?
          `,
          )
            .bind(extOrderId)
            .run();

          console.log("SYNC_STATUS_EMAIL_SENT", JSON.stringify({ extOrderId }));
        } else {
          console.log(
            "SYNC_STATUS_EMAIL_FAILED",
            JSON.stringify({ extOrderId, status: emailResult.status }),
          );
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      found: true,
      extOrderId,
      payuOrderId,
      payuStatus: payuStatus || null,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
