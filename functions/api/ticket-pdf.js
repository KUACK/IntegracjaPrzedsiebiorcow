import { jsPDF } from "jspdf";
import QRCode from "qrcode-generator";

function drawQrToPdf(doc, text, x, y, sizeMm) {
  const qr = QRCode(0, "M");
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const cell = sizeMm / count;

  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c))
        doc.rect(x + c * cell, y + r * cell, cell, cell, "F");
    }
  }
}

function makeTicketPdf({ ticketNo, fullName, ticketType, verifyUrl }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Bilet wstępu", 20, 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(`Numer biletu: ${ticketNo}`, 20, 35);
  doc.text(`Imię i nazwisko: ${fullName}`, 20, 43);
  doc.text(`Typ biletu: ${ticketType}`, 20, 51);

  doc.setFontSize(10);
  doc.text("Weryfikacja QR:", 20, 65);

  drawQrToPdf(doc, verifyUrl, 20, 70, 45);

  doc.setFontSize(9);
  doc.text(verifyUrl, 20, 120, { maxWidth: 170 });

  return doc.output("arraybuffer");
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  // token biletu (najwygodniejsze, bo masz go w QR)
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
      "Content-Disposition": `inline; filename="bilet-${ticket.ticket_no}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
