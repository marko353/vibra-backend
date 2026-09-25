const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const sendEmail = require("../sendEmail");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Registracija korisnika
exports.register = async (req, res) => {
  try {
    const { fullName, username, birthDate, email, password, gender } = req.body;
    console.log("📤 Registracija pokušana za:", email);

    if (!['male', 'female', 'other'].includes(gender)) {
      return res.status(400).json({ message: 'Pol je obavezan i mora biti "male", "female" ili "other".' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("❌ Korisnik već postoji:", email);
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ fullName, username, birthDate, email, password: hashedPassword, gender });

    await newUser.save();
    console.log("✅ Korisnik registrovan:", newUser.email);

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("❌ Greška prilikom registracije:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Klasični login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("📤 Pokušaj prijave za:", email);

    const user = await User.findOne({ email });
    if (!user) {
      console.log("❌ Korisnik nije pronađen:", email);
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Nevalidni podaci za:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "3h" });

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

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        googleId,
        email,
        fullName: name,
        avatar: picture,
        password: "",
      });

      await user.save();
      console.log("🆕 Google korisnik kreiran:", email);
    } else {
      console.log("✅ Google korisnik već postoji:", email);
    }

    const jwtToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.status(200).json({
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      token: jwtToken,
    });
  } catch (error) {
    console.error("❌ Google login greška:", error);
    res.status(401).json({ message: "Google authentication failed" });
  }
};

// Logout
exports.logout = (req, res) => {
  console.log("🔑 Korisnik odjavljen");
  res.status(200).json({ message: "Logged out successfully" });
};

// Reset password redirect (HTTP → deep link)
//
// IZMENA: Android Chrome (i mejl klijenti koji koriste WebView/Custom
// Tabs) ne garantuju da će auto-redirect preko `window.location.href`
// ili `<meta http-equiv="refresh">` ka golom custom scheme-u
// (npr. "vibra-date://...") stvarno proslediti intent OS-u — jer se
// takva navigacija ne tretira kao pravi "user gesture". Rezultat: link
// se "tiho" ignoriše, a app se kasnije pokrene hladno (bez URL-a),
// pa auth guard vrati korisnika na login.
//
// `intent://` URI sintaksa je standardan, Google-dokumentovan način
// da se ovo zaobiđe — Chrome je pouzdano prosleđuje OS-u, sa
// mogućnošću fallback linka ako app nije instalirana.
exports.resetPasswordRedirect = (req, res) => {
  const { userId, token } = req.query;
  console.log("🔗 resetPasswordRedirect pozvan:", { userId, token: token?.substring(0, 20) + "..." });

  const safeUserId = encodeURIComponent(userId || '');
  const safeToken = encodeURIComponent(token || '');

  const scheme = "vibra-date";
  const androidPackage = "com.marko353.vibradate"; // <- potvrđeno iz adb izlaza, poklapa se

  // Klasičan custom-scheme deep link — koristi se za iOS i kao <a href> fallback.
  const plainDeepLink = `${scheme}://reset-password?userId=${safeUserId}&token=${safeToken}`;

  // Fallback URL ako app nije instalirana (prilagodi po potrebi — npr. Play Store link ili landing page).
  const fallbackUrl = `${process.env.BASE_URL || "http://192.168.1.6:5000"}/`;

  // Android intent:// URI — ovo Chrome pouzdano prosleđuje OS-u čak i
  // kad je navigacija pokrenuta skriptom, ne direktnim klikom korisnika.
  const intentUrl =
    `intent://reset-password?userId=${safeUserId}&token=${safeToken}` +
    `#Intent;scheme=${scheme};package=${androidPackage};` +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;

  console.log("🔗 plainDeepLink:", plainDeepLink.substring(0, 60) + "...");
  console.log("🔗 intentUrl:", intentUrl.substring(0, 60) + "...");

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
          // Detektuj platformu i koristi odgovarajući URI:
          // - Android: intent:// (pouzdano prosleđen OS-u čak i preko script-navigacije)
          // - iOS/ostalo: klasičan custom scheme
          var ua = navigator.userAgent || "";
          var isAndroid = /Android/i.test(ua);

          if (isAndroid) {
            window.location.href = "${intentUrl}";
          } else {
            window.location.href = "${plainDeepLink}";
            // iOS ponekad zahteva pravi user-gesture; ostavi vidljiv "click here" link kao fallback.
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
    const user = await User.findOne({ email });

    if (!user) {
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
              <!-- Card Wrapper -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 460px; background-color: #18181F; border-radius: 20px; border: 1px solid #2B2B36; padding: 36px 28px; box-shadow: 0 12px 32px rgba(0,0,0,0.5);">
                
                <!-- Logo -->
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <span style="font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #FF2A85 0%, #8A2BE2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: -0.5px;">
                      VibrA
                    </span>
                  </td>
                </tr>

                <!-- Title -->
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #FFFFFF;">Reset Your Password</h1>
                  </td>
                </tr>

                <!-- Body Text -->
                <tr>
                  <td align="center" style="padding-bottom: 28px;">
                    <p style="margin: 0; font-size: 14px; line-height: 22px; color: #A0A0AB;">
                      Hi <strong style="color: #FFFFFF;">${user.fullName || "there"}</strong>,<br>
                      We received a request to reset your password for your VibrA account. Click the button below to choose a new password.
                    </p>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td align="center" style="padding-bottom: 28px;">
                    <a href="${resetLink}" target="_blank" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #FF2A85 0%, #8A2BE2 100%); color: #FFFFFF; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 20px rgba(255, 42, 133, 0.4);">
                      Reset Password
                    </a>
                  </td>
                </tr>

                <!-- Direct Link -->
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

                <!-- Footer Note -->
                <tr>
                  <td style="border-top: 1px solid #2B2B36; padding-top: 20px;">
                    <p style="margin: 0; font-size: 11px; color: #52525E; text-align: center; line-height: 16px;">
                      If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged. This link expires in <strong>15 minutes</strong>.
                    </p>
                  </td>
                </tr>

              </table>
              
              <!-- Bottom Footer -->
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

    await sendEmail({ to: email, subject, html });

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
    if (!user) return res.status(404).json({ message: "User not found" });

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