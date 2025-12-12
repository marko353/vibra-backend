// server.js

const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

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

// ================= GLOBALS (BITNO!) =================
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

  // ---- ONLINE USERS ----
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);

  io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));

  // ==================================================
  // 📩 SEND MESSAGE (emitujemo SAMO primaocu)
  // ==================================================
  socket.on("sendMessage", async ({ receiverId, text }, callback) => {
    if (!receiverId || !text) {
      return callback?.({ status: "error", message: "Nedostaju podaci" });
    }

    try {
      const conversation = await Conversation.findOne({
        "participants.user": { $all: [userId, receiverId] },
      });

      if (!conversation) {
        return callback?.({
          status: "error",
          message: "Konverzacija ne postoji",
        });
      }

      // 1️⃣ Sačuvaj poruku
      const message = await Message.create({
        conversationId: conversation._id,
        sender: userId,
        receiver: receiverId,
        text,
      });

      conversation.messages.push(message._id);

      // 2️⃣ Update participant statusa
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

      // 3️⃣ EMITUJ PRIMAOCU
      const receiverSockets = onlineUsers.get(String(receiverId));
      if (receiverSockets) {
        receiverSockets.forEach((sid) => {
          io.to(sid).emit("receiveMessage", payload);
        });
      }

      // 4️⃣ CALLBACK POŠILJAOCU
      callback?.({ status: "ok", message: payload });

    } catch (err) {
      console.error("❌ sendMessage error:", err);
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
