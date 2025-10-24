// server.js
const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

// Rute i modeli
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const Conversation = require("./models/Conversation");
const Message = require("./models/Message");

dotenv.config();
const app = express();
const server = http.createServer(app);

// Allow CORS (prilagodi origin na produkciju)
const io = new Server(server, { cors: { origin: "*" } });

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB konekcija
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected!"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Rute
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

// --- ONLINE KORISNICI ---
// mapa: userId (string) -> Set(socketId)
const onlineUsers = new Map();

// ================= SOCKET.IO =================

// JWT autentifikacija socketa
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  console.log(`🔌 [AUTH] Pokušaj konekcije: socket ID ${socket.id}`);

  if (!token) {
    console.error(`   -> ❌ Token nedostaje za socket ${socket.id}`);
    return next(new Error("Authentication error: Token missing"));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = String(payload.id); // SIGURNO string
    console.log(`   -> ✅ Uspešna autorizacija za User ID: ${socket.userId}`);
    next();
  } catch (err) {
    console.error(`   -> ❌ Token nevažeći za socket ${socket.id}. Greška: ${err.message}`);
    next(new Error("Authentication error: Token invalid"));
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.userId);
  console.log(`[CONNECTION] 🟢 Socket povezan: ${socket.id}, User ID: ${userId}`);

  // Dodaj socket u onlineUsers
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);

  console.log(`[ONLINE USERS] Trenutno online:`, Array.from(onlineUsers.keys()));
  io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));

  // --- HANDLER: slanje poruka ---
  socket.on("sendMessage", async ({ receiverId, text }, callback) => {
    const senderId = String(socket.userId);
    if (!receiverId || !text) {
      if (callback) callback({ status: "error", message: "Podaci nedostaju." });
      return;
    }

    const receiverIdStr = String(receiverId);

    try {
      // 1) Nađi konverzaciju
      let conversation = await Conversation.findOne({
        "participants.user": { $all: [senderId, receiverIdStr] }
      });

      if (!conversation) {
        console.warn(`[sendMessage] Odbijeno: Korisnik ${senderId} pokušao da piše ${receiverIdStr} bez konverzacije.`);
        if (callback) callback({ status: "error", message: "Konverzacija ne postoji." });
        return;
      }

      // 2) Sačuvaj poruku
      const message = new Message({
        conversationId: conversation._id,
        sender: senderId,
        receiver: receiverIdStr,
        text
      });
      const savedMessage = await message.save();
      conversation.messages.push(savedMessage._id);

      // 3) Ažuriraj status učesnika (✅ NOVA LOGIKA)
      conversation.participants = conversation.participants.map(p => {
        // Primaocu:
        if (p.user.equals(receiverIdStr)) {
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

      // 4) Emituj poruku primaocu
      const messageToEmit = savedMessage.toObject();

      const receiverSockets = onlineUsers.get(receiverIdStr);
      if (receiverSockets) {
        receiverSockets.forEach(socketId => io.to(socketId).emit("receiveMessage", messageToEmit));
      }

      // 5) Emituj pošiljaocu (za sinhronizaciju više uređaja istog korisnika)
      const senderSockets = onlineUsers.get(senderId);
      if (senderSockets) {
         senderSockets.forEach(socketId => io.to(socketId).emit("receiveMessage", messageToEmit));
      }

      if (callback) callback({ status: "ok", message: messageToEmit });

    } catch (err) {
      console.error("❌ Greška u 'sendMessage':", err);
      if (callback) callback({ status: "error", message: "Greška na serveru." });
    }
  });

  // --- DISCONNECT ---
  socket.on("disconnect", () => {
    const uid = String(socket.userId);
    const userSocketSet = onlineUsers.get(uid);
    if (userSocketSet) {
      userSocketSet.delete(socket.id);
      if (userSocketSet.size === 0) {
        onlineUsers.delete(uid);
        console.log(`   -> Korisnik ${uid} je sada potpuno offline.`);
      }
    }
    console.log(`[ONLINE USERS] Trenutno online:`, Array.from(onlineUsers.keys()));
    io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));
  });
});

// Pokreni server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server je pokrenut na portu ${PORT}`));