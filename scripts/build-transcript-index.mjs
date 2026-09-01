// Builds data/transcript-index.json: which earnings calls the transcript
// dataset holds for every S&P 500 company, by fiscal quarter and report date.
//
//   node scripts/build-transcript-index.mjs
//
// The earnings calendar needs this for "which of today's calls has a
// transcript". Reading it live from the dataset is not an option: the file's
// index columns are spread across hundreds of row groups, so one scan is
// thousands of range requests, and the dataset's CDN answers a burst like
// that with 429 long before a serverless function's sixty seconds are up.
// Here there is no clock, so the read is throttled — two requests in flight,
// a short gap between them, backoff on 429 — and the result is committed by
// a scheduled workflow (.github/workflows/transcript-index.yml). The function
// then reads a small JSON file and never touches the dataset for this.
//
// Only S&P 500 constituents, and only calls reported in the last two years:
// that keeps the file around 150 KB.

import fs from 'node:fs';
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { getSp500 } from '../api/_lib/sp500.js';

const DATASET_URL =
  'https://huggingface.co/datasets/defeatbeta/yahoo-finance-data/resolve/main/data/stock_earning_call_transcripts.parquet';
const OUT = new URL('../data/transcript-index.json', import.meta.url);
const INDEX_COLUMNS = ['symbol', 'fiscal_year', 'fiscal_quarter', 'report_date'];
const KEEP_DAYS = 730;
const GROUPS_PER_READ = 8;

// ── A polite fetch ──────────────────────────────────────────────────────────

const MAX_IN_FLIGHT = 2;
const MIN_GAP_MS = 120;
const BACKOFF_MS = [2000, 4000, 8000, 16000, 32000, 60000];

let inFlight = 0;
let lastStart = 0;
const waiters = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((resolve) => waiters.push(resolve));
  inFlight += 1;
  const gap = MIN_GAP_MS - (Date.now() - lastStart);
  if (gap > 0) await sleep(gap);
  lastStart = Date.now();
}
function release() {
  inFlight -= 1;
  waiters.shift()?.();
}

let requests = 0;
let retries = 0;

async function politeFetch(url, init) {
  for (let attempt = 0; ; attempt++) {
    await acquire();
    let res;
    try {
      requests += 1;
      res = await fetch(url, init);
    } catch (err) {
      release();
      if (attempt >= BACKOFF_MS.length) throw err;
      retries += 1;
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    release();
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= BACKOFF_MS.length) throw new Error(`fetch failed ${res.status} after ${attempt} retries`);
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS[attempt];
      retries += 1;
      console.error(`  ${res.status}; waiting ${Math.round(wait / 1000)}s`);
      await res.arrayBuffer().catch(() => {});
      await sleep(wait);
      continue;
    }
    return res;
  }
}

// ── The read ────────────────────────────────────────────────────────────────

const toDate = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(Number(v));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

const started = Date.now();
const wanted = new Set((await getSp500()).map((c) => c.symbol));
console.error(`${wanted.size} S&P 500 symbols`);

const file = await asyncBufferFromUrl({ url: DATASET_URL, fetch: politeFetch });
const metadata = await parquetMetadataAsync(file);
const groups = metadata.row_groups;
console.error(`${groups.length} row groups, ${Number(metadata.num_rows)} rows, footer read in ${Date.now() - started}ms`);

// Row groups are sorted by symbol and carry min/max statistics, so groups
// that cannot hold any wanted symbol are skipped outright.
const symbolStats = (g) => {
  const col = g.columns.find((c) => c.meta_data.path_in_schema.join('.') === 'symbol');
  const s = col?.meta_data?.statistics;
  return s?.min_value != null && s?.max_value != null ? [String(s.min_value), String(s.max_value)] : null;
};
const sorted = [...wanted].sort();
const groupWanted = (g) => {
  const st = symbolStats(g);
  if (!st) return true;
  return sorted.some((sym) => sym >= st[0] && sym <= st[1]);
};

const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
const rows = [];
let rowStart = 0;
let batch = [];
let batchStart = 0;
let readGroups = 0;

const flush = async () => {
  if (!batch.length) return;
  const rowEnd = batch[batch.length - 1].end;
  const out = await parquetReadObjects({ file, metadata, compressors, columns: INDEX_COLUMNS, rowStart: batchStart, rowEnd });
  for (const r of out) {
    const symbol = String(r.symbol ?? '').trim();
    if (!wanted.has(symbol)) continue;
    const reportDate = toDate(r.report_date);
    if (!reportDate || reportDate < cutoff) continue;
    rows.push([symbol, Number(r.fiscal_year), Number(r.fiscal_quarter), reportDate]);
  }
  readGroups += batch.length;
  batch = [];
};

for (let i = 0; i < groups.length; i++) {
  const n = Number(groups[i].num_rows);
  const range = { start: rowStart, end: rowStart + n };
  rowStart += n;
  if (!groupWanted(groups[i])) { await flush(); continue; }
  if (!batch.length) batchStart = range.start;
  batch.push(range);
  if (batch.length >= GROUPS_PER_READ) await flush();
  if (i % 50 === 49) console.error(`  ${i + 1}/${groups.length} groups scanned, ${readGroups} read, ${rows.length} rows kept, ${requests} requests, ${retries} retries`);
}
await flush();

rows.sort((a, b) => a[0].localeCompare(b[0]) || (b[1] - a[1]) || (b[2] - a[2]));
const symbols = new Set(rows.map((r) => r[0]));
const output = {
  builtAt: new Date().toISOString(),
  source: 'defeatbeta/yahoo-finance-data · stock_earning_call_transcripts.parquet',
  universe: 'S&P 500',
  keepDays: KEEP_DAYS,
  rows,
};
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(output));
console.error(`wrote ${rows.length} rows for ${symbols.size} symbols (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB) `
  + `from ${readGroups} of ${groups.length} row groups in ${Math.round((Date.now() - started) / 1000)}s, ${requests} requests, ${retries} retries`);
if (symbols.size < 300) {
  console.error(`only ${symbols.size} symbols found — refusing to publish a thin index`);
  process.exit(1);
}
