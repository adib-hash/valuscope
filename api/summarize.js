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
//
// The summary itself is a two-pass pipeline (api/_lib/callSummary.js): a
// structured extraction of the segmented transcript, then prose written from
// that extraction — and from the prior quarter's extraction, when there is
// one, for the "what changed" section. Each pass is a Gemini call of twenty
// to forty seconds and a function has sixty, so the passes are separate
// requests, dispatched on `stage`, with the client carrying results between
// them (which also means a deployment without a Blob store works):
//
//   stage=extract  GET  ?ticker&year?&quarter?  → this call's extraction (or the
//                                                 stored summary, if one exists)
//   stage=prior    GET  ?ticker&year?&quarter?  → the quarter before it, extracted
//   stage=compose  POST {symbol, year, quarter, extraction, prior?} → the summary
//
// A GET with no stage runs the whole pipeline in one request — fine locally
// and for scripts, but it is the request that times out on Vercel, so the
// app never sends it.

import { createHash } from 'node:crypto';
import { getTranscript as loadTranscript } from './_lib/transcripts.js';
import { getJson, putJson } from './_lib/store.js';
import { GEMINI_MODEL, callGemini, geminiFor } from './_lib/gemini.js';
import { extractCall, composeSummary, wordCount } from './_lib/callSummary.js';

// Bumped when the summary's shape changes, so stored summaries of the old
// shape are regenerated rather than served with sections missing.
const SUMMARY_VERSION = 2;

// The one network dependency the tests need to replace.
export const deps = { getTranscript: loadTranscript };
const getTranscript = (...args) => deps.getTranscript(...args);

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

// summary/v2/{symbol}/{year}-Q{quarter}.json and the extraction beside it —
// immutable inputs, so write-once.
const summaryKey = (symbol, year, quarter) => `summary/v${SUMMARY_VERSION}/${symbol}/${year}-Q${quarter}.json`;
const extractKey = (symbol, year, quarter) => `extract/v${SUMMARY_VERSION}/${symbol}/${year}-Q${quarter}.json`;

// The prior quarter's extraction is wanted, not required: the function has
// sixty seconds, and reading a second transcript from scratch is the one step
// that could push past them. Past this budget the summary goes out without a
// "what changed" section rather than not at all.
const PRIOR_BUDGET_MS = 30_000;

const withBudget = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => resolve(null), ms)),
]);

// The current call's extraction: from the store when it has been read before
// (a digest re-run, or the quarter after it asking for a comparison), else a
// fresh pass that is stored for next time.
async function extractionFor(gemini, transcript) {
  const key = extractKey(transcript.symbol, transcript.year, transcript.quarter);
  const stored = await getJson(key).catch(() => null);
  if (stored?.extraction) return stored.extraction;
  const extraction = await extractCall(gemini, transcript);
  await putJson(key, {
    symbol: transcript.symbol, year: transcript.year, quarter: transcript.quarter,
    extraction, model: GEMINI_MODEL, generatedAt: new Date().toISOString(),
  }).catch((err) => console.warn(`Extraction store write failed for ${key}: ${err.message}`));
  return extraction;
}

// The quarter before this one, from the transcript's own quarter list (newest
// first), and its extraction — reading its transcript only when no stored
// extraction exists.
async function priorExtractionFor(gemini, transcript) {
  const quarters = transcript.quarters || [];
  const i = quarters.findIndex((q) => q.year === transcript.year && q.quarter === transcript.quarter);
  const prev = i >= 0 ? quarters[i + 1] : null;
  if (!prev) return null;

  const key = extractKey(transcript.symbol, prev.year, prev.quarter);
  const stored = await getJson(key).catch(() => null);
  if (stored?.extraction) {
    return { transcript: { symbol: transcript.symbol, year: prev.year, quarter: prev.quarter }, extraction: stored.extraction };
  }
  const priorTranscript = await getTranscript(transcript.symbol, prev.year, prev.quarter);
  if (!priorTranscript?.paragraphs?.length) return null;
  const extraction = await extractionFor(gemini, priorTranscript);
  return { transcript: priorTranscript, extraction };
}

const TICKER_RE = /^[A-Z.\-]{1,10}$/;

// Query validation shared by the GET stages.
function parseCallQuery(query) {
  const { ticker, year, quarter } = query;
  if (!ticker) return { error: 'Missing ticker parameter' };
  const symbol = String(ticker).toUpperCase().trim();
  if (!TICKER_RE.test(symbol)) return { error: 'Invalid ticker' };
  const fiscalYear = year ? Number(year) : null;
  const fiscalQuarter = quarter ? Number(quarter) : null;
  if ((year && !Number.isInteger(fiscalYear)) || (quarter && !Number.isInteger(fiscalQuarter))) {
    return { error: 'Invalid year or quarter' };
  }
  return { symbol, fiscalYear, fiscalQuarter, specific: Boolean(fiscalYear && fiscalQuarter) };
}

const IMMUTABLE = 's-maxage=2592000, stale-while-revalidate=2592000';

// ── stage=extract ──────────────────────────────────────────────────────────

async function stageExtract(req, res, apiKey) {
  const q = parseCallQuery(req.query);
  if (q.error) return res.status(400).json({ error: q.error });
  const { symbol, fiscalYear, fiscalQuarter, specific } = q;

  // A finished summary short-circuits the whole thing.
  if (specific) {
    const stored = await getJson(summaryKey(symbol, fiscalYear, fiscalQuarter)).catch(() => null);
    if (stored?.summary) { res.setHeader('Cache-Control', IMMUTABLE); return res.status(200).json({ ...stored, cached: true }); }
  }
  const transcript = await getTranscript(symbol, fiscalYear, fiscalQuarter);
  if (!transcript?.paragraphs?.length) {
    return res.status(404).json({ error: `No transcript available for ${symbol}.` });
  }
  if (!specific) {
    const stored = await getJson(summaryKey(symbol, transcript.year, transcript.quarter)).catch(() => null);
    if (stored?.summary) { res.setHeader('Cache-Control', IMMUTABLE); return res.status(200).json({ ...stored, cached: true }); }
  }

  let extraction;
  try {
    extraction = await extractionFor(geminiFor(apiKey), transcript);
  } catch (err) {
    return geminiFailure(res, err, `Extraction for ${symbol}`);
  }

  // Immutable once made; "latest" resolves to a different quarter over time,
  // so only a pinned quarter is cached hard.
  res.setHeader('Cache-Control', specific ? IMMUTABLE : 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({
    symbol,
    year: transcript.year,
    quarter: transcript.quarter,
    reportDate: transcript.reportDate,
    extraction,
    model: GEMINI_MODEL,
  });
}

// ── stage=prior ────────────────────────────────────────────────────────────

async function stagePrior(req, res, apiKey) {
  const q = parseCallQuery(req.query);
  if (q.error) return res.status(400).json({ error: q.error });
  const { symbol, fiscalYear, fiscalQuarter, specific } = q;

  // Only the quarter list is needed to find the prior call; the transcript
  // reader returns it with the (unused) current transcript. Cheap enough.
  const current = await getTranscript(symbol, fiscalYear, fiscalQuarter);
  if (!current?.paragraphs?.length) {
    return res.status(404).json({ error: `No transcript available for ${symbol}.` });
  }
  const quarters = current.quarters || [];
  const i = quarters.findIndex((x) => x.year === current.year && x.quarter === current.quarter);
  const prev = i >= 0 ? quarters[i + 1] : null;
  res.setHeader('Cache-Control', specific ? IMMUTABLE : 's-maxage=3600, stale-while-revalidate=86400');
  if (!prev) return res.status(200).json({ symbol, prior: null });

  const stored = await getJson(extractKey(symbol, prev.year, prev.quarter)).catch(() => null);
  if (stored?.extraction) {
    return res.status(200).json({ symbol, year: prev.year, quarter: prev.quarter, extraction: stored.extraction, cached: true });
  }
  const priorTranscript = await getTranscript(symbol, prev.year, prev.quarter);
  if (!priorTranscript?.paragraphs?.length) return res.status(200).json({ symbol, prior: null });

  let extraction;
  try {
    extraction = await extractionFor(geminiFor(apiKey), priorTranscript);
  } catch (err) {
    return geminiFailure(res, err, `Prior extraction for ${symbol}`);
  }
  return res.status(200).json({ symbol, year: prev.year, quarter: prev.quarter, extraction, model: GEMINI_MODEL });
}

// ── stage=compose ──────────────────────────────────────────────────────────

const MAX_EXTRACTION_BYTES = 400_000;

// The posted extraction is client-carried and therefore untrusted: it is
// checked for shape and size, and the only thing the model sees is its
// JSON. Quotes are re-verified against the transcript, which is re-read here
// for exactly that purpose.
function validExtraction(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  if (JSON.stringify(x).length > MAX_EXTRACTION_BYTES) return false;
  return ['speakers', 'exchanges', 'guidance', 'metrics', 'quotes', 'topics', 'newMentions']
    .every((k) => Array.isArray(x[k]));
}

async function stageCompose(req, res, apiKey) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const body = req.body || {};
  const symbol = String(body.symbol || '').toUpperCase().trim();
  const year = Number(body.year);
  const quarter = Number(body.quarter);
  if (!TICKER_RE.test(symbol) || !Number.isInteger(year) || !Number.isInteger(quarter)) {
    return res.status(400).json({ error: 'symbol, year and quarter are required' });
  }
  if (!validExtraction(body.extraction)) return res.status(400).json({ error: 'extraction is missing or malformed' });
  let prior = null;
  if (body.prior) {
    const py = Number(body.prior.year);
    const pq = Number(body.prior.quarter);
    if (!Number.isInteger(py) || !Number.isInteger(pq) || !validExtraction(body.prior.extraction)) {
      return res.status(400).json({ error: 'prior is malformed' });
    }
    prior = { transcript: { symbol, year: py, quarter: pq }, extraction: body.prior.extraction };
  }

  const key = summaryKey(symbol, year, quarter);
  const stored = await getJson(key).catch(() => null);
  if (stored?.summary) { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ ...stored, cached: true }); }

  const transcript = await getTranscript(symbol, year, quarter);
  if (!transcript?.paragraphs?.length) {
    return res.status(404).json({ error: `No transcript available for ${symbol}.` });
  }

  const started = Date.now();
  let summary;
  try {
    summary = await composeSummary(geminiFor(apiKey), transcript, body.extraction, prior);
  } catch (err) {
    return geminiFailure(res, err, `Composition for ${symbol}`);
  }
  console.log(`Summary ${symbol} Q${quarter} ${year}: ${wordCount(summary)} words, `
    + `${body.extraction.segmentation?.exchanges ?? body.extraction.exchanges.length} exchanges, `
    + `prior ${prior ? `Q${prior.transcript.quarter} ${prior.transcript.year}` : 'none'}, compose ${Date.now() - started}ms`);

  const out = finishedSummary(transcript, summary, body.extraction, prior);
  await putJson(key, out).catch((err) => console.warn(`Summary store write failed for ${key}: ${err.message}`));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(out);
}

const finishedSummary = (transcript, summary, extraction, prior) => ({
  symbol: transcript.symbol,
  year: transcript.year,
  quarter: transcript.quarter,
  reportDate: transcript.reportDate,
  summary,
  version: SUMMARY_VERSION,
  pipeline: {
    segmentation: extraction.segmentation || null,
    comparedWith: prior ? { year: prior.transcript.year, quarter: prior.transcript.quarter } : null,
  },
  model: GEMINI_MODEL,
  generatedAt: new Date().toISOString(),
});

// ── no stage: the whole pipeline in one request ─────────────────────────────
// Local dev and scripts only; see the header.

async function opSummary(req, res, apiKey) {
  const q = parseCallQuery(req.query);
  if (q.error) return res.status(400).json({ error: q.error });
  const { symbol, fiscalYear, fiscalQuarter, specific } = q;

  const served = (stored) => { res.setHeader('Cache-Control', IMMUTABLE); return res.status(200).json({ ...stored, cached: true }); };
  if (specific) {
    const stored = await getJson(summaryKey(symbol, fiscalYear, fiscalQuarter)).catch(() => null);
    if (stored?.summary) return served(stored);
  }
  const transcript = await getTranscript(symbol, fiscalYear, fiscalQuarter);
  if (!transcript?.paragraphs?.length) {
    return res.status(404).json({ error: `No transcript available for ${symbol}.` });
  }
  const key = summaryKey(symbol, transcript.year, transcript.quarter);
  if (!specific) {
    const stored = await getJson(key).catch(() => null);
    if (stored?.summary) return served(stored);
  }

  const gemini = geminiFor(apiKey);
  let summary;
  let extraction;
  let prior = null;
  try {
    [extraction, prior] = await Promise.all([
      extractionFor(gemini, transcript),
      withBudget(
        priorExtractionFor(gemini, transcript).catch((err) => {
          console.warn(`Prior quarter for ${symbol}: ${err.message}`);
          return null;
        }),
        PRIOR_BUDGET_MS,
      ),
    ]);
    summary = await composeSummary(gemini, transcript, extraction, prior);
  } catch (err) {
    return geminiFailure(res, err, `Summary for ${symbol}`);
  }

  const out = finishedSummary(transcript, summary, extraction, prior);
  await putJson(key, out).catch((err) => console.warn(`Summary store write failed for ${key}: ${err.message}`));
  res.setHeader('Cache-Control', IMMUTABLE);
  return res.status(200).json(out);
}

// ── op=digest — the day, read across every call ─────────────────────────────
//
// The per-call summaries are the digest's raw material: the client generates
// (or, mostly, fetches) each one through the op above and posts the set here.
// That keeps the heavy reading incremental and cached per call, and makes this
// step a small prompt over a few thousand words rather than a million-token
// read of thirty transcripts.

const DIGEST_SYSTEM = `You write the top of an earnings digest: one investor's morning read across every S&P 500 company that reported on a single day. You are given each company's call summary, already extracted from its transcript, including the Q&A exchanges that carried signal and the questions management did not answer.

Rules:
- Use only the supplied summaries. Never add outside knowledge, never speculate about companies not listed, and never guess at share price reactions.
- Never give investment advice, a price view, or any recommendation to buy, sell or hold.
- Name companies by ticker in parentheses after the name the first time, e.g. "Apple (AAPL)". Name executives by name and title when citing what they said.
- overview: two to four sentences on the day as a whole — how many reported, the tone of the day, what set it apart.
- themes: the threads that ran through more than one call (demand, pricing, costs, tariffs, AI spend, consumer health, and so on). Each names the companies that spoke to it and what they said, in one or two sentences. Skip a theme only one company mentioned.
- standouts: the individual calls most worth reading in full and the one-sentence reason — a large guidance change, a surprising number, an unusually pointed Q&A, a question management declined to answer. At most six.
- Quote the figures the summaries give, with units. No filler adjectives. Keep it tight.`;

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

const str = (v, max = MAX_ITEM_CHARS) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const clampList = (v) => (Array.isArray(v) ? v : [])
  .filter((s) => typeof s === 'string' && s.trim())
  .slice(0, MAX_LIST)
  .map((s) => str(s));

const clampObjects = (v, shape, max = 8) => (Array.isArray(v) ? v : [])
  .slice(0, max)
  .map((o) => (o && typeof o === 'object'
    ? Object.fromEntries(shape.map((k) => [k, str(o[k])]))
    : null))
  .filter((o) => o && Object.values(o).some(Boolean));

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
    overview: str(s.overview, 1200),
    keyTakeaways: clampList(s.keyTakeaways),
    financialHighlights: clampList(s.financialHighlights),
    guidance: clampList(s.guidance),
    qa: clampObjects(s.qa, ['analyst', 'firm', 'question', 'responder', 'responderTitle', 'answer', 'read'], 6),
    unanswered: clampObjects(s.unanswered, ['analyst', 'firm', 'question', 'how'], 4),
    notableQuotes: clampObjects(s.notableQuotes, ['speaker', 'title', 'quote'], 5),
    risksMentioned: clampList(s.risksMentioned),
  };
}

function renderCall(c) {
  const section = (title, items) => (items.length ? `${title}:\n${items.map((i) => `- ${i}`).join('\n')}\n` : '');
  const who = (name, firmOrTitle) => (firmOrTitle ? `${name}, ${firmOrTitle}` : name);
  return `## ${c.name} (${c.symbol})${c.year ? ` — fiscal Q${c.quarter} ${c.year}` : ''}\n`
    + `${c.overview}\n`
    + section('Key takeaways', c.keyTakeaways)
    + section('Financial highlights', c.financialHighlights)
    + section('Guidance', c.guidance)
    + section('Q&A', c.qa.map((q) =>
      `${who(q.analyst, q.firm)} asked: ${q.question} — ${who(q.responder, q.responderTitle)}: ${q.answer} [${q.read}]`))
    + section('Not answered', c.unanswered.map((u) => `${who(u.analyst, u.firm)}: ${u.question} — ${u.how}`))
    + section('Quotes', c.notableQuotes.map((q) => `"${q.quote}" — ${who(q.speaker, q.title)}`))
    + section('Risks', c.risksMentioned);
}

// digest/{date}/{hash}.json — the hash is the set of calls, so a day whose
// transcripts arrive over two mornings gets a fresh read once the set grows.
const digestKey = (date, calls) => {
  const ids = calls.map((c) => `${c.symbol}:${c.year}:${c.quarter}`).sort().join(',');
  const hash = createHash('sha1').update(ids).digest('hex').slice(0, 12);
  return `digest/v${SUMMARY_VERSION}/${date}/${hash}.json`;
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
    model: GEMINI_MODEL,
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
    const stage = req.query.stage;
    if (stage === 'extract') return await stageExtract(req, res, apiKey);
    if (stage === 'prior') return await stagePrior(req, res, apiKey);
    if (stage === 'compose') return await stageCompose(req, res, apiKey);
    if (stage) return res.status(400).json({ error: `Unknown stage: ${stage}` });
    return await opSummary(req, res, apiKey);
  } catch (err) {
    console.error('Summarize error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed to summarise: ${err.message}` });
  }
}
