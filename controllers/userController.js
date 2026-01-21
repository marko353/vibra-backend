
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
    const filter = {};
    console.log('[GET ALL USERS] Query params:', req.query);
    // Filter za pol
    if (req.query.gender === 'male' || req.query.gender === 'female') {
      filter.gender = req.query.gender;
    }
    console.log('[GET ALL USERS] Filter after gender:', filter);
    // Filter za godine (ako želiš, možeš dodati kao i u potentialMatches)
    // Filter za udaljenost će biti primenjen u JS-u ispod

    // Geo filter za udaljenost
    if (req.query.maxDistance && req.query.latitude && req.query.longitude) {
      const maxDistance = Number(req.query.maxDistance) * 1000 || 200000; // u metrima
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

    // Validacija za polje gender
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
    ];

    // ✅ OBAVEZNO OVDE
    const finalUpdatePayload = {};

    Object.keys(updateData).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        finalUpdatePayload[key] = updateData[key];
      }
    });

    // Ako korisnik šalje novu lokaciju i novi grad, ažuriraj oba
    if (updateData.locationCity) {
      finalUpdatePayload.locationCity = updateData.locationCity;
    }

    // Ako korisnik šalje novu lokaciju, ali nije poslao grad, možeš ovde automatski dodeliti grad na osnovu lokacije (ili ostaviti prazno)
    // Primer: ako želiš default grad za svaku novu lokaciju
    if (updateData.location && !updateData.locationCity) {
      // OVAJ DEO MOŽEŠ PRILAGODITI: koristi reverse geocoding API za pravi grad
      finalUpdatePayload.locationCity = 'Beograd';
    }

    if (Object.keys(finalUpdatePayload).length === 0) {
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
      return res.status(404).json({ message: 'User not found.' });
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

    const User = require('../models/User');
    const user = await User.findById(req.user.id);

    if (!user) {
      return res
        .status(404)
        .json({ message: 'Korisnik nije pronađen' });
    }

    // sigurnosni filter (nikad null u bazi)
    const cleanPictures = pictures.filter(
      (p) => typeof p === 'string'
    );

    user.profilePictures = cleanPictures;

    // avatar = prva slika
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

    // Filter parametri iz query stringa
    const { minAge, maxAge, gender } = req.query;
    const min = Number(minAge) || 18;
    const max = Number(maxAge) || 99;
    const today = new Date();
    const minBirthDate = new Date(today.getFullYear() - max, today.getMonth(), today.getDate());
    const maxBirthDate = new Date(today.getFullYear() - min, today.getMonth(), today.getDate());


    let filter = {
      _id: { $nin: [user._id, ...(user.matches || [])] },
      birthDate: { $gte: minBirthDate, $lte: maxBirthDate },
    };
    if (gender === 'male' || gender === 'female') {
      filter.gender = gender;
    }

    // Geo filter za udaljenost
    if (req.query.maxDistance && req.query.latitude && req.query.longitude) {
      const maxDistance = Number(req.query.maxDistance) * 1000 || 200000; // u metrima
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
      return res.status(404).json({
        message: "Korisnik nije pronađen",
      });
    }

    console.log("➡️ SWIPE ACTION", {
      from: user._id.toString(),
      to: targetUser._id.toString(),
      action,
    });

    // ================= ACTION: LIKE =================
    if (action === "like") {
      console.log(`❤️ LIKE: ${user._id} lajkuje ${targetUser._id}`);

      // 1️⃣ Provera uzajamnosti (Da li je on MENE već lajkovao?)
      // user.likes sadrži ID-jeve ljudi koji su lajkovali 'user'-a
      const isMutualLike = user.likes.some(
        (id) => id.toString() === targetUser._id.toString()
      );

      console.log("🔍 MUTUAL LIKE PROVERA:", isMutualLike);

      // ================= CASE A: MATCH =================
      if (isMutualLike) {
        console.log("🔥 MATCH OCCURRED - Obostrani lajk detektovan");

        // 1. Upis match-a kod oba korisnika
        user.matches.addToSet(targetUser._id);
        targetUser.matches.addToSet(user._id);

        // 2. Očisti 'incoming like' - pošto ste sada match, ne treba da stoji u Likes tabu
        // Brišemo targetUser-a iz tvoje liste lajkova (umanjuje tvoj brojač)
        user.likes.pull(targetUser._id);
        
        // Za svaki slučaj čistimo i tvoj ID iz njegove liste ako je postojao
        targetUser.likes.pull(user._id);

        // 3. Kreiranje ili pronalaženje konverzacije
        let conversation = await Conversation.findOne({
          "participants.user": { $all: [user._id, targetUser._id] },
        });

        if (!conversation) {
          console.log("💬 Kreiram novu konverzaciju za match");
          conversation = await Conversation.create({
            participants: [
              {
                user: user._id,
                is_new: true,
                has_unread_messages: false,
                has_sent_message: false,
              },
              {
                user: targetUser._id,
                is_new: true,
                has_unread_messages: false,
                has_sent_message: false,
              },
            ],
          });
        }

        await user.save();
        await targetUser.save();

        // 🔔 SOCKET: Obavesti drugu osobu da se desio match
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

        return res.json({
          match: true,
          matchedUser: {
            _id: targetUser._id,
            fullName: targetUser.fullName,
            avatar: targetUser.avatar,
          },
        });
      }

// ================= CASE B: SAMO LIKE =================
    console.log("👍 Nema matcha - dodajem lajk u targetUser.likes");

    // Dodaj tvoj ID u NJEGOVU listu lajkova (da bi se tebi pojavilo kod njega u Likes tabu)
    targetUser.likes.addToSet(user._id);
    await targetUser.save();

    // 🔔 SOCKET: Javi drugoj osobi da je dobila lajk (povećava mu badge/brojač)
    const targetSockets = global.onlineUsers.get(targetUser._id.toString());
    if (targetSockets) {
      targetSockets.forEach((sid) => {
        global.io.to(sid).emit("likeReceived", {
          fromUserId: user._id,
          fullName: user.fullName,
          avatar: user.avatar,
          birthDate: user.birthDate, // <--- DODATO: Sada šaljemo i datum rođenja
        });
      });
    }

    return res.json({
      match: false,
      message: "Like sačuvan",
    });
  }

  // ================= ACTION: DISLIKE =================
  if (action === "dislike") {
    console.log("👎 DISLIKE");

    // Dodajemo u dislikes da ga ne bi ponovo videli u potential matches
    user.dislikes.addToSet(targetUser._id);
    await user.save();

    return res.json({
      success: true,
      message: "Dislike sačuvan",
    });
  }

  return res.status(400).json({
    message: "Nepoznata akcija",
  });

} catch (error) {
  console.error("❌ swipeAction error:", error);
  return res.status(500).json({
    message: "Server error",
  });
}
}
// ================= GET MATCHES & CONVERSATIONS =================
exports.getMatchesAndConversations = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) return res.status(404).json({ message: "Korisnik nije pronađen" });

    // 1. Učitaj sve konverzacije gde učestvuje currentUser
    const conversations = await Conversation.find({ "participants.user": currentUser._id })
      .populate({ path: 'participants.user', select: 'fullName avatar' })
      .lean();

    // 2. Za SVAKU konverzaciju dohvatamo POSLEDNJU poruku direktno iz Message kolekcije
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
        console.warn(`Konverzacija ${conv._id} nema validnog drugog učesnika.`);
        continue;
      }

      const chatUser = {
        _id: otherParticipant.user._id,
        fullName: otherParticipant.user.fullName,
        avatar: otherParticipant.user.avatar,
      };

      const userStatus = conv.participants.find(
        (p) => p.user && p.user._id.equals(currentUser._id)
      );

      if (!userStatus) {
        console.warn(`Status za korisnika ${currentUser._id} nije pronađen u konverzaciji ${conv._id}.`);
        continue;
      }

      // ✅ Ako postoji BILO KAKVA poruka za ovu konverzaciju → IDE U PORUKE
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
          // Badge samo ako ovaj user ima nepročitane poruke
          has_unread: !!userStatus.has_unread_messages,
        });
      } else {
        // ⬅️ Nema poruka → novi spoj (prikaz na vrhu)
        newMatches.push({
          ...chatUser,
          chatId: conv._id.toString(),
          has_unread: !!userStatus.is_new,
        });
      }
    }

    // 3. Sortiraj konverzacije po vremenu poslednje poruke (najnovije prvo)
    existingConversations.sort((a, b) => {
      const timeA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
      const timeB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
      return timeB - timeA;
    });

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

// ================= POST MESSAGE (Podržava slanje po chatId ili recipientId) =================
exports.postMessage = async (req, res) => {
  try {
    const { text, recipientId } = req.body; 
    const { chatId: chatIdParam } = req.params; 
    const senderId = req.user.id;

    let conversation = null;
    let targetRecipientId = recipientId; 

    // 1. Scenarij: Poruka u postojećem chatu (koristi chatId iz rute)
    if (chatIdParam) {
      conversation = await Conversation.findById(chatIdParam);
      if (!conversation) return res.status(404).json({ message: "Konverzacija nije pronađena." });
      
      // Pronađi ID primaoca iz konverzacije
      const receiverParticipant = conversation.participants.find(p => p.user && !p.user.equals(senderId));
      if (!receiverParticipant || !receiverParticipant.user) return res.status(400).json({ message: "Primalac nije pronađen u konverzaciji." });
      targetRecipientId = receiverParticipant.user.toString();
    } 
    // 2. Scenarij: Prva poruka nakon match-a (koristi recipientId iz tela)
    else if (recipientId) {
      // Proveri da li konverzacija već postoji
      conversation = await Conversation.findOne({ "participants.user": { $all: [senderId, recipientId] } });
       
      if (!conversation) {
        // Kreiraj novu konverzaciju ako ne postoji
        conversation = new Conversation({
          participants: [
            { user: senderId, is_new: false, has_unread_messages: false, has_sent_message: true },
            { user: recipientId, is_new: true, has_unread_messages: true, has_sent_message: false } 
          ],
        });
        await conversation.save();
      } else {
        // Ako konverzacija postoji, ažuriraj statuse za ovu poruku
        conversation.participants = conversation.participants.map(p => {
            if (p.user.equals(senderId)) return { ...p.toObject(), is_new: false, has_sent_message: true, has_unread_messages: false };
            if (p.user.equals(recipientId)) return { ...p.toObject(), has_unread_messages: true };
            return p.toObject();
        });
      }
    } 
    // 3. Scenarij: Nedostaju ključni podaci
    else {
      return res.status(400).json({ message: "Nedostaju chatId ili recipientId za slanje poruke." });
    }


    // Provere nakon pronalaska/kreiranja konverzacije
    if (!conversation || !targetRecipientId) {
      return res.status(500).json({ message: "Greška u obradi konverzacije." });
    }

    // Kreiranje i čuvanje poruke
    const newMessage = new Message({
        conversationId: conversation._id, 
        sender: senderId, 
        receiver: targetRecipientId, 
        text
    });
    await newMessage.save();

    conversation.messages.push(newMessage._id);

    // Ažuriranje statusa učesnika za oba scenarija
    conversation.participants = conversation.participants.map(p => {
        const participantObject = p.toObject ? p.toObject() : { ...p };
        
        if (p.user.equals(targetRecipientId)) { // Primaocu
            participantObject.has_unread_messages = true;
        }
        else if (p.user.equals(senderId)) { // Pošiljaocu
            participantObject.has_unread_messages = false; 
            participantObject.is_new = false;
            participantObject.has_sent_message = true;
        }
        return participantObject;
    });

    conversation.markModified('participants');
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

    // Dohvati trenutnog korisnika
    const user = await User.findById(currentUserId).lean();
    if (!user) {
      console.log('[INCOMING LIKES] Korisnik nije pronađen:', currentUserId);
      return res.status(404).json({ message: 'User not found' });
    }

    // Filter parametri iz query stringa
    const { minAge, maxAge, gender, latitude, longitude, maxDistance } = req.query;
    const min = Number(minAge) || 18;
    const max = Number(maxAge) || 99;
    const today = new Date();
    const minBirthDate = new Date(today.getFullYear() - max, today.getMonth(), today.getDate());
    const maxBirthDate = new Date(today.getFullYear() - min, today.getMonth(), today.getDate());

    // Pronađi sve korisnike koji su lajkovali trenutnog korisnika
    const incomingLikeIds = user.likes || [];
    console.log('[INCOMING LIKES] incomingLikeIds:', incomingLikeIds);

    let query = {
      _id: { $in: incomingLikeIds, $nin: [user._id, ...(user.matches || [])] },
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
        showLocation
        gender
        sexualOrientation
      `)
      .lean();

    // Dodaj locationCity u location objekat
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
    console.error('[INCOMING LIKES] Greška:', err);
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

    // 1️⃣ obriši poruke
    await Message.deleteMany({ conversationId: conversation._id });

    // 2️⃣ obriši konverzaciju
    await Conversation.findByIdAndDelete(conversation._id);

    // 3️⃣ ukloni match
    await User.updateOne(
      { _id: currentUserId },
      { $pull: { matches: otherUserId } }
    );

    await User.updateOne(
      { _id: otherUserId },
      { $pull: { matches: currentUserId } }
    );

    
    //  SOCKET EVENT
   
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
