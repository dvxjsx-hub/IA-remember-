const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { config } = require("../server/config");

const CHAT_DIR = config.CHAT_DIR;
const META_FILE = config.INDEX_META_FILE;
const VECTORS_FILE = config.INDEX_VECTORS_FILE;
const API_KEY = config.OPENAI_API_KEY;
const MODEL = config.EMBEDDING_MODEL;
const BATCH = 64;
const CHUNK_SIZE = 8;
const OVERLAP = 3;

function chatFiles() {
  return fs.readdirSync(CHAT_DIR).filter(n => /^Aniveersary.*\.txt$/i.test(n)).sort();
}

// Huella digital del estado actual: contenido de los .txt + modelo + parámetros
// de chunking. Si nada de esto cambió desde la última vez, no hace falta
// gastar ni un solo request de embeddings.
function computeSourceHash(files) {
  const hash = crypto.createHash("sha256");
  hash.update(MODEL + "|" + CHUNK_SIZE + "|" + OVERLAP);
  for (const file of files) hash.update(fs.readFileSync(path.join(CHAT_DIR, file)));
  return hash.digest("hex");
}

function loadMessages(files) {
  const messages = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(CHAT_DIR, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^(.*?)-\s*(R|M):\s*(.*)$/i);
      if (!match || !match[3].trim()) continue;
      const speaker = match[2].toUpperCase();
      messages.push({
        date: match[1].trim(), speaker,
        persona: speaker === "R" ? "river" : "mavc",
        content: match[3].trim()
      });
    }
  }
  return messages;
}

// Los chunks solo necesitan texto para mandarlo a embeddings; a la hora de
// GUARDAR no hace falta duplicar los mensajes (ya viven en el .txt original
// y server.js los vuelve a parsear en el mismo orden) — start/end alcanza.
function makeChunks(messages) {
  const chunks = [];
  for (let start = 0; start < messages.length; start += CHUNK_SIZE - OVERLAP) {
    const end = Math.min(messages.length, start + CHUNK_SIZE);
    const rows = messages.slice(start, end);
    if (!rows.length) break;
    const text = rows.map(m => `[${m.date}] ${m.speaker} (${m.persona}): ${m.content}`).join("\n");
    chunks.push({ id: chunks.length, start, end: end - 1, text });
    if (end === messages.length) break;
  }
  return chunks;
}

async function embed(inputs) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, input: inputs })
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.data.sort((a, b) => a.index - b.index).map(x => x.embedding);
}

(async () => {
  if (!fs.existsSync(CHAT_DIR)) {
    console.log("No existe la carpeta chat/, nada que indexar.");
    return;
  }
  const files = chatFiles();
  if (!files.length) {
    console.log("No hay archivos Aniveersary*.txt, nada que indexar.");
    return;
  }

  const sourceHash = computeSourceHash(files);

  // --- Chequeo de hash: si el índice existente ya corresponde a este
  // mismo contenido + modelo + parámetros, no gastamos ni un request. ---
  if (fs.existsSync(META_FILE) && fs.existsSync(VECTORS_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
      if (existing.source_hash === sourceHash) {
        console.log(`Índice ya está al día (hash ${sourceHash.slice(0, 12)}…). No se regenera. ${existing.chunks?.length || 0} fragmentos, ${existing.message_count || 0} mensajes.`);
        return;
      }
      console.log("El chat cambió desde el último índice (o cambiaron modelo/parámetros) — regenerando.");
    } catch (e) {
      console.warn("No se pudo leer el índice existente, se regenera desde cero:", e.message);
    }
  }

  if (!API_KEY) {
    console.error("Falta OPENAI_API_KEY. Necesitas una clave de OpenAI para generar embeddings reales.");
    console.error("La app seguirá funcionando solo con búsqueda léxica (sin memoria semántica).");
    process.exit(0); // no rompemos el build por esto: es opcional
  }

  const messages = loadMessages(files);
  const chunks = makeChunks(messages);
  console.log(`Mensajes: ${messages.length}. Fragmentos semánticos: ${chunks.length}. Modelo: ${MODEL}`);

  let dim = null;
  const vectorBuffers = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const vectors = await embed(batch.map(x => x.text));
    for (const vector of vectors) {
      if (!dim) dim = vector.length;
      vectorBuffers.push(Buffer.from(Float32Array.from(vector).buffer));
    }
    console.log(`Embeddings: ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
  }

  // Vectores en binario (Float32): 4 bytes por número en vez de ~14 bytes
  // como texto decimal en JSON. De paso, nada de JSON.parse de un archivo
  // gigante al arrancar el servidor.
  fs.writeFileSync(VECTORS_FILE, Buffer.concat(vectorBuffers));

  // Metadata chica: solo lo necesario para ubicar cada chunk dentro de
  // CHAT_MEMORY (start/end) — nada de texto ni mensajes duplicados.
  const meta = {
    version: 3,
    model: MODEL,
    dim,
    chunk_size: CHUNK_SIZE,
    overlap: OVERLAP,
    created_at: new Date().toISOString(),
    source_files: files,
    source_hash: sourceHash,
    message_count: messages.length,
    chunks: chunks.map(c => ({ id: c.id, start: c.start, end: c.end }))
  };
  fs.writeFileSync(META_FILE, JSON.stringify(meta));

  const metaSize = fs.statSync(META_FILE).size;
  const vecSize = fs.statSync(VECTORS_FILE).size;
  console.log(`Índice guardado: ${META_FILE} (${(metaSize / 1024).toFixed(0)} KB) + ${VECTORS_FILE} (${(vecSize / 1024 / 1024).toFixed(1)} MB)`);
})().catch(err => { console.error(err); process.exit(1); });
