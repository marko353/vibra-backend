// models/Conversation.js
const mongoose = require("mongoose");

const ParticipantSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  is_new: { type: Boolean, default: true },
  has_unread_messages: { type: Boolean, default: false },
  // ✅ NOVO POLJE
  has_sent_message: { type: Boolean, default: false } 
});

const ConversationSchema = new mongoose.Schema(
  {
    participants: [ParticipantSchema],
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", ConversationSchema);