const gameService = require("../services/game.service");
async function startGame(req, res) { try { res.json(await gameService.start()); } catch (err) { console.error("/api/game/start ERROR:", err); res.status(502).json({ error: "No pude preparar un recuerdo para el juego." }); } }
async function answerGame(req, res) { try { const { gameId, answer } = req.body || {}; if (!gameId || typeof answer !== "string" || !answer.trim()) return res.status(400).json({ error: "Faltan datos del reto." }); res.json(await gameService.answer(gameId, answer.trim())); } catch (err) { console.error("/api/game/answer ERROR:", err); res.status(err.status || 502).json({ error: err.message || "No pude comprobar la respuesta." }); } }
module.exports = { startGame, answerGame };
