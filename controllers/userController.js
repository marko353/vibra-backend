const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

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
    const users = await User.find(
      {},
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
    if (!user) return res.status(404).json({ message: "User not found" });
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
    if (!user) return res.status(404).json({ message: "User not found" });
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

    if (!updatedUser) return res.status(404).json({ message: "User not found." });
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
    if (!user) return res.status(404).json({ message: "User not found" });

    user.profilePictures = (user.profilePictures || []).filter(pic => pic !== imageUrl);
    user.avatar = (user.profilePictures.length > 0) ? user.profilePictures[0] : null;
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
    if (!user) return res.status(404).json({ message: "User not found" });

    const excluded = [user._id, ...(user.likes || []), ...(user.dislikes || [])];
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
    try {
        const { targetUserId, action } = req.body;
        const user = await User.findById(req.user.id);
        const targetUser = await User.findById(targetUserId);
        if (!user || !targetUser) return res.status(404).json({ message: "Korisnik nije pronađen" });

        let matchOccurred = false;

        if (action === "like") {
            user.likes.addToSet(targetUserId);

            if (targetUser.likes.includes(user._id)) {
                matchOccurred = true; // Desio se match!
                user.matches.addToSet(targetUserId);
                targetUser.matches.addToSet(user._id);

                const existingConversation = await Conversation.findOne({ participants: { $all: [user._id, targetUser._id] } });
                if (!existingConversation) {
                    const newConversation = new Conversation({ participants: [user._id, targetUser._id] });
                    await newConversation.save();
                }
                await targetUser.save();
                console.log("[Controller] SWIPE ACTION - MATCH! između:", user.fullName, "i", targetUser.fullName);
            }
        } else if (action === "dislike") {
            user.dislikes.addToSet(targetUserId);
        }

        await user.save();

        if (matchOccurred) {
            // Ako se desio match, vraćamo posebnu poruku i podatke o drugom korisniku
            return res.status(200).json({
                match: true,
                matchedUser: {
                    _id: targetUser._id,
                    fullName: targetUser.fullName,
                    avatar: targetUser.avatar,
                }
            });
        }

        // Ako se nije desio match, vraćamo standardnu poruku
        return res.status(200).json({ match: false, message: "Akcija sačuvana" });

    } catch (error) {
        console.error("[Controller] SWIPE ACTION - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
};

// --- GET MATCHES & CONVERSATIONS (AŽURIRANO za ispravan status chata) ---
exports.getMatchesAndConversations = async (req, res) => {
    try {
        // Popuni 'matches' polje podacima o drugim korisnicima
        const currentUser = await User.findById(req.user.id).populate('matches', 'fullName avatar');
        if (!currentUser) return res.status(404).json({ message: "Korisnik nije pronađen" });

        // Dohvati sve konverzacije korisnika
        const conversations = await Conversation.find({ participants: currentUser._id })
            .populate({ path: 'participants', select: 'fullName avatar' })
            .populate({
                path: 'messages',
                options: { sort: { createdAt: -1 }, limit: 1 }
            });

        const newMatches = [];
        const existingConversations = [];
        const matchesWithConversations = new Set(); // Služi za praćenje obrađenih mečeva

        for (const conv of conversations) {
            // Pronađi drugog učesnika
            const otherParticipant = conv.participants.find(p => p._id && !p._id.equals(currentUser._id));
            if (!otherParticipant) continue;
            
            const matchUser = { 
                _id: otherParticipant._id.toString(),
                fullName: otherParticipant.fullName,
                avatar: otherParticipant.avatar,
                chatId: conv._id.toString() // ID konverzacije
            };

            matchesWithConversations.add(matchUser._id);

            // 1. AKTIVNE KONVERZACIJE: Ako postoji poruka, ide u "Poruke"
            if (conv.messages.length > 0) {
                existingConversations.push({
                    chatId: conv._id,
                    user: otherParticipant,
                    lastMessage: { text: conv.messages[0].text, timestamp: conv.messages[0].createdAt }
                });
            } else {
                // 2. PRAZNE KONVERZACIJE: Ako nema poruke, ali ima kreiranu konverzaciju, 
                // ide u "Novi Spojevi".
                newMatches.push(matchUser); 
            }
        }
        
        // 3. Pravi NOVI SPOJEVI (Match bez Conversation objekta) - Ako je match kreiran, ali nema konverzacije (fallback)
        for (const match of currentUser.matches) {
            if (!matchesWithConversations.has(match._id.toString())) {
                newMatches.push({
                     _id: match._id,
                     fullName: match.fullName,
                     avatar: match.avatar,
                     // Nema chatId ovde, pa frontend koristi User ID za prvu poruku (što triggeruje traženje conv)
                });
            }
        }
        
        // Sortiranje aktivnih razgovora
        existingConversations.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));

        res.status(200).json({ newMatches, conversations: existingConversations });
    } catch (error) {
        console.error("[Controller] GET MATCHES & CONVERSATIONS - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
};

// ---------------- GET MESSAGES (AŽURIRANO za rukovanje ID-jevima) ----------------
exports.getMessages = async (req, res) => {
    console.log(`[Controller] GET MESSAGES - User ${req.user.id} traži chat ID: ${req.params.chatId}`);
    try {
        const { chatId } = req.params;
        let conversation = null;

        // POKUŠAJ A: Pronađi konverzaciju po ID-ju konverzacije
        conversation = await Conversation.findOne({ _id: chatId, participants: req.user.id })
            .populate({ path: 'messages', populate: { path: 'sender', select: '_id' } });

        // POKUŠAJ B: Ako nije nađen ID konverzacije, proveri da li je to match ID (drugi korisnik)
        if (!conversation) {
            conversation = await Conversation.findOne({ participants: { $all: [req.user.id, chatId] } })
                .populate({ path: 'messages', populate: { path: 'sender', select: '_id' } });

            if (conversation) {
                console.log(`[Controller] GET MESSAGES - Konverzacija nađena preko User ID-ja: ${chatId}. ID Konverzacije: ${conversation._id}`);
            }
        }

        if (!conversation) {
             console.log(`[Controller] GET MESSAGES - Nije nađena konverzacija za: ${chatId}`);
             
             // Ako je prosleđen user ID i taj korisnik je u match listi (ali još nema poruka)
             const targetUser = await User.findById(chatId);
             if (targetUser && targetUser.matches.includes(req.user.id)) {
                 return res.status(200).json({ messages: [], conversationId: null });
             }

             return res.status(404).json({ message: "Razgovor nije pronađen" });
        }

        const messages = conversation.messages.map(msg => ({
            _id: msg._id,
            text: msg.text,
            timestamp: msg.createdAt,
            senderId: msg.sender._id.toString()
        }));

        console.log(`[Controller] GET MESSAGES - Uspešno nađeno poruka: ${messages.length}`);
        res.status(200).json({ messages, conversationId: conversation._id.toString() });

    } catch (error) {
        console.error("[Controller] GET MESSAGES - Greška:", error.message);
        res.status(500).json({ message: "Greška servera" });
    }
};

// ---------------- POST MESSAGE (AŽURIRANO za rukovanje ID-jevima i vraćanje ID-ja konverzacije) ----------------
exports.postMessage = async (req, res) => {
    console.log(`[Controller] POST MESSAGE - User ${req.user.id} šalje poruku na ID: ${req.params.chatId}`);
    try {
        const { chatId } = req.params;
        const { text } = req.body;
        const senderId = req.user.id;

        // POKUŠAJ A: Pronađi konverzaciju po ID-ju (Standardno ako je chat već otvoren)
        let conversation = await Conversation.findById(chatId);

        // POKUŠAJ B: Ako konverzacija nije pronađena (jer je chatId ID drugog korisnika),
        // pronađi je po učesnicima.
        if (!conversation) {
            console.log(`[Controller] POST MESSAGE - ID nije konverzacija. Tražim po učesnicima.`);
            conversation = await Conversation.findOne({
                participants: { $all: [senderId, chatId] }
            });
            if (conversation) {
                 console.log(`[Controller] POST MESSAGE - Konverzacija nađena preko User ID-ja: ${conversation._id}`);
            }
        }

        if (!conversation) {
            console.warn(`[Controller] POST MESSAGE - NIJE PRONAĐENA KONVERZACIJA: ${chatId}.`);
            return res.status(404).json({ message: "Konverzacija nije pronađena. Spoj nije validan." });
        }

        const newMessage = new Message({
            conversationId: conversation._id,
            sender: senderId,
            text,
        });
        await newMessage.save();

        conversation.messages.push(newMessage._id);
        await conversation.save();

        const responseMessage = newMessage.toObject();

        // Vraćamo conversationId, što je KLJUČNO za frontend da pređe na ispravan URL i Query Key.
        res.status(201).json({
            ...responseMessage,
            conversationId: conversation._id.toString()
        });

    } catch (error) {
         console.error("[Controller] POST MESSAGE - Greška:", error);
         res.status(500).json({ message: "Greška prilikom slanja poruke" });
    }
};

// ---------------- UNMATCH / DELETE MATCH ACTION (AŽURIRANO za simetrično brisanje) ----------------
exports.unmatchUser = async (req, res) => {
    const currentUserId = req.user.id;
    const { chatId } = req.params; // ID koji može biti CONVERSATION ID ili USER ID
    console.log(`[Controller] UNMATCH - User ${currentUserId} requests unmatch for ID: ${chatId}`);

    try {
        let conversation = null;
        let otherUserId = null;

        // POKUŠAJ A: Pronađi konverzaciju po chat ID-ju
        conversation = await Conversation.findOne({ _id: chatId, participants: currentUserId });

        if (conversation) {
            otherUserId = conversation.participants.find(id => !id.equals(currentUserId));
        } else {
            // POKUŠAJ B: Pronađi konverzaciju po ID-ju DVA KORISNIKA (Ako je poslato kao User ID)
            otherUserId = chatId;

            conversation = await Conversation.findOne({
                participants: { $all: [currentUserId, otherUserId] }
            });

            if (!conversation) {
                // Provera: Ako match i dalje postoji, ali nema konverzacije (prva poruka nije poslata)
                const isStillMatched = await User.exists({ _id: currentUserId, matches: otherUserId });
                if (!isStillMatched) {
                    return res.status(404).json({ message: "Spoj ili razgovor nisu pronađeni." });
                }
                console.log(`[Controller] UNMATCH - Nema konverzacije, ali match postoji. Brišem samo match. User: ${otherUserId}`);
            }
        }

        // Finalna provera drugog korisnika
        if (!otherUserId) {
            return res.status(400).json({ message: "Drugi korisnik nije pronađen za brisanje spoja." });
        }

        // 3. BRISANJE PORUKA I RAZGOVORA (samo ako konverzacija postoji)
        if (conversation) {
            await Message.deleteMany({ conversationId: conversation._id });
            await Conversation.deleteOne({ _id: conversation._id });
            console.log(`[Controller] UNMATCH - Obrisane poruke i razgovor: ${conversation._id}`);
        }

        // 4. KRITIČNO: UKLANJANJE ID-jeva iz svih relevantnih listi (matches, likes, dislikes) za OBA KORISNIKA
        await User.updateMany(
            { _id: { $in: [currentUserId, otherUserId] } }, // Ciljaj oba korisnika
            {
                $pull: { 
                    // Uklanja ID trenutnog i drugog korisnika iz svih lista oba korisnika
                    matches: { $in: [currentUserId, otherUserId] }, 
                    likes: { $in: [currentUserId, otherUserId] },
                    dislikes: { $in: [currentUserId, otherUserId] },
                }
            }
        );
        console.log(`[Controller] UNMATCH - Uklonjeno iz liste mečeva, lajkova i dislajkova za oba korisnika: ${currentUserId} i ${otherUserId}`);

        // 5. USPEH
        res.status(200).json({ message: "Spoj i poruke su uspešno obrisani." });

    } catch (error) {
        console.error("[Controller] UNMATCH ACTION - Greška:", error.message);
        res.status(500).json({ message: "Greška servera prilikom prekida spoja" });
    }
};

