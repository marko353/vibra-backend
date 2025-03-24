const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const messageRoutes = require("./routes/messages");
const Message = require("./models/Message");

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(cookieParser());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello from Vercel!");
});
app.get("/test", (req, res) => {
  res.send("Test endpoint, no authentication needed.");
});

// Konekcija sa MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected!!!"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Rute
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/messages", messageRoutes);

// Skladište online korisnika
const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("🟢 Korisnik povezan:", socket.id);

  socket.on("join", async (userId) => {
    onlineUsers.set(userId, socket.id);
    console.log(`👤 Korisnik ${userId} se pridružio`);
    io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));

    try {
      const missedMessages = await Message.find({ receiverId: userId, isRead: false });
      missedMessages.forEach((msg) => {
        io.to(socket.id).emit("receiveMessage", msg);
      });
      await Message.updateMany({ receiverId: userId, isRead: false }, { isRead: true });
    } catch (error) {
      console.error("❌ Greška pri slanju propuštenih poruka:", error);
    }
  });

  socket.on("sendMessage", async (newMessage) => {
    const receiverSocketId = onlineUsers.get(newMessage.receiverId);
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("receiveMessage", newMessage);
    } else {
      try {
        const message = new Message(newMessage);
        await message.save();
        console.log("📩 Poruka sačuvana u bazi jer korisnik nije online");
      } catch (err) {
        console.error("❌ Greška pri čuvanju poruke:", err);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Korisnik odjavljen:", socket.id);
    let disconnectedUserId = null;

    onlineUsers.forEach((value, key) => {
      if (value === socket.id) {
        disconnectedUserId = key;
        onlineUsers.delete(key);
      }
    });

    if (disconnectedUserId) {
      io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));


      console.log(`❌ Korisnik ${disconnectedUserId} je sada offline`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server je pokrenut na portu ${PORT}`));
