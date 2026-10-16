// controllers/phoneController.js
//
// Telefon kao dodatni način prijave.
//  - Javne rute (login):        sendPhoneLoginCode, verifyPhoneLoginCode
//  - Rute za prijavljene:        getPhoneStatus, sendAddPhoneCode, verifyAddPhone, removePhone
//
// Broj se u bazi čuva samo ako je potvrđen SMS kodom (phoneVerified: true),
// a prijava brojem radi samo za brojeve koji su već povezani sa nalogom.

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendVerification, checkVerification } = require("../services/phoneVerification");

// Isti rok kao u authController (drži ih usklađenim)
const AUTH_TOKEN_EXPIRES_IN = "365d";

// ─── Pomoćne funkcije ─────────────────────────────────────────

// E.164: plus, cifra 1-9, ukupno 8 do 15 cifara. Server NE veruje klijentu,
// klijent šalje već normalizovan broj, ali ga ovde ponovo proveravamo.
const isValidE164 = (phone) =>
  typeof phone === "string" && /^\+[1-9]\d{7,14}$/.test(phone);

const isValidCode = (code) => typeof code === "string" && /^\d{6}$/.test(code);

// "+381641234567" -> "+381•••••567" (pun broj se nikad ne vraća klijentu)
const maskPhone = (phone) =>
  phone ? `${phone.slice(0, 4)}${"•".repeat(Math.max(phone.length - 7, 3))}${phone.slice(-3)}` : null;

// Greške iz Twilija. Broj telefona se namerno ne loguje.
const handleProviderError = (err, res, context) => {
  const code = err?.code;

  // 60203: previše pokušaja slanja, 60202: previše pokušaja provere, 60212/20429: previše zahteva
  if ([60203, 60202, 60212, 20429].includes(code) || err?.status === 429) {
    return res.status(429).json({ message: "Too many attempts. Please try again later." });
  }
  // 60200: neispravan broj
  if (code === 60200) {
    return res.status(400).json({ message: "Invalid phone number" });
  }

  console.error(`❌ [phone:${context}] greška provajdera:`, code, err?.message);
  return res.status(500).json({ message: "Could not process the request. Please try again." });
};

// ═════════════════════════════════════════════════════════════
// JAVNE RUTE (login brojem)
// ═════════════════════════════════════════════════════════════

// POST /api/auth/send-code   { phone }
// Uvek isti odgovor, bez obzira da li broj ima nalog (ne otkrivamo ko je registrovan).
exports.sendPhoneLoginCode = async (req, res) => {
  const phone = req.body?.phone;

  if (!isValidE164(phone)) {
    return res.status(400).json({ message: "Invalid phone number" });
  }

  try {
    await sendVerification(phone);
    return res.status(200).json({ message: "Code sent" });
  } catch (err) {
    return handleProviderError(err, res, "login-send");
  }
};

// POST /api/auth/verify-code   { phone, code }
exports.verifyPhoneLoginCode = async (req, res) => {
  const { phone, code } = req.body || {};

  if (!isValidE164(phone) || !isValidCode(code)) {
    return res.status(400).json({ message: "Invalid phone number or code" });
  }

  try {
    const approved = await checkVerification(phone, code);
    if (!approved) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    // Kod je tačan: broj je dokazan. Sad tražimo nalog povezan sa tim brojem.
    const user = await User.findOne({ phone, phoneVerified: true });

    if (!user) {
      // Klijent na ovo prikazuje "No account linked to this number" + registraciju.
      // phoneToken je dokaz da je broj potvrđen SMS kodom (važi 15 min). Registracija
      // ga prima umesto broja iz tela zahteva, pa se potvrda ne može lažirati.
      const phoneToken = jwt.sign(
        { phone, purpose: "phone-signup" },
        process.env.JWT_SECRET + ":phone-signup", // isto kao u authController.js
        { expiresIn: "15m" }
      );

      return res.status(404).json({
        code: "PHONE_NOT_REGISTERED",
        message: "No account linked to this number",
        phoneToken,
      });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: AUTH_TOKEN_EXPIRES_IN,
    });

    return res.status(200).json({
      message: "Login successful",
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      token,
    });
  } catch (err) {
    return handleProviderError(err, res, "login-verify");
  }
};

// ═════════════════════════════════════════════════════════════
// RUTE ZA PRIJAVLJENE KORISNIKE (dodavanje broja na nalog)
// ═════════════════════════════════════════════════════════════

// GET /api/user/phone
// Vraća maskiran broj (za prikaz u profilu). Pun broj nikad ne napušta server.
exports.getPhoneStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("+phone phoneVerified");
    if (!user) return res.status(404).json({ message: "User not found" });

    const hasPhone = !!user.phone && user.phoneVerified;
    return res.json({
      phone: hasPhone ? maskPhone(user.phone) : null,
      verified: hasPhone,
    });
  } catch (err) {
    console.error("❌ [phone:status]", err?.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/user/phone/send-code   { phone }
exports.sendAddPhoneCode = async (req, res) => {
  const phone = req.body?.phone;

  if (!isValidE164(phone)) {
    return res.status(400).json({ message: "Invalid phone number" });
  }

  try {
    // Broj već pripada drugom nalogu: ne šaljemo SMS
    const takenByOther = await User.exists({
      phone,
      phoneVerified: true,
      _id: { $ne: req.user.id },
    });
    if (takenByOther) {
      return res.status(409).json({
        code: "PHONE_IN_USE",
        message: "This number is already linked to another account.",
      });
    }

    await sendVerification(phone);
    return res.status(200).json({ message: "Code sent" });
  } catch (err) {
    return handleProviderError(err, res, "add-send");
  }
};

// POST /api/user/phone/verify   { phone, code }
exports.verifyAddPhone = async (req, res) => {
  const { phone, code } = req.body || {};

  if (!isValidE164(phone) || !isValidCode(code)) {
    return res.status(400).json({ message: "Invalid phone number or code" });
  }

  try {
    const approved = await checkVerification(phone, code);
    if (!approved) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    const takenByOther = await User.exists({ phone, _id: { $ne: req.user.id } });
    if (takenByOther) {
      return res.status(409).json({
        code: "PHONE_IN_USE",
        message: "This number is already linked to another account.",
      });
    }

    // updateOne (ne save/findOneAndUpdate): zaobilazi validaciju i logove šeme,
    // pa se broj ne ispisuje u konzoli
    await User.updateOne(
      { _id: req.user.id },
      { $set: { phone, phoneVerified: true } }
    );

    return res.status(200).json({ phone: maskPhone(phone), verified: true });
  } catch (err) {
    // 11000: duplikat jedinstvenog indeksa (dve istovremene potvrde istog broja)
    if (err?.code === 11000) {
      return res.status(409).json({
        code: "PHONE_IN_USE",
        message: "This number is already linked to another account.",
      });
    }
    return handleProviderError(err, res, "add-verify");
  }
};

// DELETE /api/user/phone
// Uklanja broj sa naloga. Email ostaje način prijave (obavezan je), pa se niko ne zaključava.
exports.removePhone = async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user.id },
      { $unset: { phone: "" }, $set: { phoneVerified: false } }
    );
    return res.status(200).json({ phone: null, verified: false });
  } catch (err) {
    console.error("❌ [phone:remove]", err?.message);
    return res.status(500).json({ message: "Server error" });
  }
};