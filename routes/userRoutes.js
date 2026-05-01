// routes/userRoutes.js
const express = require('express');
const multer = require('multer');
const cloudinary = require('../config/cloudinaryConfig');
const authMiddleware = require("../middleware/authMiddleware");

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
  getIncomingLikes,
  postMessage,
  unmatchUser,
  reorderProfilePictures,
  markAsRead,
  saveUserFilters,
  getUserFilters,
  createMatchAndNotify // Importovano iz kontrolera
} = require('../controllers/userController');

const User = require("../models/User");

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ========== TRAJNI FILTERI ==========
router.patch('/filters', authMiddleware, saveUserFilters);
router.get('/filters', authMiddleware, getUserFilters);

/* ===================== LOGIN ===================== */
router.post('/login', (req, res, next) => {
  console.log('[Ruta] POST /api/user/login');
  next();
}, login);

/* ===================== UPLOAD PROFILE PICTURE ===================== */
router.post(
  '/upload-profile-picture',
  authMiddleware,
  upload.single('profilePicture'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Nema slike za upload" });

    const position = Number(req.body.position);
    if (Number.isNaN(position) || position < 0 || position > 8) {
      return res.status(400).json({ message: "Pozicija slike nije validna" });
    }

    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "profile_pictures" },
          (error, result) => (error ? reject(error) : resolve(result))
        );
        stream.end(req.file.buffer);
      });

      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

      const pictures = [...user.profilePictures];
      while (pictures.length < position + 1) pictures.push(null);
      pictures[position] = result.secure_url;

      user.profilePictures = pictures.filter(Boolean);
      if (!user.avatar) user.avatar = result.secure_url;

      await user.save();
      res.status(200).json({ imageUrl: result.secure_url });
    } catch (err) {
      console.error('[UPLOAD ERROR]', err);
      res.status(500).json({ message: 'Greška prilikom uploada slike' });
    }
  }
);

/* ===================== PROFILE PICTURES ===================== */
router.get('/profile-pictures', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });
  res.json({ profilePictures: user.profilePictures });
});

router.delete('/delete-profile-picture', authMiddleware, deleteProfilePicture);

/* ===================== LOCATION ===================== */
router.patch('/update-location', authMiddleware, async (req, res) => {
  const { latitude, longitude, accuracy, locationCity, showLocation } = req.body;

  const update = showLocation
    ? { location: { latitude, longitude, accuracy, locationCity }, showLocation: true }
    : { location: null, showLocation: false };

  const user = await User.findByIdAndUpdate(req.user.id, update, { new: true });
  if (!user) return res.status(404).json({ message: "Korisnik nije pronađen" });

  res.json({ location: user.location, showLocation: user.showLocation });
});

/* ===================== POTENTIAL MATCHES ===================== */
router.get('/potential-matches', authMiddleware, getPotentialMatches);

/* ===================== REORDER PROFILE PICTURES ===================== */
router.put('/reorder-profile-pictures', authMiddleware, reorderProfilePictures);

/* ===================== SWIPE ===================== */
router.post('/swipe', authMiddleware, swipeAction);

/* ===================== MESSAGES ===================== */
router.post('/message', authMiddleware, postMessage);
router.get('/chat/:chatId/messages', authMiddleware, getMessages);
router.post('/chat/:chatId/message', authMiddleware, postMessage);
router.post('/chat/:chatId/mark-as-read', authMiddleware, markAsRead);

/* ===================== INCOMING LIKES ===================== */
router.get('/incoming-likes', authMiddleware, getIncomingLikes);

/* ===================== MATCHES & UNMATCH ===================== */
router.get('/my-matches', authMiddleware, getMatchesAndConversations);
router.delete('/match/:chatId', authMiddleware, unmatchUser);

/* ===================== USERS & PROFILE ===================== */
router.get('/all-users', authMiddleware, getAllUsers);
router.get('/profile', authMiddleware, getProfile);

/* ===================== FCM TOKEN (NOVO) ===================== */
router.post('/save-fcm-token', authMiddleware, async (req, res) => {
  const { fcmToken } = req.body;
  const userId = req.user.id; // Uzimamo ID iz dekodovanog tokena

  if (!fcmToken) {
    return res.status(400).json({ error: 'Missing fcmToken' });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId, 
      { fcmToken }, 
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ FCM token uspešno ažuriran za: ${user.fullName}`);
    res.status(200).json({ message: 'Token saved successfully' });
  } catch (error) {
    console.error(`❌ Greška pri čuvanju FCM tokena: ${error.message}`);
    res.status(500).json({ error: 'Failed to save token' });
  }
});

/* ===================== MATCH NOTIFICATION (NOVO) ===================== */
router.post('/match-notify', authMiddleware, async (req, res) => {
  const { userId2 } = req.body;
  const userId1 = req.user.id;

  try {
    await createMatchAndNotify(userId1, userId2);
    res.status(200).json({ message: 'Match created and notifications sent' });
  } catch (error) {
    console.error('Error creating match:', error);
    res.status(500).json({ error: 'Failed to create match' });
  }
});

/* ===================== UPDATE PROFILE ===================== */
router.put('/update-profile', authMiddleware, updateProfile);

/* ⚠️ DINAMIČKA RUTA UVEK NA KRAJU */
router.get('/:userId', authMiddleware, getProfileById);

module.exports = router;