// Earnings call transcripts.
//
// Primary source is the defeatbeta community dataset on HuggingFace: a single
// 2.2 GB Parquet file holding ~235k transcripts, rebuilt daily, free and
// keyless. Downloading it is obviously out of the question, but its row groups
// are sorted by ticker and carry min/max statistics, so the ticker we want can
// be narrowed to one or two row groups and pulled with HTTP range requests.
// Fetching one company's index costs a few KB; a full transcript costs ~2 MB.
//
// Alpha Vantage is the fallback for when that dataset goes stale or moves. It
// needs a free API key and allows only 25 requests a day, which is why it is
// not the primary.

import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

const DATASET_URL =
  'https://huggingface.co/datasets/defeatbeta/yahoo-finance-data/resolve/main/data/stock_earning_call_transcripts.parquet';

const INDEX_COLUMNS = ['symbol', 'fiscal_year', 'fiscal_quarter', 'report_date'];

// The Parquet footer is ~1.5 MB and takes about a second to read, so it is held
// for the life of a warm serverless instance.
let filePromise = null;
let metadataPromise = null;

async function getFile() {
  if (!filePromise) {
    filePromise = asyncBufferFromUrl({ url: DATASET_URL }).catch((e) => {
      filePromise = null;
      throw e;
    });
  }
  return filePromise;
}

async function getMetadata(file) {
  if (!metadataPromise) {
    metadataPromise = parquetMetadataAsync(file).catch((e) => {
      metadataPromise = null;
      throw e;
    });
  }
  return metadataPromise;
}

// Row groups are ticker-sorted, so the ones whose [min, max] straddles the
// symbol are the only ones worth decoding.
function rowRangeForSymbol(metadata, symbol) {
  let cursor = 0, rowStart = null, rowEnd = null;
  for (const group of metadata.row_groups) {
    const column = group.columns.find(
      (c) => c.meta_data.path_in_schema.join('.') === 'symbol'
    );
    const stats = column?.meta_data?.statistics;
    const min = stats?.min_value != null ? String(stats.min_value) : null;
    const max = stats?.max_value != null ? String(stats.max_value) : null;
    const rows = Number(group.num_rows);
    if (min != null && max != null && min <= symbol && symbol <= max) {
      if (rowStart == null) rowStart = cursor;
      rowEnd = cursor + rows;
    }
    cursor += rows;
  }
  return rowStart == null ? null : { rowStart, rowEnd };
}

const toDate = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(Number(v));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

// Every quarter we hold for a ticker, newest first.
export async function listQuarters(symbol) {
  const file = await getFile();
  const metadata = await getMetadata(file);
  const range = rowRangeForSymbol(metadata, symbol);
  if (!range) return [];

  const rows = await parquetReadObjects({
    file, metadata, compressors,
    columns: INDEX_COLUMNS,
    rowStart: range.rowStart,
    rowEnd: range.rowEnd,
  });

  return rows
    .map((r, i) => ({ ...r, absoluteRow: range.rowStart + i }))
    .filter((r) => r.symbol === symbol)
    .map((r) => ({
      year: Number(r.fiscal_year),
      quarter: Number(r.fiscal_quarter),
      reportDate: toDate(r.report_date),
      absoluteRow: r.absoluteRow,
    }))
    .sort((a, b) => (b.year - a.year) || (b.quarter - a.quarter));
}

// Fetches one transcript. Reading a single row keeps the content transfer to
// roughly 2 MB rather than the whole row group.
export async function getTranscript(symbol, year, quarter) {
  const quarters = await listQuarters(symbol);
  if (!quarters.length) return null;

  const wanted = (year && quarter)
    ? quarters.find((q) => q.year === year && q.quarter === quarter)
    : quarters[0];
  if (!wanted) return null;

  const file = await getFile();
  const metadata = await getMetadata(file);
  const rows = await parquetReadObjects({
    file, metadata, compressors,
    columns: [...INDEX_COLUMNS, 'transcripts'],
    rowStart: wanted.absoluteRow,
    rowEnd: wanted.absoluteRow + 1,
  });

  const row = rows[0];
  if (!row) return null;

  const paragraphs = (row.transcripts || [])
    .map((p) => ({
      n: Number(p.paragraph_number),
      speaker: String(p.speaker ?? '').trim(),
      content: String(p.content ?? '').trim(),
    }))
    .filter((p) => p.content)
    .sort((a, b) => a.n - b.n);

  return {
    symbol,
    year: wanted.year,
    quarter: wanted.quarter,
    reportDate: wanted.reportDate,
    paragraphs,
    quarters: quarters.map(({ absoluteRow, ...q }) => q),
    source: 'defeatbeta',
  };
}

// ── Alpha Vantage fallback ───────────────────────────────────────────────────
// Note this keys off *calendar* quarters while the primary source is organised
// by *fiscal* quarter, so the report date is what maps between them.
export async function getTranscriptFallback(symbol, reportDate) {
  const key = process.env.ALPHAVANTAGE_API_KEY;
  if (!key) return null;

  const date = reportDate ? new Date(reportDate) : new Date();
  if (isNaN(date)) return null;
  const calendarQuarter = `${date.getFullYear()}Q${Math.floor(date.getMonth() / 3) + 1}`;

  const url = `https://www.alphavantage.co/query?function=EARNINGS_CALL_TRANSCRIPT`
    + `&symbol=${encodeURIComponent(symbol)}&quarter=${calendarQuarter}&apikey=${key}`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  // Alpha Vantage reports quota exhaustion and bad symbols as 200s with a note.
  if (data.Note || data.Information || !Array.isArray(data.transcript)) return null;

  const paragraphs = data.transcript
    .map((t, i) => ({
      n: i + 1,
      speaker: String(t.speaker ?? '').trim(),
      content: String(t.content ?? '').trim(),
    }))
    .filter((p) => p.content);

  if (!paragraphs.length) return null;

  return {
    symbol,
    year: date.getFullYear(),
    quarter: Math.floor(date.getMonth() / 3) + 1,
    reportDate: reportDate || null,
    paragraphs,
    quarters: [],
    source: 'alphavantage',
  };
}
