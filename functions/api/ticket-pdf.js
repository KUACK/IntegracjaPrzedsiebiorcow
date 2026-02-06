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
  if (typeof doc.splitTextToSize === "function")
    return doc.splitTextToSize(text, maxWidth);
  return [text];
}

function makeTicketPdf({ ticketNo, fullName, ticketType, verifyUrl }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFonts(doc);

  // Kolory
  const ink = [17, 24, 39];
  const muted = [107, 114, 128];
  const border = [229, 231, 235];
  const headerBg = [15, 23, 42];

  const pageW = 210;
  const margin = 15;

  // Karta biletu
  const cardX = margin;
  const cardY = 20;
  const cardW = pageW - margin * 2;
  const cardH = 85;

  // Tło + obramowanie
  doc.setDrawColor(...border);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(cardX, cardY, cardW, cardH, 4, 4, "FD");

  // Pasek nagłówka
  doc.setFillColor(...headerBg);
  doc.roundedRect(cardX, cardY, cardW, 18, 4, 4, "F");
  doc.rect(cardX, cardY + 14, cardW, 4, "F");

  // Tytuł
  doc.setTextColor(255, 255, 255);
  doc.setFont("DejaVuSans", dejavuBoldBase64 ? "bold" : "normal");
  doc.setFontSize(16);
  doc.text("Bilet wstępu", cardX + 10, cardY + 12);

  // Typ biletu (VIP) — POGRUBIONY
  const typeText = safeOneLine(ticketType, 50);
  doc.setFontSize(11);
  doc.setFont("DejaVuSans", dejavuBoldBase64 ? "bold" : "normal");
  doc.text(typeText, cardX + cardW - 10, cardY + 12, { align: "right" });

  // Layout
  const leftX = cardX + 10;
  const topY = cardY + 30;
  const labelGap = 12;
  const valueOffset = 5;

  const qrSize = 42;
  const qrX = cardX + cardW - 10 - qrSize;
  const qrY = cardY + 32;

  // Etykiety (BEZ "Weryfikacja")
  doc.setTextColor(...muted);
  doc.setFontSize(9);
  doc.setFont("DejaVuSans", "normal");
  doc.text("Numer biletu", leftX, topY);
  doc.text("Imię i nazwisko", leftX, topY + labelGap);

  // Wartości
  doc.setTextColor(...ink);
  doc.setFontSize(11);
  doc.setFont("DejaVuSans", dejavuBoldBase64 ? "bold" : "normal");

  const no = safeOneLine(ticketNo, 80);
  const name = safeOneLine(fullName, 80);

  doc.text(textWrap(doc, no, qrX - leftX - 8), leftX, topY + valueOffset);
  doc.text(
    textWrap(doc, name, qrX - leftX - 8),
    leftX,
    topY + labelGap + valueOffset,
  );

  // QR opis
  doc.setFont("DejaVuSans", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text("Pokaż QR przy wejściu", qrX + qrSize / 2, qrY - 4, {
    align: "center",
  });

  // Ramka pod QR
  doc.setDrawColor(...border);
  doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 3, 3, "S");

  // QR
  drawQrToPdf(doc, verifyUrl, qrX, qrY, qrSize);

  // Logo — lewy dolny róg (POPRAWIONE proporcje)
  if (logoPngBase64) {
    const logoDataUrl = `data:image/png;base64,${logoPngBase64}`;
    const logoH = 20; // mm wysokość (większa niż poprzednio)
    const logoW = 17; // mm szerokość (mniejsza, by zachować proporcje pionowe)
    const logoX = cardX + 10;
    const logoY = cardY + cardH - 10 - logoH;

    doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoW, logoH);
  }

  // BEZ stopki "Integracja Przedsiębiorców"

  return doc.output("arraybuffer");
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const tokenRaw = url.searchParams.get("t") || "";
  const token = tokenRaw.trim().replace(/[<>]/g, "");

  if (!token) return new Response("Missing t", { status: 400 });
  if (!env.DB) return new Response("Missing D1 binding: DB", { status: 500 });

  const ticket = await env.DB.prepare(
    `
      SELECT ticket_no, full_name, ticket_type, ticket_token
      FROM tickets
      WHERE ticket_token = ?
      LIMIT 1
    `,
  )
    .bind(token)
    .first();

  if (!ticket) return new Response("Ticket not found", { status: 404 });

  const base =
    env.PUBLIC_BASE_URL || "https://integracjaprzedsiebiorcow.pages.dev";
  const verifyUrl = `${base}/verify?t=${encodeURIComponent(ticket.ticket_token)}`;

  const pdfBuf = makeTicketPdf({
    ticketNo: ticket.ticket_no,
    fullName: ticket.full_name,
    ticketType: ticket.ticket_type,
    verifyUrl,
  });

  return new Response(pdfBuf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="bilet-${safeOneLine(ticket.ticket_no, 60)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
