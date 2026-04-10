// Serverless endpoint: fetches stock price history at a given range.
// Ranges: 1D, 5D, 1M, YTD, 1Y, 5Y, MAX

import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

function resolveRange(range) {
  const now = new Date();
  const r = (range || '1Y').toUpperCase();

  const daysAgo = (n) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  };
  const yearsAgo = (n) => {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - n);
    return d;
  };

  switch (r) {
    case '1D':  return { period1: daysAgo(1),  interval: '5m'  };
    case '5D':  return { period1: daysAgo(5),  interval: '30m' };
    case '1M':  return { period1: daysAgo(31), interval: '1d'  };
    case 'YTD': return { period1: new Date(now.getFullYear(), 0, 1), interval: '1d' };
    case '1Y':  return { period1: yearsAgo(1), interval: '1d'  };
    case '5Y':  return { period1: yearsAgo(5), interval: '1wk' };
    case 'MAX': return { period1: yearsAgo(30), interval: '1mo' };
    default:    return { period1: yearsAgo(1), interval: '1d'  };
  }
}

export default async function handler(req, res) {
  const { ticker, range = '1Y' } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();
  const { period1, interval } = resolveRange(range);

  try {
    const chart = await yahooFinance.chart(
      symbol,
      { period1, interval, includePrePost: false },
      { validateResult: false }
    );

    const quotes = (chart?.quotes || [])
      .filter((q) => q && q.date && (q.close != null || q.adjclose != null))
      .map((q) => ({
        date:  new Date(q.date).toISOString(),
        close: q.adjclose ?? q.close,
        volume: q.volume ?? null,
      }));

    if (!quotes.length) {
      return res.status(404).json({ error: `No price history for ${symbol}.` });
    }

    const first = quotes[0].close;
    const last  = quotes[quotes.length - 1].close;
    const change = last - first;
    const changePct = first > 0 ? (change / first) * 100 : null;

    const meta = chart?.meta || {};
    const currency = meta.currency || 'USD';
    const exchange = meta.exchangeName || meta.fullExchangeName || '';
    const currentPrice = meta.regularMarketPrice ?? last;

    // Cache based on range granularity
    const maxAge = interval === '5m' || interval === '30m' ? 60 : 300;
    res.setHeader('Cache-Control', `s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`);

    return res.status(200).json({
      symbol,
      range: range.toUpperCase(),
      interval,
      currency,
      exchange,
      currentPrice,
      first,
      last,
      change,
      changePct,
      quotes,
    });
  } catch (err) {
    console.error('priceHistory error:', err);
    const msg = err.message || '';
    if (msg.includes('404') || msg.includes('Not Found') || msg.includes('No data')) {
      return res.status(404).json({ error: `No price history found for ${symbol}.` });
    }
    return res.status(500).json({ error: `Failed to fetch price history: ${msg}` });
  }
}
