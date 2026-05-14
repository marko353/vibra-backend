// server.js

const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require('./models/User'); // Proveri putanju do modela
const { sendMessageNotification } = require('./sendNotification'); // Proveri putanju do servisa

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
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }

  onlineUsers.get(userId).add(socket.id);

  console.log(
    "👥 ONLINE USERS MAP:",
    Array.from(onlineUsers.entries()).map(([uid, sockets]) => ({
      userId: uid,
      sockets: Array.from(sockets),
    }))
  );

  io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));

  // ==================================================
  // ❤️ LIKE RECEIVED (REAL-TIME LIKES TAB)
  // ==================================================
  socket.on("likeSent", ({ targetUserId }) => {
    console.log(
      "❤️ likeSent → from:",
      userId,
      "to:",
      targetUserId
    );

    const receiverSockets = onlineUsers.get(String(targetUserId));

    console.log(
      "📤 emit likeReceived → sockets:",
      receiverSockets
    );

    if (receiverSockets) {
      receiverSockets.forEach((sid) => {
        io.to(sid).emit("likeReceived", {
          fromUserId: userId,
        });
      });
    }
  });

  // ==================================================
  // 📩 SEND MESSAGE (emitujemo SAMO primaocu)
  // ==================================================
  socket.on("sendMessage", async ({ receiverId, text }, callback) => {
    console.log("✉️ sendMessage", { from: userId, to: receiverId });

    if (!receiverId || !text) {
      console.error("❌ sendMessage: Nedostaju podaci", { receiverId, text });
      return callback?.({ status: "error", message: "Nedostaju podaci" });
    }

    try {
      console.log("🔍 Tražim konverzaciju između korisnika", { userId, receiverId });
      const conversation = await Conversation.findOne({
        "participants.user": { $all: [userId, receiverId] },
      });

      if (!conversation) {
        console.error("❌ Konverzacija ne postoji", { userId, receiverId });
        return callback?.({
          status: "error",
          message: "Konverzacija ne postoji",
        });
      }

      console.log("💾 Kreiram poruku za konverzaciju", { conversationId: conversation._id });
      const message = await Message.create({
        conversationId: conversation._id,
        sender: userId,
        receiver: receiverId,
        text,
      });

      conversation.messages.push(message._id);

      console.log("🔄 Ažuriram status učesnika u konverzaciji");
      conversation.participants = conversation.participants.map((p) => {
        const obj = p.toObject();

        if (p.user.equals(receiverId)) {
          obj.has_unread_messages = true;
        }

        if (p.user.equals(userId)) {
          obj.has_unread_messages = false;
          obj.has_sent_message = true;
          obj.is_new = false;
        }

        return obj;
      });

      conversation.markModified("participants");
      await conversation.save();

      const payload = message.toObject();

      console.log("📤 Emitujem poruku primaocu preko Socket.IO", { receiverId });
      const receiverSockets = onlineUsers.get(String(receiverId));
      if (receiverSockets) {
        receiverSockets.forEach((sid) => {
          console.log("➡️ Emitujem na socket", { sid });
          io.to(sid).emit("receiveMessage", payload);
        });
      } else {
        console.warn("⚠️ Primalac nije online", { receiverId });
      }

      console.log("🔔 Pokrećem asinhrono slanje push notifikacije");
      (async () => {
        try {
          console.log("🔍 Dohvatam podatke za notifikaciju", { receiverId, userId });
          const receiver = await User.findById(receiverId).select('fcmToken _id');
          const sender = await User.findById(userId).select('fullName avatar _id');

          if (receiver && receiver.fcmToken) {
            console.log("🔔 Pozivam sendMessageNotification za", {
              receiverId: receiver._id,
              senderId: sender._id,
              fcmToken: receiver.fcmToken.substring(0, 10),
            });
            await sendMessageNotification(
              receiver, 
              sender, 
              text, 
              conversation._id
            );
          } else {
            console.warn("⚠️ Primalac nema FCM token ili nije pronađen", { receiverId });
          }
        } catch (pushErr) {
          console.error("❌ Greška pri slanju push notifikacije", pushErr);
        }
      })();

      console.log("✅ Poruka uspešno obrađena, šaljem callback pošiljaocu");
      callback?.({ status: "ok", message: payload });
    } catch (err) {
      console.error("❌ sendMessage error", err);
      callback?.({ status: "error", message: "Server error" });
    }
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
