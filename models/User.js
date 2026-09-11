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
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0]
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

// LOG: Pre cuvanja dokumenta (.save())
UserSchema.pre("save", function (next) {
  console.log(`\n================== [MONGOOSE PRE-SAVE] ==================`);
  console.log(`User ID: ${this._id}`);
  console.log(`Updated Notifications:`, JSON.stringify(this.notifications, null, 2));
  console.log(`==========================================================\n`);
  next();
});

// LOG: Pre izmene dokumenta kroz update metode (.findOneAndUpdate / .findByIdAndUpdate)
UserSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();
  console.log(`\n================== [MONGOOSE PRE-UPDATE] ==================`);
  console.log(`Filter:`, JSON.stringify(this.getQuery(), null, 2));
  console.log(`Update payload:`, JSON.stringify(update, null, 2));
  if (update.$set && update.$set.notifications) {
    console.log(`[NOTIFICATIONS CHANGED]:`, JSON.stringify(update.$set.notifications, null, 2));
  }
  console.log(`===========================================================\n`);
  next();
});

// LOG: Nakon uspesnog update-a
UserSchema.post("findOneAndUpdate", function (doc) {
  if (doc) {
    console.log(`\n================== [MONGOOSE POST-UPDATE] ==================`);
    console.log(`User ID: ${doc._id} successfully updated.`);
    console.log(`Current saved notifications:`, JSON.stringify(doc.notifications, null, 2));
    console.log(`============================================================\n`);
  }
});

// Direktno eksportujemo model
module.exports = model("User", UserSchema);