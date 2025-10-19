const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

// Rute i Modeli
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const Conversation = require("./models/Conversation");
const Message = require("./models/Message");

dotenv.config();
const app = express();
const server = http.createServer(app);

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

// Online korisnici: userId -> Set<socketId> (podrška za više uređaja)
const onlineUsers = new Map();

// ================= SOCKET.IO LOGIKA SA SVIM LOGOVIMA =================

// ✅ KORAK 1: SOCKET AUTENTIFIKACIJA
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  console.log(`🔌 [AUTH] Pokušaj konekcije sa socket ID: ${socket.id}`);
  
  if (!token) {
    console.error(`   -> ❌ [AUTH] Greška: Token nedostaje za socket ${socket.id}`);
    return next(new Error("Authentication error: Token missing"));
  }
  
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = payload.id; // Dodajemo userId na socket
    console.log(`   -> ✅ [AUTH] Uspešna autorizacija za User ID: ${socket.userId}`);
    next();
  } catch (err) {
    console.error(`   -> ❌ [AUTH] Greška: Token nevažeći za socket ${socket.id}. Greška: ${err.message}`);
    next(new Error("Authentication error: Token invalid"));
  }
});


// ✅ KORAK 2: UPRAVLJANJE KONEKCIJAMA
io.on("connection", (socket) => {
  const userId = socket.userId;
  console.log(`[CONNECTION] 🟢 Korisnik povezan: Socket ID: ${socket.id}, User ID: ${userId}`);
  
  // Dodaj korisnika u listu online korisnika
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);
  console.log(`[ONLINE USERS] Trenutno online:`, Array.from(onlineUsers.keys()));
  io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));


  // ✅ KORAK 3: HANDLER ZA SLANJE PORUKA
  socket.on("sendMessage", async ({ receiverId, text }, callback) => {
    const senderId = socket.userId;
    console.log(`[sendMessage] 📤 Primljen event od ${senderId} za ${receiverId}. Poruka: "${text}"`);

    if (!receiverId || !text) {
        console.error(`   -> ❌ GREŠKA: Nedostaje receiverId ili text.`);
        if (callback) callback({ status: "error", message: "Podaci nedostaju." });
        return;
    }

    try {
      console.log("   -> 🔵 Korak 1: Tražim ili kreiram konverzaciju...");
      let conversation = await Conversation.findOneAndUpdate(
        { participants: { $all: [senderId, receiverId] } },
        { $setOnInsert: { participants: [senderId, receiverId] } },
        { new: true, upsert: true }
      );
      console.log(`   -> ✅ Uspešno nađena/kreirana konverzacija ID: ${conversation._id}`);

      console.log("   -> 🔵 Korak 2: Kreiram i čuvam poruku u bazi...");
      const message = new Message({
        conversationId: conversation._id,
        sender: senderId,
        text: text,
      });
      await message.save();
      console.log(`   -> ✅ Uspešno sačuvana poruka, ID: ${message._id}`);

      console.log("   -> 🔵 Korak 3: Dodajem poruku u konverzaciju...");
      conversation.messages.push(message._id);
      await conversation.save();
      console.log("   -> ✅ Uspešno dodata poruka u konverzaciju.");
      
      console.log("   -> 🔵 Korak 4: Šaljem poruku primaocu i pošiljaocu...");
      // Pošalji poruku primaocu (svim njegovim uređajima)
      const receiverSockets = onlineUsers.get(receiverId);
      if (receiverSockets) {
        console.log(`      -> [EMIT] Šaljem "receiveMessage" primaocu ${receiverId} na sockete:`, Array.from(receiverSockets));
        receiverSockets.forEach(socketId => {
          io.to(socketId).emit("receiveMessage", message);
        });
      } else {
        console.log(`      -> [EMIT] Primalac ${receiverId} nije online.`);
      }

      // Pošalji poruku i pošiljaocu (za sinhronizaciju na njegovim drugim uređajima)
      const senderSockets = onlineUsers.get(senderId);
      if (senderSockets) {
        console.log(`      -> [EMIT] Šaljem "receiveMessage" pošiljaocu ${senderId} na sockete:`, Array.from(senderSockets));
        senderSockets.forEach(socketId => {
            io.to(socketId).emit("receiveMessage", message);
        });
      }
      
      // Javi klijentu da je sve prošlo OK (acknowledgement)
      if (callback) {
        console.log("   -> ✅ Korak 5: Šaljem 'ok' potvrdu klijentu.");
        callback({ status: "ok", message });
      }

    } catch (err) {
        // NAJVAŽNIJI DEO - ISPIS DETALJNE GREŠKE
        console.error("   -> ❌❌❌ KATASTROFALNA GREŠKA U 'sendMessage' BLOKU! ❌❌❌");
        console.error(err); // <-- Ovo će ti reći tačno šta je problem
      
        if (callback) {
            callback({ status: "error", message: "Greška na serveru." });
        }
    }
  });


  // ✅ KORAK 4: HANDLER ZA DISKONEKCIJU
  socket.on("disconnect", () => {
    const userId = socket.userId;
    console.log(`[DISCONNECT] 🔴 Korisnik diskonektovan: Socket ID: ${socket.id}, User ID: ${userId}`);
    const userSocketSet = onlineUsers.get(userId);
    if (userSocketSet) {
      userSocketSet.delete(socket.id);
      if (userSocketSet.size === 0) {
        onlineUsers.delete(userId);
        console.log(`   -> Korisnik ${userId} je sada potpuno offline.`);
      }
    }
    console.log(`[ONLINE USERS] Trenutno online:`, Array.from(onlineUsers.keys()));
    io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server je pokrenut na portu ${PORT}`));