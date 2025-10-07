const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  console.log("Authorization header:", req.headers.authorization);

  const token = req.headers.authorization && req.headers.authorization.split(" ")[1];

  if (!token) {
    console.log("No token provided");
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    // ✨ DODATO: Logujemo tajni ključ koji se koristi za PROVERU tokena
    console.log("--- PROVERA TOKENA --- JWT_SECRET:", process.env.JWT_SECRET);

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    console.log("Token is valid, user decoded:", decoded);
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ message: "Token is not valid" });
  }
};

module.exports = authMiddleware;
