// Gemini-backed summaries of earnings calls. Two ops in one function, because
// the Hobby plan caps a deployment at twelve and this app sits on the cap.
//
//   (default)  GET  ?ticker&year&quarter → one call's summary
//   op=digest  POST {date, calls[]}      → the day read across every call
//
// Explicitly user-triggered: nothing here runs unless someone presses the
// button, both because the call costs a few seconds and because an unrequested
// AI summary is not something a valuation tool should be pushing at you.
//
// The API key stays server-side. A summary is derived from a transcript that
// never changes once published, so a given ticker/quarter is generated once,
// written to the artifact store, and served from there (and the edge cache)
// ever after. That matters most for the digest, which reads a whole day's
// calls at once: the second person to open a day pays nothing.

import { createHash } from 'node:crypto';
import { getTranscript } from './_lib/transcripts.js';
import { getJson, putJson } from './_lib/store.js';

const MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function callGemini(apiKey, systemText, userText, schema, temperature = 0.2) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Gemini ${response.status}: ${detail.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }
  const payload = await response.json();
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Gemini returned unparseable JSON');
    err.status = 502;
    throw err;
  }
}

// One place turns a Gemini failure into a response, so the two ops say the
// same thing when the free tier's rate limit bites.
function geminiFailure(res, err, what) {
  console.error(`${what}: ${err.message}`);
  if (err.status === 429) {
    return res.status(429).json({ error: 'Summary limit reached for now. Try again in a few minutes.' });
  }
  if (err.status === 502) {
    return res.status(502).json({ error: 'The summary came back malformed. Try again.' });
  }
  return res.status(502).json({ error: 'The summary service is unavailable right now.' });
}

// ── One call ────────────────────────────────────────────────────────────────

// Guardrails matter here more than usual: this is financial content, and the
// summary sits next to real valuation numbers. Keep it strictly extractive.
const SYSTEM_INSTRUCTION = `You summarise earnings call transcripts for an investor's own research notes.

Rules:
- Ground every statement strictly in the supplied transcript. Never add outside knowledge and never speculate.
- Never give investment advice, a price view, or any recommendation to buy, sell or hold.
- Attribute forward-looking statements to management ("management expects…") rather than asserting them as fact.
- Quote the specific figures management gave, with units.
- Keep each bullet to one tight sentence.
- keyMetrics holds the headline numbers management reported — revenue, growth rates, margins, EPS, segment figures, operating counts — each as a short label, the value with units, and the comparison management gave (year over year, versus guidance, sequential) when one was stated. At most eight, the most material first.
- If a section has nothing in the transcript to support it, return an empty list for it rather than inventing content.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    keyTakeaways: { type: 'array', items: { type: 'string' } },
    financialHighlights: { type: 'array', items: { type: 'string' } },
    keyMetrics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string' },
          value: { type: 'string' },
          comparison: { type: 'string' },
        },
        required: ['metric', 'value'],
      },
    },
    guidance: { type: 'array', items: { type: 'string' } },
    analystFocus: { type: 'array', items: { type: 'string' } },
    risksMentioned: { type: 'array', items: { type: 'string' } },
  },
  required: ['overview', 'keyTakeaways', 'financialHighlights', 'keyMetrics', 'guidance', 'analystFocus', 'risksMentioned'],
};

// summary/{symbol}/{year}-Q{quarter}.json — immutable inputs, so write-once.
const summaryKey = (symbol, year, quarter) => `summary/${symbol}/${year}-Q${quarter}.json`;

async function opSummary(req, res, apiKey) {
  const { ticker, year, quarter } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = String(ticker).toUpperCase().trim();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid ticker' });
  }
  const fiscalYear = year ? Number(year) : null;
  const fiscalQuarter = quarter ? Number(quarter) : null;
  if ((year && !Number.isInteger(fiscalYear)) || (quarter && !Number.isInteger(fiscalQuarter))) {
    return res.status(400).json({ error: 'Invalid year or quarter' });
  }

  // A specific quarter can be answered from the store before the transcript
  // is even fetched. "Latest" has to resolve the quarter first.
  if (fiscalYear && fiscalQuarter) {
    const stored = await getJson(summaryKey(symbol, fiscalYear, fiscalQuarter)).catch(() => null);
    if (stored?.summary) {
      res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000');
      return res.status(200).json({ ...stored, cached: true });
    }
  }

  const transcript = await getTranscript(symbol, fiscalYear, fiscalQuarter);
  if (!transcript?.paragraphs?.length) {
    return res.status(404).json({ error: `No transcript available for ${symbol}.` });
  }

  const key = summaryKey(symbol, transcript.year, transcript.quarter);
  if (!(fiscalYear && fiscalQuarter)) {
    const stored = await getJson(key).catch(() => null);
    if (stored?.summary) {
      res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000');
      return res.status(200).json({ ...stored, cached: true });
    }
  }

  const text = transcript.paragraphs
    .map((p) => `${p.speaker}: ${p.content}`)
    .join('\n\n');

  let summary;
  try {
    summary = await callGemini(
      apiKey,
      SYSTEM_INSTRUCTION,
      `Summarise this ${symbol} earnings call (fiscal Q${transcript.quarter} ${transcript.year}).\n\n`
        + `<transcript>\n${text}\n</transcript>`,
      RESPONSE_SCHEMA,
    );
  } catch (err) {
    return geminiFailure(res, err, `Summary for ${symbol}`);
  }

  const body = {
    symbol,
    year: transcript.year,
    quarter: transcript.quarter,
    reportDate: transcript.reportDate,
    summary,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
  // The store is an optimisation, never a dependency: a missing token on
  // Vercel throws here, and the summary is still returned.
  await putJson(key, body).catch((err) => console.warn(`Summary store write failed for ${key}: ${err.message}`));

  // Same transcript in, same summary out — cache hard, refresh in background.
  res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000');
  return res.status(200).json(body);
}

// ── op=digest — the day, read across every call ─────────────────────────────
//
// The per-call summaries are the digest's raw material: the client generates
// (or, mostly, fetches) each one through the op above and posts the set here.
// That keeps the heavy reading incremental and cached per call, and makes this
// step a small prompt over a few thousand words rather than a million-token
// read of thirty transcripts.

const DIGEST_SYSTEM = `You write the top of an earnings digest: one investor's morning read across every S&P 500 company that reported on a single day. You are given each company's call summary, already extracted from its transcript.

Rules:
- Use only the supplied summaries. Never add outside knowledge, never speculate about companies not listed, and never guess at share price reactions.
- Never give investment advice, a price view, or any recommendation to buy, sell or hold.
- Name companies by ticker in parentheses after the name the first time, e.g. "Apple (AAPL)".
- overview: two to four sentences on the day as a whole — how many reported, the tone of the day, what set it apart.
- themes: the threads that ran through more than one call (demand, pricing, costs, tariffs, AI spend, consumer health, and so on). Each names the companies that spoke to it and what they said, in one or two sentences. Skip a theme only one company mentioned.
- standouts: the individual calls most worth reading in full and the one-sentence reason — a large guidance change, a surprising number, an unusually pointed Q&A. At most six.
- Quote the figures the summaries give, with units. Keep it tight.`;

const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { theme: { type: 'string' }, detail: { type: 'string' } },
        required: ['theme', 'detail'],
      },
    },
    standouts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { symbol: { type: 'string' }, note: { type: 'string' } },
        required: ['symbol', 'note'],
      },
    },
  },
  required: ['overview', 'themes', 'standouts'],
};

const MAX_DIGEST_CALLS = 80;
const MAX_LIST = 12;        // bullets kept per section per call
const MAX_ITEM_CHARS = 400;

const clampList = (v) => (Array.isArray(v) ? v : [])
  .filter((s) => typeof s === 'string' && s.trim())
  .slice(0, MAX_LIST)
  .map((s) => s.trim().slice(0, MAX_ITEM_CHARS));

// The posted summaries are re-shaped into exactly the fields the prompt uses.
// Whatever else a client sends never reaches the model.
function sanitiseCall(c) {
  if (!c || typeof c !== 'object') return null;
  const symbol = String(c.symbol || '').toUpperCase().trim();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return null;
  const year = Number(c.year);
  const quarter = Number(c.quarter);
  const s = c.summary || {};
  return {
    symbol,
    name: String(c.name || symbol).slice(0, 80),
    year: Number.isInteger(year) ? year : null,
    quarter: Number.isInteger(quarter) ? quarter : null,
    overview: String(s.overview || '').slice(0, 1200),
    keyTakeaways: clampList(s.keyTakeaways),
    financialHighlights: clampList(s.financialHighlights),
    guidance: clampList(s.guidance),
    analystFocus: clampList(s.analystFocus),
    risksMentioned: clampList(s.risksMentioned),
  };
}

function renderCall(c) {
  const section = (title, items) => (items.length ? `${title}:\n${items.map((i) => `- ${i}`).join('\n')}\n` : '');
  return `## ${c.name} (${c.symbol})${c.year ? ` — fiscal Q${c.quarter} ${c.year}` : ''}\n`
    + `${c.overview}\n`
    + section('Key takeaways', c.keyTakeaways)
    + section('Financial highlights', c.financialHighlights)
    + section('Guidance', c.guidance)
    + section('Analyst Q&A', c.analystFocus)
    + section('Risks', c.risksMentioned);
}

// digest/{date}/{hash}.json — the hash is the set of calls, so a day whose
// transcripts arrive over two mornings gets a fresh read once the set grows.
const digestKey = (date, calls) => {
  const ids = calls.map((c) => `${c.symbol}:${c.year}:${c.quarter}`).sort().join(',');
  const hash = createHash('sha1').update(ids).digest('hex').slice(0, 12);
  return `digest/${date}/${hash}.json`;
};

async function opDigest(req, res, apiKey) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { date, calls } = req.body || {};
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const clean = (Array.isArray(calls) ? calls : []).map(sanitiseCall).filter(Boolean);
  if (!clean.length) return res.status(400).json({ error: 'No call summaries supplied' });
  if (clean.length > MAX_DIGEST_CALLS) {
    return res.status(400).json({ error: `At most ${MAX_DIGEST_CALLS} calls per digest` });
  }

  const key = digestKey(date, clean);
  const stored = await getJson(key).catch(() => null);
  if (stored?.digest) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ...stored, cached: true });
  }

  let digest;
  try {
    digest = await callGemini(
      apiKey,
      DIGEST_SYSTEM,
      `Write the digest for ${date}. ${clean.length} S&P 500 ${clean.length === 1 ? 'company' : 'companies'} reported.\n\n`
        + `<summaries>\n${clean.map(renderCall).join('\n')}\n</summaries>`,
      DIGEST_SCHEMA,
      0.3,
    );
  } catch (err) {
    return geminiFailure(res, err, `Digest for ${date}`);
  }

  const body = {
    date,
    calls: clean.map((c) => c.symbol),
    digest,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
  await putJson(key, body).catch((err) => console.warn(`Digest store write failed for ${key}: ${err.message}`));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(body);
}

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: 'Summaries are not configured on this deployment.' });
  }

  try {
    if (req.query.op === 'digest') return await opDigest(req, res, apiKey);
    return await opSummary(req, res, apiKey);
  } catch (err) {
    console.error('Summarize error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed to summarise: ${err.message}` });
  }
}
