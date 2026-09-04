const express = require("express");
const path = require("path");
const { config, assertRuntimeConfig } = require("./config");
const { tokenFromRequest, validSession } = require("./services/session.service");
const authRoutes = require("./routes/auth.routes");
const chatRoutes = require("./routes/chat.routes");
const gameRoutes = require("./routes/game.routes");

assertRuntimeConfig();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api", authRoutes);
app.use("/api", chatRoutes);
app.use("/api", gameRoutes);
app.get("/", (req, res) => {
  const page = validSession(tokenFromRequest(req)) ? "index.html" : "login.html";
  res.sendFile(path.join(config.PUBLIC_DIR, page));
});
app.use(express.static(config.PUBLIC_DIR, { index: false }));
app.listen(config.PORT, () => console.log(`Servidor corriendo en el puerto ${config.PORT}`));
