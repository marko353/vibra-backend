const express = require("express");
const Message = require("../models/Message");
const router = express.Router();

// Slanje poruke
router.post("/send", async (req, res) => {
    try {
        console.log("Primljen request:", req.body);

        const { senderId, receiverId, message } = req.body;
        if (!senderId || !receiverId || !message || message.trim() === "") {
            console.error("⚠️ Nedostaju obavezni podaci u poruci!");
            return res.status(400).json({ error: "All fields (senderId, receiverId, message) are required." });
        }

        const newMessage = new Message({ senderId, receiverId, message });
        const savedMessage = await newMessage.save();
        console.log(" Poruka uspešno sačuvana u bazi:", savedMessage);

        res.status(201).json(savedMessage);
    } catch (error) {
        console.error("❌ Greška pri slanju poruke:", error);
        res.status(500).json({ error: "Error sending message" });
    }
});

// Dohvatanje svih poruka između dva korisnika
router.get("/conversations/:userId/:receiverId", async (req, res) => {
    try {
        const { userId, receiverId } = req.params;
        const messages = await Message.find({
            $or: [
                { senderId: userId, receiverId: receiverId },
                { senderId: receiverId, receiverId: userId },
            ],
        }).sort({ createdAt: 1 });

        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: "Error fetching messages" });
    }
});

// Dohvatanje poslednje poruke sa svakim korisnikom
router.get("/last/:userId", async (req, res) => {
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
                },
            },
            {
                $sort: { timestamp: -1 },
            },
        ]);

        console.log("Poslednje poruke:", lastMessages);
        res.status(200).json(lastMessages);
    } catch (error) {
        console.error("Greška pri preuzimanju poslednjih poruka:", error);
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;
