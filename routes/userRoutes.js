const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinaryConfig');
const User = require('../models/User');
const { login, updateProfile, deleteProfilePicture, updateLocation } = require('../controllers/userController');
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post("/login", login);

// AŽURIRANO: Dodati logovi za proveru rute
router.put('/update-location', authMiddleware, (req, res, next) => {
    console.log('ROUTE: Ažuriranje lokacije - ruta je pogođena.');
    next();
}, updateLocation);

// Upload profilne slike - ISPRAVLJENO: Naziv polja za Multer bi trebalo da bude "profilePicture"
router.post('/upload-profile-picture', authMiddleware, upload.single('profilePicture'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: "Nema slike za upload" });
    }

    const stream = cloudinary.uploader.upload_stream(
        { folder: "profile_pictures" },
        async (error, result) => {
            if (error) {
                console.error("Greška prilikom slanja slike:", error);
                return res.status(500).json({ message: "Greška prilikom slanja slike" });
            }

            try {
                const user = await User.findById(req.user.id);
                if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

                user.profilePictures.push(result.secure_url);

                if (user.profilePictures.length === 1) {
                    user.avatar = result.secure_url;
                }

                await user.save();

                res.status(200).json({ message: "Slika uspešno sačuvana", imageUrl: result.secure_url });
            } catch (e) {
                console.error("Greška pri čuvanju korisnika:", e);
                res.status(500).json({ message: "Greška pri čuvanju korisnika" });
            }
        }
    );

    stream.end(req.file.buffer);
});

// Čuvanje svih slika u bazi
router.post("/save-profile-pictures", authMiddleware, async (req, res) => {
    try {
        const { images } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

        user.profilePictures = images;
        await user.save();

        res.status(200).json({ message: "Slike uspešno sačuvane" });
    } catch (error) {
        res.status(500).json({ message: "Interna greška servera" });
    }
});

// Dohvatanje slika korisnika
router.get('/profile-pictures', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

        res.status(200).json({ profilePictures: user.profilePictures });
    } catch (error) {
        res.status(500).json({ message: "Interna greška servera" });
    }
});

// Brisanje slike
router.delete('/delete-profile-picture', authMiddleware, async (req, res) => {
    try {
        const { imageUrl } = req.body; // Axios podržava slanje body i za DELETE
        if (!imageUrl) return res.status(400).json({ message: "imageUrl nije prosleđen" });

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

        const index = user.profilePictures.indexOf(imageUrl);
        if (index === -1) return res.status(404).json({ message: "Slika nije pronađena" });

        user.profilePictures.splice(index, 1);

        if (user.avatar === imageUrl) {
            user.avatar = user.profilePictures[0] || null;
        }

        await user.save();

        const publicId = getCloudinaryPublicId(imageUrl);
        if (publicId) {
            cloudinary.uploader.destroy(publicId, (error, result) => {
                if (error) console.error("Greška pri brisanju slike sa Cloudinary:", error);
            });
        }

        return res.status(200).json({ message: "Slika uspešno obrisana" });
    } catch (error) {
        return res.status(500).json({ message: "Interna greška servera" });
    }
});

function getCloudinaryPublicId(imageUrl) {
    try {
        const url = new URL(imageUrl);
        const parts = url.pathname.split('/');
        const publicIdWithVersion = parts.slice(parts.indexOf('upload') + 2).join('/');
        const publicId = publicIdWithVersion.replace(/\.[^/.]+$/, "");
        return publicId;
    } catch {
        return null;
    }
}

// Dohvatanje profila trenutno ulogovanog korisnika
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Dohvatanje profila po ID-u
router.get('/:userId', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: 'Korisnik nije pronađen' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Interna greška servera' });
    }
});

// Ažuriranje profila
router.put('/update-profile', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { field, value } = req.body; // <--- Uklonjen je objekat updates

        if (!field || typeof value === 'undefined') {
            return res.status(400).json({ message: 'Nevažeći podaci za ažuriranje.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Korisnik nije pronađen' });

        // Ažuriranje samo jednog polja, sa dinamičkim ključem
        user[field] = value;
        await user.save();

        return res.status(200).json({ message: 'Profil uspešno ažuriran' });
    } catch (error) {
        console.error("Greška pri ažuriranju profila:", error);
        return res.status(500).json({ message: 'Interna greška servera' });
    }
});
// Dohvatanje svih korisnika
router.get("/all-users", authMiddleware, async (req, res) => {
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
});

module.exports = router;
