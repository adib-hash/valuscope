// Model bake-off for the earnings call summary pipeline.
//
//   node scripts/bakeoff-summary.mjs run    [--tickers NVDA,JPM,KO] [--models ...] [--judge ...] [--out bakeoff]
//   node scripts/bakeoff-summary.mjs aggregate bakeoff/results.json   (per-model table)
//
// Runs the production two-pass pipeline (extractCall + composeSummary from
// api/_lib/callSummary.js, unchanged) once per model per call, then scores the
// outputs two ways:
//
//   - mechanically: latency, tokens, cost, schema failures, Q&A exchange
//     coverage, quote survival (quotes the model claimed were verbatim and
//     that actually are), number grounding (figures in the summary that appear
//     in the transcript), filler words and unattributed "management said".
//   - by a judge model, blind: every model's summary for one call, shuffled
//     and relabelled, alongside the transcript, scored on a fixed rubric.
//
// Models are "provider:id". Gemini needs GEMINI_API_KEY, Anthropic needs
// ANTHROPIC_API_KEY (both read from .env if present). Models whose provider
// has no key, or that the provider does not list, are skipped with a warning.
//
// Transcripts come from the same dataset the app uses. Pass --cache DIR to
// save them as JSON, and to read them from there on later runs (which also
// makes the bake-off runnable where huggingface.co is not reachable).

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { getTranscript } from '../api/_lib/transcripts.js';
import { segmentTranscript, extractCall, composeSummary, wordCount } from '../api/_lib/callSummary.js';
import { GEMINI_MODEL } from '../api/_lib/gemini.js';

try {
  for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }

// ── Defaults ────────────────────────────────────────────────────────────────

// A spread of sectors, call lengths and Q&A styles.
const DEFAULT_TICKERS = ['NVDA', 'JPM', 'KO', 'TSLA', 'DELL'];

// The production model first. The other Gemini ids are the obvious tiers
// around it; any the API does not list are skipped.
const DEFAULT_MODELS = [
  `gemini:${GEMINI_MODEL}`,
  'gemini:gemini-3.6-flash-lite',
  'gemini:gemini-3.6-pro',
  'anthropic:claude-haiku-4-5',
  'anthropic:claude-sonnet-5-5',
];

const DEFAULT_JUDGE = 'anthropic:claude-opus-5-5';

// $ per million tokens, [input, output]. Gemini prices move and are not
// hard-coded: pass --prices '{"gemini-3.6-flash":[0.3,2.5]}' to cost them.
const PRICES = {
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};

// ── Providers ───────────────────────────────────────────────────────────────
//
// Each returns { json, usage: { in, out } } for (system, user, schema, temperature).

async function geminiCall(model, system, user, schema, temperature) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const payload = await res.json();
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  const u = payload.usageMetadata || {};
  return {
    json: JSON.parse(raw),
    usage: { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
  };
}

// Structured outputs want every object closed.
const closeSchema = (s) => {
  if (!s || typeof s !== 'object') return s;
  const out = { ...s };
  if (out.type === 'object') {
    out.additionalProperties = false;
    out.properties = Object.fromEntries(Object.entries(out.properties || {}).map(([k, v]) => [k, closeSchema(v)]));
  }
  if (out.items) out.items = closeSchema(out.items);
  return out;
};

let anthropic = null;
async function anthropicCall(model, system, user, schema) {
  anthropic ??= new Anthropic();
  // Current models reject a non-default temperature, so the pipeline's
  // temperature is not forwarded. Streaming because extractions are long.
  const stream = anthropic.messages.stream({
    model,
    max_tokens: 64000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: closeSchema(schema) } },
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error(`refused (${msg.stop_details?.category ?? 'no category'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error('hit max_tokens');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { json: JSON.parse(text), usage: { in: msg.usage.input_tokens, out: msg.usage.output_tokens } };
}

export const PROVIDERS = {
  gemini: { key: 'GEMINI_API_KEY', call: geminiCall },
  anthropic: { key: 'ANTHROPIC_API_KEY', call: (m, s, u, sch) => anthropicCall(m, s, u, sch) },
};

async function listModels(provider) {
  try {
    if (provider === 'gemini') {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      });
      if (!r.ok) return null;
      return new Set((await r.json()).models.map((m) => m.name.replace(/^models\//, '')));
    }
    anthropic ??= new Anthropic();
    const ids = new Set();
    for await (const m of anthropic.models.list()) ids.add(m.id);
    return ids;
  } catch {
    return null; // unknown: try the model anyway
  }
}

// Wraps a model as the `gemini(system, user, schema, temperature)` function
// the pipeline takes, recording every call.
function tracked(spec) {
  const [provider, model] = spec.split(':');
  const log = [];
  const fn = async (system, user, schema, temperature) => {
    const t = Date.now();
    const { json, usage } = await PROVIDERS[provider].call(model, system, user, schema, temperature);
    // Counted before the pipeline drops unverifiable quotes.
    log.push({
      ms: Date.now() - t, ...usage,
      rawQuotes: json.quotes?.length ?? json.notableQuotes?.length ?? 0,
    });
    return json;
  };
  return { fn, log, provider, model };
}

// ── Transcripts ─────────────────────────────────────────────────────────────

async function loadTranscript(cache, symbol, year = null, quarter = null) {
  if (cache) {
    const files = fs.existsSync(cache) ? fs.readdirSync(cache).filter((f) => f.startsWith(`${symbol}-`)).sort().reverse() : [];
    const want = year ? `${symbol}-${year}-Q${quarter}.json` : files[0];
    if (want && files.includes(want)) return JSON.parse(fs.readFileSync(path.join(cache, want), 'utf8'));
  }
  const t = await getTranscript(symbol, year, quarter);
  if (cache && t?.paragraphs?.length) {
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, `${symbol}-${t.year}-Q${t.quarter}.json`), JSON.stringify(t));
  }
  return t;
}

// ── Mechanical scoring ──────────────────────────────────────────────────────

const FILLER = /\b(robust|exciting|unprecedented|tremendous|incredible)\b/gi;
const UNATTRIBUTED = /\bmanagement (said|noted|expects|stated|highlighted)\b/gi;

// Every figure in the summary (outside verbatim quotes), and whether its
// digits appear anywhere in the transcript. Catches invented numbers; does
// not catch a real number attached to the wrong metric.
function numberGrounding(summary, transcriptText) {
  const { notableQuotes, ...rest } = summary;
  const text = JSON.stringify(rest);
  const haystack = transcriptText.replace(/,/g, '');
  const nums = [...new Set((text.match(/\d[\d,]*\.?\d*/g) || [])
    .map((n) => n.replace(/,/g, '').replace(/\.$/, ''))
    .filter((n) => n.length >= 2 && !/^(19|20)\d\d$/.test(n)))];
  const grounded = nums.filter((n) => haystack.includes(n));
  return { total: nums.length, grounded: grounded.length, ungrounded: nums.filter((n) => !grounded.includes(n)).slice(0, 12) };
}

function score(transcript, extraction, summary, log) {
  const text = transcript.paragraphs.map((p) => `${p.speaker}: ${p.content}`).join('\n');
  const seg = segmentTranscript(transcript.paragraphs);
  const extractCalls = log.slice(0, -1);
  const composeCall = log.at(-1);
  const rawExtractQuotes = extractCalls.reduce((a, c) => a + c.rawQuotes, 0);
  const flat = JSON.stringify(summary);
  return {
    msExtract: extractCalls.reduce((a, c) => a + c.ms, 0),
    msCompose: composeCall.ms,
    tokensIn: log.reduce((a, c) => a + c.in, 0),
    tokensOut: log.reduce((a, c) => a + c.out, 0),
    exchangesSegmented: seg.exchanges.length,
    exchangesExtracted: extraction.exchanges.length,
    guidanceItems: extraction.guidance.length,
    metricItems: extraction.metrics.length,
    quotesProposed: rawExtractQuotes,
    quotesVerified: extraction.quotes.length,
    summaryQuotesProposed: composeCall.rawQuotes,
    summaryQuotesVerified: summary.notableQuotes.length,
    words: wordCount(summary),
    qaItems: summary.qa?.length ?? 0,
    unansweredItems: summary.unanswered?.length ?? 0,
    filler: (flat.match(FILLER) || []).length,
    unattributed: (flat.match(UNATTRIBUTED) || []).length,
    numbers: numberGrounding(summary, text),
  };
}

// ── Judge ───────────────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You grade earnings call summaries against the transcript they were written from. You are given the transcript and several summaries of it, labelled A, B, C… in random order. Grade each summary on its own merits, on a 1–10 scale per criterion:

- accuracy: every figure, attribution and claim matches the transcript. One invented or misattributed number caps this at 5.
- coverage: the headline results, guidance changes and the risks management named are all there.
- qaSignal: the Q&A section picks the exchanges that carried information, attributes them correctly, and the "unanswered" list reflects questions that really were dodged.
- concision: tight, specific, numbers instead of adjectives, readable on a phone.
- overall: how much an analyst would trust and use this summary instead of reading the transcript.

For each summary also list up to three concrete errors (wrong or invented facts, misattributions), quoting the summary. Then rank the summaries best to worst.`;

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    grades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          accuracy: { type: 'integer' },
          coverage: { type: 'integer' },
          qaSignal: { type: 'integer' },
          concision: { type: 'integer' },
          overall: { type: 'integer' },
          errors: { type: 'array', items: { type: 'string' } },
          comment: { type: 'string' },
        },
        required: ['label', 'accuracy', 'coverage', 'qaSignal', 'concision', 'overall', 'errors', 'comment'],
      },
    },
    ranking: { type: 'array', items: { type: 'string' } },
  },
  required: ['grades', 'ranking'],
};

async function judge(spec, transcript, entries) {
  const [provider, model] = spec.split(':');
  const shuffled = entries.map((e) => ({ e, r: Math.random() })).sort((a, b) => a.r - b.r).map((x) => x.e);
  const labels = shuffled.map((_, i) => String.fromCharCode(65 + i));
  const text = transcript.paragraphs.map((p) => `${p.speaker}: ${p.content}`).join('\n\n');
  const user = `<transcript>\n${text}\n</transcript>\n\n`
    + shuffled.map((e, i) => `<summary label="${labels[i]}">\n${JSON.stringify(e.summary)}\n</summary>`).join('\n\n');
  const { json } = await PROVIDERS[provider].call(model, JUDGE_SYSTEM, user, JUDGE_SCHEMA, 0);
  const byLabel = Object.fromEntries(labels.map((l, i) => [l, shuffled[i].model]));
  return {
    grades: Object.fromEntries(json.grades.map((g) => [byLabel[g.label], g])),
    ranking: json.ranking.map((l) => byLabel[l]).filter(Boolean),
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else (o._ ??= []).push(argv[i]);
  }
  return o;
}

export async function run(opts) {
  const tickers = (opts.tickers || DEFAULT_TICKERS.join(',')).split(',').map((s) => s.trim().toUpperCase());
  let models = (opts.models || DEFAULT_MODELS.join(',')).split(',').map((s) => s.trim());
  const judgeSpec = opts.judge === 'none' ? null : (opts.judge || DEFAULT_JUDGE);
  const outDir = opts.out || 'bakeoff';
  const withPrior = !opts['no-prior'];
  Object.assign(PRICES, opts.prices ? JSON.parse(opts.prices) : {});

  const available = {};
  for (const p of new Set([...models, judgeSpec].filter(Boolean).map((m) => m.split(':')[0]))) {
    available[p] = process.env[PROVIDERS[p]?.key] ? await listModels(p) : false;
  }
  models = models.filter((m) => {
    const [p, id] = m.split(':');
    if (available[p] === false) { console.error(`skip ${m}: ${PROVIDERS[p]?.key || 'provider'} not set`); return false; }
    if (available[p] && !available[p].has(id)) { console.error(`skip ${m}: not listed by the provider`); return false; }
    return true;
  });
  if (!models.length) { console.error('No runnable models.'); process.exit(1); }

  const results = { startedAt: new Date().toISOString(), production: `gemini:${GEMINI_MODEL}`, models, judge: judgeSpec, prices: PRICES, calls: [] };
  fs.mkdirSync(outDir, { recursive: true });
  const save = () => fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));

  for (const symbol of tickers) {
    console.error(`\n${symbol}: loading transcript…`);
    const transcript = await loadTranscript(opts.cache, symbol).catch((e) => { console.error(`  ${e.message}`); return null; });
    if (!transcript?.paragraphs?.length) { console.error('  no transcript, skipping'); continue; }
    let priorTranscript = null;
    if (withPrior) {
      const i = transcript.quarters?.findIndex((q) => q.year === transcript.year && q.quarter === transcript.quarter) ?? -1;
      const prev = i >= 0 ? transcript.quarters[i + 1] : null;
      if (prev) priorTranscript = await loadTranscript(opts.cache, symbol, prev.year, prev.quarter).catch(() => null);
    }
    const call = {
      symbol, year: transcript.year, quarter: transcript.quarter, reportDate: transcript.reportDate,
      paragraphs: transcript.paragraphs.length, chars: transcript.paragraphs.reduce((a, p) => a + p.content.length, 0),
      prior: priorTranscript ? { year: priorTranscript.year, quarter: priorTranscript.quarter } : null,
      runs: {},
    };
    results.calls.push(call);

    for (const spec of models) {
      console.error(`  ${spec}…`);
      const t = tracked(spec);
      const t0 = Date.now();
      try {
        const extraction = await extractCall(t.fn, transcript);
        const n = t.log.length;
        const prior = priorTranscript ? { transcript: priorTranscript, extraction: await extractCall(t.fn, priorTranscript) } : null;
        // Prior-quarter extraction is served from the store in production, so
        // it is excluded from this call's latency and cost.
        const priorCalls = t.log.splice(n);
        const summary = await composeSummary(t.fn, transcript, extraction, prior);
        const m = score(transcript, extraction, summary, t.log);
        const [pin, pout] = PRICES[t.model] || [];
        m.cost = pin != null ? (m.tokensIn * pin + m.tokensOut * pout) / 1e6 : null;
        call.runs[spec] = { ok: true, wallMs: Date.now() - t0, priorCalls: priorCalls.length, metrics: m, summary, extraction };
        console.error(`    ${((m.msExtract + m.msCompose) / 1000).toFixed(1)}s, ${m.words} words, quotes ${m.quotesVerified}/${m.quotesProposed}, numbers ${m.numbers.grounded}/${m.numbers.total}`);
      } catch (e) {
        call.runs[spec] = { ok: false, error: String(e.message || e).slice(0, 400) };
        console.error(`    FAILED: ${e.message}`);
      }
      save();
    }

    if (judgeSpec) {
      const ok = Object.entries(call.runs).filter(([, r]) => r.ok).map(([model, r]) => ({ model, summary: r.summary }));
      if (ok.length) {
        console.error(`  judging with ${judgeSpec}…`);
        try { call.judge = await judge(judgeSpec, transcript, ok); } catch (e) { call.judgeError = String(e.message); console.error(`    judge failed: ${e.message}`); }
        save();
      }
    }
  }
  results.finishedAt = new Date().toISOString();
  save();
  console.error(`\nWrote ${path.join(outDir, 'results.json')}`);
}

// ── Aggregate + render ──────────────────────────────────────────────────────

export function aggregate(results) {
  const rows = results.models.map((model) => {
    const runs = results.calls.map((c) => c.runs[model]).filter(Boolean);
    const ok = runs.filter((r) => r.ok);
    const avg = (f) => (ok.length ? ok.reduce((a, r) => a + f(r), 0) / ok.length : null);
    const sum = (f) => ok.reduce((a, r) => a + f(r), 0);
    const grades = results.calls.map((c) => c.judge?.grades?.[model]).filter(Boolean);
    const g = (k) => (grades.length ? grades.reduce((a, x) => a + x[k], 0) / grades.length : null);
    const ranks = results.calls.map((c) => c.judge?.ranking?.indexOf(model)).filter((i) => i != null && i >= 0);
    return {
      model,
      production: model === results.production,
      runs: runs.length, failures: runs.length - ok.length,
      seconds: avg((r) => (r.metrics.msExtract + r.metrics.msCompose) / 1000),
      cost: ok.every((r) => r.metrics.cost != null) && ok.length ? avg((r) => r.metrics.cost) : null,
      words: avg((r) => r.metrics.words),
      exchangeCoverage: sum((r) => r.metrics.exchangesSegmented) ? sum((r) => Math.min(r.metrics.exchangesExtracted, r.metrics.exchangesSegmented)) / sum((r) => r.metrics.exchangesSegmented) : null,
      quoteSurvival: sum((r) => r.metrics.quotesProposed) ? sum((r) => r.metrics.quotesVerified) / sum((r) => r.metrics.quotesProposed) : null,
      numberGrounding: sum((r) => r.metrics.numbers.total) ? sum((r) => r.metrics.numbers.grounded) / sum((r) => r.metrics.numbers.total) : null,
      guidanceItems: avg((r) => r.metrics.guidanceItems),
      filler: sum((r) => r.metrics.filler),
      unattributed: sum((r) => r.metrics.unattributed),
      accuracy: g('accuracy'), coverage: g('coverage'), qaSignal: g('qaSignal'), concision: g('concision'), overall: g('overall'),
      meanRank: ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length + 1 : null,
      firsts: ranks.filter((r) => r === 0).length,
    };
  });
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = args(process.argv.slice(2));
  const cmd = opts._?.[0];
  if (cmd === 'run') await run(opts);
  else if (cmd === 'aggregate') console.log(JSON.stringify(aggregate(JSON.parse(fs.readFileSync(opts._[1], 'utf8'))), null, 2));
  else { console.error('usage: node scripts/bakeoff-summary.mjs run|aggregate …'); process.exit(1); }
}
