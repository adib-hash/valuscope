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
  return apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
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

export async function fetchPriceHistory(ticker, range = '1Y') {
  return apiFetch(`/api/priceHistory?ticker=${encodeURIComponent(ticker)}&range=${encodeURIComponent(range)}`);
}
