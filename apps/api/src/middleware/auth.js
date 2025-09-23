const jwt = require("jsonwebtoken");

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.employee = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { auth };
