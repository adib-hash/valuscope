// CUSIP → ticker via OpenFIGI.
//
// 13F filings identify securities by CUSIP and a shouty issuer name
// ("ALLY FINL INC"). Resolving to a ticker is what lets a holdings row link
// into the rest of ValueScope. OpenFIGI is free and needs no key.
//
// This is an enhancement, never a dependency: if OpenFIGI is slow, rate-limited
// or down, rows keep their issuer names and nothing errors.

const ENDPOINT = 'https://api.openfigi.com/v3/mapping';

// Keyless allowance is 10 jobs per request and 25 requests per minute. A large
// filing is a few hundred positions, so the resolvable set is capped and the
// rest fall back to issuer names.
const JOBS_PER_REQUEST = 10;
const MAX_REQUESTS = 12;
const REQUEST_TIMEOUT_MS = 6000;

// CUSIP→ticker does not change, so this only ever grows more useful.
const cache = new Map();

// OpenFIGI returns share classes as BRK/B; Yahoo and the rest of this app use
// BRK-B.
const normalizeTicker = (t) => (t ? t.replace(/\//g, '-').toUpperCase() : null);

async function mapChunk(cusips) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cusips.map((idValue) => ({ idType: 'ID_CUSIP', idValue }))),
      signal: controller.signal,
    });
    if (!res.ok) return;

    const body = await res.json();
    body.forEach((entry, i) => {
      const matches = entry?.data || [];
      // Prefer the US listing; a CUSIP often maps to several venues.
      const best = matches.find((m) => m.exchCode === 'US') || matches[0];
      if (best?.ticker) {
        cache.set(cusips[i], { ticker: normalizeTicker(best.ticker), name: best.name || null });
      } else {
        cache.set(cusips[i], null); // resolved to nothing; don't ask again
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveCusips(cusips) {
  const unique = [...new Set(cusips.filter(Boolean))];
  const missing = unique.filter((c) => !cache.has(c));
  const chunks = [];
  for (let i = 0; i < missing.length && chunks.length < MAX_REQUESTS; i += JOBS_PER_REQUEST) {
    chunks.push(missing.slice(i, i + JOBS_PER_REQUEST));
  }

  // Sequential on purpose — the keyless limit is per minute, and a burst of
  // parallel requests is the fastest way to get throttled.
  for (const chunk of chunks) {
    try {
      await mapChunk(chunk);
    } catch {
      // Partial resolution is fine. Stop trying rather than stall the response.
      break;
    }
  }

  const out = {};
  for (const cusip of unique) {
    const hit = cache.get(cusip);
    if (hit?.ticker) out[cusip] = hit;
  }
  return out;
}
