const express = require("express");
const { 
  register, 
  login, 
  logout, 
  googleLogin, 
  forgotPassword,
  resetPassword,
  resetPasswordRedirect,
} = require("../controllers/authController");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.post("/google", googleLogin);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/reset-password-redirect", resetPasswordRedirect);

module.exports = router;