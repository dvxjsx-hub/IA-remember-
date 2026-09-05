const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const controller = require("../controllers/room.controller");
const router = express.Router();
router.post("/rooms/create", authMiddleware, controller.create);
router.post("/rooms/join", authMiddleware, controller.join);
router.get("/rooms/state", authMiddleware, controller.state);
router.post("/rooms/leave", authMiddleware, controller.leave);
module.exports = router;
