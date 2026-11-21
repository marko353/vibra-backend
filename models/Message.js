// models/Message.js

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  liked: {
    type: Boolean,
    default: false,
  },
  // Citat poruke na koju se odgovara
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    text: String,
    sender: String,
  },
  // Vrsta poruke: obična ili GIF (stare poruke dobijaju "text")
  type: {
    type: String,
    enum: ["text", "gif"],
    default: "text",
  },
  // Podaci o GIF-u (samo za type: "gif")
  gif: {
    url: String,
    width: Number,
    height: Number,
  },
  text: {
    type: String,
    // GIF poruka nema tekst
    required: function () {
      return this.type !== "gif";
    },
    default: "",
  },
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);