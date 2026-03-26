// Vercel serverless function — ticker search via yahoo-finance2

import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

export default async function handler(req, res) {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing search query parameter "q"' });

  try {
    const results = await yahooFinance.search(q, { newsCount: 0 }, { validateResult: false });
    const quotes = (results.quotes || [])
      .filter(r => r.quoteType === 'EQUITY')
      .slice(0, 8)
      .map(r => ({
        symbol:   r.symbol,
        name:     r.shortname || r.longname || r.symbol,
        exchange: r.exchDisp  || r.exchange || '',
      }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(quotes);
  } catch (err) {
    return res.status(500).json({ error: `Search failed: ${err.message}` });
  }
}
