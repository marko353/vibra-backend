/**
 * Slanje mejla timu kad neko prijavi korisnika (Node + Express + nodemailer).
 *
 * Mejl se UVEK šalje sa servera, nikad iz aplikacije
 * (lozinka za slanje ne sme da bude u mobilnoj aplikaciji).
 *
 * .env na backendu (NE u Expo .env):
 *   REPORT_EMAIL_TO=support.vibradating@gmail.com
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_USER=adresa.sa.koje.saljes@gmail.com
 *   SMTP_PASS=app-lozinka-od-16-karaktera
 *
 * Za Gmail: uključi 2-step verification, pa napravi "App password"
 * (Google nalog → Security → App passwords). Obična lozinka ne radi.
 * Za više od par prijava dnevno bolje je koristiti servis za slanje
 * (Resend, Brevo, SendGrid...), isti kod, menjaju se samo SMTP podaci.
 */

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: Number(process.env.SMTP_PORT || 465) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Da prijava ne visi ako SMTP ne odgovara
  connectionTimeout: 8000,
  greetingTimeout: 8000,
  socketTimeout: 10000,
});

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

  await transporter.sendMail({
    from: `"Vibra Reports" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
    text:
      `New report\nReason: ${reason || "not provided"}\n` +
      `Reported: ${reported.fullName} (${reported._id})\n` +
      `Reporter: ${reporter.fullName} (${reporter._id})`,
  });
}

module.exports = { sendReportEmail };