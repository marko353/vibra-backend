// routes/voice.js
// POST /api/voice/upload  (multipart: file, duration)  ->  { url, duration }
// Snimak ide direktno iz memorije na Cloudinary (audio se tamo čuva kao resource_type "video").
// Folder je voice_messages/<userId>, pa server kasnije može da proveri da URL pripada pošiljaocu.

const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const cloudinary = require("../config/cloudinaryConfig");

const router = express.Router();

const MAX_VOICE_SECONDS = 120;
const MAX_BYTES = 5 * 1024 * 1024; // 2 minuta AAC je ~2 MB, 5 MB je velika rezerva

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^audio\//.test(file.mimetype)) return cb(null, true);
    const err = new Error("Unsupported file type");
    err.code = "UNSUPPORTED_TYPE";
    cb(err);
  },
});

// Isti princip kao u routes/gifs.js: JWT sa payload.id
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Token missing" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = String(payload.id);
    next();
  } catch {
    return res.status(401).json({ message: "Token invalid" });
  }
}

router.post("/upload", requireAuth, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "File too large" });
      if (err.code === "UNSUPPORTED_TYPE") return res.status(415).json({ message: "Unsupported file" });
      console.error("[VOICE] Multer greška:", err.message);
      return res.status(400).json({ message: "Bad upload" });
    }

    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    try {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `voice_messages/${req.userId}`,
            resource_type: "video", // Cloudinary tako čuva i audio
          },
          (error, uploaded) => (error ? reject(error) : resolve(uploaded))
        );
        stream.end(req.file.buffer);
      });

      // Trajanje iz Cloudinary-ja je pouzdanije od klijentskog
      const clientDuration = Number(req.body?.duration);
      const rawDuration = Number.isFinite(result.duration) ? result.duration : clientDuration;
      const duration = Math.round(rawDuration);

      // Duže od dozvoljenog (uz malu toleranciju): obriši i odbij
      if (!Number.isFinite(duration) || duration > MAX_VOICE_SECONDS + 5) {
        await cloudinary.uploader
          .destroy(result.public_id, { resource_type: "video" })
          .catch(() => {});
        return res.status(422).json({ message: "Voice message too long" });
      }

      return res.json({
        url: result.secure_url,
        duration: Math.min(Math.max(duration, 1), MAX_VOICE_SECONDS),
      });
    } catch (e) {
      console.error("[VOICE] Cloudinary greška:", e?.message || e);
      return res.status(502).json({ message: "Upload failed" });
    }
  });
});

module.exports = router;