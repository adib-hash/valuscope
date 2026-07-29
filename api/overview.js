// Batch live quotes for the watchlist dashboard.
//
// One Yahoo `quote` call covers every ticker at once, which keeps the landing
// view cheap no matter how long the watchlist gets.

import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const MAX_SYMBOLS = 20; // matches the watchlist cap in src/lib/watchlist.js

const iso = (d) => {
  if (!d) return null;
  const parsed = d instanceof Date ? d : new Date(d);
  return isNaN(parsed) ? null : parsed.toISOString();
};

export default async function handler(req, res) {
  const raw = req.query.symbols || '';
  const symbols = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  if (!symbols.length) {
    return res.status(400).json({ error: 'Missing symbols parameter' });
  }

  try {
    const results = await yahooFinance.quote(symbols, {}, { validateResult: false });
    const list = Array.isArray(results) ? results : [results];

    const quotes = list.filter(Boolean).map((q) => ({
      symbol: q.symbol,
      name: q.longName || q.shortName || q.symbol,
      price: q.regularMarketPrice ?? null,
      changePercent: q.regularMarketChangePercent ?? null,
      marketCap: q.marketCap ?? null,
      trailingPE: q.trailingPE ?? null,
      forwardPE: q.forwardPE ?? null,
      nextEarnings: iso(q.earningsTimestampStart || q.earningsTimestamp),
      fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekChangePercent: q.fiftyTwoWeekChangePercent ?? null,
      currency: q.currency || 'USD',
    }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ quotes, source: 'yahoo' });

  } catch (err) {
    console.error('Overview error:', err);
    return res.status(500).json({ error: `Failed to load quotes: ${err.message}` });
  }
}
