require('dotenv').config();
const nodemailer = require("nodemailer");

const sendEmail = async ({ to, subject, text, html }) => {
  console.log("📧 Priprema za slanje mejla...");
  console.log(`➡️ Primaoci: ${to}`);
  console.log(`➡️ Naslov: ${subject}`);
  if (html) {
    console.log("➡️ Koristi se HTML sadržaj");
  } else {
    console.log(`➡️ Tekst: ${text}`);
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,     // tvoj gmail
      pass: process.env.EMAIL_PASS,     // app password od 16 karaktera
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `"VibrA" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: html ? undefined : text, // koristi text samo ako nema html
      html, // ako postoji html, koristi njega
    });
    console.log("✅ Mejl uspešno poslat!");
    console.log("Info:", info);
  } catch (error) {
    console.error("❌ Greška pri slanju mejla:", error);
    throw error;
  }
};

module.exports = sendEmail;
