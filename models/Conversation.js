// models/Conversation.js
const mongoose = require("mongoose");

const ParticipantSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  is_new: { type: Boolean, default: true },
  has_unread_messages: { type: Boolean, default: false },
  has_sent_message: { type: Boolean, default: false },
});

const ConversationSchema = new mongoose.Schema(
  {
    participants: [ParticipantSchema],
    messages: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }],

    // Jedinstven ključ para: id-jevi učesnika sortirani i spojeni ("idA_idB").
    // Baza ne dozvoljava dve konverzacije za isti par, čak ni kad dva zahteva
    // stignu istovremeno. sparse: stare konverzacije bez ključa se ne računaju
    // dok se ne dopune (vidi backfill skriptu).
    pairKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

// Brza pretraga konverzacija po učesniku (getMatchesAndConversations, markAsRead...)
ConversationSchema.index({ "participants.user": 1 });

ConversationSchema.statics.buildPairKey = function (userA, userB) {
  return [String(userA), String(userB)].sort().join("_");
};

// Vrati postojeću konverzaciju para ili napravi novu, bez duplikata.
// `participants` je opciono (npr. postMessage ima svoje početne flagove).
ConversationSchema.statics.findOrCreateForPair = async function (
  userA,
  userB,
  participants
) {
  const pairKey = this.buildPairKey(userA, userB);

  // 1) Postoji (uključujući stare bez pairKey): vrati je i dopuni ključ
  const existing = await this.findOne({
    "participants.user": { $all: [userA, userB] },
  });
  if (existing) {
    if (!existing.pairKey) {
      await this.updateOne(
        { _id: existing._id, pairKey: { $exists: false } },
        { $set: { pairKey } }
      ).catch(() => {}); // ako ključ već zauzme druga konverzacija, ne ruši zahtev
    }
    return existing;
  }

  // 2) Ne postoji: napravi. Ako je druga strana bila brža, E11000 → vrati njenu
  try {
    return await this.create({
      pairKey,
      participants: participants || [{ user: userA }, { user: userB }],
    });
  } catch (err) {
    if (err.code === 11000) {
      const winner = await this.findOne({ pairKey });
      if (winner) return winner;
    }
    throw err;
  }
};

module.exports = mongoose.model("Conversation", ConversationSchema);