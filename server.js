// server.js

const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require('./models/User');
const gifRoutes = require("./routes/gifs");
const {
  sendMatchNotification,
  sendMessageNotification,
  sendReactionNotification,
} = require('./notificationService');
// Moderacija sadržaja (Sightengine)
const {
  moderateText,
  rejectionPayload,
  unavailablePayload,
  ModerationUnavailableError,
} = require('./services/sightengineService');
// Routes & models
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const Conversation = require("./models/Conversation");
const Message = require("./models/Message");

dotenv.config();

const app = express();
const server = http.createServer(app);

// ================= SOCKET.IO =================
const io = new Server(server, {
  cors: { origin: "*" },
});

// ================= GLOBALS =================
const onlineUsers = new Map(); // userId -> Set(socketId)
global.io = io;
global.onlineUsers = onlineUsers;

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());
app.get("/health", (req, res) => res.send("ok"));

// ================= MONGODB =================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected!"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ================= ROUTES =================
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/gifs", gifRoutes);

// ================= SOCKET AUTH =================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  console.log(`🔌 [AUTH] Socket pokušaj: ${socket.id}`);

  if (!token) {
    console.log("❌ Socket auth: token missing");
    return next(new Error("Authentication error: Token missing"));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = String(payload.id);
    console.log(`   -> ✅ Autorizovan user: ${socket.userId}`);
    next();
  } catch (err) {
    console.error("❌ Socket auth error:", err.message);
    next(new Error("Authentication error: Token invalid"));
  }
});

// ================= GIF HELPER =================
// Prihvata samo https linkove sa Klipy domena, da klijent ne može da pošalje
// proizvoljan URL. Vraća { url, width, height } ili null ako GIF nije validan.
function sanitizeGif(gif) {
  if (!gif || typeof gif.url !== "string" || gif.url.length > 500) return null;
  try {
    const u = new URL(gif.url);
    const hostOk = u.hostname === "klipy.com" || u.hostname.endsWith(".klipy.com");
    if (u.protocol !== "https:" || !hostOk) return null;
    const dim = (n) => (Number.isFinite(n) && n > 0 && n < 10000 ? Math.round(n) : null);
    return { url: gif.url, width: dim(gif.width), height: dim(gif.height) };
  } catch {
    return null;
  }
}

// ================= SOCKET CONNECTION =================
io.on("connection", (socket) => {
  const userId = socket.userId;
  console.log(`🟢 Socket povezan: ${socket.id}, user ${userId}`);

  // ================= ONLINE USERS =================
  // 🛡️ Zaštita od duplih socketa - disconnect stare konekcije
  if (onlineUsers.has(userId)) {
    onlineUsers.get(userId).forEach(oldSid => {
      if (oldSid !== socket.id) {
        console.log(`🧹 Čistim stari socket za user ${userId}: ${oldSid}`);
        io.sockets.sockets.get(oldSid)?.disconnect(true);
      }
    });
  }

  onlineUsers.set(userId, new Set([socket.id]));

  console.log(
    "👥 ONLINE USERS MAP:",
    Array.from(onlineUsers.entries()).map(([uid, sockets]) => ({
      userId: uid,
      sockets: Array.from(sockets),
    }))
  );

  io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));

  // 📩 SEND MESSAGE
  // ==================================================
  // Šalje se ili tekst (text) ili GIF (gif: { url, width, height }).
  // replyToId (opciono): ID poruke na koju se odgovara. Server sam pravi citat
  // (tekst i autor originala), klijentu se ne veruje.
  socket.on("sendMessage", async ({ receiverId, text, gif, replyToId } = {}, callback) => {
    const reply = (data) => typeof callback === "function" && callback(data);

    try {
      // Validacija ulaza
      if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
        return reply({ status: "error", message: "Nevalidan primalac" });
      }

      const gifData = sanitizeGif(gif);
      const isGif = !!gifData;
      if (gif && !gifData) return reply({ status: "error", message: "Nevalidan GIF" });

      const cleanText = typeof text === "string" ? text.trim() : "";
      if (!isGif) {
        if (!cleanText) return reply({ status: "error", message: "Poruka ne može biti prazna" });
        if (cleanText.length > 2000) return reply({ status: "error", message: "Poruka je predugačka" });
      }

      if (String(receiverId) === userId) {
        return reply({ status: "error", message: "Nevalidan primalac" });
      }

      // Pošiljalac i primalac
      // profilePictures je dodat jer avatar ne mora da postoji kao polje "avatar"
      const [sender, receiver] = await Promise.all([
        User.findById(userId).select("fullName avatar profilePictures blockedUsers matches"),
        User.findById(receiverId).select("fullName fcmToken notifications blockedUsers"),
      ]);
      if (!sender || !receiver) {
        return reply({ status: "error", message: "Korisnik nije pronađen" });
      }

      // Blok u bilo kom smeru
      const blocked =
        (sender.blockedUsers || []).some((id) => id.equals(receiver._id)) ||
        (receiver.blockedUsers || []).some((id) => id.equals(sender._id));
      if (blocked) return reply({ status: "error", message: "Blokiran", code: "BLOCKED" });

      // Konverzacija mora da postoji i par mora biti matchovan
      const conversation = await Conversation.findOne({
        "participants.user": { $all: [userId, receiverId] },
      });
      const isMatched = (sender.matches || []).some((id) => id.equals(receiver._id));
      if (!conversation || !isMatched) {
        return reply({ status: "error", message: "Konverzacija ne postoji", code: "NO_CONVERSATION" });
      }

      // Moderacija teksta: odbijena poruka se ne čuva i ne šalje primaocu.
      // Aplikacija iz odgovora vidi 'rejected' (Toast) ili 'MODERATION_UNAVAILABLE'
      // (poruka ostaje kao neposlata sa "Tap to retry").
      // GIF-ovi se ne moderišu.
      if (!isGif) {
        try {
          const { ok, reasons } = await moderateText(cleanText);
          if (!ok) {
            console.warn(`[MODERATION] Poruka odbijena (user ${userId}):`, reasons);
            return reply(rejectionPayload("text", reasons));
          }
        } catch (modErr) {
          if (modErr instanceof ModerationUnavailableError) {
            console.error("[MODERATION] Sightengine nedostupan:", modErr.message);
            return reply(unavailablePayload("text"));
          }
          throw modErr;
        }
      }

      // Citat: original mora da pripada istoj konverzaciji
      let replyTo;
      if (replyToId && mongoose.Types.ObjectId.isValid(replyToId)) {
        const original = await Message.findOne({
          _id: replyToId,
          conversationId: conversation._id,
        }).select("text type sender");

        if (original) {
          replyTo = {
            messageId: original._id,
            text: original.type === "gif" ? "GIF" : String(original.text || "").slice(0, 120),
            sender: String(original.sender), // autor ORIGINALA
          };
        }
      }

      const message = await Message.create({
        conversationId: conversation._id,
        sender: userId,
        receiver: receiverId,
        type: isGif ? "gif" : "text",
        text: isGif ? "" : cleanText,
        ...(isGif && { gif: gifData }),
        ...(replyTo && { replyTo }),
      });

      conversation.messages.push(message._id);
      conversation.participants = conversation.participants.map((p) => {
        const obj = p.toObject();
        if (p.user.equals(receiver._id)) obj.has_unread_messages = true;
        if (p.user.equals(sender._id)) {
          obj.has_unread_messages = false;
          obj.has_sent_message = true;
          obj.is_new = false;
        }
        return obj;
      });
      conversation.markModified("participants");
      await conversation.save();

      // Podaci pošiljaoca idu uz poruku, da klijent ne zavisi od params rute
      // za avatar i ime druge osobe.
      const senderAvatar =
        sender.avatar || (Array.isArray(sender.profilePictures) ? sender.profilePictures[0] : undefined);

      const payload = {
        ...message.toObject(),
        _id: message._id.toString(),
        conversationId: message.conversationId.toString(),
        sender: message.sender.toString(),
        receiver: message.receiver.toString(),
        senderName: sender.fullName,
        senderAvatar,
        ...(replyTo && { replyTo: { ...replyTo, messageId: String(replyTo.messageId) } }),
      };

      // Socket primaocu
      const receiverSockets = onlineUsers.get(String(receiverId));
      if (receiverSockets) {
        receiverSockets.forEach((sid) => io.to(sid).emit("receiveMessage", payload));
      }

      // Push (best effort, ne blokira odgovor)
      if (receiver.fcmToken) {
        sendMessageNotification(
          receiver,
          sender,
          isGif ? "GIF" : cleanText,
          conversation._id
        ).catch((e) =>
          console.error("❌ Greška pri slanju push notifikacije:", e.message)
        );
      }

      return reply({ status: "ok", message: payload });
    } catch (err) {
      console.error("❌ sendMessage error", err);
      return reply({ status: "error", message: "Server error" });
    }
  });

  // ❤️ REACT TO MESSAGE
  // ==================================================
  // Samo primalac poruke sme da je lajkuje, i to samo jednom (nema skidanja srca).
  // Autoru poruke stiže uživo "messageReaction" i push notifikacija.
  socket.on("reactToMessage", async ({ chatId, messageId, liked } = {}, callback) => {
    const reply = (data) => typeof callback === "function" && callback(data);

    try {
      if (!mongoose.Types.ObjectId.isValid(messageId) || liked !== true) {
        return reply({ status: "error", message: "Nevalidan zahtev" });
      }

      // Vraća staro stanje (new: false) da znamo da li je promena stvarna
      const before = await Message.findOneAndUpdate(
        { _id: messageId, receiver: userId },
        { liked },
        { new: false }
      );
      if (!before || String(before.conversationId) !== String(chatId)) {
        // Ako chatId ne odgovara, poništi izmenu
        if (before) await Message.updateOne({ _id: messageId }, { liked: !!before.liked });
        return reply({ status: "error", message: "Poruka nije pronađena" });
      }

      const senderId = String(before.sender);

      const [liker, author] = await Promise.all([
        User.findById(userId).select("fullName avatar blockedUsers"),
        User.findById(senderId).select("fullName fcmToken notifications blockedUsers"),
      ]);

      // Blok u bilo kom smeru: poništi izmenu i javi grešku
      const blocked =
        !liker ||
        !author ||
        (liker.blockedUsers || []).some((id) => id.equals(author._id)) ||
        (author.blockedUsers || []).some((id) => id.equals(liker._id));
      if (blocked) {
        await Message.updateOne({ _id: messageId }, { liked: !!before.liked });
        return reply({ status: "error", message: "Blokiran", code: "BLOCKED" });
      }

      // Uživo kod autora poruke
      const authorSockets = onlineUsers.get(senderId);
      if (authorSockets) {
        authorSockets.forEach((sid) =>
          io.to(sid).emit("messageReaction", {
            messageId: String(before._id),
            conversationId: String(before.conversationId),
            liked,
          })
        );
      }

      // Push samo kad se srce stvarno postavi (ne pri skidanju ni pri ponovljenom slanju)
      if (liked && !before.liked && author.fcmToken) {
        sendReactionNotification(
          author,
          liker,
          before.type === "gif" ? "GIF" : before.text,
          before.conversationId
        ).catch((e) =>
          console.error("❌ Greška pri slanju push notifikacije:", e.message)
        );
      }

      return reply({ status: "ok" });
    } catch (err) {
      console.error("❌ reactToMessage error", err);
      return reply({ status: "error", message: "Server error" });
    }
  });

  // ================= JOIN CHAT =================
  socket.on("joinChat", (chatId) => {
    socket.join(chatId);
    console.log(`👤 Korisnik ${userId} se pridružio sobi: ${chatId}`);
  });

  // ================= DISCONNECT =================
  socket.on("disconnect", (reason) => {
    console.log(`🔴 Socket ${socket.id} disconnect (${reason})`);

    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);

      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));
      }
    }

    console.log(
      "👥 ONLINE USERS AFTER DISCONNECT:",
      Array.from(onlineUsers.entries()).map(([uid, sockets]) => ({
        userId: uid,
        sockets: Array.from(sockets),
      }))
    );
  });

  // ================= SOCKET ERROR =================
  socket.on("error", (err) => {
    console.error(`❌ Socket error (${socket.id}):`, err.message);
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server pokrenut na portu ${PORT}`)
);