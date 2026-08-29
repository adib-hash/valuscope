// Gemini-backed valuation brief.
//
// GET, keyed by ticker alone, so the edge cache is honest — a client-posted
// payload could neither be cached nor trusted. All inputs are assembled
// server-side from the app's own endpoints (see _lib/briefInputs.js) with
// every comparative figure precomputed: the model restates numbers, it never
// derives them. Explicitly user-triggered, like every AI feature here.

import { assembleBriefInputs } from './_lib/briefInputs.js';

const MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// One generation per ticker per UTC day per warm instance; the map is capped
// because serverless memory is shared across tickers, not infinite.
const briefCache = new Map();
const CACHE_MAX = 100;

const SYSTEM_INSTRUCTION = `You write a one-page valuation brief for an investor's own research notes, from a supplied JSON of precomputed figures about one company.

Rules:
- Use ONLY numbers present in the input JSON. Never compute new figures, never estimate, and never add outside knowledge about this company, its products, or its market.
- Every comparative claim is already computed for you (premiums, upside, percentiles, CAGRs). Restate them; do not do arithmetic.
- Never give investment advice, a recommendation, a price target, or any prediction of where the price will go.
- "Expensive" and "cheap" only ever mean relative to this company's OWN history, as shown by the supplied percentiles and averages — never an absolute verdict and never versus other companies.
- Attribute every forward-looking figure to analysts ("analysts estimate…", "consensus expects…"). They are estimates, not facts.
- Implied prices are mechanical mean-reversion arithmetic — what the price would be if a multiple returned to its historical average — not forecasts. Say so when citing them.
- Bull and bear cases must each be grounded in specific supplied figures; they describe what the numbers permit, not what will happen.
- If a field is null or absent, omit that topic entirely rather than guessing.
- Quote figures with their units (x, %, $). Keep every bullet to one tight sentence.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    payingToday:    { type: 'string' },
    vsHistory:      { type: 'string' },
    trajectory:     { type: 'string' },
    whatMustBeTrue: { type: 'array', items: { type: 'string' } },
    bullCase:       { type: 'array', items: { type: 'string' } },
    bearCase:       { type: 'array', items: { type: 'string' } },
    caveats:        { type: 'string' },
  },
  required: ['payingToday', 'vsHistory', 'trajectory', 'whatMustBeTrue', 'bullCase', 'bearCase', 'caveats'],
};

const validBrief = (b) =>
  b && typeof b.payingToday === 'string' && typeof b.vsHistory === 'string'
  && typeof b.trajectory === 'string' && typeof b.caveats === 'string'
  && [b.whatMustBeTrue, b.bullCase, b.bearCase].every(
    (a) => Array.isArray(a) && a.every((x) => typeof x === 'string'),
  );

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: 'Briefs are not configured on this deployment.' });
  }

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });
  const symbol = String(ticker).toUpperCase().trim();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid ticker' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${symbol}:${today}`;
  const hit = briefCache.get(cacheKey);
  if (hit) {
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
    return res.status(200).json(hit);
  }

  try {
    // Self-fetch through the deployment's own host so dev and prod both read
    // the endpoints (and caches) the page itself uses.
    const host = req.headers?.host;
    const proto = req.headers?.['x-forwarded-proto'] || 'https';
    const base = host ? `${proto}://${host}` : 'http://localhost:5173';

    const inputs = await assembleBriefInputs(base, symbol);
    if (!inputs) {
      return res.status(404).json({ error: `Not enough data to brief ${symbol}.` });
    }

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{
          role: 'user',
          parts: [{
            text: `Write the valuation brief for ${inputs.company.name} (${symbol}).\n\n<data>\n${JSON.stringify(inputs)}\n</data>`,
          }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`Gemini ${response.status} for ${symbol} brief: ${detail.slice(0, 300)}`);
      if (response.status === 429) {
        return res.status(429).json({ error: 'Brief limit reached for now. Try again in a few minutes.' });
      }
      return res.status(502).json({ error: 'The brief service is unavailable right now.' });
    }

    const payload = await response.json();
    const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    let brief;
    try {
      brief = JSON.parse(raw);
    } catch {
      brief = null;
    }
    if (!validBrief(brief)) {
      console.error(`Gemini returned malformed brief for ${symbol}`);
      return res.status(502).json({ error: 'The brief came back malformed. Try again.' });
    }

    const body = {
      symbol,
      brief,
      inputsAsOf: { date: today, price: inputs.company.price },
      model: MODEL,
      generatedAt: new Date().toISOString(),
    };

    if (briefCache.size >= CACHE_MAX) {
      briefCache.delete(briefCache.keys().next().value);
    }
    briefCache.set(cacheKey, body);

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
    return res.status(200).json(body);
  } catch (err) {
    console.error('Brief error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed to build brief: ${err.message}` });
  }
}
