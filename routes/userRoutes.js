// routes/userRoutes.js
const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinaryConfig');
const {
    login,
    updateProfile,
    deleteProfilePicture,
    getProfileById,
    getProfile,
    getAllUsers,
    getPotentialMatches,
    swipeAction,
    getMatchesAndConversations,
    getMessages,
    postMessage,
    unmatchUser // ✅ NOVI IMPORT
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
    if (position === null || isNaN(position) || position < 0 || position > 8)
        return res.status(400).json({ message: "Pozicija slike nije validna" });

    try {
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({ folder: "profile_pictures" }, (error, result) => {
                if (error) reject(error); else resolve(result);
            });
            stream.end(req.file.buffer);
        });

        const user = await require("../models/User").findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

        const newProfilePictures = [...user.profilePictures];
        while (newProfilePictures.length < position + 1) newProfilePictures.push(null);
        newProfilePictures[position] = result.secure_url;

        user.profilePictures = newProfilePictures.filter(Boolean);
        if (user.profilePictures.length === 1) user.avatar = result.secure_url;

        await user.save();
        res.status(200).json({ message: "Slika uspešno sačuvana", imageUrl: result.secure_url });
    } catch (error) {
        console.error("[Ruta] Greška prilikom uploada slike:", error.message);
        res.status(500).json({ message: "Greška prilikom slanja slike" });
    }
});

// ---------------- REORDER PROFILE PICTURES ----------------
router.put('/reorder-profile-pictures', authMiddleware, async (req, res) => {
    try {
        const { pictures } = req.body;
        const user = await require("../models/User").findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'Korisnik nije pronađen.' });

        const newProfilePictures = pictures.map(url => user.profilePictures.includes(url) ? url : null).filter(Boolean);
        user.profilePictures = newProfilePictures;
        await user.save();

        res.status(200).json({ message: 'Redosled slika je uspešno ažuriran.' });
    } catch (error) {
        console.error("[Ruta] Greška servera:", error.message);
        res.status(500).json({ message: 'Greška servera.' });
    }
});

// ---------------- SAVE PROFILE PICTURES ----------------
router.post("/save-profile-pictures", authMiddleware, async (req, res) => {
    try {
        const { images } = req.body;
        const user = await require("../models/User").findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

        user.profilePictures = images;
        await user.save();

        res.status(200).json({ message: "Slike uspešno sačuvane" });
    } catch (error) {
        console.error("[Ruta] Interna greška:", error.message);
        res.status(500).json({ message: "Interna greška servera" });
    }
});

// ---------------- GET PROFILE PICTURES ----------------
router.get('/profile-pictures', authMiddleware, async (req, res) => {
    try {
        const user = await require("../models/User").findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

        res.status(200).json({ profilePictures: user.profilePictures });
    } catch (error) {
        console.error("[Ruta] Interna greška:", error.message);
        res.status(500).json({ message: "Interna greška servera" });
    }
});

// ---------------- DELETE PROFILE PICTURE ----------------
router.delete('/delete-profile-picture', authMiddleware, deleteProfilePicture);

// ---------------- UPDATE LOCATION ----------------
router.patch("/update-location", authMiddleware, async (req, res) => {
    try {
        const { latitude, longitude, accuracy, locationCity, showLocation } = req.body;

        const updateData = {};
        if (showLocation) {
            updateData.location = { latitude, longitude, accuracy, locationCity };
            updateData.showLocation = true;
        } else {
            updateData.location = null;
            updateData.showLocation = false;
        }

        const user = await require("../models/User").findByIdAndUpdate(req.user.id, { $set: updateData }, { new: true });
        if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

        res.status(200).json({
            message: "Lokacija ažurirana",
            location: user.location,
            showLocation: user.showLocation
        });
    } catch (error) {
        console.error("[Ruta] Greška update-location:", error.message);
        res.status(500).json({ message: "Greška prilikom čuvanja lokacije" });
    }
});

// ---------------- POTENTIAL MATCHES ----------------
router.get("/matches", authMiddleware, getPotentialMatches);

// ---------------- SWIPE ACTION ----------------
router.post("/swipe", authMiddleware, swipeAction);

// ---------------- USER'S MATCHES ----------------
router.get("/my-matches", authMiddleware, getMatchesAndConversations);

// ---------------- UNMATCH (DELETE) ACTION ----------------
router.delete("/match/:chatId", authMiddleware, unmatchUser); // ✅ NOVI ENDPOINT

// DODAJ OVE DVE RUTE
router.get("/chat/:chatId/messages", authMiddleware, getMessages);
router.post("/chat/:chatId/message", authMiddleware, postMessage);

// ---------------- ALL USERS ----------------
router.get("/all-users", authMiddleware, getAllUsers);

// ---------------- GET PROFILE ----------------
router.get('/profile', authMiddleware, getProfile);

// ---------------- GET PROFILE BY ID ----------------
router.get('/:userId', authMiddleware, getProfileById);

// ---------------- UPDATE PROFILE ----------------
router.put('/update-profile', authMiddleware, updateProfile);

module.exports = router;