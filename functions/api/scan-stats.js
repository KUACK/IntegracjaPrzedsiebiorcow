export async function onRequestGet({request, env}) {
  const headers = {"Cache-Control":"no-store"};
  if (!env.SCAN_KEY) return Response.json({error:"Ustaw SCAN_KEY w konfiguracji Pages."},{status:503,headers});
  if (request.headers.get("X-Scan-Key") !== env.SCAN_KEY)
    return Response.json({error:"Brak dostępu."},{status:401,headers});
  const windows = [{"code": "day1", "label": "Dzień 1", "start": "2026-10-08 22:00:00", "end": "2026-10-09 22:00:00"}, {"code": "day2", "label": "Dzień 2", "start": "2026-10-09 22:00:00", "end": "2026-10-10 22:00:00"}, {"code": "banquet", "label": "Bankiet", "start": "2026-10-09 16:30:00", "end": "2026-10-09 22:00:00"}];
  try {
    const sections = [];
    for (const w of windows) {
      const result = await env.DB.prepare(`
        SELECT s.ticket_no AS ticketNo, COUNT(*) AS scanCount,
          MIN(s.scanned_at) AS firstScan, MAX(s.scanned_at) AS lastScan,
          (SELECT MAX(t.full_name) FROM tickets t WHERE t.ticket_no=s.ticket_no) AS fullName,
          (SELECT MAX(t.ticket_type) FROM tickets t WHERE t.ticket_no=s.ticket_no) AS ticketType
        FROM ticket_scans s
        WHERE s.scanned_for=? AND s.scanned_at>=? AND s.scanned_at<?
        GROUP BY s.ticket_no ORDER BY s.ticket_no
      `).bind(w.code,w.start,w.end).all();
      sections.push({...w, tickets:result.results || []});
    }
    return Response.json({timezone:"Europe/Warsaw",sections},{headers});
  } catch (_) {
    return Response.json({error:"Nie udało się odczytać historii. Sprawdź tabelę i binding DB."},{status:500,headers});
  }
}
