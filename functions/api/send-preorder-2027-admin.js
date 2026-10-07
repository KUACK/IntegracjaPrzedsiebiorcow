const ADMIN_RECIPIENTS_2027 = [
  "ligocki@asknet.pl",
  "grzegorzasknet@gmail.com",
  "konferencja@brfh.eu"
];
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function makeAdminEmail(order,env) {
  const amount=(Number(order.total_amount)/100).toFixed(2).replace(".",",");
  const unit=(Number(order.unit_price)/100).toFixed(2).replace(".",",");
  const details=[
    ["Edycja","2027 – Obra, woj. wielkopolskie"],
    ["Status","Płatność potwierdzona"],
    ["Numer zamówienia",order.ext_order_id],
    ["Imię i nazwisko",order.full_name],
    ["E-mail",order.email],
    ["Telefon",order.phone],
    ["Adres",`${order.street}, ${order.postal_code} ${order.city}`],
    ["Wariant biletu",order.ticket_type],
    ["Liczba biletów",String(order.quantity)],
    ["Cena za bilet",`${unit} PLN`],
    ["Zapłacono",`${amount} PLN`],
    ["Data potwierdzenia płatności",order.paid_at]
  ];
  const subject=`[EDYCJA 2027] Opłacone zamówienie ${order.ext_order_id}`;
  const note="Bilet na edycję 2027 zostanie wysłany klientowi później. Ta wiadomość jest powiadomieniem o opłaconym zamówieniu, nie biletem wstępu.";
  return {
    from:env.EMAIL_FROM || "Integracja Przedsiębiorców <noreply@integracjaprzedsiebiorcow.eu>",
    to:ADMIN_RECIPIENTS_2027,
    subject,
    text:["Nowy zakup na Integrację Przedsiębiorców 2027",...details.map(([k,v])=>`${k}: ${v}`),note].join("\n"),
    html:`<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;color:#243b53"><h1>Nowy zakup – EDYCJA 2027</h1><p>Klient opłacił bilet na Integrację Przedsiębiorców 2027 w Obrze.</p><table style="width:100%;border-collapse:collapse">${details.map(([k,v])=>`<tr><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(k)}</td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(v)}</td></tr>`).join("")}</table><p>${note}</p></div>`
  };
}
export async function sendPreorder2027AdminNotification({extOrderId,env}) {
  if(!env.DB) throw new Error("Missing DB binding");
  const order=await env.DB.prepare("SELECT * FROM paidpreorders2027 WHERE ext_order_id=?").bind(extOrderId).first();
  if(!order || order.status!=="COMPLETED") throw new Error("Paid preorder not found");
  if(order.admin_email_sent) return {ok:true,adminEmailSent:true};
  if(!env.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  const now=Math.floor(Date.now()/1000),token=crypto.randomUUID();
  if(order.admin_email_first_attempt_at && now-Number(order.admin_email_first_attempt_at)>=23*3600) {
    await env.DB.prepare("UPDATE paidpreorders2027 SET admin_email_last_error=? WHERE ext_order_id=? AND admin_email_sent=0").bind("Manual review required: retry window exceeded",extOrderId).run();
    throw new Error("Admin notification requires manual review");
  }
  const lock=await env.DB.prepare(`UPDATE paidpreorders2027 SET admin_email_lock_token=?,admin_email_lock_until=?,
    admin_email_payload=COALESCE(admin_email_payload,?),admin_email_first_attempt_at=COALESCE(admin_email_first_attempt_at,?),admin_email_attempts=admin_email_attempts+1
    WHERE ext_order_id=? AND status='COMPLETED' AND admin_email_sent=0
    AND (admin_email_lock_until IS NULL OR admin_email_lock_until < ?)
    AND (admin_email_first_attempt_at IS NULL OR admin_email_first_attempt_at > ?)`)
    .bind(token,now+120,JSON.stringify(makeAdminEmail(order,env)),now,extOrderId,now,now-23*3600).run();
  if(Number(lock.meta?.changes)!==1) throw new Error("Admin email already processing or requires review");
  try {
    const locked=await env.DB.prepare("SELECT admin_email_payload FROM paidpreorders2027 WHERE ext_order_id=? AND admin_email_lock_token=?").bind(extOrderId,token).first();
    if(!locked?.admin_email_payload) throw new Error("Missing admin email payload");
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${env.RESEND_API_KEY}`,"Idempotency-Key":`preorder2027-admin/${extOrderId}`},
      body:locked.admin_email_payload,signal:AbortSignal.timeout(20000)
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || !data.id) throw new Error(`Resend ${response.status}: ${data.message || "missing id"}`);
    const saved=await env.DB.prepare(`UPDATE paidpreorders2027 SET admin_email_sent=1,admin_email_sent_at=datetime('now'),
      admin_email_provider_id=?,admin_email_lock_token=NULL,admin_email_lock_until=NULL,admin_email_last_error=NULL,
      updated_at=datetime('now') WHERE ext_order_id=? AND admin_email_lock_token=?`).bind(data.id,extOrderId,token).run();
    if(Number(saved.meta?.changes)!==1) throw new Error("Admin email accepted but database acknowledgement needs retry");
    return {ok:true,adminEmailSent:true};
  } catch(error) {
    await env.DB.prepare("UPDATE paidpreorders2027 SET admin_email_lock_token=NULL,admin_email_lock_until=NULL,admin_email_last_error=? WHERE ext_order_id=? AND admin_email_lock_token=?").bind(String(error).slice(0,500),extOrderId,token).run();
    throw error;
  }
}
