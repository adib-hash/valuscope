// Name lookup — companies and 13F investors behind one function.
//
// These were separate endpoints until the Hobby plan's 12-function ceiling
// made every deployment fail the moment a 13th appeared. They are the two
// smallest functions in the app and the same shape of thing — a query string
// in, a short list of names out — so they share a handler, switched by `kind`.

import YahooFinance from 'yahoo-finance2';
import { searchFilers } from './_lib/edgar13f.js';

const yahooFinance = new YahooFinance();

export default async function handler(req, res) {
  const { q, kind } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing search query parameter "q"' });

  try {
    if (kind === 'investor') {
      const filers = await searchFilers(q.trim());
      // Filer names are effectively static.
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
      return res.status(200).json({ filers });
    }

    const results = await yahooFinance.search(q, { newsCount: 0 }, { validateResult: false });
    const quotes = (results.quotes || [])
      .filter((r) => r.quoteType === 'EQUITY')
      .slice(0, 8)
      .map((r) => ({
        symbol:   r.symbol,
        name:     r.shortname || r.longname || r.symbol,
        exchange: r.exchDisp  || r.exchange || '',
      }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(quotes);
  } catch (err) {
    console.error('Lookup error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Search failed: ${err.message}` });
  }
}
