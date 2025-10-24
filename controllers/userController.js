// controllers/userController.js

const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

// ================= HELPER FUNKCIJE =================
function tryParseJSON(value) {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed;
  } catch (e) {
    return value;
  }
}

function parseArrayLike(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = tryParseJSON(value);
    if (Array.isArray(parsed)) return parsed;
    return value.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [value];
}

// ================= LOGIN =================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Incorrect password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "20d" });
    const safeUser = user.toObject();
    delete safeUser.password;

    res.status(200).json({ token, user: safeUser });
  } catch (error) {
    console.error("[Controller] LOGIN - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= GET ALL USERS =================
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, "fullName profilePictures birthDate avatar location height relationshipType education jobTitle horoscope workout interests pets drinks smokes").lean();
    res.status(200).json({ users });
  } catch (error) {
    console.error("[Controller] GET ALL USERS - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= GET PROFILE =================
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    console.error("[Controller] GET PROFILE - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= GET PROFILE BY ID =================
exports.getProfileById = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('-password').lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    console.error("[Controller] GET PROFILE BY ID - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= UPDATE PROFILE =================
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    let updateData = req.body;
    if (updateData.field && updateData.value !== undefined) {
      updateData = { [updateData.field]: updateData.value };
    }

    const allowedUpdates = ['bio', 'jobTitle', 'education', 'location', 'showLocation', 'gender', 'sexualOrientation', 'relationshipType', 'horoscope', 'familyPlans', 'communicationStyle', 'loveStyle', 'pets', 'drinks', 'smokes', 'workout', 'diet', 'height', 'languages', 'interests'];
    const finalUpdatePayload = {};
    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) finalUpdatePayload[key] = updateData[key];
    });

    if (Object.keys(finalUpdatePayload).length === 0) {
      const user = await User.findById(userId).select('-password').lean();
      return res.status(200).json(user);
    }

    const updatedUser = await User.findByIdAndUpdate(userId, { $set: finalUpdatePayload }, { new: true, runValidators: true }).select('-password').lean();
    if (!updatedUser) return res.status(404).json({ message: "User not found." });
    return res.status(200).json(updatedUser);

  } catch (error) {
    console.error("[Controller] UPDATE PROFILE - Error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ================= DELETE PROFILE PICTURE =================
exports.deleteProfilePicture = async (req, res) => {
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

// ================= GET POTENTIAL MATCHES =================
exports.getPotentialMatches = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const excluded = [user._id, ...(user.likes || []), ...(user.dislikes || [])];
    const potentialMatches = await User.find({ _id: { $nin: excluded } })
      .select('fullName profilePictures birthDate location height relationshipType education jobTitle horoscope workout interests pets drinks smokes')
      .lean();

    res.status(200).json({ users: potentialMatches });
  } catch (error) {
    console.error("[Controller] GET POTENTIAL MATCHES - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= SWIPE ACTION =================
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
        matchOccurred = true;
        user.matches.addToSet(targetUserId);
        targetUser.matches.addToSet(user._id);

        const existingConversation = await Conversation.findOne({ "participants.user": { $all: [user._id, targetUser._id] } });
        if (!existingConversation) {
          // Novi meč sa default statusima
          const newConversation = new Conversation({ 
            participants: [
              // ✅ Dodajemo i 'has_sent_message: false' za svaki slučaj (iako model ima default)
              { user: user._id, is_new: true, has_unread_messages: false, has_sent_message: false }, 
              { user: targetUser._id, is_new: true, has_unread_messages: false, has_sent_message: false }
            ]
          });
          await newConversation.save();
        }
        await targetUser.save();
      }
    } else if (action === "dislike") {
      user.dislikes.addToSet(targetUserId);
    }

    await user.save();

    if (matchOccurred) {
      return res.status(200).json({ match: true, matchedUser: { _id: targetUser._id, fullName: targetUser.fullName, avatar: targetUser.avatar } });
    }

    return res.status(200).json({ match: false, message: "Akcija sačuvana" });
  } catch (error) {
    console.error("[Controller] SWIPE ACTION - Error:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};

// ================= GET MATCHES & CONVERSATIONS =================
exports.getMatchesAndConversations = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) return res.status(404).json({ message: "Korisnik nije pronađen" });

    const conversations = await Conversation.find({ "participants.user": currentUser._id })
      .populate({ path: 'participants.user', select: 'fullName avatar' })
      .populate({ path: 'messages', options: { sort: { createdAt: -1 }, limit: 1 } })
      .lean();

    const newMatches = [];
    const existingConversations = [];

    for (const conv of conversations) {
      const otherParticipant = conv.participants.find(p => !p.user._id.equals(currentUser._id));
      if (!otherParticipant) continue;

      const chatUser = {
        _id: otherParticipant.user._id,
        fullName: otherParticipant.user.fullName,
        avatar: otherParticipant.user.avatar,
      };

      const userStatus = conv.participants.find(p => p.user._id.equals(currentUser._id));
      if (!userStatus) continue; 

      // ✅ NOVA LOGIKA:
      // Korisnik vidi čet u "Poruke" (existingConversations)
      // SAMO AKO JE TAJ KORISNIK POSLAO poruku.
      if (userStatus.has_sent_message) {
        existingConversations.push({
          chatId: conv._id,
          user: chatUser,
          lastMessage: {
            text: conv.messages[0]?.text || '...', // Osigurano od greške ako je prazno
            timestamp: conv.messages[0]?.createdAt
          },
          has_unread: userStatus.has_unread_messages 
        });
      } else {
        // Ako korisnik NIJE poslao poruku, ostaje u "Novi spojevi"
        // (čak i ako je PRIMIO poruku)
        newMatches.push({
          ...chatUser,
          chatId: conv._id,
          // Tačka se prikazuje ILI ako je nov meč (is_new)
          // ILI ako je primio poruku (has_unread_messages)
          has_unread: userStatus.is_new || userStatus.has_unread_messages
        });
      }
    }

    // Sortiranje da se osigura da 'timestamp' postoji
    existingConversations.sort((a, b) => 
      new Date(b.lastMessage?.timestamp) - new Date(a.lastMessage?.timestamp)
    );

    res.status(200).json({ newMatches, conversations: existingConversations });
  } catch (error) {
    console.error("[Controller] GET MATCHES & CONVERSATIONS - Error:", error);
    res.status(500).json({ message: "Greška servera" });
  }
};

// ================= GET MESSAGES =================
exports.getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const conversationExists = await Conversation.exists({ _id: chatId, "participants.user": userId });
    if (!conversationExists) return res.status(200).json([]);

    const messages = await Message.find({ conversationId: chatId }).sort({ createdAt: -1 });
    res.status(200).json(messages);
  } catch (error) {
    console.error("[Controller] GET MESSAGES - Error:", error);
    res.status(500).json({ message: "Greška na serveru prilikom dohvatanja poruka." });
  }
};

// ================= POST MESSAGE (fallback za Socket.IO) =================
exports.postMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { text } = req.body;
    const senderId = req.user.id;

    let conversation = await Conversation.findById(chatId);
    if (!conversation) return res.status(404).json({ message: "Konverzacija nije pronađena." });

    const receiver = conversation.participants.find(p => !p.user.equals(senderId));
    if (!receiver) return res.status(400).json({ message: "Primalac nije pronađen u konverzaciji." });

    const newMessage = new Message({ 
        conversationId: conversation._id, 
        sender: senderId, 
        receiver: receiver.user,
        text 
    });
    await newMessage.save();

    conversation.messages.push(newMessage._id);
    
    // ✅ NOVA LOGIKA: Pošiljalac dobija 'has_sent_message: true'
    conversation.participants = conversation.participants.map(p => {
      // Primaocu:
      if (p.user.equals(receiver.user)) {
          return { ...p.toObject(), has_unread_messages: true, is_new: false };
      }
      // Pošiljaocu:
      if (p.user.equals(senderId)) {
          // Postavlja 'has_sent_message' i skida 'is_new'
          return { ...p.toObject(), is_new: false, has_sent_message: true }; 
      }
      return p;
    });
    await conversation.save();

    res.status(201).json({ ...newMessage.toObject(), conversationId: conversation._id.toString() });
  } catch (error) {
    console.error("[Controller] POST MESSAGE - Error:", error);
    res.status(500).json({ message: "Greška prilikom slanja poruke" });
  }
};
// ================= MARK AS READ =================
exports.markAsRead = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const updatedConversation = await Conversation.findOneAndUpdate(
      { _id: chatId, "participants.user": userId },
      // Resetuj oba flega - i 'is_new' (za novi meč) i 'has_unread_messages' (za nove poruke)
      { $set: { "participants.$.is_new": false, "participants.$.has_unread_messages": false } },
      { new: true }
    );

    if (!updatedConversation) return res.status(404).json({ message: "Konverzacija nije pronađena." });

    res.status(200).json({ success: true, message: "Obeleženo kao pročitano." });
  } catch (error) {
    console.error("[Controller] MARK AS READ - Error:", error);
    res.status(500).json({ message: "Greška servera." });
  }
};

// ================= UNMATCH =================
exports.unmatchUser = async (req, res) => {
  const currentUserId = req.user.id;
  const { chatId } = req.params;

  try {
    // Nađi konverzaciju u kojoj je trenutni korisnik
    const conversation = await Conversation.findOne({ _id: chatId, "participants.user": currentUserId });
    if (!conversation) return res.status(404).json({ message: "Spoj ili razgovor nisu pronađeni." });

    // Nađi ID drugog korisnika u toj konverzaciji
    const otherUserId = conversation.participants.find(p => !p.user.equals(currentUserId))?.user;
    if (!otherUserId) return res.status(400).json({ message: "Drugi korisnik nije mogao biti identifikovan." });

    // Obriši sve poruke iz konverzacije
    await Message.deleteMany({ conversationId: conversation._id });

    // Obriši samu konverzaciju
    await Conversation.findByIdAndDelete(conversation._id);

    // Obriši meč iz oba korisnika
    await User.updateOne(
      { _id: currentUserId },
      { $pull: { matches: otherUserId } }
    );
    await User.updateOne(
      { _id: otherUserId },
      { $pull: { matches: currentUserId } }
    );

    res.status(200).json({ message: "Spoj i sve poruke su uspešno obrisani." });
  } catch (error) {
    console.error("[Controller] UNMATCH ACTION - Error:", error);
    res.status(500).json({ message: "Greška servera prilikom prekida spoja" });
  }
};
