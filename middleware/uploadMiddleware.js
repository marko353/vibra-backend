const multer = require("multer");
const path = require("path");

// Definiši storage za multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('File destination:', file); // Loguj fajl pre nego što ga smestiš u direktorijum
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    console.log('File name:', file.originalname); // Loguj ime fajla pre nego što ga sačuvaš
    cb(null, Date.now() + path.extname(file.originalname));  // Generiši jedinstveno ime za svaku sliku
  },
});

const upload = multer({ storage });
module.exports = upload;
