const { tokenFromRequest, validSession } = require("../services/session.service");

function authMiddleware(req, res, next) {
  if (!validSession(tokenFromRequest(req))) return res.status(401).json({ error: "Sesión no válida o expirada." });
  next();
}

module.exports = { authMiddleware };
