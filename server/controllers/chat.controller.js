const { PERSONAS } = require("../personas");
const { config } = require("../config");
const memoryService = require("../services/memory.service");
const { callGroq } = require("../services/groq.service");

const { GROQ_API_KEY, GROQ_MODEL, MAX_HISTORY_MESSAGES, MAX_SYSTEM_CHARS } = config;

function trimSystemPrompt(text) {
  return text.length > MAX_SYSTEM_CHARS ? text.slice(0, MAX_SYSTEM_CHARS) + "\n[Contexto recortado para ahorrar tokens.]" : text;
}
function cleanRReply(text) {
  return String(text).replace(/\*/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

async function handleChat(req, res) {
  try {
    if (!GROQ_API_KEY) return res.status(502).json({ error: "Disculpa, experimenté un error de conexión." });
    const { persona, messages } = req.body;
    if (!persona || !PERSONAS[persona]) return res.status(400).json({ error: "Persona inválida." });
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "Faltan mensajes." });

    const cleanMessages = messages
      .filter(m => m && typeof m.content === "string" && m.content.trim())
      .slice(-MAX_HISTORY_MESSAGES)
      .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.trim().slice(0, 2500) }));

    const latest = [...cleanMessages].reverse().find(m => m.role === "user")?.content || "";
    const memoryMode = memoryService.detectMemoryIntent(latest);
    const memory = memoryMode
      ? await memoryService.searchMemory(memoryService.extractQuery(latest))
      : { results: [], confidence: 0, semantic: false };

    const relationship = persona === "M"
      ? "Eres mavc, una mujer. Hablas con River, tu novio y pareja."
      : "Eres river, un hombre. Hablas con mavc, tu pareja.";

    const memoryContext = memoryMode
      ? (memory.results.length
        ? `\n\nEVIDENCIA DEL CHAT REAL — ${memory.results.length} MENSAJES:\n${memoryService.formatMemory(memory.results)}\n\nReconstruye el recuerdo con esta evidencia, respetando cronología y quién dijo cada cosa.`
        : "\n\nEVIDENCIA DEL CHAT REAL: no se encontró evidencia suficiente. No inventes el recuerdo.")
      : "";

    const systemPrompt = trimSystemPrompt(`${PERSONAS[persona].systemPrompt}\n\n${relationship}\n\nREGLAS DE MEMORIA:\n- R = river, hombre. M = mavc, mujer.\n- Todas las fechas se leen DÍA/MES/AÑO (DD/MM/AAAA).\n- Las preguntas de recuerdo activan investigación aunque no digan SABES.\n- Cuando investigues, analiza hechos, fechas, quién habló y secuencia antes de responder.\n- Puedes investigar hasta 50 mensajes, pero usa solo la evidencia relevante en la respuesta.\n- No inventes recuerdos.\n- No menciones mecanismos internos.${memoryContext}`);

    const data = await callGroq({
      model: GROQ_MODEL,
      max_tokens: memoryMode ? 850 : 350,
      temperature: memoryMode ? 0.25 : 0.85,
      messages: [{ role: "system", content: systemPrompt }, ...cleanMessages],
    });

    let reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error("Respuesta vacía de Groq");
    if (persona === "R") reply = cleanRReply(reply);

    res.json({ reply, memory: { used: memoryMode, semantic: memory.semantic, matches: memory.results.length, confidence: memory.confidence } });
  } catch (err) {
    console.error("/api/chat ERROR:", err);
    res.status(err.status === 429 ? 429 : 502).json({ error: "Disculpa, experimenté un error de conexión." });
  }
}

function handleHealth(req, res) {
  const stats = memoryService.stats();
  res.json({ ok: true, memory_messages: stats.messageCount, semantic_index: stats.available, semantic_chunks: stats.chunks });
}

module.exports = { handleChat, handleHealth };
