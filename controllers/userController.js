const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cloudinary = require("cloudinary").v2;
const NodeGeocoder = require('node-geocoder');

// Konfiguracija geokodera
const options = {
  provider: 'openstreetmap',
  formatter: null,
  httpAdapter: 'https',
  timeout: 5000,
  headers: {
    'user-agent': 'VibrA/1.0',
    'referrer': 'http://localhost:5000'
  }
};
const geocoder = NodeGeocoder(options);

// Prijava korisnika
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log("LOGIN: Pokušaj prijave za e-mail:", email);

    const user = await User.findOne({ email });
    if (!user) {
      console.log("LOGIN: Korisnik nije pronađen za e-mail:", email);
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("LOGIN: Pogrešni podaci za e-mail:", email);
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "3h",
    });

    console.log("LOGIN: Token uspešno generisan za korisnika:", email);

    return res.status(200).json({
      message: "Login successful",
      token,
      profilePictures: user.profilePictures,
    });
  } catch (error) {
    console.error("LOGIN: Greška tokom prijave:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Brisanje slike iz profila
exports.deleteProfilePicture = async (req, res) => {
  try {
    const userId = req.user.id;
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ message: "Image URL is required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const parts = imageUrl.split("/");
    const filename = parts[parts.length - 1];
    const publicId = filename.split(".")[0];

    await cloudinary.uploader.destroy(publicId);

    user.profilePictures = user.profilePictures.filter(
      (url) => url !== imageUrl
    );
    await user.save();

    return res.status(200).json({
      message: "Image deleted successfully",
      profilePictures: user.profilePictures,
    });
  } catch (error) {
    console.error("Greška pri brisanju slike:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Ažuriranje lokacije korisnika
exports.updateLocation = async (req, res) => {
  const { latitude, longitude, accuracy } = req.body;
  const userId = req.user.id;

  console.log('UPDATE_LOCATION: Primljene koordinate za korisnika', userId, ':', { latitude, longitude, accuracy });

  if (latitude === undefined || longitude === undefined) {
    console.log('UPDATE_LOCATION: Greška - nedostaju latitude ili longitude.');
    return res.status(400).json({ message: 'Nedostaju latitude ili longitude' });
  }

  try {
    console.log('UPDATE_LOCATION: Pokrećem obrnuto geokodiranje...');
    const geoResponse = await geocoder.reverse({ lat: latitude, lon: longitude });

    console.log('UPDATE_LOCATION: Odgovor od geokodera:', JSON.stringify(geoResponse, null, 2));

    let locationCity = null;
    if (geoResponse && geoResponse.length > 0) {
      const geoData = geoResponse[0];
      
      let rawCity = geoData.city || geoData.county || geoData.town || geoData.village;

      // Nova logika: proveri da li je lokacija u Beogradu na osnovu formattedAddress
      const isBeograd = geoData.formattedAddress && (geoData.formattedAddress.includes('Град Београд') || geoData.formattedAddress.includes('Grad Beograd'));

      if (isBeograd) {
        locationCity = 'Београд';
      } else {
        locationCity = rawCity;
      }
    }

    console.log('UPDATE_LOCATION: Izdvojeni grad:', locationCity);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        'location.latitude': latitude,
        'location.longitude': longitude,
        'location.accuracy': accuracy,
        'location.locationCity': locationCity,
      },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      console.log('UPDATE_LOCATION: Greška - korisnik nije pronađen.');
      return res.status(404).json({ message: 'Korisnik nije pronađen' });
    }

    console.log('UPDATE_LOCATION: Lokacija uspešno ažurirana. Sačuvani grad:', updatedUser.location.locationCity);

    res.status(200).json({
      message: 'Lokacija uspešno ažurirana',
      locationCity: updatedUser.location.locationCity
    });
  } catch (error) {
    console.error('UPDATE_LOCATION: Greška prilikom ažuriranja lokacije:', error);
    res.status(500).json({ message: 'Došlo je do greške na serveru.' });
  }
};

// Ažuriranje profila korisnika
// Ažuriranje profila korisnika
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id; // koristimo ID iz tokena, ne iz parametra
    const updateData = req.body;

    console.log('UPDATE_PROFILE: Pokušaj ažuriranja profila za korisnika', userId);

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'Korisnik nije pronađen' });

    Object.assign(user, updateData);
    await user.save();

    const userResponse = { ...user._doc };
    delete userResponse.password;
    delete userResponse.resetPasswordToken;
    delete userResponse.resetPasswordExpires;
    delete userResponse.__v;

    console.log('UPDATE_PROFILE: Profil uspešno ažuriran.');
    return res.status(200).json({
      message: 'Profil uspešno ažuriran.',
      user: userResponse
    });
  } catch (error) {
    console.error('UPDATE_PROFILE: Greška pri ažuriranju profila:', error);
    res.status(500).json({ message: 'Došlo je do greške na serveru.' });
  }
};


// Dohvatanje profila po ID-u
exports.getProfileById = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'Korisnik nije pronađen' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Interna greška servera' });
  }
};

// Dohvatanje profila trenutno ulogovanog korisnika
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Dohvatanje svih korisnika
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, "fullName avatar _id profilePictures birthDate");
    const updatedUsers = users.map(user => {
      if (!user.avatar) {
        user.avatar = "https://path/to/default-avatar.jpg";
      }
      return user;
    });
    res.json(updatedUsers);
  } catch (error) {
    res.status(500).json({ message: "Greška pri dohvaćanju korisnika" });
  }
};