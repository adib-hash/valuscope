// LLM bake-off for ValuScope's two AI features: earnings-call Key Takeaways
// (api/summarize.js) and the AI comp picker (api/_lib/peers.js).
//
// Every contestant gets the app's exact system prompt and response schema.
// Inputs come from the app's own data code (transcripts.js, Yahoo profiles),
// so what the models see is what production sends. Two blinded judges from
// different vendors then score each feature.
//
//   node scripts/bakeoff/llm-bakeoff.mjs inputs   # cache transcripts + Yahoo profiles
//   node scripts/bakeoff/llm-bakeoff.mjs gen      # call every model (resumable)
//   node scripts/bakeoff/llm-bakeoff.mjs check    # deterministic checks (figures, live tickers)
//   node scripts/bakeoff/llm-bakeoff.mjs judge    # blinded LLM judging (resumable)
//   node scripts/bakeoff/bakeoff-report.mjs       # build LLM-BAKEOFF-REPORT.html
//
// Keys: ANTHROPIC_API_KEY from ValuScope's .env (the main checkout's, since
// worktrees don't carry it), GEMINI_API_KEY from Kitab's .env.local.
// ValuScope's own Gemini key is free tier (no Gemini Pro, low rate limits) and
// is what production summaries run on, so a bake-off must not spend it.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import YahooFinance from 'yahoo-finance2'
import { listQuarters, getTranscript } from '../../api/_lib/transcripts.js'
import { extractCall, composeSummary, wordCount, SUMMARY_SYSTEM as V2_SYSTEM } from '../../api/_lib/callSummary.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const projects = path.join(here, '..', '..', '..')
function readEnv(file, names) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    const v = m?.[2].trim().replace(/^["']|["']$/g, '')
    if (m && v && names.includes(m[1]) && !process.env[`BAKEOFF_${m[1]}`]) process.env[`BAKEOFF_${m[1]}`] = v
  }
}
readEnv(path.join(projects, 'valuscope', '.env'), ['ANTHROPIC_API_KEY', 'ANTHROPIC_WORKSPACE_ID'])
readEnv(path.join(projects, 'kitab', '.env.local'), ['GEMINI_API_KEY'])

export const INPUTS = path.join(here, 'inputs.json')
export const RUNS = path.join(here, 'runs.json')
export const JUDGE = path.join(here, 'judge.json')
export const LADDER = path.join(here, 'ladder.json') // from ladder.mjs

// USD per 1M tokens, standard tier, prompts under 200k. Checked 2026-10-11.
// Gemini Flash prices double on Jan 1, 2027. Haiku 5.5 is $0.50/$2.50 above 100k-token prompts.
export const CONFIGS = [
  { id: 'g36f', label: 'Gemini 3.6 Flash', note: 'Production today, default thinking', provider: 'gemini', model: 'gemini-3.6-flash', price: [0.75, 3.75], current: true },
  { id: 'g38f', label: 'Gemini 3.8 Flash', note: 'Newest Flash, low thinking', provider: 'gemini', model: 'gemini-3.8-flash', thinking: 'low', price: [0.75, 3.75] },
  { id: 'g35fl', label: 'Gemini 3.5 Flash-Lite', note: 'Cheap Gemini, minimal thinking', provider: 'gemini', model: 'gemini-3.5-flash-lite', thinking: 'minimal', price: [0.3, 2.5] },
  { id: 'g31p', label: 'Gemini 3.1 Pro', note: 'Preview, low thinking, no free tier', provider: 'gemini', model: 'gemini-3.1-pro-preview', thinking: 'low', price: [2.0, 12.0] },
  { id: 'haiku', label: 'Claude Haiku 5.5', note: 'Low effort', provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low', price: [0.1, 0.5] },
  { id: 'sonnet', label: 'Claude Sonnet 5.5', note: 'Low effort', provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low', price: [2.0, 10.0] },
  { id: 'opus', label: 'Claude Opus 5.5', note: 'Low effort', provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', price: [4.0, 20.0] },
  { id: 'fable', label: 'Claude Fable 5.1', note: 'Low effort', provider: 'anthropic', model: 'claude-fable-5-1', effort: 'low', price: [10.0, 50.0] },
]

// Claude via the Claude Code subscription instead of the API (the API key ran
// out of credit on Oct 11, 2026). Each pass is answered by a subagent on that
// model, through prompt/response files: the harness writes the exact system
// prompt, input and schema, and reads the JSON back into the real pipeline.
// No latency or cost is measurable this way, and effort is Claude Code's default.
export const SUB_CONFIGS = [
  { id: 'haiku-s', label: 'Claude Haiku 4.5', note: 'Subscription subagent (Haiku 5.5 isn\'t offered there)', provider: 'subagent', agentModel: 'haiku' },
  { id: 'sonnet-s', label: 'Claude Sonnet 5.5', note: 'Subscription subagent', provider: 'subagent', agentModel: 'sonnet' },
  { id: 'opus-s', label: 'Claude Opus 5.5', note: 'Subscription subagent', provider: 'subagent', agentModel: 'opus' },
  { id: 'fable-s', label: 'Claude Fable 5.1', note: 'Subscription subagent', provider: 'subagent', agentModel: 'fable' },
]

export const PROD = { id: 'prod', label: 'Production today', note: 'Curated set, Yahoo similar-stocks, or similar + Gemini 3.6 Flash', provider: 'none' }

// Six calls across very different businesses and transcript styles.
export const CALLS = [
  { symbol: 'AAPL', why: 'Mega-cap, heavily scripted call' },
  { symbol: 'JPM', why: 'Bank: NII, credit, capital ratios' },
  { symbol: 'LLY', why: 'Pharma: pipeline readouts, guidance raise' },
  { symbol: 'CMG', why: 'Restaurant: comps, traffic, unit growth' },
  { symbol: 'KNSL', why: 'Specialty insurer: combined ratio, small-cap' },
  { symbol: 'DE', why: 'Cyclical industrial: segment guidance' },
]

// The comp picker only runs where curated sets and Yahoo co-view data run out,
// so the test set is mostly that tail. CMG and CRWD have curated sets, which
// give a hand-built reference to measure overlap against.
export const COMP_TICKERS = [
  { symbol: 'KNSL', why: 'Specialty E&S insurer' },
  { symbol: 'AXON', why: 'Public-safety tech, no clean peer group' },
  { symbol: 'DUOL', why: 'Consumer edtech app' },
  { symbol: 'CELH', why: 'Energy drinks' },
  { symbol: 'HIMS', why: 'DTC telehealth' },
  { symbol: 'TOST', why: 'Restaurant software + payments' },
  { symbol: 'FICO', why: 'Credit scores + decision software' },
  { symbol: 'CAVA', why: 'Fast-casual restaurant' },
  { symbol: 'RKLB', why: 'Launch + space systems' },
  { symbol: 'ELF', why: 'Mass cosmetics' },
  { symbol: 'CMG', why: 'Has a curated set (reference)' },
  { symbol: 'CRWD', why: 'Has a curated set (reference)' },
]

// ---- Copied verbatim from api/summarize.js (keep in sync) ----
export const SUMMARY_SYSTEM = `You summarise earnings call transcripts for an investor's own research notes.

Rules:
- Ground every statement strictly in the supplied transcript. Never add outside knowledge and never speculate.
- Never give investment advice, a price view, or any recommendation to buy, sell or hold.
- Attribute forward-looking statements to management ("management expects…") rather than asserting them as fact.
- Quote the specific figures management gave, with units.
- Keep each bullet to one tight sentence.
- If a section has nothing in the transcript to support it, return an empty list for it rather than inventing content.`

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    keyTakeaways: { type: 'array', items: { type: 'string' } },
    financialHighlights: { type: 'array', items: { type: 'string' } },
    guidance: { type: 'array', items: { type: 'string' } },
    analystFocus: { type: 'array', items: { type: 'string' } },
    risksMentioned: { type: 'array', items: { type: 'string' } },
  },
  required: ['overview', 'keyTakeaways', 'financialHighlights', 'guidance', 'analystFocus', 'risksMentioned'],
}

export function summaryUserText(symbol, t) {
  const text = t.paragraphs.map((p) => `${p.speaker}: ${p.content}`).join('\n\n')
  return `Summarise this ${symbol} earnings call (fiscal Q${t.quarter} ${t.year}).\n\n<transcript>\n${text}\n</transcript>`
}
// ---- end copy ----

// ---- Copied verbatim from api/_lib/peers.js (keep in sync) ----
export const PEERS_SYSTEM = `You select public-market comparable companies the way an equity research analyst builds a comp set.

Rules:
- Return 8 to 10 peers that share the subject's business model and industry economics — the companies an analyst would actually put in the same table.
- US-listed common stocks only. No ETFs, no indices, no private companies, no subsidiaries of the subject.
- Use the Yahoo Finance ticker format: BRK-B, not BRK.B.
- Never include the subject company itself.
- Prefer peers of broadly comparable scale, but a clear direct competitor belongs in the set regardless of size.`

export const PEERS_SCHEMA = {
  type: 'object',
  properties: {
    peers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ticker: { type: 'string' }, company: { type: 'string' } },
        required: ['ticker', 'company'],
      },
    },
  },
  required: ['peers'],
}

export function peersUserText(symbol, subject) {
  const capB = subject.mktCap ? `$${(subject.mktCap / 1e9).toFixed(1)}B market cap` : ''
  return [
    `Build a comp set for ${subject.name || symbol} (${symbol}).`,
    `Sector: ${subject.sector || 'unknown'}. Industry: ${subject.industry || 'unknown'}. ${capB}`,
    subject.description ? `Business: ${subject.description.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n')
}
// ---- end copy ----

export const readJSON = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback)
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] })

// Claude's structured outputs need closed objects; Gemini's responseSchema rejects the keyword.
function closeSchema(s) {
  if (s?.type === 'object') {
    return { ...s, additionalProperties: false, properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, closeSchema(v)])) }
  }
  if (s?.type === 'array') return { ...s, items: closeSchema(s.items) }
  return s
}

// ---------------- model calls ----------------
async function callGemini(cfg, system, user, schema, { temperature }) {
  const generationConfig = { temperature, ...(cfg.thinking ? { thinkingConfig: { thinkingLevel: cfg.thinking } } : {}) }
  if (schema) Object.assign(generationConfig, { responseMimeType: 'application/json', responseSchema: schema })
  const t0 = performance.now()
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.BAKEOFF_GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig,
    }),
    signal: AbortSignal.timeout(300000),
  })
  const data = await resp.json()
  const ms = performance.now() - t0
  if (!resp.ok) {
    const e = new Error(`${resp.status} ${data.error?.message || 'Gemini error'}`.slice(0, 300))
    e.status = resp.status
    throw e
  }
  const parts = data.candidates?.[0]?.content?.parts || []
  const u = data.usageMetadata || {}
  return {
    text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(''),
    ms,
    inTok: u.promptTokenCount || 0,
    outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    thinkTok: u.thoughtsTokenCount || 0,
    finish: data.candidates?.[0]?.finishReason,
  }
}

async function callAnthropic(cfg, system, user, schema) {
  const body = {
    model: cfg.model,
    max_tokens: 32000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: cfg.effort, ...(schema ? { format: { type: 'json_schema', schema: closeSchema(schema) } } : {}) },
  }
  const t0 = performance.now()
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.BAKEOFF_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // A user-level key (sk-ant-usr-…) isn't tied to a workspace and must name one.
      ...(process.env.BAKEOFF_ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.BAKEOFF_ANTHROPIC_WORKSPACE_ID } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  })
  const data = await resp.json()
  const ms = performance.now() - t0
  if (!resp.ok) {
    const e = new Error(`${resp.status} ${data.error?.message || 'Anthropic error'}`.slice(0, 300))
    e.status = resp.status
    throw e
  }
  if (data.stop_reason === 'refusal') throw new Error('refusal')
  return {
    text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
    ms,
    inTok: data.usage?.input_tokens || 0,
    outTok: data.usage?.output_tokens || 0,
    thinkTok: data.usage?.output_tokens_details?.thinking_tokens ?? null,
    finish: data.stop_reason,
  }
}

export async function callModel(cfg, system, user, schema, { temperature = 0.2 } = {}) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = cfg.provider === 'gemini'
        ? await callGemini(cfg, system, user, schema, { temperature })
        : await callAnthropic(cfg, system, user, schema)
      return { ...r, attempts: attempt + 1 }
    } catch (e) {
      lastErr = e
      if (e.status && e.status < 500 && e.status !== 429) break
      await sleep(5000 * (attempt + 1))
    }
  }
  throw Object.assign(lastErr, { attempts: 3 })
}

// ---------------- phase: inputs ----------------
async function profile(symbol) {
  const s = await yahooFinance.quoteSummary(symbol, { modules: ['price', 'assetProfile'] }, { validateResult: false })
  return {
    name: s.price?.longName || s.price?.shortName || symbol,
    sector: s.assetProfile?.sector || '',
    industry: s.assetProfile?.industry || '',
    description: s.assetProfile?.longBusinessSummary || '',
    mktCap: s.price?.marketCap || null,
  }
}

async function inputs() {
  const out = readJSON(INPUTS, { calls: {}, comps: {} })
  for (const c of CALLS) {
    if (out.calls[c.symbol]) continue
    const q = (await listQuarters(c.symbol))[0]
    const t = await getTranscript(c.symbol, q.year, q.quarter)
    out.calls[c.symbol] = { year: t.year, quarter: t.quarter, reportDate: t.reportDate, paragraphs: t.paragraphs }
    console.log(`${c.symbol} FY${t.year} Q${t.quarter}  ${t.paragraphs.length} paragraphs`)
    writeJSON(INPUTS, out)
  }
  // The quarter before, picked the way summarize.js picks it, for "what changed".
  out.priors ||= {}
  for (const c of CALLS) {
    if (out.priors[c.symbol]) continue
    const cur = out.calls[c.symbol]
    const quarters = await listQuarters(c.symbol)
    const i = quarters.findIndex((q) => q.year === cur.year && q.quarter === cur.quarter)
    const prev = quarters[i + 1]
    const t = await getTranscript(c.symbol, prev.year, prev.quarter)
    out.priors[c.symbol] = { year: t.year, quarter: t.quarter, reportDate: t.reportDate, paragraphs: t.paragraphs }
    console.log(`${c.symbol} prior FY${t.year} Q${t.quarter}`)
    writeJSON(INPUTS, out)
  }
  for (const c of COMP_TICKERS) {
    if (out.comps[c.symbol]) continue
    out.comps[c.symbol] = await profile(c.symbol)
    console.log(`${c.symbol}  ${out.comps[c.symbol].industry}`)
    writeJSON(INPUTS, out)
  }
}

// ---------------- phase: gen ----------------
function jobs() {
  const inp = readJSON(INPUTS, null)
  const list = []
  for (const c of CALLS) {
    const t = inp.calls[c.symbol]
    list.push({ task: 'sum', item: c.symbol, system: SUMMARY_SYSTEM, user: summaryUserText(c.symbol, t), schema: SUMMARY_SCHEMA, temperature: 0.2 })
  }
  for (const c of COMP_TICKERS) {
    list.push({ task: 'comp', item: c.symbol, system: PEERS_SYSTEM, user: peersUserText(c.symbol, inp.comps[c.symbol]), schema: PEERS_SCHEMA, temperature: 0.1 })
  }
  return list
}

async function gen() {
  const runs = readJSON(RUNS, {})
  const only = process.argv[3]?.split(',')
  const cfgs = CONFIGS.filter((c) => !only || only.includes(c.id))
  const all = jobs()
  // One worker per model, calls in sequence, so latency isn't skewed by self-contention.
  await Promise.all(cfgs.map(async (cfg) => {
    for (const j of all) {
      const key = `${cfg.id}|${j.task}|${j.item}`
      if (runs[key]?.text) continue
      try {
        const r = await callModel(cfg, j.system, j.user, j.schema, { temperature: j.temperature })
        runs[key] = { cfg: cfg.id, task: j.task, item: j.item, ...r, at: new Date().toISOString() }
        console.log(`${key}  ${(r.ms / 1000).toFixed(1)}s  in ${r.inTok} out ${r.outTok}`)
      } catch (e) {
        runs[key] = { cfg: cfg.id, task: j.task, item: j.item, error: e.message, attempts: e.attempts, at: new Date().toISOString() }
        console.log(`${key}  ERROR ${e.message}`)
      }
      writeJSON(RUNS, runs)
    }
  }))
}


// ---------------- phase: gen2 (the current two-pass summary pipeline) ----------------
// Runs api/_lib/callSummary.js itself: segment, extract this quarter, extract
// the prior quarter, compose with "what changed". Only the model call is
// swapped. Each pass is timed separately because production runs each stage
// as its own Vercel request under a 60-second cap.
export const STAGE_CAP_S = 300
// Round 2 (sum2) ran the pipeline as of Oct 11 under a 60s cap; round 3
// (sum3) runs it after the segmentation and "what changed" fixes.
export const PIPE_TASK = process.env.BAKEOFF_TASK || 'sum3'

function modelAdapter(cfg, log) {
  return async (system, user, schema, temperature) => {
    const r = await callModel(cfg, system, user, schema, { temperature })
    const parsed = parseJSON(r.text)
    log.push({ ms: r.ms, inTok: r.inTok, outTok: r.outTok, thinkTok: r.thinkTok, finish: r.finish, ok: !!parsed })
    if (!parsed) throw Object.assign(new Error(`unparseable JSON (finish ${r.finish})`), { status: 502 })
    return parsed
  }
}

export const SUB_DIR = path.join(here, 'sub')
class Pending extends Error {}

// Answers a pipeline call from a subagent's response file, or writes the
// prompt file for one and stops this ticker until it exists.
function fileAdapter(cfg, symbol, stage) {
  return async (system, user, schema) => {
    const base = path.join(SUB_DIR, cfg.id, `${symbol}-${stage}`)
    if (fs.existsSync(base + '.json')) {
      const parsed = parseJSON(fs.readFileSync(base + '.json', 'utf8'))
      if (!parsed) throw Object.assign(new Error(`unparseable JSON in ${base}.json`), { status: 502 })
      return parsed
    }
    fs.mkdirSync(path.dirname(base), { recursive: true })
    fs.writeFileSync(base + '.txt', [
      '=== SYSTEM PROMPT ===', system, '',
      '=== USER MESSAGE ===', user, '',
      '=== RESPONSE JSON SCHEMA ===', JSON.stringify(schema, null, 1), '',
    ].join('\n'))
    throw new Pending(base + '.txt')
  }
}

async function gen2() {
  const inp = readJSON(INPUTS, null)
  const runs = readJSON(RUNS, {})
  const only = process.argv[3]?.split(',')
  const cfgs = [...CONFIGS, ...SUB_CONFIGS].filter((c) => (only ? only.includes(c.id) : c.provider !== 'subagent'))
  await Promise.all(cfgs.map(async (cfg) => {
    for (const c of CALLS) {
      const key = `${cfg.id}|${PIPE_TASK}|${c.symbol}`
      if (runs[key]?.summary) continue
      const cur = { symbol: c.symbol, ...inp.calls[c.symbol] }
      const prev = { symbol: c.symbol, ...inp.priors[c.symbol] }
      const passes = {}
      try {
        // Production runs the two extractions in parallel, then composes.
        const logCur = [], logPrior = [], logCompose = []
        const sub = cfg.provider === 'subagent'
        const adapter = (log, stage) => (sub ? fileAdapter(cfg, c.symbol, stage) : modelAdapter(cfg, log))
        const settled = await Promise.allSettled([
          extractCall(adapter(logCur, 'extract'), cur),
          extractCall(adapter(logPrior, 'prior'), prev),
        ])
        const failed = settled.find((x) => x.status === 'rejected')
        if (failed) throw failed.reason
        const [extraction, priorExtraction] = settled.map((x) => x.value)
        passes.extract = logCur.at(-1); passes.prior = logPrior.at(-1)
        const summary = await composeSummary(adapter(logCompose, 'compose'), cur, extraction, { transcript: prev, extraction: priorExtraction })
        passes.compose = logCompose.at(-1)
        runs[key] = { cfg: cfg.id, task: PIPE_TASK, item: c.symbol, summary, extraction, passes, words: wordCount(summary), at: new Date().toISOString() }
        for (const k of Object.keys(passes)) if (!passes[k]) delete passes[k]
        const t = Object.entries(passes).map(([k, v]) => `${k} ${(v.ms / 1000).toFixed(0)}s`).join(' · ') || 'subagent'
        console.log(`${key}  ${t}  ${runs[key].words} words`)
      } catch (e) {
        if (e instanceof Pending) { console.log(`${key}  waiting on ${path.relative(here, e.message)}`); continue }
        runs[key] = { cfg: cfg.id, task: PIPE_TASK, item: c.symbol, error: e.message, passes, at: new Date().toISOString() }
        console.log(`${key}  ERROR ${e.message}`)
      }
      writeJSON(RUNS, runs)
    }
  }))
}

// ---------------- phase: check ----------------
// Every figure in a summary should be traceable to the transcript. Pull each
// number out, normalise it, and look for it in the transcript's own numbers.
// Rounding ("$94.9 billion" from "$94.93 billion") counts as grounded; a figure
// with no source within rounding distance is flagged for review.
const numRe = /\d[\d,]*(?:\.\d+)?/g
export function figuresIn(text) {
  return [...String(text).matchAll(numRe)].map((m) => m[0].replace(/,/g, '')).filter((n) => {
    const v = Number(n)
    // Skip bare years and list-like small integers, which are noise for this check.
    if (/^(19|20)\d\d$/.test(n)) return false
    return !(Number.isInteger(v) && v < 10 && !n.includes('.'))
  })
}
function grounded(n, sourceNums) {
  if (sourceNums.has(n)) return true
  const v = Number(n)
  const dp = (n.split('.')[1] || '').length
  for (const s of sourceNums) {
    const sv = Number(s)
    if (Math.abs(sv - v) <= 0.5 * 10 ** -dp + 1e-9) return true // rounded from a more precise figure
  }
  return false
}
// Speakers say "two and a half billion" and "half a point", which transcripts
// keep as words. Convert the common forms so they count as sources too.
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
function wordNumbers(text) {
  const out = []
  const t = String(text).toLowerCase()
  const word = `(?:${[...Object.keys(TENS), ...UNITS].join('|')})(?:[- ](?:${UNITS.slice(1, 10).join('|')}))?`
  const val = (w) => w.split(/[- ]/).reduce((a, p) => a + (TENS[p] ?? UNITS.indexOf(p)), 0)
  for (const m of t.matchAll(new RegExp(`\\b(${word}|\\d+(?:\\.\\d+)?) and (?:a|one) (half|quarter)\\b`, 'g'))) {
    const base = /\d/.test(m[1]) ? Number(m[1]) : val(m[1])
    out.push(String(base + (m[2] === 'half' ? 0.5 : 0.25)))
  }
  if (/\bhalf (?:a|of a) (?:point|percent|percentage)/.test(t)) out.push('0.5')
  if (/\b(?:a )?quarter (?:of a )?(?:point|percent|percentage)/.test(t)) out.push('0.25')
  for (const m of t.matchAll(new RegExp(`\\b(${word})\\b`, 'g'))) out.push(String(val(m[1])))
  return out
}
export function sourceNumbers(text) {
  const nums = [...String(text).matchAll(numRe)].map((m) => m[0].replace(/,/g, ''))
  return new Set([...nums, ...wordNumbers(text)])
}

export function parseJSON(text) {
  try { return JSON.parse(String(text || '').replace(/```json|```/g, '').trim()) } catch { return null }
}

async function check() {
  const inp = readJSON(INPUTS, null)
  const runs = readJSON(RUNS, {})
  const transcriptNums = {}
  for (const [sym, t] of Object.entries(inp.calls)) {
    transcriptNums[sym] = sourceNumbers(t.paragraphs.map((p) => p.content).join('\n'))
  }
  // What production shows today, as a ninth contestant for comps: the curated
  // set, the Yahoo similar-stocks rung, or (when that's thin) similar peers
  // topped up by Gemini 3.6 Flash, merged exactly as comps.js does.
  const ladder = readJSON(LADDER, {})
  for (const c of COMP_TICKERS) {
    const l = ladder[c.symbol]
    if (!l) continue
    let list = l.list || l.similar
    if (l.rung === 'ai') {
      const g = runs[`g36f|comp|${c.symbol}`]
      const ai = parseJSON(g?.text)?.peers?.map((p) => String(p.ticker).toUpperCase().trim().replace(/\./g, '-')) || []
      list = [...l.similar, ...ai.filter((t) => !l.similar.includes(t) && t !== c.symbol)]
    }
    runs[`prod|comp|${c.symbol}`] = { cfg: 'prod', task: 'comp', item: c.symbol, rung: l.rung, text: JSON.stringify({ peers: list.map((t) => ({ ticker: t, company: '' })) }), ms: 0, inTok: 0, outTok: 0 }
  }

  const tickers = new Set()
  for (const r of Object.values(runs)) {
    if (!r.text) continue
    r.parsed = parseJSON(r.text)
    if (r.task === 'sum' && r.parsed) {
      const s = r.parsed
      const all = [s.overview, ...['keyTakeaways', 'financialHighlights', 'guidance', 'analystFocus', 'risksMentioned'].flatMap((k) => s[k] || [])].join('\n')
      const figs = figuresIn(all)
      r.figures = figs.length
      r.ungrounded = figs.filter((n) => !grounded(n, transcriptNums[r.item]))
      r.words = all.split(/\s+/).filter(Boolean).length
      r.bullets = ['keyTakeaways', 'financialHighlights', 'guidance', 'analystFocus', 'risksMentioned'].reduce((a, k) => a + (s[k]?.length || 0), 0)
    }
    if (r.task === 'comp' && r.parsed) {
      r.suggested = [...new Set((r.parsed.peers || [])
        .map((p) => String(p.ticker || '').toUpperCase().trim().replace(/\./g, '-'))
        .filter((t) => /^[A-Z][A-Z0-9-]{0,9}$/.test(t) && t !== r.item))]
      r.companies = Object.fromEntries((r.parsed.peers || []).map((p) => [String(p.ticker || '').toUpperCase().trim().replace(/\./g, '-'), p.company]))
      r.suggested.forEach((t) => tickers.add(t))
    }
  }
  // Same live-quote gate as geminiPeers(), plus the industry, for a same-industry share.
  const live = {}
  const list = [...tickers]
  for (let i = 0; i < list.length; i += 40) {
    const batch = list.slice(i, i + 40)
    const quotes = await yahooFinance.quote(batch, {}, { validateResult: false }).catch(() => [])
    for (const q of [].concat(quotes)) {
      if (q?.symbol) live[q.symbol.toUpperCase()] = { ok: q.regularMarketPrice != null && q.quoteType === 'EQUITY', name: q.longName || q.shortName, quoteType: q.quoteType, mktCap: q.marketCap || null }
    }
  }
  const industry = {}
  await Promise.all(list.filter((t) => live[t]?.ok).map(async (t) => {
    try {
      const s = await yahooFinance.quoteSummary(t, { modules: ['assetProfile'] }, { validateResult: false })
      industry[t] = { industry: s.assetProfile?.industry || '', sector: s.assetProfile?.sector || '' }
    } catch { industry[t] = null }
  }))
  for (const r of Object.values(runs)) {
    if (r.task !== 'comp' || !r.suggested) continue
    const subj = inp.comps[r.item]
    r.peers = r.suggested.map((t) => ({
      ticker: t,
      company: r.companies[t],
      live: !!live[t]?.ok,
      quoteType: live[t]?.quoteType || null,
      yahooName: live[t]?.name || null,
      mktCap: live[t]?.mktCap || null,
      industry: industry[t]?.industry || null,
      sameIndustry: !!subj.industry && industry[t]?.industry === subj.industry,
      sameSector: !!subj.sector && industry[t]?.sector === subj.sector,
    }))
    // What the app would show: live tickers only, first eight.
    r.shown = r.peers.filter((p) => p.live).slice(0, 8)
  }
  writeJSON(RUNS, runs)
  console.log('checked')
}

// ---------------- phase: judge ----------------
export const JUDGES = [
  { id: 'opus', label: 'Claude Opus 5.5', provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' },
  { id: 'gpro', label: 'Gemini 3.1 Pro', provider: 'gemini', model: 'gemini-3.1-pro-preview', thinking: 'high' },
]

function shuffle(list, key) {
  let seed = [...key].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
  const l = [...list]
  for (let k = l.length - 1; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [l[k], l[m]] = [l[m], l[k]] }
  l.forEach((x, k) => (x.letter = String.fromCharCode(65 + k)))
  return l
}

function renderSummary(s) {
  const sec = (title, arr) => (arr?.length ? `${title}:\n${arr.map((b) => `- ${b}`).join('\n')}` : `${title}: (empty)`)
  return [`Overview: ${s.overview}`, sec('Key takeaways', s.keyTakeaways), sec('Financial highlights', s.financialHighlights), sec('Guidance', s.guidance), sec('Analyst focus', s.analystFocus), sec('Risks mentioned', s.risksMentioned)].join('\n')
}

function sumJudgePrompt(sym, t, lists) {
  const text = t.paragraphs.map((p) => `${p.speaker}: ${p.content}`).join('\n\n')
  return `You are judging AI-written summaries of one earnings call. The summaries come from different AI systems; they are anonymous and in random order. They appear as "Key Takeaways" in a valuation tool that an investor uses for their own research.

The systems were told: ground every statement strictly in the transcript, no outside knowledge, no investment advice, attribute forward-looking statements to management, quote specific figures with units, one tight sentence per bullet, and leave a section empty rather than invent content.

Here is the full transcript of the ${sym} call (fiscal Q${t.quarter} ${t.year}):
<transcript>
${text}
</transcript>

${lists.map((l) => `### Summary ${l.letter}\n${renderSummary(l.summary)}`).join('\n\n')}

Check every figure and claim against the transcript. Score every summary from 1 to 10 on each criterion, using the full range and comparing summaries against each other.
- accuracy: are all figures and claims correct and supported by the transcript? Any wrong number, wrong period, wrong attribution or invented content must pull this down hard.
- coverage: does it capture what an investor most needs from this call: results vs. prior periods, guidance changes, the main strategic news, what analysts pressed on?
- insight: does it surface the things that actually matter (the surprise, the change in tone, the number that moved) rather than restating the press release?
- concision: tight, scannable, no padding or repetition across sections.
- discipline: follows the rules: forward-looking statements attributed to management, no advice or price view, no outside knowledge.
- overall: how useful is this as a research note on this call?

List every factual error you are confident about, quoting the summary's wording and stating what the transcript actually says. Do not list omissions as errors.

Return only JSON, no other text, in this shape:
{"summaries": [{"letter": "A", "accuracy": 0, "coverage": 0, "insight": 0, "concision": 0, "discipline": 0, "overall": 0, "errors": ["..."], "comment": "one sentence"}]}`
}

function compJudgePrompt(sym, subj, lists) {
  return `You are judging comparable-company sets ("comp sets") built by different AI systems for an equity valuation tool. The systems are anonymous and in random order. Each set will be shown as a table of trading multiples next to the subject company.

Subject: ${subj.name} (${sym})
Sector: ${subj.sector}. Industry: ${subj.industry}. Market cap: ${subj.mktCap ? '$' + (subj.mktCap / 1e9).toFixed(1) + 'B' : 'unknown'}.
Business: ${subj.description.slice(0, 900)}

The systems were told: 8 to 10 peers that share the subject's business model and industry economics, the companies an analyst would actually put in the same table; US-listed common stocks only; no ETFs, private companies or subsidiaries; prefer comparable scale but include a clear direct competitor regardless of size.

${lists.map((l) => `### Set ${l.letter}\n${l.peers.map((p) => `- ${p.ticker}${p.yahooName ? ` (${p.yahooName})` : p.company ? ` (${p.company})` : ''}${p.live ? '' : '  [ticker did not resolve to a live US equity quote; the app drops it]'}`).join('\n')}`).join('\n\n')}

Score every set from 1 to 10 on each criterion, using the full range and comparing sets against each other. Judge the set as the app would show it: tickers marked as not resolving are dropped.
- relevance: do the peers share the subject's business model and economics, so their multiples are a meaningful benchmark?
- coverage: are the obvious direct competitors that an analyst would expect present?
- scale: are the peers of sensible scale, with outliers justified by direct competition?
- noise: are there peers that clearly do not belong (penalise each one), wrong tickers, or companies that are not what the system thought they were?
- overall: would an equity analyst accept this comp set with only light edits?

Name any peers that clearly do not belong, and any obvious peers missing from every set.

Return only JSON, no other text, in this shape:
{"sets": [{"letter": "A", "relevance": 0, "coverage": 0, "scale": 0, "noise": 0, "overall": 0, "misfits": ["TICKER: why"], "comment": "one sentence"}], "missingEverywhere": ["TICKER: why"]}`
}


export function renderSummary2(s) {
  const list = (title, arr) => (arr?.length ? `${title}:\n${arr.map((b) => `- ${b}`).join('\n')}` : `${title}: (empty)`)
  const out = [`Overview: ${s.overview}`, list('Key takeaways', s.keyTakeaways), list('Financial highlights', s.financialHighlights)]
  out.push(list('Key metrics', (s.keyMetrics || []).map((m) => `${m.metric}: ${m.value}${m.comparison ? ` (${m.comparison})` : ''}`)))
  out.push(list('Guidance', s.guidance))
  out.push(list('Q&A', (s.qa || []).map((q) => `${q.analyst}${q.firm ? ` (${q.firm})` : ''} asked: ${q.question} | ${q.responder}${q.responderTitle ? `, ${q.responderTitle}` : ''}: ${q.answer} | Read: ${q.read}`)))
  out.push(list('Unanswered', (s.unanswered || []).map((u) => `${u.analyst}${u.firm ? ` (${u.firm})` : ''}: ${u.question} | How avoided: ${u.how}`)))
  out.push(list('Notable quotes (already verified verbatim against the transcript)', (s.notableQuotes || []).map((q) => `"${q.quote}" — ${q.speaker}${q.title ? `, ${q.title}` : ''}`)))
  const w = s.whatChanged
  out.push(w ? [list('What changed: guidance revisions', w.guidanceRevisions), list('What changed: new mentions', w.newMentions), list('What changed: dropped topics', w.droppedTopics), `What changed: tone shift: ${w.toneShift || '(none)'}`].join('\n') : 'What changed: (section omitted)')
  out.push(list('Risks mentioned', s.risksMentioned))
  return out.join('\n')
}

function sum2JudgePrompt(sym, t, prior, lists) {
  const text = (x) => x.paragraphs.map((p) => `${p.speaker}: ${p.content}`).join('\n\n')
  return `You are judging AI-written summaries of one earnings call. The summaries come from different AI systems; they are anonymous and in random order. They appear in a valuation tool that an investor reads on their phone for their own research.

Each system ran the same two-pass pipeline: it first extracted structured facts from the transcript (and from the prior quarter's transcript), then wrote the summary from those extractions alone. The writing instructions were: ground every statement in the extraction, no outside knowledge, no advice or price view; attribute statements to the named person and title, never "management said"; every quantitative claim carries its number; no filler adjectives; one tight sentence per bullet; under roughly 900 words. Sections: overview; key takeaways, financial highlights, guidance, risks (three to five bullets each); key metrics; four to six Q&A exchanges chosen for signal, each with a one-line read on how direct the answer was; two to four questions that were deflected, partially answered or declined; three to five verbatim quotes; and "what changed" versus the prior quarter.

Here is the full transcript of the ${sym} call (fiscal Q${t.quarter} ${t.year}):
<transcript>
${text(t)}
</transcript>

And the prior quarter's call (fiscal Q${prior.quarter} ${prior.year}), which the "what changed" section compares against:
<prior_transcript>
${text(prior)}
</prior_transcript>

${lists.map((l) => `### Summary ${l.letter}\n${renderSummary2(l.summary)}`).join('\n\n')}

Check every figure, attribution and claim against the transcripts. Score every summary from 1 to 10 on each criterion, using the full range and comparing summaries against each other.
- accuracy: are all figures, periods, attributions (who said it, their title) and claims correct? Any wrong number, wrong person, wrong period or invented content must pull this down hard.
- qa: are the Q&A exchanges the high-signal ones, correctly attributed, with the substance right; are the "read" lines and the unanswered list fair (a question that was answered directly listed as dodged is an error)?
- coverage: does it capture what an investor most needs: results vs. prior periods, guidance and how it moved, the main strategic news, the risks?
- insight: does it surface what actually matters (the surprise, the change in tone, the number that moved, the question management avoided) rather than restating the press release? Includes whether "what changed" is real and useful.
- concision: tight and scannable on a phone, within about 900 words, no padding, filler adjectives or repetition across sections.
- discipline: follows the rules: named attribution, numbers with every quantitative claim, no advice or price view, no outside knowledge.
- overall: how useful is this as a research note on this call?

List every factual error you are confident about, quoting the summary's wording and stating what the transcript actually says. Do not list omissions as errors.

Return only JSON, no other text, in this shape:
{"summaries": [{"letter": "A", "accuracy": 0, "qa": 0, "coverage": 0, "insight": 0, "concision": 0, "discipline": 0, "overall": 0, "errors": ["..."], "comment": "one sentence"}]}`
}

function judgeWork(only) {
  const inp = readJSON(INPUTS, null)
  const runs = readJSON(RUNS, {})
  const work = []
  for (const j of JUDGES.filter((x) => !only || only.includes(x.id))) {
    for (const c of CALLS) {
      const lists = CONFIGS.map((cfg) => runs[`${cfg.id}|sum|${c.symbol}`]).filter((r) => r?.parsed).map((r) => ({ cfg: r.cfg, summary: r.parsed }))
      const ord = shuffle(lists, `${j.id}|sum|${c.symbol}`)
      work.push({ j, key: `${j.id}|sum|${c.symbol}`, ord, prompt: sumJudgePrompt(c.symbol, inp.calls[c.symbol], ord), field: 'summaries' })
    }
    for (const c of CALLS) {
      const lists = CONFIGS.map((cfg) => runs[`${cfg.id}|sum3|${c.symbol}`]).filter((r) => r?.summary).map((r) => ({ cfg: r.cfg, summary: r.summary }))
      if (!lists.length) continue
      const ord = shuffle(lists, `${j.id}|sum3|${c.symbol}`)
      work.push({ j, key: `${j.id}|sum3|${c.symbol}`, ord, prompt: sum2JudgePrompt(c.symbol, inp.calls[c.symbol], inp.priors[c.symbol], ord), field: 'summaries' })
    }
    for (const c of CALLS) {
      const lists = [...CONFIGS, ...SUB_CONFIGS].map((cfg) => runs[`${cfg.id}|sum2|${c.symbol}`]).filter((r) => r?.summary).map((r) => ({ cfg: r.cfg, summary: r.summary }))
      if (!lists.length) continue
      const ord = shuffle(lists, `${j.id}|sum2|${c.symbol}`)
      work.push({ j, key: `${j.id}|sum2|${c.symbol}`, ord, prompt: sum2JudgePrompt(c.symbol, inp.calls[c.symbol], inp.priors[c.symbol], ord), field: 'summaries' })
    }
    for (const c of COMP_TICKERS) {
      const lists = [...CONFIGS, PROD].map((cfg) => runs[`${cfg.id}|comp|${c.symbol}`]).filter((r) => r?.peers).map((r) => ({ cfg: r.cfg, peers: r.peers }))
      const ord = shuffle(lists, `${j.id}|comp|${c.symbol}`)
      work.push({ j, key: `${j.id}|comp|${c.symbol}`, ord, prompt: compJudgePrompt(c.symbol, inp.comps[c.symbol], ord), field: 'sets' })
    }
  }
  return work
}

function recordJudgment(judged, w, text, extra = {}) {
  const parsed = parseJSON(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  if (!parsed?.[w.field]) throw new Error('unparseable judge output')
  const scores = {}
  for (const s of parsed[w.field]) {
    const l = w.ord.find((x) => x.letter === s.letter)
    if (l) scores[l.cfg] = s
  }
  judged[w.key] = { order: w.ord.map((l) => [l.letter, l.cfg]), scores, missingEverywhere: parsed.missingEverywhere, ...extra }
}

// The Anthropic key ran out of credit mid-run (Oct 11, 2026). Remaining Claude
// judgments can be done by an Opus 5.5 subagent in Claude Code instead, on the
// identical blinded prompt: dump writes the prompts, load reads the answers.
const PROMPT_DIR = path.join(here, 'judge-prompts')
function judgeDump() {
  const judged = readJSON(JUDGE, {})
  fs.mkdirSync(PROMPT_DIR, { recursive: true })
  for (const w of judgeWork([process.argv[3] || 'opus'])) {
    if (judged[w.key]?.scores) continue
    fs.writeFileSync(path.join(PROMPT_DIR, w.key.replace(/\|/g, '_') + '.txt'), w.prompt)
    console.log('dumped', w.key)
  }
}
function judgeLoad() {
  const judged = readJSON(JUDGE, {})
  for (const w of judgeWork([process.argv[3] || 'opus'])) {
    const f = path.join(PROMPT_DIR, w.key.replace(/\|/g, '_') + '.json')
    if (judged[w.key]?.scores || !fs.existsSync(f)) continue
    recordJudgment(judged, w, fs.readFileSync(f, 'utf8'), { via: 'subagent' })
    console.log('loaded', w.key)
  }
  writeJSON(JUDGE, judged)
}

async function judge() {
  const judged = readJSON(JUDGE, {})
  const work = judgeWork(process.argv[3]?.split(','))
  // Two judges in parallel, three jobs each at a time.
  const byJudge = Object.groupBy(work, (w) => w.j.id)
  await Promise.all(Object.values(byJudge).map(async (ws) => {
    let i = 0
    const worker = async () => {
      while (i < ws.length) {
        const w = ws[i++]
        if (judged[w.key]?.scores) continue
        try {
          const r = await callModel(w.j, 'You are a meticulous, impartial evaluator. Return only the JSON requested.', w.prompt, null, { temperature: 0.2 })
          recordJudgment(judged, w, r.text, { ms: r.ms, inTok: r.inTok, outTok: r.outTok })
          console.log(`${w.key}  ${(r.ms / 1000).toFixed(0)}s`)
        } catch (e) {
          judged[w.key] = { error: e.message }
          console.log(`${w.key}  ERROR ${e.message}`)
        }
        writeJSON(JUDGE, judged)
      }
    }
    await Promise.all([worker(), worker(), worker()])
  }))
}

const phase = process.argv[2]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fns = { inputs, gen, gen2, check, judge, 'judge-dump': judgeDump, 'judge-load': judgeLoad }
  if (!fns[phase]) { console.log('usage: llm-bakeoff.mjs inputs|gen|check|judge [ids]'); process.exit(1) }
  await fns[phase]()
}
