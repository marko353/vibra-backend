// server.js

const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require('./models/User');
const { sendMatchNotification, sendMessageNotification } = require('./notificationService');
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
   socket.on("sendMessage", async ({ receiverId, text } = {}, callback) => {
    const reply = (data) => typeof callback === "function" && callback(data);

    try {
      // Validacija ulaza
      if (!receiverId || !mongoose.Types.ObjectId.isValid(receiverId)) {
        return reply({ status: "error", message: "Nevalidan primalac" });
      }
      const cleanText = typeof text === "string" ? text.trim() : "";
      if (!cleanText) return reply({ status: "error", message: "Poruka ne može biti prazna" });
      if (cleanText.length > 2000) return reply({ status: "error", message: "Poruka je predugačka" });
      if (String(receiverId) === userId) {
        return reply({ status: "error", message: "Nevalidan primalac" });
      }

      // Pošiljalac i primalac
      const [sender, receiver] = await Promise.all([
        User.findById(userId).select("fullName avatar blockedUsers matches"),
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

      const message = await Message.create({
        conversationId: conversation._id,
        sender: userId,
        receiver: receiverId,
        text: cleanText,
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

      const payload = {
        ...message.toObject(),
        _id: message._id.toString(),
        conversationId: message.conversationId.toString(),
        sender: message.sender.toString(),
        receiver: message.receiver.toString(),
      };

      // Socket primaocu
      const receiverSockets = onlineUsers.get(String(receiverId));
      if (receiverSockets) {
        receiverSockets.forEach((sid) => io.to(sid).emit("receiveMessage", payload));
      }

      // Push (best effort, ne blokira odgovor)
      if (receiver.fcmToken) {
        sendMessageNotification(receiver, sender, cleanText, conversation._id).catch((e) =>
          console.error("❌ Greška pri slanju push notifikacije:", e.message)
        );
      }

      return reply({ status: "ok", message: payload });
    } catch (err) {
      console.error("❌ sendMessage error", err);
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