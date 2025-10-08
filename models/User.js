const { Schema, model } = require("mongoose");

// Definišemo Mongoose šemu za korisnika
const UserSchema = new Schema(
  {
    // Osnovni podaci o autentifikaciji
    username: { type: String, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    fullName: { type: String },
    birthDate: { type: Date },
    googleId: { type: String },
    isAdmin: { type: Boolean, default: false },

    // Podaci za profilne slike
    profilePictures: { type: [String], default: [] },
    avatar: { type: String },

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
    location: {
      type: Object,
    },
    showLocation: { type: Boolean, default: false },

    // 👇 DODATO POLJE 👇
    hasCompletedLocationPrompt: {
        type: Boolean,
        default: false
    },

    gender: { type: String, default: null },
    sexualOrientation: { type: String, default: null },

    // Swipe logika
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    dislikes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    matches: [{ type: Schema.Types.ObjectId, ref: "User" }], // Dodao sam i matches, verovatno treba

    // Tokeni i timestampovi
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
  },
  {
    timestamps: true,
  }
);

// Direktno eksportujemo model
module.exports = model("User", UserSchema);