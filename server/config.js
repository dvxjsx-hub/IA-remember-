// Punto único de lectura y validación de variables de entorno.
// Nadie más en el proyecto debe leer process.env directamente:
// así, si falta una var, el server avisa claro al arrancar en vez de
// fallar a medias (o silenciosamente) en medio de una petición.

require("dotenv").config();
const path = require("path");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}. Revisa tu .env (usa .env.example como referencia).`);
  return value;
}

// server/config.js vive un nivel debajo de la raíz del proyecto.
const ROOT_DIR = path.join(__dirname, "..");

const config = {
  // Servidor
  PORT: Number(process.env.PORT || 3000),
  NODE_ENV: process.env.NODE_ENV || "development",

  // Auth
  ACCESS_PASSWORD: process.env.ACCESS_PASSWORD || null, // se valida al usarse, no al arrancar (permite correr sin login en dev si hace falta)

  // Groq (obligatorio: sin esto la IA no responde nada)
  GROQ_API_KEY: process.env.GROQ_API_KEY || null,
  GROQ_MODEL: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",

  // OpenAI (opcional: solo hace falta para la búsqueda semántica de memoria;
  // sin ella, la app sigue funcionando solo con búsqueda léxica)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || "text-embedding-3-small",

  // Rutas
  PUBLIC_DIR: path.join(ROOT_DIR, "public"),
  CHAT_DIR: path.join(ROOT_DIR, "data", "chat"),
  INDEX_META_FILE: path.join(ROOT_DIR, "data", "chat", "embeddings.meta.json"),
  INDEX_VECTORS_FILE: path.join(ROOT_DIR, "data", "chat", "embeddings.bin"),

  // Límites (antes hardcodeados dispersos en server.js)
  MAX_HISTORY_MESSAGES: 12,
  MAX_MEMORY_MESSAGES: 50,
  MAX_MEMORY_CHARS: 18000,
  MAX_SYSTEM_CHARS: 24000,
  REQUEST_TIMEOUT_MS: 45000,
  MEMORY_TIMEOUT_MS: 15000,
};

function assertRuntimeConfig() {
  // Se llama una sola vez al arrancar server/index.js.
  // GROQ_API_KEY es la única realmente obligatoria: sin ella la app no
  // puede cumplir su propósito (chatear).
  if (!config.GROQ_API_KEY) {
    console.error("⚠️  Falta GROQ_API_KEY. El servidor va a arrancar pero /api/chat va a fallar en cada request.");
  }
  if (!config.ACCESS_PASSWORD) {
    console.error("⚠️  Falta ACCESS_PASSWORD. Nadie va a poder hacer login.");
  }
  if (!config.OPENAI_API_KEY) {
    console.warn("ℹ️  Falta OPENAI_API_KEY: la memoria semántica queda desactivada, solo se usará búsqueda léxica.");
  }
}

module.exports = { config, required, assertRuntimeConfig };
