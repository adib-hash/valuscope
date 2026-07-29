// Per-ticker valuation summary, cached in localStorage.
//
// The watchlist dashboard wants each holding's valuation regime and upside at a
// glance, but recomputing that means running the full financials + deep-history
// pipeline for every ticker — far too much work for a landing view. Instead each
// dashboard writes its own summary as you visit it, and the watchlist reads
// whatever has been cached, labelled with how old it is.

const PREFIX = 'vs-summary-';

const key = (symbol) => `${PREFIX}${symbol.toUpperCase()}`;

export function saveSummary(symbol, summary) {
  if (!symbol) return;
  try {
    localStorage.setItem(key(symbol), JSON.stringify({ ...summary, updatedAt: Date.now() }));
  } catch {
    // Storage full or unavailable — the dashboard just shows an empty row.
  }
}

export function getSummary(symbol) {
  if (!symbol) return null;
  try {
    const raw = localStorage.getItem(key(symbol));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getSummaries(symbols = []) {
  const out = {};
  for (const s of symbols) out[s] = getSummary(s);
  return out;
}

// Drops summaries for tickers no longer on the watchlist.
export function pruneSummaries(keep = []) {
  const wanted = new Set(keep.map((s) => key(s)));
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && !wanted.has(k)) localStorage.removeItem(k);
    }
  } catch {
    // Non-fatal.
  }
}
