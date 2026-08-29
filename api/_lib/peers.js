// Peer discovery for tickers outside the curated comp sets.
//
// Two rungs, tried in order. Yahoo's similar-stocks graph is co-view data —
// "people who watch X also watch" — which is excellent where an industry is
// well defined (homebuilders, footwear) and noisy where it isn't: momentum
// names attract momentum names, so a specialty insurer's list fills up with
// whatever else retail was buying that month. The industry filter keeps the
// signal and drops the noise, and whatever survives is ranked co-view first.
//
// When that leaves fewer than three real peers, Gemini picks the list the way
// an analyst would. Every suggestion is validated against a live Yahoo quote
// before it is shown — a language model's ticker knowledge goes stale the same
// way our curated lists did (SQ, GPS, PARA), and a recycled symbol would
// otherwise put the wrong company's numbers in the table.

const GEMINI_MODEL = 'gemini-3.6-flash';

// ── Rung 1: Yahoo similar-stocks, industry-verified ──────────────────────────

async function recommendationsFor(yahooFinance, symbol) {
  try {
    const r = await yahooFinance.recommendationsBySymbol(symbol, {}, { validateResult: false });
    return (r?.recommendedSymbols || [])
      .filter((x) => x?.symbol)
      .map((x) => ({ symbol: x.symbol.toUpperCase(), score: x.score ?? 0 }));
  } catch {
    return [];
  }
}

export async function similarPeers(yahooFinance, symbol, subject) {
  const seeds = await recommendationsFor(yahooFinance, symbol);
  if (!seeds.length) return [];

  // One hop out from the strongest seeds widens five candidates into ~a dozen.
  const hops = await Promise.all(
    seeds.slice(0, 3).map((s) => recommendationsFor(yahooFinance, s.symbol))
  );

  const pool = new Map();
  for (const c of [...seeds, ...hops.flat()]) {
    if (c.symbol === symbol) continue;
    const prev = pool.get(c.symbol);
    if (!prev || c.score > prev.score) pool.set(c.symbol, c);
  }

  const candidates = [...pool.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  // Verify against the real classification. Co-view similarity is not business
  // similarity; this is the step that keeps CrowdStrike out of an adtech table.
  const profiles = await Promise.all(
    candidates.map(async (c) => {
      try {
        const s = await yahooFinance.quoteSummary(c.symbol, {
          modules: ['assetProfile', 'price'],
        }, { validateResult: false });
        if (s.price?.quoteType && s.price.quoteType !== 'EQUITY') return null;
        return {
          ...c,
          industry: s.assetProfile?.industry || '',
          sector: s.assetProfile?.sector || '',
          mktCap: s.price?.marketCap || null,
        };
      } catch {
        return null;
      }
    })
  );

  const subjectCap = subject.mktCap || null;
  const sameIndustry = [];
  const sameSector = [];
  for (const p of profiles) {
    if (!p) continue;
    if (subject.industry && p.industry === subject.industry) {
      sameIndustry.push(p);
    } else if (subject.sector && p.sector === subject.sector) {
      // Sector-only matches are kept when they at least live in the same size
      // world; a 100x market-cap gap is a different business.
      const ratio = subjectCap && p.mktCap ? p.mktCap / subjectCap : 1;
      if (ratio > 0.02 && ratio < 50) sameSector.push(p);
    }
  }

  // Sector-only names are padding, never proof of coverage: "Financial
  // Services" spans banks, brokers and insurers, and five co-viewed financials
  // are not a comp set for a specialty insurer. Only three real industry
  // matches anchor a set; anything less stays thin so the caller escalates to
  // the model, which is precisely the tail it exists for.
  if (sameIndustry.length >= 3) {
    return [...sameIndustry, ...sameSector].slice(0, 8).map((p) => p.symbol);
  }
  return sameIndustry.map((p) => p.symbol);
}

// ── Rung 2: Gemini, validated against live quotes ────────────────────────────

// Warm-instance memoisation. Peer selection is stable for months, and the edge
// cache below this only holds for minutes because the response carries live
// multiples — without this a burst of cold revalidations would re-ask Gemini
// the same question.
const geminiCache = new Map();
const GEMINI_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    peers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticker: { type: 'string' },
          company: { type: 'string' },
        },
        required: ['ticker', 'company'],
      },
    },
  },
  required: ['peers'],
};

const SYSTEM_INSTRUCTION = `You select public-market comparable companies the way an equity research analyst builds a comp set.

Rules:
- Return 8 to 10 peers that share the subject's business model and industry economics — the companies an analyst would actually put in the same table.
- US-listed common stocks only. No ETFs, no indices, no private companies, no subsidiaries of the subject.
- Use the Yahoo Finance ticker format: BRK-B, not BRK.B.
- Never include the subject company itself.
- Prefer peers of broadly comparable scale, but a clear direct competitor belongs in the set regardless of size.`;

export async function geminiPeers(yahooFinance, symbol, subject) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  const hit = geminiCache.get(symbol);
  if (hit && Date.now() - hit.at < GEMINI_TTL_MS) return hit.peers;

  const capB = subject.mktCap ? `$${(subject.mktCap / 1e9).toFixed(1)}B market cap` : '';
  const prompt = [
    `Build a comp set for ${subject.name || symbol} (${symbol}).`,
    `Sector: ${subject.sector || 'unknown'}. Industry: ${subject.industry || 'unknown'}. ${capB}`,
    subject.description ? `Business: ${subject.description.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');

  let raw;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.1,
          },
        }),
      }
    );
    if (!response.ok) return [];
    const payload = await response.json();
    raw = JSON.parse(payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '');
  } catch {
    return [];
  }

  const suggested = [...new Set(
    (raw?.peers || [])
      .map((p) => String(p.ticker || '').toUpperCase().trim().replace(/\./g, '-'))
      .filter((t) => /^[A-Z][A-Z0-9-]{0,9}$/.test(t) && t !== symbol)
  )];
  if (!suggested.length) return [];

  // The model's knowledge has a cutoff and tickers get renamed and recycled.
  // Only symbols that resolve to a live, priced equity make it through.
  let verified = [];
  try {
    const quotes = await yahooFinance.quote(suggested, {}, { validateResult: false });
    const list = Array.isArray(quotes) ? quotes : [quotes];
    const alive = new Set(
      list
        .filter((q) => q?.symbol && q.regularMarketPrice != null && q.quoteType === 'EQUITY')
        .map((q) => q.symbol.toUpperCase())
    );
    verified = suggested.filter((t) => alive.has(t)).slice(0, 8);
  } catch {
    return [];
  }

  if (verified.length) geminiCache.set(symbol, { at: Date.now(), peers: verified });
  return verified;
}
