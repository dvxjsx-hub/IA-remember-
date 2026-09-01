const express = require("express");
const crypto = require("crypto");
const session = require("../services/session.service");
const { authMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/login", (req, res) => {
  const expected = session.configuredPassword();
  if (!expected) return res.status(500).json({ error: "Falta ACCESS_PASSWORD en las variables de entorno." });
  const password = String(req.body?.password || "");
  const a = Buffer.from(password), b = Buffer.from(expected);
  const correct = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!correct) return res.status(401).json({ error: "Contraseña incorrecta." });
  session.cleanupSessions();
  const token = session.createSession();
  if (!token) return res.status(429).json({ error: "Servidor lleno. Hay 5 personas conectadas ahora mismo." });
  session.setSessionCookie(res, token);
  res.json({ ok: true, maxUsers: session.MAX_USERS });
});

router.post("/logout", authMiddleware, (req, res) => {
  session.sessions.delete(session.tokenFromRequest(req));
  session.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/session", (req, res) => {
  session.cleanupSessions();
  res.json({ authenticated: session.validSession(session.tokenFromRequest(req)), activeUsers: session.sessions.size, maxUsers: session.MAX_USERS });
});

// Alias heredado del proyecto original — se mantiene por compatibilidad
// con el frontend actual, que puede estar llamando a cualquiera de los dos.
router.get("/access", (req, res) => {
  session.cleanupSessions();
  res.json({ authenticated: session.validSession(session.tokenFromRequest(req)), activeUsers: session.sessions.size, maxUsers: session.MAX_USERS });
});

module.exports = router;
