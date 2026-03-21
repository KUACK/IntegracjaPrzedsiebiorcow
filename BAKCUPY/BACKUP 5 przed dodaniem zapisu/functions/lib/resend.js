export async function sendResendEmail({ env, to, subject, text, attachments }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject,
      text,
      attachments, // [{ filename, content: base64 }]
    }),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Resend error ${r.status}: ${err}`);
  }
}
