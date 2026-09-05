const crypto = require("crypto");
const { config } = require("../config");
const memoryService = require("./memory.service");
const { callGroq } = require("./groq.service");

const games = new Map();
const GAME_TTL_MS = 30 * 60 * 1000;
const QUESTION_TYPES = ["date", "complete", "event"];

function pickType() { return QUESTION_TYPES[Math.floor(Math.random() * QUESTION_TYPES.length)]; }
function normalizeAnswer(value = "") { return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9/ -]/g, " ").replace(/\s+/g, " ").trim(); }
function cleanup() { const now = Date.now(); for (const [id, game] of games) if (now - game.createdAt > GAME_TTL_MS) games.delete(id); }
function scoreAnswer(challenge, answer) { const given = normalizeAnswer(answer); const accepted = challenge.accepted.map(normalizeAnswer).filter(Boolean); return accepted.some(x => x === given || (x.length >= 5 && given.length >= 5 && (x.includes(given) || given.includes(x)))); }
function fallbackChallenge(type, seed) {
  const item = seed[Math.floor(Math.random() * seed.length)];
  if (type === "date") return { type, narration: "Vamos con un recuerdo concreto. 📅", question: "¿Qué día aparece asociado a este recuerdo?", answer: item.date, accepted: [item.date], hint: "Mira la fecha del recuerdo." };
  if (type === "complete") {
    const words = item.content.split(/\s+/).filter(Boolean);
    if (words.length >= 6) { const start = Math.max(0, Math.floor(words.length / 3)); const count = Math.min(4, words.length - start); const answer = words.slice(start, start + count).join(" "); const masked = [...words]; masked.splice(start, count, "______"); return { type, narration: "A ver si recuerdas exactamente esta frase. 🧩", question: `Completa el recuerdo: “${masked.join(" ")}"`, answer, accepted: [answer], hint: "La frase está en la memoria real." }; }
  }
  return { type: "event", narration: "Vamos a comprobar si recuerdas lo que ocurrió. 🧠", question: `¿Qué ocurrió en este recuerdo? “${item.content.slice(0, 120)}${item.content.length > 120 ? "…" : ""}”`, answer: item.content, accepted: [item.content], hint: "Describe el hecho principal." };
}
async function aiChallenge(type, seed) {
  const transcript = memoryService.formatMemory(seed);
  const instructions = { date: "Pregunta qué día ocurrió un recuerdo. La respuesta debe aparecer explícitamente en la evidencia.", complete: "Elige una frase real y reemplaza una parte importante por ______. La respuesta debe aparecer literalmente en la evidencia.", event: "Pregunta qué ocurrió. La respuesta debe ser un hecho concreto verificable en la evidencia." }[type];
  const data = await callGroq({ model: config.GROQ_MODEL, max_tokens: 350, temperature: 0.45, messages: [
    { role: "system", content: `Eres el narrador de IA-REMEMBER, un juego de memoria basado en una historia real. Usa EXCLUSIVAMENTE la evidencia. Nunca inventes, combines ni alteres recuerdos. ${instructions}\n\nDevuelve SOLO JSON válido: {"narration":"narración breve y natural","question":"pregunta","answer":"respuesta exacta","accepted":["variaciones realmente equivalentes"],"hint":"pista breve sin revelar la respuesta"}. narration y question NO pueden contener la respuesta.` },
    { role: "user", content: `EVIDENCIA REAL:\n${transcript}` }
  ] });
  let raw = data?.choices?.[0]?.message?.content?.trim() || "";
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const challenge = JSON.parse(raw);
  if (!challenge.question || !challenge.answer || typeof challenge.answer !== "string") throw new Error("El reto generado no es válido.");
  challenge.type = type; challenge.accepted = Array.isArray(challenge.accepted) ? challenge.accepted.filter(x => typeof x === "string") : []; challenge.accepted.push(challenge.answer); return challenge;
}
async function createChallenge() { const type = pickType(); const seed = memoryService.randomMemoryWindow(10); if (!seed.length) throw new Error("No hay memoria disponible para iniciar el juego."); try { return await aiChallenge(type, seed); } catch (err) { console.error("Generación IA del reto:", err.message); return fallbackChallenge(type, seed); } }
function publicChallenge(c) { return { narration: c.narration || "Vamos a ver cuánto recuerdas...", question: c.question, hint: c.hint || "", type: c.type }; }
async function start() { cleanup(); const challenge = await createChallenge(); const id = crypto.randomUUID(); games.set(id, { createdAt: Date.now(), score: 0, round: 1, streak: 0, challenge }); return { gameId: id, round: 1, score: 0, streak: 0, ...publicChallenge(challenge) }; }
async function answer(gameId, answer) { cleanup(); const game = games.get(gameId); if (!game) throw Object.assign(new Error("La partida expiró. Inicia una nueva."), { status: 404 }); const given = normalizeAnswer(answer); if (!given) throw Object.assign(new Error("Escribe una respuesta."), { status: 400 }); const correct = scoreAnswer(game.challenge, answer); const points = correct ? (game.challenge.type === "date" ? 15 : 10) : 0; game.score += points; game.streak = correct ? game.streak + 1 : 0; const result = { correct, correctAnswer: game.challenge.answer, explanation: correct ? "¡Correcto! Ese recuerdo coincide." : "Casi. Ese no coincide con la memoria real.", score: game.score, streak: game.streak }; game.round += 1; game.challenge = await createChallenge(); return { ...result, round: game.round, ...publicChallenge(game.challenge) }; }
module.exports = { start, answer, createChallenge, publicChallenge, normalizeAnswer, scoreAnswer };
