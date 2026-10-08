function accessFromTicketType(ticketType) {
  const type = String(ticketType || "")
    .trim()
    .toLowerCase();

  const permissions = {
    jednodniowy9x: {
      day1: true,
      day2: false,
      banquet: false,
    },

    jednodniowy10x: {
      day1: false,
      day2: true,
      banquet: false,
    },

    jednodniowy9xbankiet: {
      day1: true,
      day2: false,
      banquet: true,
    },

    biznesplus: {
      day1: true,
      day2: true,
      banquet: false,
    },

    vipbankiet: {
      day1: true,
      day2: true,
      banquet: true,
    },

    vip: {
      day1: true,
      day2: true,
      banquet: true,
    },
  };

  return permissions[type] || null;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  const scannedFor = url.searchParams.get("for") || "unknown"; // day1/day2/banquet
  const scannedBy = url.searchParams.get("by") || null;

  // Prosta ochrona, żeby ktoś z zewnątrz nie sprawdzał tokenów masowo:
  // ustaw w Pages env: SCAN_KEY i wymagaj ?k=...

  if (!token) return new Response("Missing token", { status: 400 });

  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "";
  const ua = request.headers.get("user-agent") || "";

  // 1) znajdź bilet po tokenie + sprawdź czy zamówienie COMPLETED
  const ticket = await env.DB.prepare(
    `
    SELECT
      t.ticket_no, t.ticket_type, t.full_name, t.email, t.ext_order_id, t.created_at,
      o.status AS order_status
    FROM tickets t
    LEFT JOIN orders o ON o.ext_order_id = t.ext_order_id
    WHERE t.ticket_token = ?
    LIMIT 1
  `,
  )
    .bind(token)
    .first();

  if (!ticket) {
    return Response.json({ valid: false, reason: "NOT_FOUND" });
  }

  if (String(ticket.order_status || "").toUpperCase() !== "COMPLETED") {
    return Response.json({
      valid: false,
      reason: "ORDER_NOT_COMPLETED",
      orderStatus: ticket.order_status,
    });
  }
  if (!["day1", "day2", "banquet"].includes(scannedFor)) {
    return Response.json(
      {
        valid: false,
        reason: "INVALID_SCAN_TYPE",
      },
      { status: 400 },
    );
  }

  const access = accessFromTicketType(ticket.ticket_type);

  if (!access) {
    return Response.json({
      valid: false,
      reason: "UNKNOWN_TICKET_TYPE",
      ticketType: ticket.ticket_type,
    });
  }

  if (!access[scannedFor]) {
    return Response.json({
      valid: false,
      reason: "NO_ACCESS",
      ticketType: ticket.ticket_type,
      scannedFor,
      access,
    });
  }
  // 2) log skanu (NIE zmieniamy statusu biletu)
  // D1 ma batch jako transakcję (jak coś padnie, całość się wycofa). [web:133]
  await env.DB.batch([
    env.DB.prepare(
      `
      INSERT INTO ticket_scans (ticket_no, ticket_token, scanned_at, scanned_for, scanned_by, ip, user_agent)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
    `,
    ).bind(ticket.ticket_no, token, scannedFor, scannedBy, ip, ua),
  ]);

  // 3) zwróć dane dla obsługi

  // (opcjonalnie) policz ile razy skanowano dla poszczególnych "dni"
  const counts = await env.DB.prepare(
    `
    SELECT scanned_for, COUNT(*) AS cnt
    FROM ticket_scans
    WHERE ticket_token = ?
    GROUP BY scanned_for
  `,
  )
    .bind(token)
    .all();

  return Response.json({
    valid: true,
    ticketNo: ticket.ticket_no,
    ticketType: ticket.ticket_type,
    fullName: ticket.full_name, // możesz usunąć jeśli nie chcesz pokazywać PII
    orderId: ticket.ext_order_id,
    access, // day1/day2/banquet -> true/false
    scanCounts: counts.results || [],
  });
}
