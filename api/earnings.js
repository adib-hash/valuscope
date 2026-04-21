// Serverless endpoint: proxies API Ninjas' earningstranscript endpoint.
//
// The edge cache is load-bearing for free-tier budget. Transcripts never change
// once published, so we cache successful responses for 1 week fresh / 30 days SWR —
// each (ticker, year, quarter) tuple then costs exactly one API Ninjas call, ever.
// Empty responses (not-yet-reported quarters) get a short 5-minute cache so they
// refresh naturally once the call happens.

const ENDPOINT = 'https://api.api-ninjas.com/v1/earningstranscript';

export default async function handler(req, res) {
  const { ticker, year, quarter } = req.query;

  if (!ticker)  return res.status(400).json({ error: 'Missing ticker parameter' });
  if (!year)    return res.status(400).json({ error: 'Missing year parameter' });
  if (!quarter) return res.status(400).json({ error: 'Missing quarter parameter' });

  const yearNum    = parseInt(year, 10);
  const quarterNum = parseInt(quarter, 10);
  if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
    return res.status(400).json({ error: 'Invalid year (expected 4-digit year)' });
  }
  if (!Number.isInteger(quarterNum) || quarterNum < 1 || quarterNum > 4) {
    return res.status(400).json({ error: 'Invalid quarter (expected 1–4)' });
  }

  const apiKey = process.env.API_NINJAS_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const symbol = ticker.toUpperCase().trim();
  const url = `${ENDPOINT}?ticker=${encodeURIComponent(symbol)}&year=${yearNum}&quarter=${quarterNum}`;

  try {
    const upstream = await fetch(url, { headers: { 'X-Api-Key': apiKey } });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(502).json({
        error: `Upstream error (${upstream.status}): ${text.slice(0, 200) || upstream.statusText}`,
      });
    }

    const body = await upstream.json().catch(() => ({}));

    // API Ninjas returns {} (200 empty object) when the transcript hasn't been indexed.
    if (!body || !body.transcript || typeof body.transcript !== 'string' || !body.transcript.trim()) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(404).json({
        error: `No transcript available for ${symbol} Q${quarterNum} ${yearNum}.`,
      });
    }

    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=2592000');
    return res.status(200).json({
      ticker:     body.ticker   || symbol,
      year:       body.year     || yearNum,
      quarter:    body.quarter  || quarterNum,
      date:       body.date     || null,
      transcript: body.transcript,
    });
  } catch (err) {
    console.error('earnings error:', err);
    return res.status(500).json({
      error: `Failed to fetch transcript: ${err.message || 'unknown error'}`,
    });
  }
}
