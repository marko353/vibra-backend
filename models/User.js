const { Schema, model } = require("mongoose");

const UserSchema = new Schema({
  username: { type: String, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  fullName: { type: String },
  birthDate: { type: Date },  
  profilePictures: { type: [String], default: [] }, 
  isAdmin: { type: Boolean, default: false },
  avatar: { type: String },
  googleId: { type: String }, 
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
});

module.exports = model("User", UserSchema);



