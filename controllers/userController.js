const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

/**
 * Helper: pokušaj parsiranja stringa u JSON, fallback na original
 */
function tryParseJSON(value) {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed;
  } catch (e) {
    return value;
  }
}

/**
 * Helper: kad je niz u stringu (npr. "a,b,c"), pretvori ga u array
 */
function parseArrayLike(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = tryParseJSON(value);
    if (Array.isArray(parsed)) return parsed;
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [value];
}

// ---------------- LOGIN ----------------
exports.login = async (req, res) => {
  console.log("[Controller] LOGIN - Body:", req.body);
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      console.warn("[Controller] LOGIN - Korisnik nije pronađen za email:", email);
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn("[Controller] LOGIN - Pogrešna lozinka za email:", email);
      return res.status(400).json({ message: "Pogrešna lozinka" });
    }
    console.log("--- KREIRANJE TOKENA --- JWT_SECRET:", process.env.JWT_SECRET);
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    console.log("[Controller] LOGIN - Uspelo logovanje za:", email);
    const safeUser = user.toObject ? user.toObject() : user;
    delete safeUser.password;
    res.status(200).json({ token, user: safeUser });
  } catch (error) {
    console.error("[Controller] LOGIN - Greška:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};

// ---------------- GET ALL USERS ----------------
exports.getAllUsers = async (req, res) => {
  console.log("[Controller] GET ALL USERS - UserID koji traži:", req.user?.id);
  try {
    const users = await User.find({}, "fullName profilePictures birthDate avatar location").lean();
    console.log("[Controller] GET ALL USERS - Pronađeno korisnika:", users.length);
    res.status(200).json({ users });
  } catch (error) {
    console.error("[Controller] GET ALL USERS - Greška:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};

// ---------------- GET PROFILE ----------------
exports.getProfile = async (req, res) => {
  console.log("[Controller] GET PROFILE - UserID:", req.user?.id);
  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) {
      console.warn("[Controller] GET PROFILE - User nije pronađen za ID:", req.user.id);
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }
    console.log("[Controller] GET PROFILE - Vraćam korisnika:", user.fullName || user.username || user._id);
    res.status(200).json(user);
  } catch (error) {
    console.error("[Controller] GET PROFILE - Greška:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};

// ---------------- GET PROFILE BY ID ----------------
exports.getProfileById = async (req, res) => {
  console.log("[Controller] GET PROFILE BY ID - Traženi userId:", req.params.userId);
  try {
    const user = await User.findById(req.params.userId).select('-password').lean();
    if (!user) {
      console.warn("[Controller] GET PROFILE BY ID - User nije pronađen:", req.params.userId);
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }
    console.log("[Controller] GET PROFILE BY ID - Vraćam korisnika:", user.fullName || user.username || user._id);
    res.status(200).json(user);
  } catch (error) {
    console.error("[Controller] GET PROFILE BY ID - Greška:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};

// ---------------- UPDATE PROFILE ----------------
exports.updateProfile = async (req, res) => {
    console.log("BACKEND LOG 1: 'updateProfile' funkcija je pozvana. Body:", req.body);
    
    try {
        const userId = req.user.id;
        let updateData = req.body;

        // ⭐ KRITIČNA KOREKCIJA: Transformiše { field: 'name', value: 'data' } u { name: 'data' }
        if (updateData.field && updateData.value !== undefined) {
            console.log("BACKEND LOG: Detektovan FIELD/VALUE format. Transformišem payload.");
            updateData = { [updateData.field]: updateData.value }; 
        }

        const allowedUpdates = [
            'bio', 'jobTitle', 'education', 'location', 'showLocation', 'gender',
            'sexualOrientation', 'relationshipType', 'horoscope', 'familyPlans',
            'communicationStyle', 'loveStyle', 'pets', 'drinks', 'smokes',
            'workout', 'diet', 'height', 'languages', 'interests', 
            'hasCompletedLocationPrompt'
        ];

        const finalUpdatePayload = {};

        // Filtriramo payload, ostavljajući samo dozvoljena polja
        Object.keys(updateData).forEach(key => {
            if (allowedUpdates.includes(key)) {
                finalUpdatePayload[key] = updateData[key];
            }
        });

        // ⭐ REŠENJE ZA GREŠKU: Ako nema promena, vraćamo 200 OK
        if (Object.keys(finalUpdatePayload).length === 0) {
            console.log("BACKEND LOG: Nema promena u payload-u. Preskačem upis u bazu.");
            const user = await User.findById(userId).select('-password').lean();
            return res.status(200).json(user);
        }

        console.log("BACKEND LOG 2: Pokrećem upis u bazu:", finalUpdatePayload);

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: finalUpdatePayload },
            { new: true, runValidators: true }
        ).select('-password').lean();

        console.log("BACKEND LOG 3: Upis u bazu je završen.");

        if (!updatedUser) {
            console.log("BACKEND LOG 4: Korisnik NIJE pronađen u bazi.");
            return res.status(404).json({ message: "Korisnik nije pronađen." });
        }
        
        console.log("BACKEND LOG 5: Vraćam uspešan odgovor klijentu.");
        return res.status(200).json(updatedUser);

    } catch (error) {
        console.error("BACKEND LOG: CATCH BLOK! Desila se greška:", error);
        return res.status(500).json({ message: "Greška servera", error: error.message });
    }
};

// ---------------- DELETE PROFILE PICTURE ----------------
exports.deleteProfilePicture = async (req, res) => {
  console.log("[Controller] DELETE PROFILE PICTURE - UserID:", req.user?.id, "Body:", req.body);
  try {
    const { imageUrl } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) {
      console.warn("[Controller] DELETE PROFILE PICTURE - User nije pronađen:", req.user.id);
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }
    user.profilePictures = (user.profilePictures || []).filter(pic => pic !== imageUrl);
    user.avatar = (user.profilePictures && user.profilePictures.length > 0) ? user.profilePictures[0] : null;
    await user.save();
    console.log("[Controller] DELETE PROFILE PICTURE - Preostale slike:", user.profilePictures.length);
    res.status(200).json({ message: "Slika obrisana" });
  } catch (error) {
    console.error("[Controller] DELETE PROFILE PICTURE - Greška:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};

// ---------------- GET POTENTIAL MATCHES ----------------
exports.getPotentialMatches = async (req, res) => {
  console.log("[Controller] GET POTENTIAL MATCHES - UserID:", req.user?.id);
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      console.warn("[Controller] GET POTENTIAL MATCHES - User nije pronađen:", req.user.id);
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }
    const excluded = [user._id, ...(user.likes || []), ...(user.dislikes || [])];
    const potentialMatches = await User.find({ _id: { $nin: excluded } }).select('fullName profilePictures birthDate location').lean();
    console.log("[Controller] GET POTENTIAL MATCHES - Pronađeno:", potentialMatches.length);
    res.status(200).json({ users: potentialMatches });
  } catch (error) {
    console.error("[Controller] GET POTENTIAL MATCHES - Greška:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};

// ---------------- SWIPE ACTION ----------------
exports.swipeAction = async (req, res) => {
  console.log("[Controller] SWIPE ACTION - UserID:", req.user?.id, "Body:", req.body);
  try {
    const { targetUserId, action } = req.body;
    const user = await User.findById(req.user.id);
    const targetUser = await User.findById(targetUserId);
    if (!user || !targetUser) {
      console.warn("[Controller] SWIPE ACTION - User ili target nije pronađen!");
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }
    console.log(`[Controller] SWIPE ACTION - ${user.fullName} ${action} ${targetUser.fullName}`);
    if (action === "like") {
      user.likes = Array.from(new Set([...(user.likes || []), targetUserId]));
      if ((targetUser.likes || []).map(String).includes(String(user._id))) {
        user.matches = Array.from(new Set([...(user.matches || []), targetUserId]));
        targetUser.matches = Array.from(new Set([...(targetUser.matches || []), user._id]));
        await targetUser.save();
        console.log("[Controller] SWIPE ACTION - MATCH! između:", user.fullName, "i", targetUser.fullName);
      }
    } else if (action === "dislike") {
      user.dislikes = Array.from(new Set([...(user.dislikes || []), targetUserId]));
    }
    await user.save();
    res.status(200).json({ message: "Akcija sačuvana" });
  } catch (error) {
    console.error("[Controller] SWIPE ACTION - Greška:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};