// models/User.js
const { Schema, model } = require("mongoose");

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String },
  birthDate: { type: Date, required: true },  
  profilePictures: { type: [String], default: [] }, 
  isAdmin: { type: Boolean, default: false },
  avatar: { type: String }, 

});

module.exports = model("User", UserSchema);

