const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  console.log("Authorization header:", req.headers.authorization); // Loguj authorization header

  const token = req.headers.authorization && req.headers.authorization.split(" ")[1];

  if (!token) {
    console.log("No token provided"); // Ako nema tokena
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Postavljanje korisničkog objekta na req.user
    console.log("Token is valid, user decoded:", decoded); // Loguj validan token i korisnika
    next(); // Nastavi sa sledećom funkcijom
  } catch (error) {
    console.error("Token verification failed:", error); // Loguj grešku ako token nije validan
    return res.status(401).json({ message: "Token is not valid" });
  }
};


module.exports = authMiddleware;
