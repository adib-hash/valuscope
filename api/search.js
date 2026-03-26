// Vercel serverless function — ticker search via FMP

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

export default async function handler(req, res) {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Missing search query parameter "q"' });
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'FMP_API_KEY not configured' });
  }

  try {
    const response = await fetch(
      `${FMP_BASE}/search?query=${encodeURIComponent(q)}&limit=8&exchange=NASDAQ,NYSE,AMEX&apikey=${apiKey}`
    );
    const data = await response.json();

    // Slim down the response
    const results = (data || []).map(item => ({
      symbol: item.symbol,
      name: item.name,
      exchange: item.exchangeShortName,
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: `Search failed: ${err.message}` });
  }
}
