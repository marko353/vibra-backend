const crypto = require("crypto");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const sendEmail = require("../sendEmail");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Rok važenja tokena za prijavu
const AUTH_TOKEN_EXPIRES_IN = "365d";

// Tajna za phoneToken: mora biti ista kao u phoneController.js (tamo se token izdaje)
const phoneSignupSecret = () => process.env.JWT_SECRET + ":phone-signup";

const MIN_AGE = 18;

const isAdult = (birthDate) => {
  const date = new Date(birthDate);
  if (isNaN(date.getTime())) return false;

  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) age--;

  return age >= MIN_AGE;
};

// Nasumično korisničko ime: nikad se ne gradi od broja telefona ili emaila
const randomUsername = () => `user_${crypto.randomBytes(4).toString("hex")}`;

// Registracija korisnika (email + lozinka, ili telefon potvrđen SMS kodom)
//
// Telefon se NE prima iz tela zahteva. Klijent dobija phoneToken od
// POST /api/auth/verify-code (kad je kod tačan, a broj nema nalog) i šalje ga ovde.
// Broj se uzima iz tokena koji je potpisao server, pa ga niko ne može lažirati.
exports.register = async (req, res) => {
  try {
    const { fullName, username, birthDate, email, password, gender, phoneToken } = req.body;

    if (!["male", "female", "other"].includes(gender)) {
      return res
        .status(400)
        .json({ message: 'Pol je obavezan i mora biti "male", "female" ili "other".' });
    }

    if (!isAdult(birthDate)) {
      return res.status(400).json({ message: "You must be at least 18 years old." });
    }

    // Potvrđen telefon (samo preko tokena koji je izdao server)
    let verifiedPhone;
    if (phoneToken) {
      try {
        const decoded = jwt.verify(phoneToken, phoneSignupSecret());
        if (decoded.purpose !== "phone-signup" || !decoded.phone) {
          throw new Error("Invalid phone token");
        }
        verifiedPhone = decoded.phone;
      } catch {
        return res.status(400).json({
          message: "Phone verification expired. Please verify your number again.",
        });
      }
    }

    const normalizedEmail = email ? String(email).trim().toLowerCase() : undefined;

    if (!normalizedEmail && !verifiedPhone) {
      return res
        .status(400)
        .json({ message: "Email or a verified phone number is required." });
    }

    if (normalizedEmail && (!password || String(password).length < 6)) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    console.log("📤 Registracija pokušana:", normalizedEmail ? "email" : "phone");

    if (normalizedEmail && (await User.exists({ email: normalizedEmail }))) {
      return res.status(400).json({ message: "User with this email already exists" });
    }

    if (verifiedPhone && (await User.exists({ phone: verifiedPhone }))) {
      return res.status(400).json({ message: "User with this phone already exists" });
    }

    // Lozinka samo za email registraciju (kod telefona je nema)
    const hashedPassword = normalizedEmail ? await bcrypt.hash(password, 10) : undefined;

    // undefined (ne null) za polja koja nisu poslata, da jedinstveni indeksi ne prave duplikate
    const newUser = new User({
      fullName,
      username: username || randomUsername(),
      birthDate,
      email: normalizedEmail,
      password: hashedPassword,
      gender,
      phone: verifiedPhone,
      phoneVerified: !!verifiedPhone,
    });

    await newUser.save();
    console.log("✅ Korisnik uspešno registrovan:", newUser._id);

    // Generišemo JWT token odmah pri registraciji
    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, {
      expiresIn: AUTH_TOKEN_EXPIRES_IN,
    });

    res.status(201).json({
      message: "User registered successfully",
      id: newUser._id,
      fullName: newUser.fullName,
      email: newUser.email,
      token,
    });
  } catch (error) {
    // 11000: duplikat jedinstvenog polja (npr. dve istovremene registracije)
    if (error?.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const messages = {
        email: "User with this email already exists",
        phone: "User with this phone already exists",
        username: "This username is already taken",
      };
      return res.status(400).json({ message: messages[field] || "User already exists" });
    }

    console.error("❌ Greška prilikom registracije:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Klasični login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("📤 Pokušaj prijave emailom");

    const user = await User.findOne({ email: email?.trim().toLowerCase() });

    // Ista poruka za nepostojeći nalog i pogrešnu lozinku
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Nalog bez lozinke (Google ili telefon)
    if (!user.password) {
      return res.status(400).json({
        message: "This account doesn't use a password. Log in with Google or your phone number.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: AUTH_TOKEN_EXPIRES_IN,
    });

    res.status(200).json({
      message: "Login successful",
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      token,
    });
  } catch (error) {
    console.error("❌ Greška prilikom prijave:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Google login
exports.googleLogin = async (req, res) => {
  const { token } = req.body;

  // 1. Provera Google tokena: greška ovde je 401
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    console.error("❌ Google token nije validan:", error?.message);
    return res.status(401).json({ message: "Google authentication failed" });
  }

  // Ne spajamo naloge po emailu koji Google nije potvrdio
  if (!payload?.email || !payload.email_verified) {
    return res.status(401).json({ message: "Your Google email is not verified" });
  }

  try {
    const { sub: googleId, name, picture } = payload;
    const email = payload.email.trim().toLowerCase();

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        googleId,
        email,
        fullName: name,
        avatar: picture,
      });

      await user.save();
      console.log("🆕 Google korisnik kreiran");
    } else {
      console.log("✅ Google korisnik već postoji");
    }

    const jwtToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: AUTH_TOKEN_EXPIRES_IN,
    });

    res.status(200).json({
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      token: jwtToken,
    });
  } catch (error) {
    // Greške baze su 500, a ne "Google authentication failed"
    console.error("❌ Google login greška (baza):", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Logout
exports.logout = (req, res) => {
  console.log("🔑 Korisnik odjavljen");
  res.status(200).json({ message: "Logged out successfully" });
};

// Reset password redirect (HTTP → deep link)
exports.resetPasswordRedirect = (req, res) => {
  const { userId, token } = req.query;
  console.log("🔗 resetPasswordRedirect pozvan:", { userId, token: token?.substring(0, 20) + "..." });

  const safeUserId = encodeURIComponent(userId || '');
  const safeToken = encodeURIComponent(token || '');

  const scheme = "vibra-date";
  const androidPackage = "com.marko353.vibradate";

  const plainDeepLink = `${scheme}://reset-password?userId=${safeUserId}&token=${safeToken}`;
  const fallbackUrl = `${process.env.BASE_URL || "http://192.168.1.6:5000"}/`;

  const intentUrl =
    `intent://reset-password?userId=${safeUserId}&token=${safeToken}` +
    `#Intent;scheme=${scheme};package=${androidPackage};` +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;

  res.send(`
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 40px; background: #0F0F12; color: #FFFFFF; }
          a { color: #E91E63; font-weight: bold; text-decoration: none; }
          .container { max-width: 400px; margin: 40px auto; padding: 24px; background: #1C1C22; border-radius: 16px; border: 1px solid #2C2C35; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2 style="color: #E91E63; margin-bottom: 8px;">VibrA</h2>
          <p>Opening VibrA app...</p>
          <p style="font-size: 13px; color: #A0A0AB;">If the app doesn't open automatically, <a id="fallbackLink" href="${plainDeepLink}">click here</a>.</p>
        </div>
        <script>
          var ua = navigator.userAgent || "";
          var isAndroid = /Android/i.test(ua);

          if (isAndroid) {
            window.location.href = "${intentUrl}";
          } else {
            window.location.href = "${plainDeepLink}";
          }
        </script>
      </body>
    </html>
  `);
};

// Forgot password
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });

    if (!user || !user.password) {
      return res.status(200).json({ message: "Reset password link sent to email" });
    }

    const secret = process.env.JWT_SECRET + user.password;
    const token = jwt.sign({ id: user._id }, secret, { expiresIn: "15m" });

    const baseUrl = process.env.BASE_URL || "http://192.168.1.6:5000";
    const resetLink = `${baseUrl}/api/auth/reset-password-redirect?userId=${user._id}&token=${token}`;

    const subject = "Reset Your VibrA Password";
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0F0F12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FFFFFF;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0F0F12; padding: 40px 10px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 460px; background-color: #18181F; border-radius: 20px; border: 1px solid #2B2B36; padding: 36px 28px; box-shadow: 0 12px 32px rgba(0,0,0,0.5);">
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <span style="font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #FF2A85 0%, #8A2BE2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: -0.5px;">
                      VibrA
                    </span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #FFFFFF;">Reset Your Password</h1>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 28px;">
                    <p style="margin: 0; font-size: 14px; line-height: 22px; color: #A0A0AB;">
                      Hi <strong style="color: #FFFFFF;">${user.fullName || "there"}</strong>,<br>
                      We received a request to reset your password for your VibrA account. Click the button below to choose a new password.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 28px;">
                    <a href="${resetLink}" target="_blank" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #FF2A85 0%, #8A2BE2 100%); color: #FFFFFF; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 20px rgba(255, 42, 133, 0.4);">
                      Reset Password
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #6E6E7A;">
                      If the button doesn't work, copy and paste this link into your mobile browser:
                    </p>
                    <p style="margin: 0; word-break: break-all; font-size: 11px; color: #FF2A85; line-height: 16px;">
                      ${resetLink}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="border-top: 1px solid #2B2B36; padding-top: 20px;">
                    <p style="margin: 0; font-size: 11px; color: #52525E; text-align: center; line-height: 16px;">
                      If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged. This link expires in <strong>15 minutes</strong>.
                    </p>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 460px; margin-top: 20px;">
                <tr>
                  <td align="center">
                    <p style="margin: 0; font-size: 11px; color: #52525E;">
                      &copy; ${new Date().getFullYear()} VibrA. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    await sendEmail({ to: user.email, subject, html });

    res.status(200).json({ message: "Reset password link sent to email" });
  } catch (error) {
    console.error("❌ Greška u forgotPassword:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  const { userId, token, newPassword } = req.body;

  if (!userId || !token || !newPassword) return res.status(400).json({ message: "Missing required fields" });

  if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

  try {
    const user = await User.findById(userId);
    if (!user || !user.password) return res.status(404).json({ message: "User not found" });

    const secret = process.env.JWT_SECRET + user.password;
    jwt.verify(token, secret);

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    console.log(`🔐 Password reset successful for: ${user.email}`);
    res.status(200).json({ message: "Password successfully reset" });
  } catch (err) {
    console.error("❌ Reset password error:", err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "Token expired" });
    }
    res.status(401).json({ message: "Invalid or expired token" });
  }
};