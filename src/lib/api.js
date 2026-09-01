// Client-side data fetching — calls our own /api routes, which reach Yahoo
// Finance and SEC EDGAR server-side.

import { getCallSummary, saveCallSummary } from './callSummaryCache';

const isDev = import.meta.env.DEV;

// In dev, Vite proxy handles /api. In prod, Vercel serverless handles /api.
async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `API error: ${res.status}`);
    err.status = res.status; // lets callers tell a rate limit (429) from a real failure
    throw err;
  }
  return res.json();
}

export async function searchTickers(query) {
  if (!query || query.length < 1) return [];
  return apiFetch(`/api/lookup?kind=company&q=${encodeURIComponent(query)}`);
}

export async function fetchFinancials(ticker) {
  return apiFetch(`/api/financials?ticker=${encodeURIComponent(ticker)}`);
}

export async function fetchComps(ticker) {
  return apiFetch(`/api/comps?ticker=${encodeURIComponent(ticker)}`);
}

// Deep multiples history from SEC EDGAR. Fetched alongside fetchFinancials and
// merged in when it lands, so the dashboard never waits on it.
export async function fetchHistory(ticker) {
  return apiFetch(`/api/history?ticker=${encodeURIComponent(ticker)}`);
}

// Batch live quotes for the watchlist dashboard.
export async function fetchOverview(symbols) {
  if (!symbols?.length) return { quotes: [] };
  return apiFetch(`/api/overview?symbols=${encodeURIComponent(symbols.join(','))}`);
}

// Earnings calendar, surprise history and forward estimates.
export async function fetchEarnings(ticker) {
  return apiFetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`);
}

// Earnings call transcript. Omit year/quarter for the most recent call.
export async function fetchTranscript(ticker, year, quarter) {
  const params = new URLSearchParams({ ticker });
  if (year && quarter) { params.set('year', year); params.set('quarter', quarter); }
  return apiFetch(`/api/transcript?${params}`);
}

// AI summary of an earnings call. Explicitly user-triggered, never part of a
// page load.
//
// Three requests, not one: the summary is a two-pass pipeline (extract this
// call, extract the prior call, compose), each pass a Gemini call of twenty
// to forty seconds, and a Vercel function has sixty. Each stage is its own
// request and this function carries the results between them, so no request
// ever holds more than one model call — and a deployment without a Blob
// store still works, because nothing has to persist server-side between
// stages. Finished summaries are kept in localStorage; the stage responses
// are immutable and edge-cached, so a retry after a rate limit mostly hits
// caches.
//
// `onStage` reports progress: 'extract' | 'compose' | 'done'.
export async function fetchSummary(ticker, year, quarter, { onStage } = {}) {
  const cached = getCallSummary(ticker, year, quarter);
  if (cached) { onStage?.('done'); return cached; }

  const params = (extra) => {
    const q = new URLSearchParams({ ticker, ...extra });
    if (year && quarter) { q.set('year', year); q.set('quarter', quarter); }
    return q;
  };

  onStage?.('extract');
  // The prior quarter's extraction is wanted for "what changed" but never
  // required: its failure costs the section, not the summary.
  const [current, prior] = await Promise.all([
    apiFetch(`/api/summarize?${params({ stage: 'extract' })}`),
    apiFetch(`/api/summarize?${params({ stage: 'prior' })}`).catch(() => null),
  ]);
  if (current.summary) {
    // Already in the server-side store.
    saveCallSummary(current);
    onStage?.('done');
    return current;
  }

  onStage?.('compose');
  const res = await fetch('/api/summarize?stage=compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: current.symbol,
      year: current.year,
      quarter: current.quarter,
      extraction: current.extraction,
      prior: prior?.extraction ? { year: prior.year, quarter: prior.quarter, extraction: prior.extraction } : null,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const summary = await res.json();
  saveCallSummary(summary);
  onStage?.('done');
  return summary;
}

// Every S&P 500 call in a date window: who reports when, and which of those
// calls already has a transcript to read. Same function as the per-company
// earnings panel, dispatched on op — the twelve-function ceiling again.
export async function fetchEarningsCalendar(from, to) {
  return apiFetch(`/api/earnings?op=calendar&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

// The top of the digest: one read across a day's call summaries. Posted rather
// than fetched because the summaries are the input.
export async function synthesizeDigest(date, calls) {
  const res = await fetch('/api/summarize?op=digest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, calls }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function fetchPriceHistory(ticker, range = '1Y') {
  return apiFetch(`/api/priceHistory?ticker=${encodeURIComponent(ticker)}&range=${encodeURIComponent(range)}`);
}

// World index returns. mode is 'total' (USD, dividends reinvested) or 'price'
// (local currency, price only) — see api/indices.js for why both exist.
export async function fetchIndices(mode = 'total') {
  return apiFetch(`/api/indices?mode=${encodeURIComponent(mode)}`);
}

// Investor name → CIK, via EDGAR full-text search over 13F filers.
export async function searchInstitutions(query) {
  if (!query || query.trim().length < 2) return { filers: [] };
  return apiFetch(`/api/lookup?kind=investor&q=${encodeURIComponent(query.trim())}`);
}

// A manager's 13F portfolio. Omit period for the most recent quarter; the
// response always carries the full quarter list and a diff against the prior
// filing.
export async function fetchHoldings(cik, period) {
  const params = new URLSearchParams({ cik });
  if (period) params.set('period', period);
  return apiFetch(`/api/holdings?${params}`);
}

// Filings & Docs Hub. One serverless function dispatched on `op` — the Hobby
// plan caps deployments at twelve functions and this app runs at the ceiling.
export async function fetchFilings(ticker) {
  return apiFetch(`/api/docs?op=list&ticker=${encodeURIComponent(ticker)}`);
}

export async function fetchFiling(cik, accession, doc) {
  const params = new URLSearchParams({ op: 'doc', cik, accession });
  if (doc) params.set('doc', doc);
  return apiFetch(`/api/docs?${params}`);
}

// AI summary of a filing. Cached forever server-side — the document never changes.
export async function fetchDocSummary(cik, accession, form, doc) {
  const params = new URLSearchParams({ op: 'summary', cik, accession });
  if (form) params.set('form', form);
  if (doc) params.set('doc', doc);
  return apiFetch(`/api/docs?${params}`);
}

// Ask a question of one filing. Stateless: the client carries the history.
export async function askDocument({ cik, accession, doc, question, history, currentSection }) {
  const res = await fetch('/api/docs?op=chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cik, accession, doc, question, history, currentSection }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

// Operating-KPI series mined from filings. GET reads what exists; POST reads
// up to three more filings and extends the series.
export async function fetchKpis(ticker) {
  return apiFetch(`/api/docs?op=kpis&ticker=${encodeURIComponent(ticker)}`);
}

export async function buildKpis(ticker, count = 3) {
  const res = await fetch(`/api/docs?op=kpis&ticker=${encodeURIComponent(ticker)}&count=${count}`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}
