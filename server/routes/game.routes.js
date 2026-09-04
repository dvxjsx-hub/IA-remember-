const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const gameController = require("../controllers/game.controller");
const router = express.Router();
router.post("/game/start", authMiddleware, gameController.startGame);
router.post("/game/answer", authMiddleware, gameController.answerGame);
module.exports = router;
