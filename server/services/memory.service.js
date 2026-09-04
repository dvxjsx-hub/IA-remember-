const fs = require("fs");
const path = require("path");
const { config } = require("../config");
const embeddingsService = require("./embeddings.service");

const STOPWORDS = new Set("a al algo aqui asi aun aunque con como cual cuando de del desde donde dos el ella ellas ellos en era es esa esas ese estos esta estas este estos fue ha hay hasta la las lo los me mi mis muy ni no nos o para pero por que quien se si sin sobre su sus te un una uno unos y ya yo recuerda recuerdas acuerdas acuerdo vez dia historia historial chat hablamos hablar habiamos habían habían".split(" "));
const MEMORY_TRIGGERS = /\b(sabes|recuerdas|recuerdo|acuerdas|acuerdo|te acuerdas|te recuerdo|cuando hablamos|cuando fue|que paso|qué pasó|que ocurrió|qué ocurrió|hablamos de|habíamos hablado|habian hablado|habían hablado|mencionamos|dijimos|dijo|contamos|historia|historial|chat|aquella vez|ese dia|ese día|aquel dia|aquel día|lo que paso|lo que pasó)\b/i;
const { MAX_MEMORY_MESSAGES, MAX_MEMORY_CHARS } = config;

function normalize(value = "") { return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñü/]+/gi, " ").replace(/\s+/g, " ").trim(); }
function tokens(value) { return normalize(value).split(" ").filter(t => t.length >= 2 && !STOPWORDS.has(t)); }
function stem(t) { return t.length > 5 ? t.replace(/(mente|ando|iendo|ados|adas|idos|idas|es|os|as|s)$/i, "") : t; }

function loadChatMemory() {
  if (!fs.existsSync(config.CHAT_DIR)) return [];
  const files = fs.readdirSync(config.CHAT_DIR).filter(n => /^Anniversary.*\.txt$/i.test(n)).sort();
  const messages = [];
  for (const file of files) for (const line of fs.readFileSync(path.join(config.CHAT_DIR, file), "utf8").split(/\r?\n/)) {
    const m = line.match(/^(.*?)-\s*(R|M):\s*(.*)$/i); if (!m || !m[3].trim()) continue;
    const speaker = m[2].toUpperCase();
    messages.push({ raw: line, date: m[1].trim(), speaker, persona: speaker === "R" ? "river" : "mavc", content: m[3].trim(), normalized: normalize(m[3]), tokens: tokens(m[3]).map(stem) });
  }
  return messages;
}
const CHAT_MEMORY = loadChatMemory();
console.log(`Memoria: ${CHAT_MEMORY.length} mensajes cargados`);

function extractQuery(text) { return text.replace(/\bsabes\b/gi, " ").replace(/\s+/g, " ").trim(); }
function detectMemoryIntent(text) { return MEMORY_TRIGGERS.test(text); }
function dateTerms(query) { const q = normalize(query), out = []; for (const m of q.matchAll(/\b(\d{1,2})\s*[/ -]\s*(\d{1,2})\s*[/ -]\s*(\d{2,4})\b/g)) out.push({ day: m[1].padStart(2, "0"), month: m[2].padStart(2, "0"), year: m[3].length === 2 ? `20${m[3]}` : m[3] }); return out; }
function lexicalScore(item, query) { const q = normalize(query), terms = tokens(query).map(stem), set = new Set(item.tokens); let score = 0, hits = 0; if (q.length > 5 && item.normalized.includes(q)) score += 50; for (const t of terms) { if (set.has(t)) { score += 10; hits++; } else if (item.normalized.includes(t)) { score += 5; hits++; } } if (hits >= 2) score += hits * 5; for (const d of dateTerms(query)) { const dt = normalize(item.date); if (dt.includes(`${d.day}/${d.month}/${d.year}`) || dt.includes(`${d.day}-${d.month}-${d.year}`)) score += 80; } return score; }
function truncateMemory(rows) { const out = []; let chars = 0; for (const m of rows) { if (out.length >= MAX_MEMORY_MESSAGES) break; const room = MAX_MEMORY_CHARS - chars; if (room <= 80) break; const content = m.content.length > room ? m.content.slice(0, room) + "…" : m.content; out.push({ ...m, content }); chars += content.length + 32; } return out; }
function formatMemory(rows) { return rows.map((m, i) => `${i + 1}. [${m.date}] ${m.speaker}: ${m.content}`).join("\n"); }

function randomMemoryWindow(size = 10) {
  if (!CHAT_MEMORY.length) return [];
  const maxStart = Math.max(0, CHAT_MEMORY.length - size);
  const start = Math.floor(Math.random() * (maxStart + 1));
  return CHAT_MEMORY.slice(start, start + size);
}

async function searchMemory(query) {
  const lexical = CHAT_MEMORY.map((m, i) => ({ i, score: lexicalScore(m, query) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 30);
  const semantic = await embeddingsService.semanticSearch(query);
  const candidates = new Map();
  for (const x of semantic.slice(0, 8)) for (let i = x.chunk.start; i <= x.chunk.end; i++) candidates.set(i, (candidates.get(i) || 0) + x.score * 100);
  for (const x of lexical) candidates.set(x.i, (candidates.get(x.i) || 0) + x.score);
  const ranked = [...candidates.entries()].map(([i, score]) => ({ i, score })).sort((a, b) => b.score - a.score), selected = new Set();
  for (const hit of ranked.slice(0, 10)) { const radius = hit.score >= 55 ? 4 : 2; for (let d = -radius; d <= radius; d++) { const i = hit.i + d; if (i >= 0 && i < CHAT_MEMORY.length) selected.add(i); } }
  const indexes = [...selected].sort((a, b) => a - b);
  for (const hit of ranked) { if (indexes.length >= MAX_MEMORY_MESSAGES) break; if (!selected.has(hit.i)) { indexes.push(hit.i); selected.add(hit.i); } }
  return { results: truncateMemory(indexes.slice(0, MAX_MEMORY_MESSAGES).map(i => CHAT_MEMORY[i])), confidence: Math.min(1, (ranked[0]?.score || 0) / 75), semantic: semantic.length > 0 };
}
function stats() { return { messageCount: CHAT_MEMORY.length, ...embeddingsService.stats() }; }
module.exports = { searchMemory, detectMemoryIntent, extractQuery, formatMemory, randomMemoryWindow, stats };
