// Slanje mejla preko Brevo HTTPS API-ja (Render blokira odlazni SMTP).
// Potrebne promenljive okruženja na Render-u: BREVO_API_KEY i MAIL_FROM.
// Zahteva Node 18+ (ugrađen fetch).

const sendEmail = async ({ to, subject, html }) => {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    throw new Error("BREVO_API_KEY ili MAIL_FROM nije podešen");
  }

  // Prekid posle 15 s, da zahtev nikad ne visi beskonačno
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    console.log("📧 Priprema za slanje mejla (Brevo):", to);

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: "VibrA", email: from },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Brevo greška ${res.status}: ${text}`);
    }

    console.log("✅ Mejl poslat:", to);
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = sendEmail;