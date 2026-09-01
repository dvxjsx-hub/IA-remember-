const { config } = require("../config");
const { withTimeout } = require("../utils/timeout");

async function callGroq(payload) {
  const r = await withTimeout(fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.GROQ_API_KEY}` },
    body: JSON.stringify(payload),
  }), config.REQUEST_TIMEOUT_MS, "Groq");
  if (r.ok) return r.json();
  const text = (await r.text()).slice(0, 700), e = new Error(`Groq ${r.status}: ${text}`);
  e.status = r.status;
  throw e;
}

module.exports = { callGroq };
