// The Filings & Docs Hub — one function, dispatched on `op`.
//
// The plan this implements called for separate filings/filing/docsummary/
// docchat/kpis functions, but the Hobby plan caps a deployment at twelve and
// this app has been bitten by that ceiling once already. One function costs
// one slot; edge caching still works per-op because the cache key is the full
// URL. Ops arriving in later phases 501 until they exist.
//
//   op=list  GET ?ticker=            → filings index for a company
//   op=doc   GET ?cik&accession&doc? → structured blocks + sections
//   op=summary / op=chat / op=kpis   → phases 2-3

import { lookupCik } from './_lib/sec.js';
import { listCompanyFilings, getFilingIndex, fetchFilingHtml } from './_lib/filings.js';
import { htmlToBlocks, detectSections, blocksToText } from './_lib/filingText.js';
import { storeAvailable, storeEphemeral, putJson, getJson, listKeys } from './_lib/store.js';

// Filings are immutable; this only bounds memory on a warm instance.
const docCache = new Map();
const DOC_CACHE_MAX = 6;

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini(apiKey, systemText, userText, schema, temperature = 0.2) {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: schema
        ? { responseMimeType: 'application/json', responseSchema: schema, temperature }
        : { temperature },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Gemini ${response.status}: ${detail.slice(0, 200)}`);
    err.status = response.status;
    throw err;
  }
  const payload = await response.json();
  return payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}

// Loads (or reuses) a converted document for the AI ops.
async function loadDoc(cik, accession, doc) {
  const items = await getFilingIndex(cik, accession);
  const isJunk = (n) => /index/i.test(n) || /^R\d+\.htm$/i.test(n);
  let renderable = items.filter((it) => /\.(htm|html|txt)$/i.test(it.name) && !isJunk(it.name));
  const properDocs = renderable.filter((it) => it.name !== `${accession}.txt`);
  if (properDocs.length) renderable = properDocs;
  const chosen = doc && renderable.some((it) => it.name === doc)
    ? doc
    : [...renderable].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]?.name;
  if (!chosen) throw new Error('No readable document in this filing');
  const cacheKey = `${cik}:${accession}:${chosen}`;
  let body = docCache.get(cacheKey);
  if (!body) {
    const { html, edgarUrl } = await fetchFilingHtml(cik, accession, chosen);
    const { blocks, truncated } = htmlToBlocks(html);
    body = {
      blocks,
      sections: detectSections(blocks),
      docs: renderable.map(({ name, size }) => ({ name, size })),
      doc: chosen,
      edgarUrl,
      truncated,
      aiAvailable: !!process.env.GEMINI_API_KEY,
    };
    if (docCache.size >= DOC_CACHE_MAX) docCache.delete(docCache.keys().next().value);
    docCache.set(cacheKey, body);
  }
  return body;
}

async function opList(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });
  const symbol = String(ticker).toUpperCase().trim();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return res.status(400).json({ error: 'Invalid ticker' });

  const cik = await lookupCik(symbol);
  if (!cik) {
    // Non-US filers without an EDGAR presence — a state, not an error.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({ symbol, cik: null, name: null, filings: [] });
  }

  const { name, filings } = await listCompanyFilings(cik);
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ symbol, cik, name, filings });
}

async function opDoc(req, res) {
  const { cik, accession } = req.query;
  if (!cik || !accession) return res.status(400).json({ error: 'Missing cik or accession' });
  if (!/^\d{1,10}$/.test(String(cik).replace(/\D/g, '')) || !/^[\d-]{18,20}$/.test(accession)) {
    return res.status(400).json({ error: 'Invalid cik or accession' });
  }
  const body = await loadDoc(cik, accession, req.query.doc);
  res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=2592000');
  return res.status(200).json(body);
}

// ── AI ops — the summarize.js conventions apply: user-triggered, extractive,
//    501 without a key, friendly 429 copy, cached hard where inputs are
//    immutable. Schemas vary by form family: an 8-K is an event, a 10-K a
//    report, a proxy a governance document.

const FAMILY = (form) => {
  if (/^8-K/.test(form || '')) return 'event';
  if (/^DEF|^DEFA/.test(form || '')) return 'proxy';
  return 'report';
};

const SUMMARY_SCHEMAS = {
  report: {
    type: 'object',
    properties: {
      overview: { type: 'string' },
      businessHighlights: { type: 'array', items: { type: 'string' } },
      financialHighlights: { type: 'array', items: { type: 'string' } },
      riskFactors: { type: 'array', items: { type: 'string' } },
      managementDiscussion: { type: 'array', items: { type: 'string' } },
    },
    required: ['overview', 'businessHighlights', 'financialHighlights', 'riskFactors', 'managementDiscussion'],
  },
  event: {
    type: 'object',
    properties: {
      overview: { type: 'string' },
      whatHappened: { type: 'array', items: { type: 'string' } },
      keyNumbers: { type: 'array', items: { type: 'string' } },
      statedImpact: { type: 'array', items: { type: 'string' } },
    },
    required: ['overview', 'whatHappened', 'keyNumbers', 'statedImpact'],
  },
  proxy: {
    type: 'object',
    properties: {
      overview: { type: 'string' },
      proposals: { type: 'array', items: { type: 'string' } },
      compensation: { type: 'array', items: { type: 'string' } },
      governance: { type: 'array', items: { type: 'string' } },
    },
    required: ['overview', 'proposals', 'compensation', 'governance'],
  },
};

const SUMMARY_SYSTEM = `You summarise SEC filings for an investor's own research notes.

Rules:
- Ground every statement strictly in the supplied document. Never add outside knowledge and never speculate.
- Never give investment advice, a price view, or any recommendation.
- Quote the specific figures the document gives, with units.
- Attribute forward-looking statements to management rather than asserting them as fact.
- Keep each bullet to one tight sentence.
- If a section has nothing in the document to support it, return an empty list rather than inventing content.`;

// Very large documents get an Item-priority subset instead of the whole text —
// the free tier's per-minute token ceiling is real. The response says which
// sections were read so the labeling stays honest.
const SUMMARY_CHAR_BUDGET = 550_000;

function summaryText(docBody) {
  const { blocks, sections } = docBody;
  const full = blocksToText(blocks);
  if (full.length <= SUMMARY_CHAR_BUDGET) return { text: full, sectionsUsed: null };

  const priority = ['1', '1A', '7', '2', '3', '7A'];
  const used = [];
  let text = '';
  for (const item of priority) {
    const idx = sections.findIndex((sec) => sec.item === item);
    if (idx === -1) continue;
    const next = sections[idx + 1];
    const chunk = blocksToText(blocks.slice(sections[idx].blockIndex, next ? next.blockIndex : undefined));
    if (text.length + chunk.length > SUMMARY_CHAR_BUDGET) break;
    text += `\n${chunk}`;
    used.push(item);
  }
  if (!text) return { text: full.slice(0, SUMMARY_CHAR_BUDGET), sectionsUsed: ['beginning of document'] };
  return { text, sectionsUsed: used.map((i) => `Item ${i}`) };
}

const summaryCache = new Map(); // `${cik}:${accession}:${doc}` — immutable
const SUMMARY_CACHE_MAX = 40;

async function opSummary(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'Summaries are not configured on this deployment.' });
  const { cik, accession, form } = req.query;
  if (!cik || !accession) return res.status(400).json({ error: 'Missing cik or accession' });

  const docBody = await loadDoc(cik, accession, req.query.doc);
  const cacheKey = `${cik}:${accession}:${docBody.doc}`;
  const hit = summaryCache.get(cacheKey);
  if (hit) {
    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000');
    return res.status(200).json(hit);
  }

  const family = FAMILY(form);
  const { text, sectionsUsed } = summaryText(docBody);

  let raw;
  try {
    raw = await callGemini(
      apiKey,
      SUMMARY_SYSTEM,
      `Summarise this SEC ${form || 'filing'}.\n\n<document>\n${text}\n</document>`,
      SUMMARY_SCHEMAS[family],
    );
  } catch (e) {
    if (e.status === 429) {
      return res.status(429).json({ error: 'Summary limit reached for now. Try again in a few minutes.' });
    }
    throw e;
  }

  let summary;
  try { summary = JSON.parse(raw); } catch { summary = null; }
  if (!summary) return res.status(502).json({ error: 'The summary came back malformed. Try again.' });

  const body = { summary, family, sectionsUsed, model: GEMINI_MODEL, generatedAt: new Date().toISOString() };
  if (summaryCache.size >= SUMMARY_CACHE_MAX) summaryCache.delete(summaryCache.keys().next().value);
  summaryCache.set(cacheKey, body);

  // The document never changes; neither does its summary.
  res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000');
  return res.status(200).json(body);
}

// ── op=chat — stateless; the client carries the (capped) history. ───────────

const CHAT_SYSTEM = `You answer questions about one SEC filing, for an investor's own research notes.

Rules:
- Answer ONLY from the supplied document content. If the document does not contain the answer, say so plainly — never fill gaps with outside knowledge.
- Quote the document's own figures with units, and name the section they came from when you can.
- Never give investment advice, a price view, or any recommendation.
- Be concise: a few sentences, or a short list when the question asks for several things.`;

const CHAT_CONTEXT_BUDGET = 200_000;

// When the document exceeds the context budget: keep every heading (the
// skeleton), the reader's current section, and the blocks that share the most
// terms with the question. No embeddings — long context plus cheap term
// overlap is the bet, per the plan.
function selectContext(docBody, question, currentSection) {
  const { blocks, sections } = docBody;
  const full = blocksToText(blocks);
  if (full.length <= CHAT_CONTEXT_BUDGET) return { text: full, note: null };

  const terms = [...new Set(
    (question.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) || []),
  )];
  const scored = blocks.map((b, i) => {
    const text = (b.t === 'table' ? b.rows.flat().join(' ') : b.text).toLowerCase();
    let score = 0;
    for (const term of terms) if (text.includes(term)) score++;
    return { i, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

  const keep = new Set();
  blocks.forEach((b, i) => { if (b.t === 'h') keep.add(i); });
  if (currentSection) {
    const idx = sections.findIndex((sec) => sec.item === currentSection);
    if (idx !== -1) {
      const end = sections[idx + 1]?.blockIndex ?? Math.min(blocks.length, sections[idx].blockIndex + 200);
      for (let i = sections[idx].blockIndex; i < end; i++) keep.add(i);
    }
  }
  let budget = CHAT_CONTEXT_BUDGET;
  for (const { i } of scored) {
    for (const j of [i - 1, i, i + 1]) {
      if (j < 0 || j >= blocks.length || keep.has(j)) continue;
      const len = blocks[j].t === 'table' ? blocks[j].rows.flat().join(' ').length : blocks[j].text.length;
      if (budget - len < 0) continue;
      keep.add(j);
      budget -= len;
    }
    if (budget < 2000) break;
  }
  const chosen = [...keep].sort((a, b) => a - b).map((i) => blocks[i]);
  return {
    text: blocksToText(chosen),
    note: 'Long document — answered from the sections most relevant to your question, not the full text.',
  };
}

async function opChat(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'Doc chat is not configured on this deployment.' });

  const { cik, accession, doc, question, history, currentSection } = req.body || {};
  if (!cik || !accession || !question?.trim()) {
    return res.status(400).json({ error: 'Missing cik, accession or question' });
  }

  const docBody = await loadDoc(cik, accession, doc);
  const { text, note } = selectContext(docBody, question, currentSection);

  const turns = (Array.isArray(history) ? history : [])
    .slice(-10)
    .map((t) => `${t.role === 'user' ? 'Q' : 'A'}: ${String(t.text).slice(0, 2000)}`)
    .join('\n');

  let answer;
  try {
    answer = await callGemini(
      apiKey,
      CHAT_SYSTEM,
      `<document>\n${text}\n</document>\n\n${turns ? `Earlier in this conversation:\n${turns}\n\n` : ''}Question: ${question.trim().slice(0, 2000)}`,
      null,
      0.2,
    );
  } catch (e) {
    if (e.status === 429) {
      return res.status(429).json({ error: 'Chat limit reached for now. Try again in a few minutes.' });
    }
    throw e;
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ answer: answer.trim(), contextNote: note, model: GEMINI_MODEL });
}

// ── op=kpis — operating-metric extraction into per-company time series. ─────
//
// The point: subscribers, comparable sales, memberships, units — the numbers
// that define a business but exist only inside its filings, never in
// Yahoo-style APIs. Extraction is incremental (a few filings per request,
// inside the free tier's minute budget) and each filing's result is a
// write-once artifact keyed by accession. The prompt is seeded with the metric
// names already extracted for this company, which is what makes per-filing
// results cohere into series instead of drifting ("Paid memberships" one
// quarter, "paid streaming memberships" the next).

const KPI_SCHEMA = {
  type: 'object',
  properties: {
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          unit: { type: 'string' },
          value: { type: 'number' },
          sourceQuote: { type: 'string' },
        },
        required: ['name', 'unit', 'value', 'sourceQuote'],
      },
    },
  },
  required: ['metrics'],
};

const KPI_SYSTEM = `You extract OPERATING metrics from an SEC filing for a per-company time series.

Extract only company-specific operating and non-GAAP metrics: subscribers, members, paid users, stores, comparable/same-store sales growth, units shipped, deliveries, backlog, ARPU, monthly active users, occupancy, production volumes, headcount if prominent — the numbers that describe the business's operations.

Rules:
- Do NOT extract standard GAAP lines (revenue, net income, EPS, gross margin, operating income, cash, debt, share counts) — those exist elsewhere.
- Each metric: the figure for THIS filing's period (not prior-year comparatives), as a plain number. Percent metrics: the number without the % sign, unit "%". Counts in millions: convert to the absolute number when the document is explicit, else keep the document's scale and say so in the unit.
- name: short, reusable, Title Case ("Paid Memberships", "Comparable Sales Growth"). If a list of existing names is supplied and one refers to the same concept, REUSE THAT EXACT NAME.
- sourceQuote: the sentence or table fragment the value came from, verbatim, max 200 chars.
- 12 metrics maximum; fewer is fine; none is fine (return an empty list).`;

const kpiKey = (cik, accession) => `kpi/${cik}/${accession.replace(/[^0-9]/g, '')}.json`;

async function mergedKpis(cik) {
  const keys = await listKeys(`kpi/${cik}/`);
  const artifacts = (await Promise.all(keys.map((k) => getJson(k)))).filter(Boolean);
  const series = new Map();
  for (const art of artifacts) {
    for (const m of art.metrics || []) {
      const key = m.name.toLowerCase();
      if (!series.has(key)) series.set(key, { name: m.name, unit: m.unit, points: [] });
      series.get(key).points.push({
        period: art.reportDate || art.filed,
        value: m.value,
        form: art.form,
        accession: art.accession,
        sourceQuote: m.sourceQuote,
      });
    }
  }
  const metrics = [...series.values()]
    .map((m) => ({ ...m, points: m.points.sort((a, b) => (a.period || '').localeCompare(b.period || '')) }))
    .sort((a, b) => b.points.length - a.points.length);
  return { metrics, covered: new Set(artifacts.map((a) => a.accession)) };
}

async function opKpis(req, res) {
  if (!storeAvailable()) {
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json({ available: false });
  }
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });
  const symbol = String(ticker).toUpperCase().trim();
  const cik = await lookupCik(symbol);
  if (!cik) return res.status(200).json({ available: false });

  const { filings } = await listCompanyFilings(cik);
  // Annual and quarterly reports carry the operating metrics; newest first.
  const candidates = filings.filter((f) => /^10-[KQ]$/.test(f.form));

  if (req.method === 'POST') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(501).json({ error: 'KPI extraction is not configured on this deployment.' });

    const { covered, metrics: existing } = await mergedKpis(cik);
    const todo = candidates.filter((f) => !covered.has(f.accession))
      .slice(0, Math.min(Number(req.query.count) || 3, 3));

    for (const filing of todo) {
      const docBody = await loadDoc(cik, filing.accession);
      // MD&A first: Item 7 in a 10-K, Item 2 in a 10-Q. Fall back to the
      // whole (budgeted) document when sections weren't detected.
      const mdaItem = filing.form === '10-K' ? '7' : '2';
      const idx = docBody.sections.findIndex((sec) => sec.item === mdaItem);
      let text;
      if (idx !== -1) {
        const end = docBody.sections[idx + 1]?.blockIndex;
        text = blocksToText(docBody.blocks.slice(0, docBody.sections[0]?.blockIndex ?? 0))
          + blocksToText(docBody.blocks.slice(docBody.sections[idx].blockIndex, end));
      } else {
        text = blocksToText(docBody.blocks);
      }
      text = text.slice(0, 400_000);

      const known = existing.map((m) => m.name);
      let raw;
      try {
        raw = await callGemini(
          apiKey,
          KPI_SYSTEM,
          `${known.length ? `Existing metric names for this company — reuse these exact names where they refer to the same concept:\n${known.join('\n')}\n\n` : ''}`
            + `Extract operating metrics from this ${filing.form} for the fiscal period ended ${filing.reportDate || filing.filed}.\n\n<document>\n${text}\n</document>`,
          KPI_SCHEMA,
          0.1,
        );
      } catch (e) {
        if (e.status === 429) {
          return res.status(429).json({ error: 'Extraction limit reached for now. Try again in a few minutes.' });
        }
        throw e;
      }
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      if (!parsed?.metrics) continue; // skip a malformed one, keep going

      await putJson(kpiKey(cik, filing.accession), {
        accession: filing.accession,
        form: filing.form,
        filed: filing.filed,
        reportDate: filing.reportDate,
        extractedAt: new Date().toISOString(),
        model: GEMINI_MODEL,
        metrics: parsed.metrics.slice(0, 12),
      });
      // Seed subsequent filings in this same batch with the new names too.
      for (const m of parsed.metrics) {
        if (!existing.some((x) => x.name.toLowerCase() === m.name.toLowerCase())) {
          existing.push({ name: m.name });
        }
      }
    }
    // fall through to return the merged view
  }

  const { metrics, covered } = await mergedKpis(cik);
  res.setHeader('Cache-Control', req.method === 'POST' ? 'no-store' : 's-maxage=300, stale-while-revalidate=3600');
  return res.status(200).json({
    available: true,
    ephemeral: storeEphemeral(),
    symbol,
    metrics,
    coveredFilings: covered.size,
    remaining: Math.max(0, candidates.length - covered.size),
  });
}

export default async function handler(req, res) {
  const { op } = req.query;
  try {
    if (op === 'list') return await opList(req, res);
    if (op === 'doc') return await opDoc(req, res);
    if (op === 'summary') return await opSummary(req, res);
    if (op === 'chat') return await opChat(req, res);
    if (op === 'kpis') return await opKpis(req, res);
    return res.status(400).json({ error: 'Unknown op' });
  } catch (err) {
    console.error(`docs op=${op} error:`, err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
}
