const cloudinary = require("cloudinary").v2;

// Provera da li su vrednosti iz .env učitane


cloudinary.config({
  cloud_name: "dbkmpicfq",
  api_key:"721657296157376",
  api_secret:"tMMvTED93VDqw996EYCQDgKux2c",
});

module.exports = cloudinary;


