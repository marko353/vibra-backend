/**
 * Slanje mejla timu kad neko prijavi korisnika.
 *
 * Mejl se UVEK šalje sa servera, nikad iz aplikacije.
 * Koristi zajednički helper ../sendEmail (Brevo HTTPS API), jer Render
 * blokira odlazni SMTP.
 *
 * Promenljive okruženja na Render-u:
 *   REPORT_EMAIL_TO  (kome stiže prijava; ako fali, koristi se podrazumevana adresa)
 *   BREVO_API_KEY    (koristi ga sendEmail)
 *   MAIL_FROM        (koristi ga sendEmail, verifikovan pošiljalac u Brevo-u)
 */

const sendEmail = require("../sendEmail");

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * reporter / reported: mongoose dokumenti (ili objekti) sa _id, fullName, email
 * reason: tekst razloga iz aplikacije
 */
async function sendReportEmail({ reporter, reported, reason }) {
  const to = process.env.REPORT_EMAIL_TO || "support.vibradating@gmail.com";

  // Bez novih redova u naslovu (zaštita od header injection-a)
  const safeName = String(reported.fullName || reported._id).replace(/[\r\n]+/g, " ");
  const safeReason = String(reason || "no reason").replace(/[\r\n]+/g, " ");
  const subject = `[Vibra] New report: ${safeName} (${safeReason})`;

  const html = `
    <h2>New user report</h2>
    <p><b>Reason:</b> ${esc(reason || "not provided")}</p>
    <p><b>Time:</b> ${new Date().toISOString()}</p>
    <hr />
    <h3>Reported user</h3>
    <p>
      Name: ${esc(reported.fullName)}<br />
      ID: ${esc(reported._id)}<br />
      Email: ${esc(reported.email)}
    </p>
    <h3>Reported by</h3>
    <p>
      Name: ${esc(reporter.fullName)}<br />
      ID: ${esc(reporter._id)}<br />
      Email: ${esc(reporter.email)}
    </p>
  `;

  await sendEmail({ to, subject, html });
}

module.exports = { sendReportEmail };