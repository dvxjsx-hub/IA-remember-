// Maneja el estado de sesiones en memoria (login por contraseña única + cookie).
// Nota heredada del proyecto original: al vivir en un Map en memoria, las
// sesiones se pierden si el proceso se reinicia (deploy, crash, etc.) y
// solo soporta MAX_USERS conectados a la vez.

const crypto = require("crypto");
const { config } = require("../config");

const MAX_USERS = 5;
const COOKIE_NAME = "ia_session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

function configuredPassword() { return config.ACCESS_PASSWORD || ""; }

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function tokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[COOKIE_NAME] || req.headers["x-session-token"] || req.query.session || "";
}

function cookieOptions() {
  return `${COOKIE_NAME}=TOKEN; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${config.NODE_ENV === "production" ? "; Secure" : ""}`;
}

function createSession() {
  if (sessions.size >= MAX_USERS) return null;
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { createdAt: Date.now(), lastSeen: Date.now() });
  return token;
}

function validSession(token) {
  if (!token || !sessions.has(token)) return false;
  const session = sessions.get(token);
  if (Date.now() - session.lastSeen > SESSION_MAX_AGE_MS) { sessions.delete(token); return false; }
  session.lastSeen = Date.now();
  return true;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) if (now - session.lastSeen > SESSION_MAX_AGE_MS) sessions.delete(token);
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", cookieOptions().replace("TOKEN", token));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${config.NODE_ENV === "production" ? "; Secure" : ""}`);
}

module.exports = {
  MAX_USERS,
  sessions,
  configuredPassword,
  tokenFromRequest,
  createSession,
  validSession,
  cleanupSessions,
  setSessionCookie,
  clearSessionCookie,
};
