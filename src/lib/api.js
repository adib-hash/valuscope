// Client-side data fetching — calls our own /api routes, which reach Yahoo
// Finance and SEC EDGAR server-side.

const isDev = import.meta.env.DEV;

// In dev, Vite proxy handles /api. In prod, Vercel serverless handles /api.
async function apiFetch(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
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

// AI summary of an earnings call. Slow (10-15s) and explicitly user-triggered,
// so it is never called as part of a page load.
export async function fetchSummary(ticker, year, quarter) {
  const params = new URLSearchParams({ ticker });
  if (year && quarter) { params.set('year', year); params.set('quarter', quarter); }
  return apiFetch(`/api/summarize?${params}`);
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
