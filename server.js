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

// Konekcija sa MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB Connected!!!"))
    .catch((err) => console.error("❌ MongoDB connection error:", err));

// Rute
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/messages", messageRoutes);

// Skladište online korisnika
const onlineUsers = new Map();

io.on("connection", (socket) => {
    console.log("🟢 Novi korisnik povezan:", socket.id);

    socket.on("join", async (userId) => {
        if (!userId) return;
        console.log(` Korisnik ${userId} se priključuje.`);
        onlineUsers.set(userId, socket.id);
        console.log("✅ Trenutno online korisnici:", Array.from(onlineUsers.keys()));
        io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));

        try {
            const missedMessages = await Message.find({ receiverId: userId, isRead: false });
            console.log(` ${missedMessages.length} nepročitanih poruka za ${userId}`);

            // Dodata provera da se nepročitane poruke šalju samo jednom
            if (missedMessages.length > 0) {
                missedMessages.forEach((msg) => {
                    io.to(socket.id).emit("receiveMessage", msg);
                });

                await Message.updateMany({ receiverId: userId, isRead: false }, { isRead: true });
            }
        } catch (error) {
            console.error("❌ Greška pri slanju propuštenih poruka:", error);
        }
    });

    socket.on("sendMessage", async (newMessage) => {
        console.log(" Nova poruka:", newMessage);

        const receiverSocketId = onlineUsers.get(newMessage.receiverId);
        console.log(` Primac ${newMessage.receiverId} - socket ID: ${receiverSocketId || "nije online"}`);

        try {
            // Uklonjeno cuvanje poruke ovde.
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("receiveMessage", newMessage);
            }
            // emituj poruku i onome ko salje
            io.to(socket.id).emit("receiveMessage", newMessage);
        } catch (err) {
            console.error("❌ Greška pri slanju poruke socket.io:", err);
        }
    });

    socket.on("disconnect", () => {
        console.log(" Korisnik odjavljen:", socket.id);
        let disconnectedUserId = null;

        onlineUsers.forEach((value, key) => {
            if (value === socket.id) {
                disconnectedUserId = key;
                onlineUsers.delete(key);
            }
        });

        if (disconnectedUserId) {
            console.log(`❌ Korisnik ${disconnectedUserId} je sada offline`);
            io.emit("updateOnlineUsers", Array.from(onlineUsers.keys()));
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(` Server je pokrenut na portu ${PORT}`));
