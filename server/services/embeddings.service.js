// Carga el índice semántico (chat/embeddings.meta.json + chat/embeddings.bin,
// generados por scripts/build-memory-index.js) y expone búsqueda semántica
// sobre los mensajes del chat. Si no hay índice u OPENAI_API_KEY, la búsqueda
// semántica simplemente no devuelve resultados — el resto de la app sigue
// funcionando solo con búsqueda léxica (ver memory.service.js).

const fs = require("fs");
const { config } = require("../config");
const { withTimeout } = require("../utils/timeout");

let VECTOR_META = null;
let VECTOR_DATA = null; // Float32Array plano: vector del chunk i vive en [i*dim, (i+1)*dim)

function loadIndex() {
  try {
    if (fs.existsSync(config.INDEX_META_FILE) && fs.existsSync(config.INDEX_VECTORS_FILE)) {
      VECTOR_META = JSON.parse(fs.readFileSync(config.INDEX_META_FILE, "utf8"));
      const buf = fs.readFileSync(config.INDEX_VECTORS_FILE);
      VECTOR_DATA = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    }
  } catch (e) {
    console.error("No se pudo cargar el índice semántico:", e.message);
    VECTOR_META = null;
    VECTOR_DATA = null;
  }
}
loadIndex();

console.log(`Índice semántico: ${VECTOR_META?.chunks?.length || 0} fragmentos${VECTOR_META ? ` (${(fs.statSync(config.INDEX_VECTORS_FILE).size / 1024 / 1024).toFixed(1)} MB)` : " (sin índice)"}`);

function cosine(a, offset, dim, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < dim; i++) { const av = a[offset + i], bv = b[i]; dot += av * bv; na += av * av; nb += bv * bv; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function embed(input) {
  if (!config.OPENAI_API_KEY) return null;
  const r = await withTimeout(fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: config.EMBEDDING_MODEL, input }),
  }), config.MEMORY_TIMEOUT_MS, "OpenAI embeddings");
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return data.data?.sort((a, b) => a.index - b.index).map(x => x.embedding) || [];
}

// Devuelve [{chunk: {id,start,end}, score}] ordenado de mayor a menor score.
// chunk.start/end son índices dentro de CHAT_MEMORY (mismo orden de parseo
// que usa memory.service.js), listos para usar sin lookups adicionales.
async function semanticSearch(query, { minScore = 0.30 } = {}) {
  if (!VECTOR_META?.chunks?.length || !VECTOR_DATA || !config.OPENAI_API_KEY) return [];
  try {
    const vector = (await embed(query))?.[0];
    if (!vector) return [];
    const dim = VECTOR_META.dim;
    const matches = [];
    for (const chunk of VECTOR_META.chunks) {
      const score = cosine(VECTOR_DATA, chunk.id * dim, dim, vector);
      if (score > minScore) matches.push({ chunk, score });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches;
  } catch (err) {
    console.error("Memoria semántica:", err.message);
    return [];
  }
}

function stats() {
  return { available: !!VECTOR_META, chunks: VECTOR_META?.chunks?.length || 0 };
}

module.exports = { semanticSearch, stats };
