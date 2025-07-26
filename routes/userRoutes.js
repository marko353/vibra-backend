// routes/userRoutes.js
const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinaryConfig'); // Import Cloudinary konfiguracije
const User = require('../models/User'); // Import User modela
const { login } = require('../controllers/userController'); // Importuj login funkciju
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware"); 
const authenticateToken = require("../middleware/authMiddleware");
const { getAllUsers } = require("../controllers/userController");

// Konfiguracija Multer-a za upload slika na server pre slanja na Cloudinary
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post("/login", login);

// Ruta za upload slika
router.post('/upload-profile-picture', authMiddleware, upload.single('profilePicture'), async (req, res) => {
  try {
    console.log("📤 Početak upload-a slike...");

    if (!req.file) {
      console.log("❌ Nema slike u zahtevu!"); // Loguj ako nema slike
      return res.status(400).json({ message: "Nema slike za upload" });
    }

    console.log("🖼️ Slika primljena:", req.file.originalname); // Loguj ime slike

    // Upload slike na Cloudinary
    cloudinary.uploader.upload_stream(
      { folder: "profile_pictures" },
      async (error, result) => {
        if (error) {
          console.error("❌ Greška prilikom slanja slike na Cloudinary:", error); // Loguj grešku
          return res.status(500).json({ message: "Greška prilikom slanja slike" });
        }

        console.log("✅ Slika uspešno poslata na Cloudinary:", result.secure_url); // Loguj URL slike

        // Pronalazak korisnika u bazi
        const user = await User.findById(req.user.id);
        if (!user) {
          console.log("❌ Korisnik nije pronađen u bazi!"); // Loguj ako korisnik nije pronađen
          return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        // Dodavanje URL-a slike u listu profilnih slika
        user.profilePictures.push(result.secure_url);
        
        // Ako je ovo prva slika, postavi je kao avatar
        if (user.profilePictures.length === 1) {
          user.avatar = result.secure_url;
        }

        // Čuvanje korisnika sa novim URL-om slike i avatarom
        await user.save();

        console.log("💾 Slika uspešno sačuvana u bazi za korisnika:", user.email); // Loguj uspeh

        // Vraćanje odgovora sa URL-om slike
        res.status(200).json({ message: "Slika uspešno sačuvana", imageUrl: result.secure_url });
      }
    ).end(req.file.buffer);

  } catch (error) {
    console.error("❌ Interna greška servera:", error); // Loguj grešku
    res.status(500).json({ message: "Interna greška servera" });
  }
});

// Ruta za čuvanje slika u bazi
router.post("/save-profile-pictures", authMiddleware, async (req, res) => {
  try {
    console.log("📤 Početak čuvanja slika u bazi...");
    console.log("Request body:", req.body); // Loguj podatke koji su poslati u telo zahteva

    const { images } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      console.log("❌ Korisnik nije pronađen u bazi!"); // Loguj ako korisnik nije pronađen
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }

    user.profilePictures = images;
    await user.save();

    console.log("💾 Slike uspešno sačuvane u bazi:", user.profilePictures); // Loguj sačuvane slike

    res.status(200).json({ message: "Slike uspešno sačuvane" });
  } catch (error) {
    console.error("❌ Greška prilikom čuvanja slika:", error); // Loguj grešku ako se javila tokom čuvanja
    res.status(500).json({ message: "Interna greška servera" });
  }
});

// Ruta za dobijanje svih profilnih slika korisnika
router.get('/profile-pictures', authMiddleware, async (req, res) => {
  try {
    // Pronalazak korisnika u bazi
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log("❌ Korisnik nije pronađen u bazi!"); // Loguj ako korisnik nije pronađen
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }

    // Vraćanje svih profilnih slika korisnika
    res.status(200).json({ profilePictures: user.profilePictures });
  } catch (error) {
    console.error("❌ Greška prilikom dobijanja slika:", error); // Loguj grešku ako se javila prilikom dobijanja
    res.status(500).json({ message: "Interna greška servera" });
  }
});

// Ruta za brisanje profilne slike
router.post('/remove-profile-picture', authMiddleware, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    console.log("🚨 Zahtev za brisanje slike:", imageUrl);

    if (!imageUrl) {
      return res.status(400).json({ message: "imageUrl nije prosleđen" });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }

    const index = user.profilePictures.indexOf(imageUrl);
    if (index === -1) {
      return res.status(404).json({ message: "Slika nije pronađena" });
    }

    user.profilePictures.splice(index, 1);

    if (user.avatar === imageUrl) {
      user.avatar = user.profilePictures[0] || null;
    }

    await user.save();

    // Brisanje slike sa Cloudinary
    const publicId = getCloudinaryPublicId(imageUrl);
    if (publicId) {
      cloudinary.uploader.destroy(publicId, (error, result) => {
        if (error) {
          console.error("❌ Greška prilikom brisanja slike sa Cloudinary:", error);
        } else {
          console.log("✅ Slika uspešno obrisana sa Cloudinary:", result);
        }
      });
    }

    return res.status(200).json({ message: "Slika uspešno obrisana" });
  } catch (error) {
    console.error("❌ Greška pri brisanju slike:", error);
    return res.status(500).json({ message: "Interna greška servera" });
  }
});

// Pomoćna funkcija za dobijanje public_id sa Cloudinary URL-a
function getCloudinaryPublicId(imageUrl) {
  try {
    const url = new URL(imageUrl);
    const parts = url.pathname.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return null;

    const publicIdWithVersion = parts.slice(uploadIndex + 1).join('/');
    const withoutVersion = publicIdWithVersion.replace(/^v\d+\//, '');
    const publicId = withoutVersion.replace(/\.[^/.]+$/, "");
    return publicId;
  } catch {
    return null;
  }
}

// Ruta za dobijanje korisničkog profila
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Ruta za dobijanje svih korisnika
router.get("/all-users", authenticateToken, async (req, res) => {
  try {
    const users = await User.find({}, "fullName avatar _id profilePictures birthDate ");

    const updatedUsers = users.map(user => {
      if (!user.avatar) {
        user.avatar = "https://path/to/default-avatar.jpg";
      }
      return user;
    });

    console.log("Korisnici iz baze:", updatedUsers);
    res.json(updatedUsers);
  } catch (error) {
    console.error("Greška pri dohvaćanju korisnika:", error);
    res.status(500).json({ message: "Greška pri dohvaćanju korisnika" });
  }
});

module.exports = router;
