const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const chatController = require("../controllers/chat.controller");

const router = express.Router();

router.post("/chat", authMiddleware, chatController.handleChat);
router.get("/health", chatController.handleHealth);

module.exports = router;
