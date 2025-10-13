const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

/**
 * Helper: try parsing a string to JSON, fallback to original
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
 * Helper: convert a string like "a,b,c" into an array
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
      console.warn("[Controller] LOGIN - User not found for email:", email);
      return res.status(404).json({ message: "User not found" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn("[Controller] LOGIN - Incorrect password for email:", email);
      return res.status(400).json({ message: "Incorrect password" });
    }
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    const safeUser = user.toObject ? user.toObject() : user;
    delete safeUser.password;
    res.status(200).json({ token, user: safeUser });
  } catch (error) {
    console.error("[Controller] LOGIN - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------- GET ALL USERS (UPDATED) ----------------
exports.getAllUsers = async (req, res) => {
  console.log("[Controller] GET ALL USERS - Requesting UserID:", req.user?.id);
  try {
    // This query now includes all fields needed for the cards
    const users = await User.find({}, 
      "fullName profilePictures birthDate avatar location height relationshipType education jobTitle horoscope workout interests pets drinks smokes"
    ).lean();
    
    console.log("[Controller] GET ALL USERS - Found users:", users.length);
    res.status(200).json({ users });
  } catch (error) {
    console.error("[Controller] GET ALL USERS - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------- GET PROFILE ----------------
exports.getProfile = async (req, res) => {
  console.log("[Controller] GET PROFILE - UserID:", req.user?.id);
  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error("[Controller] GET PROFILE - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------- GET PROFILE BY ID ----------------
exports.getProfileById = async (req, res) => {
  console.log("[Controller] GET PROFILE BY ID - Requested userId:", req.params.userId);
  try {
    const user = await User.findById(req.params.userId).select('-password').lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error("[Controller] GET PROFILE BY ID - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------- UPDATE PROFILE ----------------
exports.updateProfile = async (req, res) => {
    console.log("BACKEND LOG 1: 'updateProfile' function called. Body:", req.body);
    try {
        const userId = req.user.id;
        let updateData = req.body;

        if (updateData.field && updateData.value !== undefined) {
            updateData = { [updateData.field]: updateData.value }; 
        }

        const allowedUpdates = [
            'bio', 'jobTitle', 'education', 'location', 'showLocation', 'gender',
            'sexualOrientation', 'relationshipType', 'horoscope', 'familyPlans',
            'communicationStyle', 'loveStyle', 'pets', 'drinks', 'smokes',
            'workout', 'diet', 'height', 'languages', 'interests', 
        ];

        const finalUpdatePayload = {};
        Object.keys(updateData).forEach(key => {
            if (allowedUpdates.includes(key)) {
                finalUpdatePayload[key] = updateData[key];
            }
        });

        if (Object.keys(finalUpdatePayload).length === 0) {
            const user = await User.findById(userId).select('-password').lean();
            return res.status(200).json(user);
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: finalUpdatePayload },
            { new: true, runValidators: true }
        ).select('-password').lean();

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found." });
        }
        
        return res.status(200).json(updatedUser);
    } catch (error) {
        console.error("BACKEND LOG: CATCH BLOCK! An error occurred:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

// ---------------- DELETE PROFILE PICTURE ----------------
exports.deleteProfilePicture = async (req, res) => {
  console.log("[Controller] DELETE PROFILE PICTURE - UserID:", req.user?.id, "Body:", req.body);
  try {
    const { imageUrl } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.profilePictures = (user.profilePictures || []).filter(pic => pic !== imageUrl);
    user.avatar = (user.profilePictures && user.profilePictures.length > 0) ? user.profilePictures[0] : null;
    await user.save();
    res.status(200).json({ message: "Image deleted" });
  } catch (error) {
    console.error("[Controller] DELETE PROFILE PICTURE - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ---------------- GET POTENTIAL MATCHES (UPDATED) ----------------
exports.getPotentialMatches = async (req, res) => {
  console.log("[Controller] GET POTENTIAL MATCHES - UserID:", req.user?.id);
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const excluded = [user._id, ...(user.likes || []), ...(user.dislikes || [])];

    // This query now also includes all fields needed for the cards
    const potentialMatches = await User.find({ _id: { $nin: excluded } })
        .select('fullName profilePictures birthDate location height relationshipType education jobTitle horoscope workout interests pets drinks smokes') 
        .lean();

    console.log("[Controller] GET POTENTIAL MATCHES - Found:", potentialMatches.length);
    res.status(200).json({ users: potentialMatches });
  } catch (error) {
    console.error("[Controller] GET POTENTIAL MATCHES - Error:", error);
    res.status(500).json({ message: "Server error" });
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
      return res.status(404).json({ message: "User not found" });
    }
    if (action === "like") {
      user.likes = Array.from(new Set([...(user.likes || []), targetUserId]));
      if ((targetUser.likes || []).map(String).includes(String(user._id))) {
        user.matches = Array.from(new Set([...(user.matches || []), targetUserId]));
        targetUser.matches = Array.from(new Set([...(targetUser.matches || []), user._id]));
        await targetUser.save();
        console.log("[Controller] SWIPE ACTION - MATCH! between:", user.fullName, "and", targetUser.fullName);
      }
    } else if (action === "dislike") {
      user.dislikes = Array.from(new Set([...(user.dislikes || []), targetUserId]));
    }
    await user.save();
    res.status(200).json({ message: "Action saved" });
  } catch (error) {
    console.error("[Controller] SWIPE ACTION - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};