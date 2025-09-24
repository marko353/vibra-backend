const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinaryConfig');
const User = require('../models/User');
const {
    login,
    updateProfile,
    deleteProfilePicture,
    getProfileById,
    getProfile,
    getAllUsers,
    getPotentialMatches,
    swipeAction
} = require('../controllers/userController');
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ---------------- LOGIN ----------------
router.post("/login", (req, res, next) => {
    console.log("[Ruta] POST /api/user/login - Pokušaj logovanja");
    next();
}, login);

// ---------------- UPLOAD PROFILE PICTURE ----------------
router.post('/upload-profile-picture', authMiddleware, upload.single('profilePicture'), async (req, res) => {
    console.log(`[Ruta] POST /api/user/upload-profile-picture - UserID: ${req.user?.id}`);
    if (!req.file) return res.status(400).json({ message: "Nema slike za upload" });

    const position = req.body.position ? parseInt(req.body.position) : null;
    console.log("[Ruta] Pozicija slike:", position);

    if (position === null || isNaN(position) || position < 0 || position > 8)
        return res.status(400).json({ message: "Pozicija slike nije validna" });

    try {
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({ folder: "profile_pictures" }, (error, result) => {
                if (error) reject(error); else resolve(result);
            });
            stream.end(req.file.buffer);
        });

        console.log("[Ruta] Cloudinary upload uspešan:", result.secure_url);

        const user = await User.findById(req.user.id);
        if (!user) {
            console.error("[Ruta] User nije pronađen!");
            return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        const newProfilePictures = [...user.profilePictures];
        while (newProfilePictures.length < position + 1) newProfilePictures.push(null);
        newProfilePictures[position] = result.secure_url;

        user.profilePictures = newProfilePictures.filter(Boolean);
        if (user.profilePictures.length === 1) user.avatar = result.secure_url;

        await user.save();
        console.log("[Ruta] User slike update-ovan, broj slika:", user.profilePictures.length);

        res.status(200).json({ message: "Slika uspešno sačuvana", imageUrl: result.secure_url });
    } catch (error) {
        console.error("[Ruta] Greška prilikom uploada slike:", error.message);
        res.status(500).json({ message: "Greška prilikom slanja slike" });
    }
});

// ---------------- REORDER PROFILE PICTURES ----------------
router.put('/reorder-profile-pictures', authMiddleware, async (req, res) => {
    console.log("[Ruta] PUT /reorder-profile-pictures");
    try {
        const { pictures } = req.body;
        console.log("[Ruta] Novi redosled slika:", pictures);

        const user = await User.findById(req.user.id);
        if (!user) {
            console.error("[Ruta] User nije pronađen!");
            return res.status(404).json({ message: 'Korisnik nije pronađen.' });
        }

        const newProfilePictures = pictures.map(url => user.profilePictures.includes(url) ? url : null).filter(Boolean);
        user.profilePictures = newProfilePictures;
        await user.save();

        console.log("[Ruta] Slike uspešno ređane:", user.profilePictures);

        res.status(200).json({ message: 'Redosled slika je uspešno ažuriran.' });
    } catch (error) {
        console.error("[Ruta] Greška servera:", error.message);
        res.status(500).json({ message: 'Greška servera.' });
    }
});

// ---------------- SAVE PROFILE PICTURES ----------------
router.post("/save-profile-pictures", authMiddleware, async (req, res) => {
    console.log("[Ruta] POST /save-profile-pictures");
    try {
        const { images } = req.body;
        console.log("[Ruta] Slike za čuvanje:", images);

        const user = await User.findById(req.user.id);
        if (!user) {
            console.error("[Ruta] User nije pronađen!");
            return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        user.profilePictures = images;
        await user.save();

        console.log("[Ruta] User slike update-ovane, broj:", images.length);

        res.status(200).json({ message: "Slike uspešno sačuvane" });
    } catch (error) {
        console.error("[Ruta] Interna greška:", error.message);
        res.status(500).json({ message: "Interna greška servera" });
    }
});

// ---------------- GET PROFILE PICTURES ----------------
router.get('/profile-pictures', authMiddleware, async (req, res) => {
    console.log("[Ruta] GET /profile-pictures");
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            console.error("[Ruta] User nije pronađen!");
            return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        console.log("[Ruta] Vraćam slike:", user.profilePictures);

        res.status(200).json({ profilePictures: user.profilePictures });
    } catch (error) {
        console.error("[Ruta] Interna greška:", error.message);
        res.status(500).json({ message: "Interna greška servera" });
    }
});

// ---------------- DELETE PROFILE PICTURE ----------------
router.delete('/delete-profile-picture', authMiddleware, deleteProfilePicture);

// ---------------- POTENTIAL MATCHES ----------------
router.get("/matches", authMiddleware, getPotentialMatches);

// ---------------- SWIPE ACTION ----------------
router.post("/swipe", authMiddleware, swipeAction);

// ---------------- USER'S MATCHES ----------------
router.get("/my-matches", authMiddleware, async (req, res) => {
    console.log("[Ruta] GET /my-matches - UserID:", req.user?.id);
    try {
        const user = await User.findById(req.user.id).populate("matches", "fullName profilePictures birthDate");
        if (!user) {
            console.error("[Ruta] User nije pronađen!");
            return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        console.log("[Ruta] Broj match-eva:", user.matches.length);

        res.status(200).json({ matches: user.matches });
    } catch (error) {
        console.error("[Ruta] Greška servera:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
});

// ---------------- ALL USERS ----------------
router.get("/all-users", authMiddleware, getAllUsers);

// ---------------- GET PROFILE ----------------
router.get('/profile', authMiddleware, getProfile);

// ---------------- GET PROFILE BY ID ----------------
router.get('/:userId', authMiddleware, getProfileById);

// ---------------- UPDATE PROFILE ----------------
router.put('/update-profile', authMiddleware, updateProfile);

module.exports = router;
