const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

// ---------------- LOGIN ----------------
exports.login = async (req, res) => {
    console.log("[Controller] LOGIN - Body:", req.body);

    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            console.warn("[Controller] LOGIN - Korisnik nije pronađen za email:", email);
            return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.warn("[Controller] LOGIN - Pogrešna lozinka za email:", email);
            return res.status(400).json({ message: "Pogrešna lozinka" });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
        console.log("[Controller] LOGIN - Uspelo logovanje za:", email);

        res.status(200).json({ token, user });
    } catch (error) {
        console.error("[Controller] LOGIN - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
};

// ---------------- GET ALL USERS ----------------
exports.getAllUsers = async (req, res) => {
    console.log("[Controller] GET ALL USERS - UserID koji traži:", req.user?.id);

    try {
        const users = await User.find({}, "fullName profilePictures birthDate avatar location");
        console.log("[Controller] GET ALL USERS - Pronađeno korisnika:", users.length);

        if (users.length > 0) {
            console.log("[Controller] Primer user:", {
                id: users[0]._id,
                fullName: users[0].fullName,
                pictures: users[0].profilePictures?.length
            });
        }

        res.status(200).json({ users });
    } catch (error) {
        console.error("[Controller] GET ALL USERS - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
};

// ---------------- GET PROFILE ----------------
exports.getProfile = async (req, res) => {
    console.log("[Controller] GET PROFILE - UserID:", req.user?.id);

    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            console.warn("[Controller] GET PROFILE - User nije pronađen za ID:", req.user.id);
            return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        console.log("[Controller] GET PROFILE - Vraćam korisnika:", user.fullName);
        res.status(200).json(user);
    } catch (error) {
        console.error("[Controller] GET PROFILE - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
};

// ---------------- GET PROFILE BY ID ----------------
exports.getProfileById = async (req, res) => {
    console.log("[Controller] GET PROFILE BY ID - Traženi userId:", req.params.userId);

    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            console.warn("[Controller] GET PROFILE BY ID - User nije pronađen:", req.params.userId);
            return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        console.log("[Controller] GET PROFILE BY ID - Vraćam korisnika:", user.fullName);
        res.status(200).json(user);
    } catch (error) {
        console.error("[Controller] GET PROFILE BY ID - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
};

// ---------------- UPDATE PROFILE ----------------
exports.updateProfile = async (req, res) => {
    console.log("[Controller] UPDATE PROFILE - UserID:", req.user?.id, "Body:", req.body);

    try {
        const user = await User.findByIdAndUpdate(req.user.id, req.body, { new: true });
        if (!user) {
            console.warn("[Controller] UPDATE PROFILE - User nije pronađen:", req.user.id);
            return res.status(404).json({ message: "Korisnik nije pronađen" });
        }

        console.log("[Controller] UPDATE PROFILE - User ažuriran:", user.fullName);
        res.status(200).json(user);
    } catch (error) {
        console.error("[Controller] UPDATE PROFILE - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
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

        user.profilePictures = user.profilePictures.filter(pic => pic !== imageUrl);
        await user.save();

        console.log("[Controller] DELETE PROFILE PICTURE - Preostale slike:", user.profilePictures.length);
        res.status(200).json({ message: "Slika obrisana" });
    } catch (error) {
        console.error("[Controller] DELETE PROFILE PICTURE - Greška:", error.message);
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

        // za sad isključujemo samog sebe
        const potentialMatches = await User.find({ _id: { $ne: user._id } });
        console.log("[Controller] GET POTENTIAL MATCHES - Pronađeno:", potentialMatches.length);

        res.status(200).json({ users: potentialMatches });
    } catch (error) {
        console.error("[Controller] GET POTENTIAL MATCHES - Greška:", error.message);
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
            if (!user.likes.includes(targetUserId)) user.likes.push(targetUserId);
            // Ako i target lajkova trenutnog usera → match
            if (targetUser.likes.includes(user._id)) {
                user.matches.push(targetUserId);
                targetUser.matches.push(user._id);
                await targetUser.save();
                console.log("[Controller] SWIPE ACTION - MATCH! između:", user.fullName, "i", targetUser.fullName);
            }
        } else if (action === "dislike") {
            if (!user.dislikes.includes(targetUserId)) user.dislikes.push(targetUserId);
        }

        await user.save();
        res.status(200).json({ message: "Akcija sačuvana" });
    } catch (error) {
        console.error("[Controller] SWIPE ACTION - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
};
