// Finished call summaries, cached in localStorage.
//
// A summary is derived from a transcript that never changes, so once this
// browser has one it never needs to ask again. The server-side store does the
// same job across browsers when a Blob store is configured; this is what
// makes a re-open instant regardless, and what saves a deployment without a
// store from paying three Gemini calls every time the same call is opened.

const PREFIX = 'vs-call-';
const MAX_ENTRIES = 40;

const key = (symbol, year, quarter) => `${PREFIX}${String(symbol).toUpperCase()}-${year}-Q${quarter}`;

export function getCallSummary(symbol, year, quarter) {
  if (!symbol || !year || !quarter) return null;
  try {
    const raw = localStorage.getItem(key(symbol, year, quarter));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // Bump recency so the eviction below keeps what is actually read.
    localStorage.setItem(key(symbol, year, quarter), JSON.stringify({ ...entry, readAt: Date.now() }));
    return entry.body;
  } catch {
    return null;
  }
}

export function saveCallSummary(body) {
  if (!body?.symbol || !body?.year || !body?.quarter || !body?.summary) return;
  try {
    localStorage.setItem(key(body.symbol, body.year, body.quarter), JSON.stringify({ body, readAt: Date.now() }));
    evict();
  } catch {
    // Storage full or unavailable — the server-side caches still apply.
  }
}

// Oldest-read first, so a phone's storage never fills with digests.
function evict() {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    let readAt = 0;
    try { readAt = JSON.parse(localStorage.getItem(k))?.readAt || 0; } catch { /* treat as oldest */ }
    entries.push({ k, readAt });
  }
  if (entries.length <= MAX_ENTRIES) return;
  entries.sort((a, b) => a.readAt - b.readAt);
  for (const e of entries.slice(0, entries.length - MAX_ENTRIES)) localStorage.removeItem(e.k);
}
