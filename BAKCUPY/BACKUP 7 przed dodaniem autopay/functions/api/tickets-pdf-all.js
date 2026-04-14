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

// Rysuje JEDEN bilet na bieżącej stronie
function drawTicketOnCurrentPage(
  doc,
  { ticketNo, fullName, ticketType, verifyUrl },
) {
  const ink = [17, 24, 39];
  const muted = [107, 114, 128];
  const border = [229, 231, 235];
  const headerBg = [15, 23, 42];

  const pageW = 210;
  const margin = 15;
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

  const leftX = cardX + 10;
  const topY = cardY + 30;
  const labelGap = 12;
  const valueOffset = 5;

  const qrSize = 42;
  const qrX = cardX + cardW - 10 - qrSize;
  const qrY = cardY + 32;

  // Etykiety
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

  // Logo
  if (logoPngBase64) {
    const logoDataUrl = `data:image/png;base64,${logoPngBase64}`;
    const logoH = 16;
    const logoW = 12;
    const logoX = cardX + 10;
    const logoY = cardY + cardH - 6 - logoH;
    doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoW, logoH);
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const extOrderId = safeOneLine(url.searchParams.get("order") || "", 120);

  if (!extOrderId) return new Response("Missing order", { status: 400 });
  if (!env.DB) return new Response("Missing D1 binding: DB", { status: 500 });

  const q = await env.DB.prepare(
    `
      SELECT ticket_no, full_name, ticket_type, ticket_token
      FROM tickets
      WHERE ext_order_id = ?
      ORDER BY id ASC
    `,
  )
    .bind(extOrderId)
    .all();

  const tickets = q.results || [];
  if (!tickets.length) return new Response("No tickets found", { status: 404 });

  const base =
    env.PUBLIC_BASE_URL || "https://integracjaprzedsiebiorcow.pages.dev";

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  registerFonts(doc);

  // Pierwsza strona (bilet 0)
  drawTicketOnCurrentPage(doc, {
    ticketNo: tickets[0].ticket_no,
    fullName: tickets[0].full_name,
    ticketType: tickets[0].ticket_type,
    verifyUrl: `${base}/verify?t=${encodeURIComponent(tickets[0].ticket_token)}`,
  });

  // Kolejne bilety — nowa strona dla każdego
  for (let i = 1; i < tickets.length; i++) {
    doc.addPage(); // jsPDF addPage() adds new page [page:0]
    drawTicketOnCurrentPage(doc, {
      ticketNo: tickets[i].ticket_no,
      fullName: tickets[i].full_name,
      ticketType: tickets[i].ticket_type,
      verifyUrl: `${base}/verify?t=${encodeURIComponent(tickets[i].ticket_token)}`,
    });
  }

  const pdfBuf = doc.output("arraybuffer");

  return new Response(pdfBuf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="bilety-${safeOneLine(extOrderId, 60)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
