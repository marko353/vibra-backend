const { Schema, model } = require("mongoose");

// Definišemo Mongoose šemu za korisnika
const UserSchema = new Schema(
  {
    // Osnovni podaci o autentifikaciji
    username: { type: String, unique: true, sparse: true },

    // VAŽNO: email, password i phone NEMAJU default: null.
    // Jedinstveni (sparse) indeks preskače samo polja koja ne postoje;
    // polje sa vrednošću null se indeksira, pa bi drugi korisnik bez emaila
    // (ili bez telefona) dobio E11000 duplicate key.
    email: { type: String, unique: true, sparse: true },
    password: { type: String },
    fullName: { type: String },
    birthDate: { type: Date },
    googleId: { type: String },
    isAdmin: { type: Boolean, default: false },

    // Telefon i verifikacija (za SMS Login).
    // select: false: pun broj se ne vraća u upitima osim ako se izričito traži
    // (.select("+phone")), da ne procuri u tuđe profile.
    phone: { type: String, unique: true, sparse: true, select: false },
    phoneVerified: {
      type: Boolean,
      default: false
    },

    // Podaci za profilne slike
    profilePictures: { type: [String], default: [] },
    avatar: { type: String },

    // Premium status i pretplata
    isPremium: { type: Boolean, default: false },
    premiumPlan: { type: String, default: null },
    premiumExpiresAt: { type: Date, default: null },
    revenueCatId: { type: String, default: null },

    // Super Like (nedeljni limit, samo za Premium)
    superLikesUsed: { type: Number, default: 0 },
    superLikesWeekStart: { type: Date, default: null },
    superLikedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Podaci za "kartice" profila
    bio: { type: String, default: null },
    relationshipType: { type: String, default: null },
    interests: { type: [String], default: [] },
    height: { type: Number, default: null },
    languages: { type: [String], default: [] },
    horoscope: { type: String, default: null },
    familyPlans: { type: String, default: null },
    communicationStyle: { type: String, default: null },
    loveStyle: { type: String, default: null },
    pets: { type: String, default: null },
    drinks: { type: String, default: null },
    smokes: { type: String, default: null },
    workout: { type: String, default: null },
    diet: { type: String, default: null },
    jobTitle: { type: String, default: null },
    education: { type: [String], default: [] },

    // Podaci o lokaciji
    // VAŽNO: bez default-a za type i coordinates. Nalog koji nikad nije poslao
    // lokaciju nema polje `location` (2dsphere indeks ga preskače), umesto da
    // dobije lažnu vrednost [0, 0]. `default: undefined` sprečava da Mongoose
    // sam upiše prazan niz, što bi 2dsphere indeks odbio.
    location: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: undefined
      }
    },
    locationCity: { type: String, default: null },
    showLocation: { type: Boolean, default: false },

    // Podešavanja za notifikacije
    notifications: {
      matches: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      likes: { type: Boolean, default: true },
    },

    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    sexualOrientation: { type: String, default: null },

    // Swipe logika
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    dislikes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    matches: [{ type: Schema.Types.ObjectId, ref: "User" }],
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Poslednji swipe: koristi se za Rewind (poništavanje poslednjeg swipe-a)
    lastSwipe: {
      targetUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
      action: { type: String }, // "like" | "superlike" | "dislike"
      wasLikedByTarget: { type: Boolean, default: false },
      wasSuperLikedByTarget: { type: Boolean, default: false },
      at: { type: Date, default: null },
    },

    // ========== DISCOVER TAB — dnevni batch ==========
    discoverBatchGeneratedAt: { type: Date, default: null },
    discoverRecommendedIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    discoverSameGoalsIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    discoverNewIds: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Tokeni i timestampovi
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },

    // Trajni filteri za korisnika
    filters: {
      ageRange: { type: [Number], default: [18, 99] },
      distance: { type: Number, default: 50 },
      gender: { type: String, default: 'any' }
    },
    fcmToken: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

// ========== INDEKSI (Discover i swipe) ==========
UserSchema.index({ location: "2dsphere" }); // obavezno za $near / $geoWithin
UserSchema.index({ likes: 1 });             // getLikedByMeIds
UserSchema.index({ blockedUsers: 1 });      // "ko je mene blokirao"
UserSchema.index({ createdAt: -1 });        // "New to VibrA"

const User = model("User", UserSchema);

/**
 * Pravi indekse iz šeme i ispisuje ih. Poziva se iz server.js TEK POSLE
 * uspešne konekcije na MongoDB (inače init() čeka konekciju i pada posle 10s).
 * Ako je neki unique indeks "sparse: false", registracija bez tog polja
 * (npr. bez emaila) puca sa E11000.
 */
async function logIndexes() {
  try {
    await User.init();
    const indexes = await User.collection.indexes();
    console.log("\n📚 [INDEXES] kolekcija users:");
    indexes.forEach((i) =>
      console.log(`   ${i.name} | unique: ${!!i.unique} | sparse: ${!!i.sparse}`)
    );
    console.log("");
  } catch (err) {
    console.error("❌ [INDEXES] greška pri kreiranju indeksa:", err.message);
  }
}

// Direktno eksportujemo model, a funkcija je dostupna kao User.logIndexes
User.logIndexes = logIndexes;

module.exports = User;