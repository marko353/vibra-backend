const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Match = require('../models/Match');
const Report = require("../models/Report");
const { sendMatchNotification, sendMessageNotification, sendLikeNotification } = require('../notificationService');
const mongoose = require('mongoose'); // Ensure mongoose is imported

const isMongoConnected = () => mongoose.connection.readyState === 1;

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
    const filter = {};
    console.log('[GET ALL USERS] Query params:', req.query);
    if (req.query.gender === 'male' || req.query.gender === 'female') {
      filter.gender = req.query.gender;
    }
    console.log('[GET ALL USERS] Filter after gender:', filter);

    if (req.query.maxDistance && req.query.latitude && req.query.longitude) {
      const maxDistance = Number(req.query.maxDistance) * 1000 || 200000;
      const lat = Number(req.query.latitude);
      const lon = Number(req.query.longitude);
      filter.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [lon, lat] },
          $maxDistance: maxDistance
        }
      };
      console.log('[GET ALL USERS] Geo filter:', JSON.stringify(filter.location, null, 2));
    }

    let users = await User.find(filter, "fullName profilePictures birthDate avatar location locationCity height relationshipType education jobTitle horoscope workout interests pets drinks smokes gender").lean();
    console.log('[GET ALL USERS] Users before locationCity merge:', JSON.stringify(users, null, 2));
    users = users.map(user => {
      if (user.location && user.locationCity) {
        user.location.locationCity = user.locationCity;
      }
      return user;
    });
    console.log('[GET ALL USERS] Users after locationCity merge:', JSON.stringify(users, null, 2));
    console.log('[GET ALL USERS] Users found:', users.length);
    res.status(200).json({ users });
  } catch (error) {
    console.error("[Controller] GET ALL USERS - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= GET PROFILE =================
exports.getProfile = async (req, res) => {
  if (!isMongoConnected()) {
    console.error("[GET PROFILE] MongoDB not connected");
    return res.status(503).json({ message: "Database unavailable. Please try again later." });
  }

  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) {
      console.warn(`[GET PROFILE] User not found: ${req.user.id}`);
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error("[Controller] GET PROFILE - Error:", error.message);
    if (error.name === 'MongooseError' || error.name === 'MongoNetworkError') {
      return res.status(503).json({ message: "Database unavailable. Please try again later." });
    }
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

    console.log('[UPDATE PROFILE] userId:', userId);
    console.log('[UPDATE PROFILE] req.body:', JSON.stringify(updateData, null, 2));

    if (updateData.field && updateData.value !== undefined) {
      updateData = { [updateData.field]: updateData.value };
      console.log('[UPDATE PROFILE] field/value pattern detektovan, updateData:', JSON.stringify(updateData, null, 2));
    }

    if (updateData.gender && !['male', 'female', 'other'].includes(updateData.gender)) {
      return res.status(400).json({ message: 'Pol može biti samo "male", "female" ili "other".' });
    }

    const allowedUpdates = [
      'bio',
      'jobTitle',
      'education',
      'location',
      'showLocation',
      'gender',
      'sexualOrientation',
      'relationshipType',
      'horoscope',
      'familyPlans',
      'communicationStyle',
      'loveStyle',
      'pets',
      'drinks',
      'smokes',
      'workout',
      'diet',
      'height',
      'languages',
      'interests',
      'notifications',
      'deleteAccount',
    ];

    const finalUpdatePayload = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        finalUpdatePayload[key] = updateData[key];
      }
    });

    if (updateData.locationCity) {
      finalUpdatePayload.locationCity = updateData.locationCity;
    }

    if (updateData.location && !updateData.locationCity) {
      finalUpdatePayload.locationCity = 'Beograd';
    }

    console.log('[UPDATE PROFILE] finalUpdatePayload:', JSON.stringify(finalUpdatePayload, null, 2));

    if (Object.keys(finalUpdatePayload).length === 0) {
      console.log('[UPDATE PROFILE] Nema validnih polja za update, vraćam trenutnog korisnika bez izmena.');
      const user = await User.findById(userId)
        .select('-password')
        .lean();
      return res.status(200).json(user);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: finalUpdatePayload },
      { new: true, runValidators: true }
    )
      .select('-password')
      .lean();

    if (!updatedUser) {
      console.warn(`[UPDATE PROFILE] Korisnik nije pronađen: ${userId}`);
      return res.status(404).json({ message: 'User not found.' });
    }

    console.log('[UPDATE PROFILE] Uspešno ažuriran korisnik:', updatedUser._id);
    if (finalUpdatePayload.notifications) {
      console.log('[UPDATE PROFILE] Nova notifications podešavanja:', JSON.stringify(updatedUser.notifications, null, 2));
    }

    return res.status(200).json(updatedUser);
  } catch (error) {
    console.error('[Controller] UPDATE PROFILE - Error:', error);
    return res
      .status(500)
      .json({ message: 'Server error', error: error.message });
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

exports.reorderProfilePictures = async (req, res) => {
  try {
    const { pictures } = req.body;

    if (!Array.isArray(pictures)) {
      return res
        .status(400)
        .json({ message: 'Nevalidan format slika' });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res
        .status(404)
        .json({ message: 'Korisnik nije pronađen' });
    }

    const cleanPictures = pictures.filter(
      (p) => typeof p === 'string'
    );

    user.profilePictures = cleanPictures;
    user.avatar = cleanPictures[0] || null;

    await user.save();

    return res.json({
      success: true,
      profilePictures: user.profilePictures,
    });
  } catch (error) {
    console.error('[REORDER PROFILE PICTURES ERROR]', error);
    return res
      .status(500)
      .json({ message: 'Greška pri promeni redosleda slika' });
  }
};

/// ================= GET POTENTIAL MATCHES =================
exports.getPotentialMatches = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { minAge, maxAge, gender } = req.query;
    const min = Number(minAge) || 18;
    const max = Number(maxAge) || 99;
    const today = new Date();
    const minBirthDate = new Date(today.getFullYear() - max, today.getMonth(), today.getDate());
    const maxBirthDate = new Date(today.getFullYear() - min, today.getMonth(), today.getDate());

    const blockedByMe = (user.blockedUsers || []).map((id) => id.toString());

    const usersWhoBlockedMe = await User.find({ blockedUsers: user._id })
      .select("_id")
      .lean();
    const blockedMe = usersWhoBlockedMe.map((u) => u._id.toString());

    let filter = {
      _id: {
        $nin: [
          user._id,
          ...(user.matches || []),
          ...blockedByMe,
          ...blockedMe,
        ],
      },
      birthDate: { $gte: minBirthDate, $lte: maxBirthDate },
    };
    if (gender === 'male' || gender === 'female') {
      filter.gender = gender;
    }

    if (req.query.maxDistance && req.query.latitude && req.query.longitude) {
      const maxDistance = Number(req.query.maxDistance) * 1000 || 200000;
      const lat = Number(req.query.latitude);
      const lon = Number(req.query.longitude);
      filter.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [lon, lat] },
          $maxDistance: maxDistance
        }
      };
      console.log('[POTENTIAL MATCHES] Geo filter:', JSON.stringify(filter.location, null, 2));
    }

    console.log('[POTENTIAL MATCHES] Filter:', JSON.stringify(filter, null, 2));

    let potentialMatches = await User.find(filter)
      .select(`
        fullName
        profilePictures
        birthDate
        avatar
        bio
        relationshipType
        interests
        height
        languages
        horoscope
        familyPlans
        communicationStyle
        loveStyle
        pets
        drinks
        smokes
        workout
        diet
        jobTitle
        education
        location
        locationCity
        showLocation
        gender
        sexualOrientation
      `)
      .lean();

    console.log('[POTENTIAL MATCHES] Users before locationCity merge:', JSON.stringify(potentialMatches, null, 2));
    potentialMatches = potentialMatches.map(user => {
      if (user.location && user.locationCity) {
        user.location.locationCity = user.locationCity;
      }
      return user;
    });
    console.log('[POTENTIAL MATCHES] Users after locationCity merge:', JSON.stringify(potentialMatches, null, 2));
    console.log('[POTENTIAL MATCHES] Broj nakon filtera (age/gender):', potentialMatches.length);
    res.status(200).json({ users: potentialMatches });
  } catch (error) {
    console.error('[MATCHES] Error:', error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= SWIPE ACTION =================
exports.swipeAction = async (req, res) => {
  try {
    const { targetUserId, action } = req.body;

    const user = await User.findById(req.user.id);
    const targetUser = await User.findById(targetUserId);

    if (!user || !targetUser) {
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }

    console.log("➡️ SWIPE ACTION", {
      from: user._id.toString(),
      to: targetUser._id.toString(),
      action,
    });

    // ================= ACTION: LIKE =================
    if (action === "like") {
      console.log(`❤️ LIKE: ${user._id} lajkuje ${targetUser._id}`);

      const isMutualLike = user.likes.some(
        (id) => id.toString() === targetUser._id.toString()
      );

      console.log("🔍 MUTUAL LIKE PROVERA:", isMutualLike);

      // ================= CASE A: MATCH =================
      if (isMutualLike) {
        console.log("🔥 MATCH OCCURRED - Obostrani lajk detektovan");

        user.matches.addToSet(targetUser._id);
        targetUser.matches.addToSet(user._id);

        user.likes.pull(targetUser._id);
        targetUser.likes.pull(user._id);

        let conversationId = null;
        try {
          let conversation = await Conversation.findOne({
            "participants.user": { $all: [user._id, targetUser._id] },
          });

          if (!conversation) {
            console.log("💬 Kreiram novu konverzaciju za match");
            conversation = await Conversation.create({
              participants: [{ user: user._id }, { user: targetUser._id }],
            });
          }
          conversationId = conversation._id.toString();
        } catch (e) {
          console.error("❌ conversation error:", e);
        }

        await user.save();
        await targetUser.save();

        const targetSockets = global.onlineUsers.get(targetUser._id.toString());
        if (targetSockets) {
          targetSockets.forEach((sid) => {
            global.io.to(sid).emit("match", {
              userId: user._id,
              fullName: user.fullName,
              avatar: user.avatar,
              birthDate: user.birthDate,
            });
          });
        }

        if (targetUser.fcmToken) {
          console.log("📲 SENDING MATCH NOTIFICATION TO:", targetUser.fullName);

          await sendMatchNotification(
            targetUser,
            user,
            conversationId
          );
        }

        return res.json({
          match: true,
          conversationId,
          matchedUser: {
            _id: targetUser._id,
            fullName: targetUser.fullName,
            avatar: targetUser.avatar,
          },
        });
      }

      // ================= CASE B: SAMO LIKE =================
      console.log("👍 Nema matcha - dodajem lajk u targetUser.likes");

      targetUser.likes.addToSet(user._id);
      await targetUser.save();

      // 🔔 SOCKET: Javi drugoj osobi da je dobila lajk
      const targetSockets = global.onlineUsers.get(targetUser._id.toString());
      if (targetSockets) {
        targetSockets.forEach((sid) => {
          global.io.to(sid).emit("likeReceived", {
            fromUserId: user._id,
            fullName: user.fullName,
            avatar: user.avatar,
            birthDate: user.birthDate,
          });
        });
      }

      // 🔔 PUSH NOTIFICATION
      if (targetUser.fcmToken) {
        console.log("📲 SENDING LIKE NOTIFICATION TO:", targetUser.fullName);
        await sendLikeNotification(targetUser, user);
      }

      return res.json({
        match: false,
        message: "Like sačuvan",
      });
    }

    // ================= ACTION: DISLIKE =================
    if (action === "dislike") {
      console.log("👎 DISLIKE");
      user.dislikes.addToSet(targetUser._id);
      user.likes.pull(targetUser._id);
      await user.save();

      return res.json({
        success: true,
        message: "Dislike sačuvan",
      });
    }

    return res.status(400).json({ message: "Nepoznata akcija" });

  } catch (error) {
    console.error("[swipeAction] Kritična greška:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// ================= GET MATCHES & CONVERSATIONS =================
exports.getMatchesAndConversations = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id).lean();
    if (!currentUser) {
      console.error("[GET MATCHES & CONVERSATIONS] User not found:", req.user.id);
      return res.status(404).json({ message: "Korisnik nije pronađen" });
    }

    const blockedByMe = (currentUser.blockedUsers || []).map((id) => id.toString());

    const conversations = await Conversation.find({ "participants.user": currentUser._id })
      .populate({ path: 'participants.user', select: 'fullName avatar blockedUsers' })
      .lean();

    const conversationsWithLastMessage = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await Message.findOne({ conversationId: conv._id })
          .sort({ createdAt: -1 })
          .lean();

        return {
          ...conv,
          _lastMessage: lastMessage || null,
        };
      })
    );

    const newMatches = [];
    const existingConversations = [];

    for (const conv of conversationsWithLastMessage) {
      const otherParticipant = conv.participants.find(
        (p) => p.user && !p.user._id.equals(currentUser._id)
      );

      if (!otherParticipant || !otherParticipant.user) {
        continue;
      }

      const otherUser = otherParticipant.user;
      const otherUserIdStr = otherUser._id.toString();

      const isBlockedByMe = blockedByMe.includes(otherUserIdStr);
      const isMeBlockedByOther = (otherUser.blockedUsers || [])
        .map((id) => id.toString())
        .includes(currentUser._id.toString());

      if (isBlockedByMe || isMeBlockedByOther) {
        continue;
      }

      const chatUser = {
        _id: otherUser._id,
        fullName: otherUser.fullName,
        avatar: otherUser.avatar,
      };

      const userStatus = conv.participants.find(
        (p) => p.user && p.user._id.equals(currentUser._id)
      );

      if (!userStatus) continue;

      const lastMsg = conv._lastMessage;
      const hasMessages = !!lastMsg;

      if (hasMessages) {
        existingConversations.push({
          chatId: conv._id.toString(),
          user: chatUser,
          lastMessage: {
            text: lastMsg.text || '...',
            timestamp: lastMsg.createdAt,
          },
          has_unread: !!userStatus.has_unread_messages,
        });
      } else {
        newMatches.push({
          ...chatUser,
          chatId: conv._id.toString(),
          has_unread: !!userStatus.is_new,
        });
      }
    }

    existingConversations.sort((a, b) => {
      const timeA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
      const timeB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    res.status(200).json({ newMatches, conversations: existingConversations });
  } catch (error) {
    console.error("[GET MATCHES & CONVERSATIONS] Error:", error);
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

// ================= POST MESSAGE (Podržava slanje po chatId ili recipientId) =================
exports.postMessage = async (req, res) => {
  try {
    const { text, recipientId } = req.body;
    const { chatId: chatIdParam } = req.params;
    const senderId = req.user.id;

    let conversation = null;
    let targetRecipientId = recipientId;

    if (chatIdParam) {
      conversation = await Conversation.findById(chatIdParam);
      if (!conversation) return res.status(404).json({ message: "Konverzacija nije pronađena." });

      const receiverParticipant = conversation.participants.find(p => p.user && !p.user.equals(senderId));
      if (!receiverParticipant || !receiverParticipant.user) return res.status(400).json({ message: "Primalac nije pronađen u konverzaciji." });
      targetRecipientId = receiverParticipant.user.toString();
    }
    else if (recipientId) {
      conversation = await Conversation.findOne({ "participants.user": { $all: [senderId, recipientId] } });

      if (!conversation) {
        conversation = new Conversation({
          participants: [
            { user: senderId, is_new: false, has_unread_messages: false, has_sent_message: true },
            { user: recipientId, is_new: true, has_unread_messages: true, has_sent_message: false }
          ],
        });
        await conversation.save();
      } else {
        conversation.participants = conversation.participants.map(p => {
          if (p.user.equals(senderId)) return { ...p.toObject(), is_new: false, has_sent_message: true, has_unread_messages: false };
          if (p.user.equals(recipientId)) return { ...p.toObject(), has_unread_messages: true };
          return p.toObject();
        });
      }
    }
    else {
      return res.status(400).json({ message: "Nedostaju chatId ili recipientId za slanje poruke." });
    }

    if (!conversation || !targetRecipientId) {
      return res.status(500).json({ message: "Greška u obradi konverzacije." });
    }

    const newMessage = new Message({
      conversationId: conversation._id,
      sender: senderId,
      receiver: targetRecipientId,
      text
    });
    await newMessage.save();

    conversation.messages.push(newMessage._id);

    conversation.participants = conversation.participants.map(p => {
      const participantObject = p.toObject ? p.toObject() : { ...p };

      if (p.user.equals(targetRecipientId)) {
        participantObject.has_unread_messages = true;
      }
      else if (p.user.equals(senderId)) {
        participantObject.has_unread_messages = false;
        participantObject.is_new = false;
        participantObject.has_sent_message = true;
      }
      return participantObject;
    });

    conversation.markModified('participants');
    await conversation.save();

    // ================= PUSH NOTIFICATION =================
    try {
      const receiver = await User.findById(targetRecipientId);
      const sender = await User.findById(senderId);

      if (receiver?.fcmToken) {
        await sendMessageNotification(
          receiver,
          sender,
          text,
          conversation._id
        );

        console.log("✅ Message notification poslata");
      }
    } catch (notificationError) {
      console.error(
        "❌ Greška pri slanju message notifikacije:",
        notificationError
      );
    }

    res.status(201).json({
      ...newMessage.toObject(),
      conversationId: conversation._id.toString()
    });
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

// ================= GET INCOMING LIKES =================
exports.getIncomingLikes = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    console.log('[INCOMING LIKES] Poziv za userId:', currentUserId);

    const user = await User.findById(currentUserId).lean();
    if (!user) {
      console.log('[INCOMING LIKES] Korisnik nije pronađen:', currentUserId);
      return res.status(404).json({ message: 'User not found' });
    }

    const incomingLikeIds = (user.likes || [])
      .filter(id => id)
      .map(id => id.toString());

    const matchIds = (user.matches || [])
      .filter(id => id)
      .map(id => id.toString());

    const { minAge, maxAge, gender, latitude, longitude, maxDistance } = req.query;
    const min = Number(minAge) || 18;
    const max = Number(maxAge) || 99;
    const today = new Date();
    const minBirthDate = new Date(today.getFullYear() - max, today.getMonth(), today.getDate());
    const maxBirthDate = new Date(today.getFullYear() - min, today.getMonth(), today.getDate());

    let query = {
      _id: {
        $in: incomingLikeIds,
        $nin: [user._id.toString(), ...matchIds]
      },
      birthDate: { $gte: minBirthDate, $lte: maxBirthDate },
    };
    if (gender === 'male' || gender === 'female') {
      query.gender = gender;
    }
    if (latitude && longitude && maxDistance) {
      query.location = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [Number(longitude), Number(latitude)]
          },
          $maxDistance: Number(maxDistance) * 1000
        }
      };
    }
    console.log('[INCOMING LIKES] Query:', JSON.stringify(query, null, 2));

    let users = await User.find(query)
      .select(`
        fullName
        profilePictures
        birthDate
        avatar
        bio
        relationshipType
        interests
        height
        languages
        horoscope
        familyPlans
        communicationStyle
        loveStyle
        pets
        drinks
        smokes
        workout
        diet
        jobTitle
        education
        location
        locationCity
        showLocation
        gender
        sexualOrientation
      `)
      .lean();

    users = users.map(u => {
      if (u.location && u.locationCity) {
        u.location.locationCity = u.locationCity;
      }
      return u;
    });

    console.log('[INCOMING LIKES] Broj korisnika nakon filtera:', users.length);
    if (users.length > 0) {
      console.log('[INCOMING LIKES] Prvi korisnik:', users[0]);
    }
    return res.json({ likes: users });
  } catch (err) {
    console.error('[INCOMING LIKES] Greška:', {
      message: err.message,
      stack: err.stack,
      userId: req.user.id,
      query: req.query
    });
    return res.status(500).json({ message: "Server error" });
  }
};

// ========== TRAJNI FILTERI ==========
exports.saveUserFilters = async (req, res) => {
  try {
    const userId = req.user.id;
    const { filters } = req.body;
    if (!filters) return res.status(400).json({ message: 'Missing filters object' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.filters = filters;
    await user.save();
    console.log('[FILTERS] Sačuvani filteri za korisnika', userId, filters);
    res.json({ success: true, filters: user.filters });
  } catch (err) {
    console.error('[FILTERS] Greška pri čuvanju filtera:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getUserFilters = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select('filters');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ filters: user.filters });
  } catch (err) {
    console.error('[FILTERS] Greška pri učitavanju filtera:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// ================= UNMATCH =================
exports.unmatchUser = async (req, res) => {
  const currentUserId = req.user.id;
  const { chatId } = req.params;

  try {
    const conversation = await Conversation.findOne({
      _id: chatId,
      "participants.user": currentUserId,
    });

    if (!conversation) {
      return res.status(404).json({ message: "Spoj ili razgovor nisu pronađeni." });
    }

    const otherParticipant = conversation.participants.find(
      p => p.user && !p.user.equals(currentUserId)
    );

    const otherUserId = otherParticipant.user;

    await Message.deleteMany({ conversationId: conversation._id });
    await Conversation.findByIdAndDelete(conversation._id);

    await User.updateOne(
      { _id: currentUserId },
      { $pull: { matches: otherUserId } }
    );

    await User.updateOne(
      { _id: otherUserId },
      { $pull: { matches: currentUserId } }
    );

    const targetSockets = global.onlineUsers.get(
      otherUserId.toString()
    );

    if (targetSockets) {
      targetSockets.forEach((sid) => {
        global.io.to(sid).emit('conversationRemoved', {
          conversationId: chatId,
        });
      });
    }

    return res.status(200).json({
      message: "Spoj i sve poruke su uspešno obrisani.",
    });
  } catch (error) {
    console.error("[Controller] UNMATCH ACTION - Error:", error);
    return res.status(500).json({
      message: "Greška servera prilikom prekida spoja",
    });
  }
};

exports.createMatchAndNotify = async (userId1, userId2) => {
  try {
    const existingMatch = await Match.findOne({
      $or: [
        { user1: userId1, user2: userId2 },
        { user1: userId2, user2: userId1 }
      ]
    });

    if (existingMatch) {
      console.log(`[Controller] Match već postoji između ${userId1} i ${userId2}`);
      return;
    }

    await Match.create({ user1: userId1, user2: userId2 });
    console.log(`[Controller] Match uspešno kreiran u bazi.`);

    const notificationPromises = [
      sendMatchNotification(
        { fcmToken: userId1.fcmToken, _id: userId1 },
        { fullName: userId2.fullName, avatar: userId2.avatar, _id: userId2 },
        conversationId
      ),
      sendMatchNotification(
        { fcmToken: userId2.fcmToken, _id: userId2 },
        { fullName: userId1.fullName, avatar: userId1.avatar, _id: userId1 },
        conversationId
      )
    ];

    const results = await Promise.allSettled(notificationPromises);

    results.forEach((result, index) => {
      const currentUserId = index === 0 ? userId1 : userId2;
      if (result.status === 'fulfilled') {
        console.log(`[Controller] Notifikacija uspešno poslata korisniku: ${currentUserId}`);
      } else {
        console.error(`[Controller] Slanje nije uspelo za ${currentUserId}:`, result.reason);
      }
    });

  } catch (error) {
    console.error('[Controller] Fatalna greška u createMatchAndNotify:', error);
    throw error;
  }
};

// ================= BLOCK USER =================
exports.blockUser = async (req, res) => {
  const currentUserId = req.user.id;
  const { userId: targetUserId } = req.params;

  try {
    if (currentUserId === targetUserId) {
      return res.status(400).json({ message: "Ne možete blokirati sami sebe." });
    }

    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { blockedUsers: targetUserId }
    });

    const conversation = await Conversation.findOne({
      "participants.user": { $all: [currentUserId, targetUserId] }
    });

    if (conversation) {
      await Message.deleteMany({ conversationId: conversation._id });
      await Conversation.findByIdAndDelete(conversation._id);
    }

    await User.updateOne(
      { _id: currentUserId },
      { $pull: { matches: targetUserId } }
    );
    await User.updateOne(
      { _id: targetUserId },
      { $pull: { matches: currentUserId } }
    );

    const targetSockets = global.onlineUsers?.get(targetUserId.toString());
    if (targetSockets && conversation) {
      targetSockets.forEach((sid) => {
        global.io.to(sid).emit('conversationRemoved', {
          conversationId: conversation._id.toString(),
        });
      });
    }

    res.status(200).json({ success: true, message: "Korisnik je uspešno blokiran." });
  } catch (error) {
    console.error("[BLOCK USER] Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= UNBLOCK USER =================
exports.unblockUser = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const { userId: targetUserId } = req.params;

    await User.updateOne(
      { _id: currentUserId },
      { $pull: { blockedUsers: targetUserId } }
    );

    res.status(200).json({ success: true, message: "Korisnik je odblokiran." });
  } catch (error) {
    console.error("[Controller] UNBLOCK USER - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= GET BLOCKED USERS =================
exports.getBlockedUsers = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate("blockedUsers", "fullName profilePictures avatar")
      .lean();

    if (!user) return res.status(404).json({ message: "Korisnik nije pronađen." });

    const blocked = (user.blockedUsers || []).map((u) => ({
      _id: u._id,
      fullName: u.fullName,
      profilePictures: u.profilePictures,
    }));

    res.status(200).json(blocked);
  } catch (error) {
    console.error("[Controller] GET BLOCKED USERS - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= REPORT USER =================
exports.reportUser = async (req, res) => {
  try {
    const reporterId = req.user.id;
    const { userId: reportedUserId } = req.params;
    const { reason } = req.body;

    if (reporterId === reportedUserId) {
      return res.status(400).json({ message: "Ne možeš prijaviti sam sebe." });
    }

    await Report.create({
      reporter: reporterId,
      reportedUser: reportedUserId,
      reason: reason || null,
    });

    res.status(200).json({ success: true, message: "Prijava je poslata." });
  } catch (error) {
    console.error("[Controller] REPORT USER - Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= DELETE ACCOUNT =================
exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id || req.user.userId;

    console.log(`\n================== [DELETE ACCOUNT] ==================`);
    console.log(`Deleting account for User ID: ${userId}`);

    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log(`User ${userId} deleted successfully.`);
    console.log(`======================================================\n`);

    return res.status(200).json({ message: "Account deleted successfully." });
  } catch (error) {
    console.error("Delete account error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
