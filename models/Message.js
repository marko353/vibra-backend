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
  // Vrsta poruke: obična, GIF ili glasovna (stare poruke dobijaju "text")
  type: {
    type: String,
    enum: ["text", "gif", "voice"],
    default: "text",
  },
  // Podaci o GIF-u (samo za type: "gif"). Ravna polja jer ih aplikacija tako čita.
  gifUrl: String,
  gifWidth: Number,
  gifHeight: Number,
  // Podaci o glasovnoj poruci (samo za type: "voice"), trajanje u sekundama
  voiceUrl: String,
  voiceDuration: Number,
  voiceWaveform: {
    type: [Number],
    default: undefined,
  },
  text: {
    type: String,
    // GIF i glasovna poruka nemaju tekst
    required: function () {
      return this.type === "text";
    },
    default: "",
  },
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);