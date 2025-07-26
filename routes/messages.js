const express = require("express");
const Message = require("../models/Message");
const router = express.Router();

// Middleware za logovanje
router.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Slanje poruke
router.post("/send", async (req, res) => {
    console.log("📩 Primljen zahtev za slanje poruke:", req.body);
    
    try {
        const { senderId, receiverId, message } = req.body;
        
        if (!senderId || !receiverId || !message?.trim()) {
            console.error("⚠️ Nedostaju obavezni podaci");
            return res.status(400).json({ 
                error: "Obavezni podaci: senderId, receiverId, message",
                receivedData: req.body 
            });
        }

        const newMessage = new Message({ 
            senderId, 
            receiverId, 
            message: message.trim(),
            createdAt: new Date()
        });
        
        console.log("💾 Čuvanje poruke u bazi...");
        const savedMessage = await newMessage.save();
        
        console.log("✅ Poruka sačuvana:", savedMessage);
        res.status(201).json(savedMessage);
    } catch (error) {
        console.error("❌ Greška pri slanju poruke:", error);
        res.status(500).json({ 
            error: "Greška na serveru",
            details: error.message 
        });
    }
});

// Dohvatanje razgovora
router.get("/conversations/:userId/:receiverId", async (req, res) => {
    console.log(`🔍 Preuzimanje razgovora između ${req.params.userId} i ${req.params.receiverId}`);
    
    try {
        const { userId, receiverId } = req.params;
        
        console.log("🔎 Pretraga u bazi...");
        const messages = await Message.find({
            $or: [
                { senderId: userId, receiverId: receiverId },
                { senderId: receiverId, receiverId: userId },
            ],
        }).sort({ createdAt: 1 });
        
        console.log(`📄 Pronađeno ${messages.length} poruka`);
        res.json(messages);
    } catch (error) {
        console.error("❌ Greška pri preuzimanju poruka:", error);
        res.status(500).json({ 
            error: "Greška pri preuzimanju poruka",
            details: error.message 
        });
    }
});

// Dohvatanje poslednjih poruka
router.get("/last/:userId", async (req, res) => {
    console.log(`📨 Preuzimanje poslednjih poruka za korisnika ${req.params.userId}`);
    
    try {
        const { userId } = req.params;

        const lastMessages = await Message.aggregate([
            {
                $match: {
                    $or: [{ senderId: userId }, { receiverId: userId }],
                },
            },
            {
                $sort: { createdAt: -1 },
            },
            {
                $group: {
                    _id: {
                        $cond: {
                            if: { $eq: ["$senderId", userId] },
                            then: "$receiverId",
                            else: "$senderId",
                        },
                    },
                    lastMessage: { $first: "$message" },
                    timestamp: { $first: "$createdAt" },
                    senderId: { $first: "$senderId" },
                    messageId: { $first: "$_id" }
                },
            },
            {
                $sort: { timestamp: -1 },
            },
        ]);

        console.log(`📊 Vraćeno ${lastMessages.length} poslednjih razgovora`);
        res.status(200).json(lastMessages);
    } catch (error) {
        console.error("❌ Greška pri preuzimanju poslednjih poruka:", error);
        res.status(500).json({ 
            error: "Server error",
            details: error.message 
        });
    }
});

module.exports = router;