const crypto = require("crypto");
const { config } = require("../config");
const memoryService = require("./memory.service");
const { callGroq } = require("./groq.service");
const games = new Map();
const GAME_TTL_MS = 30 * 60 * 1000;

function pickType() { return ["date", "complete", "who", "event"][Math.floor(Math.random() * 4)]; }
function normalizeAnswer(value = "") { return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9/ -]/g, " ").replace(/\s+/g, " ").trim(); }
function cleanup() { const now = Date.now(); for (const [id, game] of games) if (now - game.createdAt > GAME_TTL_MS) games.delete(id); }

async function createChallenge() {
  const type = pickType();
  const seed = memoryService.randomMemoryWindow();
  if (!seed.length) throw new Error("No hay memoria disponible para iniciar el juego.");
  const transcript = memoryService.formatMemory(seed);
  const instructions = {
    date: "Pregunta qué día ocurrió un recuerdo. La respuesta correcta debe ser una fecha que aparezca explícitamente en la evidencia.",
    complete: "Elige una frase real y reemplaza una parte importante por ______. La respuesta debe estar en la evidencia.",
    who: "Pregunta quién dijo una frase o realizó una acción. Debe poder comprobarse en la evidencia.",
    event: "Pregunta qué ocurrió. La respuesta debe ser un hecho concreto y verificable en la evidencia."
  }[type];
  const data = await callGroq({
    model: config.GROQ_MODEL,
    max_tokens: 300,
    temperature: 0.45,
    messages: [
      { role: "system", content: `Eres el narrador de IA-REMEMBER, un juego de memoria basado en una historia real. Usa EXCLUSIVAMENTE la evidencia. Nunca inventes, combines ni alteres recuerdos. ${instructions}\n\nDevuelve SOLO JSON válido con exactamente: {"narration":"narración breve y natural","question":"pregunta","answer":"respuesta exacta","accepted":["variaciones realmente equivalentes"],"hint":"pista breve sin revelar la respuesta"}. Para fechas usa DD/MM/AAAA. narration y question NO pueden contener la respuesta.` },
      { role: "user", content: `EVIDENCIA REAL:\n${transcript}` }
    ]
  });
  let raw = data?.choices?.[0]?.message?.content?.trim() || "";
  raw = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const challenge = JSON.parse(raw);
  if (!challenge.question || !challenge.answer || typeof challenge.answer !== "string") throw new Error("El reto generado no es válido.");
  challenge.type = type;
  challenge.accepted = Array.isArray(challenge.accepted) ? challenge.accepted.filter(x => typeof x === "string") : [];
  challenge.accepted.push(challenge.answer);
  return challenge;
}
function publicChallenge(c) { return { narration: c.narration || "Vamos a ver cuánto recuerdas...", question: c.question, hint: c.hint || "", type: c.type }; }

async function start() {
  cleanup();
  const challenge = await createChallenge();
  const id = crypto.randomUUID();
  games.set(id, { createdAt: Date.now(), score: 0, round: 1, streak: 0, challenge });
  return { gameId: id, round: 1, score: 0, streak: 0, ...publicChallenge(challenge) };
}

async function answer(gameId, answer) {
  cleanup();
  const game = games.get(gameId);
  if (!game) throw Object.assign(new Error("La partida expiró. Inicia una nueva."), { status: 404 });
  const given = normalizeAnswer(answer);
  if (!given) throw Object.assign(new Error("Escribe una respuesta."), { status: 400 });
  const accepted = game.challenge.accepted.map(normalizeAnswer).filter(Boolean);
  const correct = accepted.some(x => x === given || (x.length >= 5 && given.length >= 5 && (x.includes(given) || given.includes(x))));
  const points = correct ? (game.challenge.type === "date" ? 15 : 10) : 0;
  game.score += points;
  game.streak = correct ? game.streak + 1 : 0;
  const result = { correct, correctAnswer: game.challenge.answer, explanation: correct ? "¡Correcto! Ese recuerdo coincide." : "Casi. Ese no coincide con la memoria real.", score: game.score, streak: game.streak };
  game.round += 1;
  game.challenge = await createChallenge();
  return { ...result, round: game.round, ...publicChallenge(game.challenge) };
}
module.exports = { start, answer };
