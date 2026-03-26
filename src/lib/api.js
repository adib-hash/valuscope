// Client-side data fetching — calls our own /api routes (which proxy to FMP server-side)

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
