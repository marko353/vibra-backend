const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.register = async (req, res) => {
  try {
    const { fullName, username, birthDate, email, password } = req.body;
    console.log("📤 Registracija pokušana za:", email);

    // Proveri da li korisnik već postoji
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log("❌ Korisnik već postoji:", email); // Loguj ako korisnik već postoji
      return res.status(400).json({ message: "User already exists" });
    }

    // Kreiraj novog korisnika
    console.log("💾 Kreiranje novog korisnika...");
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      fullName,
      username,
      birthDate,
      email,
      password: hashedPassword,
    });

    await newUser.save();
    console.log("✅ Korisnik registrovan uspešno:", newUser);

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("❌ Greška prilikom registracije:", error); // Loguj grešku prilikom registracije
    res.status(500).json({ message: "Internal server error" });
  }
};


exports.logout = (req, res) => {
  console.log("🔑 Korisnik je odjavljen");
  res.status(200).json({ message: "Logged out successfully" });
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("📤 Pokušaj prijave za:", email);

    const user = await User.findOne({ email });
    if (!user) {
      console.log("❌ Korisnik nije pronađen:", email); // Loguj ako korisnik nije pronađen
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Nevalidni podaci za:", email); // Loguj ako su podaci nevalidni
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "3h" });
    console.log("✅ Generisan token za korisnika:", email); // Loguj generisani token

    return res.status(200).json({
      message: "Login successful",
      token,
    });
  } catch (error) {
    console.error("❌ Greška prilikom prijave:", error); // Loguj grešku prilikom prijave
    res.status(500).json({ message: "Internal server error" });
  }
};
