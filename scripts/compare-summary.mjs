// Old summary vs new, side by side, for one earnings call.
//
//   node scripts/compare-summary.mjs DELL 2027 1 > compare-DELL-Q1FY27.md
//   node scripts/compare-summary.mjs AAPL            (latest call)
//
// Runs the retired single-pass prompt and the current two-pass pipeline
// against the same transcript and prints both as Markdown, with word counts
// and timings. Needs GEMINI_API_KEY (read from .env if present) and network
// access to Gemini and the transcript dataset. Nothing is written to the
// artifact store, so the app is not affected.

import fs from 'node:fs';
import { getTranscript } from '../api/_lib/transcripts.js';
import { geminiFor } from '../api/_lib/gemini.js';
import { extractCall, composeSummary, wordCount } from '../api/_lib/callSummary.js';

// .env, without a dependency.
try {
  for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY is not set'); process.exit(1); }

const [symbolArg, yearArg, quarterArg] = process.argv.slice(2);
if (!symbolArg) { console.error('usage: node scripts/compare-summary.mjs TICKER [FISCAL_YEAR QUARTER]'); process.exit(1); }
const symbol = symbolArg.toUpperCase();
const year = yearArg ? Number(yearArg) : null;
const quarter = quarterArg ? Number(quarterArg) : null;

// ── The retired prompt, verbatim, so the comparison is honest ───────────────

const LEGACY_SYSTEM = `You summarise earnings call transcripts for an investor's own research notes.

Rules:
- Ground every statement strictly in the supplied transcript. Never add outside knowledge and never speculate.
- Never give investment advice, a price view, or any recommendation to buy, sell or hold.
- Attribute forward-looking statements to management ("management expects…") rather than asserting them as fact.
- Quote the specific figures management gave, with units.
- Keep each bullet to one tight sentence.
- keyMetrics holds the headline numbers management reported — revenue, growth rates, margins, EPS, segment figures, operating counts — each as a short label, the value with units, and the comparison management gave (year over year, versus guidance, sequential) when one was stated. At most eight, the most material first.
- If a section has nothing in the transcript to support it, return an empty list for it rather than inventing content.`;

const LEGACY_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    keyTakeaways: { type: 'array', items: { type: 'string' } },
    financialHighlights: { type: 'array', items: { type: 'string' } },
    keyMetrics: {
      type: 'array',
      items: {
        type: 'object',
        properties: { metric: { type: 'string' }, value: { type: 'string' }, comparison: { type: 'string' } },
        required: ['metric', 'value'],
      },
    },
    guidance: { type: 'array', items: { type: 'string' } },
    analystFocus: { type: 'array', items: { type: 'string' } },
    risksMentioned: { type: 'array', items: { type: 'string' } },
  },
  required: ['overview', 'keyTakeaways', 'financialHighlights', 'keyMetrics', 'guidance', 'analystFocus', 'risksMentioned'],
};

// ── Markdown rendering ──────────────────────────────────────────────────────

const who = (name, detail) => (detail ? `${name}, ${detail}` : name);
const list = (title, items) => (items?.length ? `\n### ${title}\n${items.map((i) => `- ${i}`).join('\n')}\n` : '');
const metrics = (items) => (items?.length
  ? `\n### Key metrics\n| Metric | Value | Comparison |\n|---|---|---|\n${items.map((m) => `| ${m.metric} | ${m.value} | ${m.comparison || ''} |`).join('\n')}\n`
  : '');

function renderLegacy(s) {
  return `${s.overview}\n`
    + metrics(s.keyMetrics)
    + list('Key takeaways', s.keyTakeaways)
    + list('Financial highlights', s.financialHighlights)
    + list('Guidance', s.guidance)
    + list('What analysts pressed on', s.analystFocus)
    + list('Risks', s.risksMentioned);
}

function renderNew(s) {
  const qa = s.qa?.length
    ? `\n### Q&A\n${s.qa.map((q) =>
      `- **${who(q.analyst, q.firm)}** asked about ${q.question}\n  **${who(q.responder, q.responderTitle)}:** ${q.answer}\n  *Read:* ${q.read}`).join('\n\n')}\n`
    : '';
  const un = s.unanswered?.length
    ? `\n### What management didn't answer\n${s.unanswered.map((u) => `- **${who(u.analyst, u.firm)}** on ${u.question} — ${u.how}`).join('\n')}\n`
    : '';
  const quotes = s.notableQuotes?.length
    ? `\n### Notable quotes\n${s.notableQuotes.map((q) => `> "${q.quote}" — ${who(q.speaker, q.title)}`).join('\n\n')}\n`
    : '';
  const w = s.whatChanged;
  const changed = w
    ? `\n### What changed (vs Q${w.comparedWith?.quarter} FY${w.comparedWith?.year})\n`
      + (w.guidanceRevisions?.length ? `Guidance revisions:\n${w.guidanceRevisions.map((i) => `- ${i}`).join('\n')}\n` : '')
      + (w.newMentions?.length ? `New this quarter:\n${w.newMentions.map((i) => `- ${i}`).join('\n')}\n` : '')
      + (w.droppedTopics?.length ? `Dropped from the narrative:\n${w.droppedTopics.map((i) => `- ${i}`).join('\n')}\n` : '')
      + (w.toneShift ? `Tone: ${w.toneShift}\n` : '')
    : '\n### What changed\n_(no prior call available — section omitted)_\n';
  return `${s.overview}\n`
    + metrics(s.keyMetrics)
    + list('Key takeaways', s.keyTakeaways)
    + list('Financial highlights', s.financialHighlights)
    + list('Guidance', s.guidance)
    + changed + qa + un + quotes
    + list('Risks', s.risksMentioned);
}

// ── Run ─────────────────────────────────────────────────────────────────────

const gemini = geminiFor(apiKey);
console.error(`Fetching ${symbol} transcript${year ? ` Q${quarter} FY${year}` : ' (latest)'}…`);
const transcript = await getTranscript(symbol, year, quarter);
if (!transcript?.paragraphs?.length) { console.error('No transcript found'); process.exit(1); }
console.error(`Got Q${transcript.quarter} FY${transcript.year}, ${transcript.paragraphs.length} paragraphs, ${transcript.quarters.length} quarters on file`);

const text = transcript.paragraphs.map((p) => `${p.speaker}: ${p.content}`).join('\n\n');

console.error('Old pipeline (single pass)…');
let t = Date.now();
const legacy = await gemini(
  LEGACY_SYSTEM,
  `Summarise this ${symbol} earnings call (fiscal Q${transcript.quarter} ${transcript.year}).\n\n<transcript>\n${text}\n</transcript>`,
  LEGACY_SCHEMA,
  0.2,
);
const legacyMs = Date.now() - t;

console.error('New pipeline: extraction…');
t = Date.now();
const extraction = await extractCall(gemini, transcript);
const extractMs = Date.now() - t;
console.error(`  ${extraction.segmentation.exchanges} exchanges, ${extraction.quotes.length} verified quotes, boundary ${extraction.segmentation.boundaryFound ? 'found' : 'NOT found'}`);

const i = transcript.quarters.findIndex((q) => q.year === transcript.year && q.quarter === transcript.quarter);
const prev = i >= 0 ? transcript.quarters[i + 1] : null;
let prior = null;
let priorMs = 0;
if (prev) {
  console.error(`New pipeline: prior quarter Q${prev.quarter} FY${prev.year} extraction…`);
  t = Date.now();
  const priorTranscript = await getTranscript(symbol, prev.year, prev.quarter);
  if (priorTranscript?.paragraphs?.length) {
    prior = { transcript: priorTranscript, extraction: await extractCall(gemini, priorTranscript) };
  }
  priorMs = Date.now() - t;
}

console.error('New pipeline: composition…');
t = Date.now();
const summary = await composeSummary(gemini, transcript, extraction, prior);
const composeMs = Date.now() - t;

const out = `# ${symbol} — fiscal Q${transcript.quarter} FY${transcript.year} earnings call (${transcript.reportDate || 'date unknown'})

| | Old (single pass) | New (two pass) |
|---|---|---|
| Words | ${wordCount(legacy)} | ${wordCount(summary)} |
| Time | ${(legacyMs / 1000).toFixed(1)}s | ${((extractMs + priorMs + composeMs) / 1000).toFixed(1)}s (extract ${(extractMs / 1000).toFixed(1)}s${prior ? `, prior ${(priorMs / 1000).toFixed(1)}s` : ''}, compose ${(composeMs / 1000).toFixed(1)}s) |
| Q&A exchanges found | — | ${extraction.segmentation.exchanges} |
| Verified quotes | — | ${extraction.quotes.length} extracted, ${summary.notableQuotes.length} used |
| Prior call | — | ${prior ? `Q${prior.transcript.quarter} FY${prior.transcript.year}` : 'none'} |

## Old
${renderLegacy(legacy)}

## New
${renderNew(summary)}

<details><summary>Extraction JSON (pass 1)</summary>

\`\`\`json
${JSON.stringify(extraction, null, 2)}
\`\`\`
</details>
`;
process.stdout.write(out);
