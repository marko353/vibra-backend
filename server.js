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

dotenv.config();
const app = express();
const server = http.createServer(app);


const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
});


app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    res.header("X-Debug-Server", "chat-server-v1");
    next();
});

app.use(cors({ 
    origin: "*", 
    methods: ["GET", "POST", "PUT", "DELETE"], 
    allowedHeaders: ["Content-Type", "Authorization", "Debug-Info"] 
}));
app.use(cookieParser());
app.use(express.json());

// MongoDB konekcija sa debug porukama
mongoose.connect(process.env.MONGO_URI, {
    connectTimeoutMS: 30000,
    socketTimeoutMS: 30000,
})
.then(() => console.log("✅ MongoDB Connected!!!"))
.catch((err) => console.error("❌ MongoDB connection error:", err));

// Rute
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/messages", messageRoutes);

// Online korisnici
const onlineUsers = new Map();

// Socket.IO debug middleware
io.use((socket, next) => {
    console.log(`🔌 Novi Socket.IO zahtev od ${socket.handshake.address}`);
    console.log(`📌 Handshake headers:`, socket.handshake.headers);
    next();
});

io.on("connection", (socket) => {
    console.log("🟢 Novi korisnik povezan:", socket.id);
    // U io.on("connection") dodajte:
socket.on("typing", (userId) => {
  const userSocket = onlineUsers.get(userId);
  if (userSocket) {
      // Šaljemo svima osim pošiljaocu
      socket.broadcast.emit("typing", userId);
  }
});

    // Join event
    socket.on("join", (userId) => {
        if (!userId) {
            console.log("⚠️ Join event bez userId-a");
            return;
        }
        
        console.log(`👤 Korisnik ${userId} se priključio (Socket ID: ${socket.id})`);
        onlineUsers.set(userId, socket.id);
        
        console.log("📊 Trenutno online korisnici:", Array.from(onlineUsers.entries()));
        io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));
    });

    // Slanje poruka
    socket.on("sendMessage", (newMessage) => {
        console.log("📤 Primljena nova poruka za slanje:", newMessage);
        
        if (!newMessage?.senderId || !newMessage?.receiverId) {
            console.error("❌ Nevalidna poruka:", newMessage);
            return;
        }

        try {
            const senderSocket = onlineUsers.get(newMessage.senderId);
            const receiverSocket = onlineUsers.get(newMessage.receiverId);

            console.log(`🔍 Pronalaženje socketova - Pošiljalac: ${senderSocket}, Primalac: ${receiverSocket}`);

            // Šalji pošiljaocu
            if (senderSocket) {
                console.log(`📨 Slanje poruke pošiljaocu (${newMessage.senderId})`);
                io.to(senderSocket).emit("receiveMessage", newMessage);
            }

            // Šalji primaocu
            if (receiverSocket) {
                console.log(`📨 Slanje poruke primaocu (${newMessage.receiverId})`);
                io.to(receiverSocket).emit("receiveMessage", newMessage);
            } else {
                console.log(`⚠️ Primalac ${newMessage.receiverId} nije online`);
            }

            console.log("✅ Poruka uspešno prosleđena");
        } catch (err) {
            console.error("❌ Greška pri slanju poruke:", err);
        }
    });

    // Diskonekcija
    socket.on("disconnect", (reason) => {
        console.log(`🔴 Korisnik diskonektovan (${socket.id}): ${reason}`);
        
        let disconnectedUserId = null;
        for (let [userId, socketId] of onlineUsers) {
            if (socketId === socket.id) {
                disconnectedUserId = userId;
                onlineUsers.delete(userId);
                break;
            }
        }

        if (disconnectedUserId) {
            console.log(`👋 Korisnik ${disconnectedUserId} je napustio chat`);
            io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));
        }
    });

    // Error handling
    socket.on("error", (err) => {
        console.error("💥 Socket.IO greška:", err);
    });
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "OK",
        onlineUsers: onlineUsers.size,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`🚀 Server je pokrenut na portu ${PORT}`);
    console.log(`🔗 WebSocket endpoint: ws://localhost:${PORT}/socket.io/`);
});