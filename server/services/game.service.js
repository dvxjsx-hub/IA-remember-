const crypto = require("crypto");
const { config } = require("../config");
const memoryService = require("./memory.service");
const { callGroq } = require("./groq.service");

const games = new Map();
const GAME_TTL_MS = 30 * 60 * 1000;

function pickType() {
  const types = ["date", "complete", "who", "event"];
  return types[Math.floor(Math.random() * types.length)];
}

function normalizeAnswer(value = "") {
  return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9/ -]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanup() {
  const now = Date.now();
  for (const [id, game] of games) if (now - game.createdAt > GAME_TTL_MS) games.delete(id);
}

async function createChallenge() {
  const type = pickType();
  const seed = memoryService.randomMemoryWindow();
  if (!seed.length) throw new Error("No hay memoria disponible para iniciar el juego.");
  const transcript = memoryService.formatMemory(seed);
  const instructions = {
    date: "Pregunta qué día ocurrió el recuerdo. La respuesta correcta debe ser la fecha exacta que aparece en la evidencia.",
    complete: "Elige una frase relevante y reemplaza una parte importante por ______. La respuesta debe poder recuperarse literalmente o casi literalmente de la evidencia.",
    who: "Pregunta quién dijo una frase o quién realizó una acción. La respuesta debe poder comprobarse en la evidencia.",
    event: "Pregunta qué ocurrió en el recuerdo. La respuesta debe ser un hecho concreto verificable en la evidencia."
  }[type];
  const data = await callGroq({
    model: config.GROQ_MODEL,
    max_tokens: 300,
    temperature: 0.55,
    messages: [{ role: "system", content: `Eres el narrador de un juego llamado IA-REMEMBER. Creas retos sobre recuerdos reales. Usa exclusivamente la evidencia. ${instructions}\n\nDevuelve SOLO JSON válido: {"narration":"mensaje corto del narrador","question":"pregunta del juego","answer":"respuesta correcta","accepted":["variación 1","variación 2"],"hint":"pista breve"}. La fecha siempre es DD/MM/AAAA. No reveles la respuesta en narration ni question.` }, { role: "user", content: `EVIDENCIA:\n${transcript}` }]
  });
  let raw = data?.choices?.[0]?.message?.content?.trim() || "";
  raw = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const challenge = JSON.parse(raw);
  if (!challenge.question || !challenge.answer) throw new Error("El reto generado no es válido.");
  challenge.type = type;
  challenge.accepted = Array.isArray(challenge.accepted) ? challenge.accepted : [];
  challenge.accepted.push(challenge.answer);
  return challenge;
}

function publicChallenge(challenge) {
  return { narration: challenge.narration || "Vamos a ver cuánto recuerdas...", question: challenge.question, hint: challenge.hint || "", type: challenge.type };
}

async function start() {
  cleanup();
  const id = crypto.randomUUID();
  const challenge = await createChallenge();
  games.set(id, { createdAt: Date.now(), score: 0, round: 1, challenge });
  return { gameId: id, round: 1, score: 0, ...publicChallenge(challenge) };
}

async function answer(gameId, answer) {
  cleanup();
  const game = games.get(gameId);
  if (!game) throw Object.assign(new Error("La partida expiró. Inicia una nueva."), { status: 404 });
  const given = normalizeAnswer(answer);
  const accepted = game.challenge.accepted.map(normalizeAnswer);
  const correct = accepted.some(x => x === given || (x.length >= 5 && given.length >= 5 && (x.includes(given) || given.includes(x))));
  const correctAnswer = game.challenge.answer;
  if (correct) game.score += game.challenge.type === "date" ? 15 : 10;
  const result = { correct, correctAnswer, explanation: correct ? "¡Correcto! Ese recuerdo coincide." : "Casi. La memoria real dice otra cosa.", score: game.score };
  game.round += 1;
  game.challenge = await createChallenge();
  return { ...result, round: game.round, ...publicChallenge(game.challenge) };
}

module.exports = { start, answer };
