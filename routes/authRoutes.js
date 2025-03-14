const express = require("express");
const { register, login, logout } = require("../controllers/authController"); // Proveri putanju i da li su funkcije definisane
const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);

module.exports = router;