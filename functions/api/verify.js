function normalizeTicketType(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s*\+\s*/g, " + ")
    .replace(/\s+/g, " ")
    .trim();
}

function accessFromTicketType(ticketType) {
  const type = normalizeTicketType(ticketType);

  const day1Only = {
    day1: true,
    day2: false,
    banquet: false,
  };

  const day2Only = {
    day1: false,
    day2: true,
    banquet: false,
  };

  const day1AndBanquet = {
    day1: true,
    day2: false,
    banquet: true,
  };

  const bothDays = {
    day1: true,
    day2: true,
    banquet: false,
  };

  const bothDaysAndBanquet = {
    day1: true,
    day2: true,
    banquet: true,
  };

  const permissions = {
    // Pełne nazwy z bazy
    "bilet jednodniowy - 9 października": day1Only,
    "bilet jednodniowy - 10 października": day2Only,

    "bilet jednodniowy - 9 października + bankiet": day1AndBanquet,

    "biznes plus - 2 dni": bothDays,

    "premium - 1 dzień": day1Only,
    "bilet premium - 1 dzień": day1Only,

    "vip z prezentacją - 2 dni + bankiet": bothDaysAndBanquet,

    "vip - 2 dni + bankiet": bothDaysAndBanquet,

    // Kody z formularza — na wypadek zapisania ich w bazie
    jednodniowy9x: day1Only,
    jednodniowy10x: day2Only,
    jednodniowy9xbankiet: day1AndBanquet,
    biznesplus: bothDays,
    vipbankiet: bothDaysAndBanquet,
    vip: bothDaysAndBanquet,
  };

  return permissions[type] || null;
}

export async function onRequestGet({ request, env }) {
  const headers = {
    "Cache-Control": "no-store",
  };

  const reply = (data, status = 200) =>
    Response.json(data, { status, headers });

  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  const scannedFor = url.searchParams.get("for");
  const scannedBy = url.searchParams.get("by") || null;

  // Nie wymagamy SCAN_KEY.

  if (!token) {
    return reply(
      {
        valid: false,
        reason: "MISSING_TOKEN",
      },
      400,
    );
  }

  if (!["day1", "day2", "banquet"].includes(scannedFor)) {
    return reply(
      {
        valid: false,
        reason: "INVALID_SCAN_TYPE",
      },
      400,
    );
  }

  try {
    const ticket = await env.DB.prepare(
      `
      SELECT
        t.ticket_no,
        t.ticket_type,
        t.full_name,
        t.ext_order_id,
        o.status AS order_status
      FROM tickets t
      LEFT JOIN orders o
        ON o.ext_order_id = t.ext_order_id
      WHERE t.ticket_token = ?
      LIMIT 1
    `,
    )
      .bind(token)
      .first();

    if (!ticket) {
      return reply({
        valid: false,
        reason: "NOT_FOUND",
      });
    }

    if (String(ticket.order_status || "").toUpperCase() !== "COMPLETED") {
      return reply({
        valid: false,
        reason: "ORDER_NOT_COMPLETED",
        orderStatus: ticket.order_status,
      });
    }

    const access = accessFromTicketType(ticket.ticket_type);

    const ip = request.headers.get("cf-connecting-ip") || "";

    const userAgent = request.headers.get("user-agent") || "";

    // Zapisujemy każdy odczyt znalezionego, opłaconego biletu.
    // Również wtedy, gdy nie uprawnia do wybranego wejścia.
    await env.DB.prepare(
      `
      INSERT INTO ticket_scans (
        ticket_no,
        ticket_token,
        scanned_at,
        scanned_for,
        scanned_by,
        ip,
        user_agent
      )
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?)
    `,
    )
      .bind(ticket.ticket_no, token, scannedFor, scannedBy, ip, userAgent)
      .run();

    if (!access) {
      return reply({
        valid: false,
        reason: "UNKNOWN_TICKET_TYPE",
        ticketNo: ticket.ticket_no,
        ticketType: ticket.ticket_type,
      });
    }

    if (!access[scannedFor]) {
      return reply({
        valid: false,
        reason: "NO_ACCESS",
        ticketNo: ticket.ticket_no,
        ticketType: ticket.ticket_type,
        scannedFor,
        access,
      });
    }

    const counts = await env.DB.prepare(
      `
      SELECT
        scanned_for,
        COUNT(*) AS cnt
      FROM ticket_scans
      WHERE ticket_token = ?
      GROUP BY scanned_for
    `,
    )
      .bind(token)
      .all();

    return reply({
      valid: true,
      ticketNo: ticket.ticket_no,
      ticketType: ticket.ticket_type,
      fullName: ticket.full_name,
      orderId: ticket.ext_order_id,
      access,
      scanCounts: counts.results || [],
    });
  } catch (error) {
    console.error("Ticket verification failed:", error);

    return reply(
      {
        valid: false,
        reason: "SERVER_ERROR",
      },
      500,
    );
  }
}
