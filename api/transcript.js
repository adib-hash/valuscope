// Earnings call transcript endpoint.
//
//   /api/transcript?ticker=AAPL                  -> latest transcript + quarter list
//   /api/transcript?ticker=AAPL&year=2026&quarter=2 -> that specific call
//
// Transcripts never change once published, so successful responses are cached
// hard at the edge.

import { getTranscript, getTranscriptFallback, listQuarters } from './_lib/transcripts.js';

export default async function handler(req, res) {
  const { ticker, year, quarter, list } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();
  const fiscalYear = year ? Number(year) : null;
  const fiscalQuarter = quarter ? Number(quarter) : null;

  try {
    // Cheap path: just the quarters we hold, for populating the picker.
    if (list) {
      const quarters = await listQuarters(symbol);
      res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json({
        symbol,
        quarters: quarters.map(({ absoluteRow, ...q }) => q),
        source: quarters.length ? 'defeatbeta' : 'none',
      });
    }

    let result = null;
    try {
      result = await getTranscript(symbol, fiscalYear, fiscalQuarter);
    } catch (err) {
      console.error(`Transcript primary source failed for ${symbol}:`, err.message);
    }

    if (!result) {
      result = await getTranscriptFallback(symbol, null).catch(() => null);
    }

    if (!result) {
      res.setHeader('Cache-Control', 's-maxage=300');
      return res.status(404).json({
        error: `No earnings call transcript found for ${symbol}.`,
        symbol,
        source: 'none',
      });
    }

    // Published transcripts are immutable — cache for a week, serve stale for a month.
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=2592000');
    return res.status(200).json({
      ...result,
      // Lets the client hide the summarise button entirely on deployments with
      // no Gemini key, rather than offering an action that can only fail.
      summaryAvailable: !!process.env.GEMINI_API_KEY,
    });

  } catch (err) {
    console.error('Transcript error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed to load transcript: ${err.message}` });
  }
}
