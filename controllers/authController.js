const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const sendEmail = require("../sendEmail");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Registracija korisnika
exports.register = async (req, res) => {
  try {
    const { fullName, username, birthDate, email, password } = req.body;
    console.log("📤 Registracija pokušana za:", email);

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("❌ Korisnik već postoji:", email);
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ fullName, username, birthDate, email, password: hashedPassword });

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

// Forgot password
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User with this email not found" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "15m" });

    // Deep link za mobilnu aplikaciju:
   const resetLink = `https://vibra.com/reset-password?userId=${user._id}&token=${token}`;

    // Web fallback link ako želiš:
    // const webResetLink = `https://vibra.com/reset-password?userId=${user._id}&token=${token}`;

    const subject = "VibrA - Reset lozinke";
    const html = `
      <p>Zdravo ${user.fullName},</p>
      <p>Klikni na sledeći link da resetuješ lozinku:</p>
      <a href="${resetLink}" target="_blank">${resetLink}</a>
      <p>Ako nisi tražio reset lozinke, slobodno ignoriši ovaj email.</p>
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.id !== userId) return res.status(401).json({ message: "Invalid token or user" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

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
