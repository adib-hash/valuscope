// World index returns.
//
// Two modes, because there is no single honest answer to "what did this market
// return?". Price return on a bond fund is roughly -7% over the last sixteen
// years; total return on the same fund is roughly +48%. The difference is the
// coupons, and for bonds the coupons are the entire point. Rather than pick one
// basis and quietly mislead, both are offered:
//
//   total — investable ETF proxies, USD, dividends and coupons reinvested.
//           Every row is measured the same way, so rows are comparable.
//   price — the real indices in their own currency. Matches the headline
//           numbers in the press, but bonds and REITs understate badly and
//           cross-currency rows are not comparable.
//
// Where a market has no free total-return series (FTSE 100, Nikkei 225) a
// labelled MSCI country ETF stands in. The substitution is real, so every row
// reports the instrument it actually measured rather than hiding it.

import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// One row is a market, not a symbol — the instrument changes with the mode.
const INDICES = [
  { key: 'acwi', label: 'MSCI ACWI', group: 'Global',
    total: { symbol: 'ACWI', via: 'iShares MSCI ACWI ETF' },
    price: { symbol: 'ACWI', via: 'iShares MSCI ACWI ETF' } },

  { key: 'spx', label: 'S&P 500', group: 'Developed',
    total: { symbol: 'SPY', via: 'SPDR S&P 500 ETF' },
    price: { symbol: '^GSPC', via: 'S&P 500 index' } },

  { key: 'nasdaq', label: 'NASDAQ', group: 'Developed',
    total: { symbol: 'QQQ', via: 'Invesco QQQ — NASDAQ-100' },
    price: { symbol: '^IXIC', via: 'NASDAQ Composite index' } },

  { key: 'ftse', label: 'FTSE 100', group: 'Developed',
    total: { symbol: 'EWU', via: 'iShares MSCI UK ETF', proxy: true },
    price: { symbol: '^FTSE', via: 'FTSE 100 index' } },

  { key: 'nikkei', label: 'Nikkei 225', group: 'Developed',
    total: { symbol: 'EWJ', via: 'iShares MSCI Japan ETF', proxy: true },
    price: { symbol: '^N225', via: 'Nikkei 225 index' } },

  { key: 'india', label: 'MSCI India', group: 'Emerging',
    total: { symbol: 'INDA', via: 'iShares MSCI India ETF' },
    price: { symbol: 'INDA', via: 'iShares MSCI India ETF' } },

  { key: 'china', label: 'MSCI China', group: 'Emerging',
    total: { symbol: 'MCHI', via: 'iShares MSCI China ETF' },
    price: { symbol: 'MCHI', via: 'iShares MSCI China ETF' } },

  { key: 'reit', label: 'Real estate', group: 'Sectors & rates',
    total: { symbol: 'VNQ', via: 'Vanguard Real Estate ETF' },
    price: { symbol: 'VNQ', via: 'Vanguard Real Estate ETF' } },

  { key: 'energy', label: 'Energy', group: 'Sectors & rates',
    total: { symbol: 'XLE', via: 'Energy Select Sector SPDR' },
    price: { symbol: 'XLE', via: 'Energy Select Sector SPDR' } },

  { key: 'bonds', label: 'US bonds', group: 'Sectors & rates',
    total: { symbol: 'AGG', via: 'iShares Core US Aggregate Bond ETF' },
    price: { symbol: 'AGG', via: 'iShares Core US Aggregate Bond ETF' } },
];

// VIX is a level, not an asset. Compounding it is meaningless — it mean-reverts
// somewhere around 15-20 rather than trending — so it is reported as a level
// plus its position in its own ten-year range, never as a return.
const VIX = { key: 'vix', label: 'VIX', symbol: '^VIX', via: 'CBOE Volatility Index' };

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const HISTORY_YEARS = 11; // one spare year so the 10Y window is always covered
const SPARK_YEARS = 5;
const SPARK_POINTS = 60;

const yearsAgo = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
};

// Total return reads adjclose, which folds dividends back in. Price return
// reads close. This single line is the whole difference between the two modes.
function toSeries(quotes, mode) {
  const out = [];
  for (const q of quotes || []) {
    const v = mode === 'total' ? (q.adjclose ?? q.close) : q.close;
    if (v == null || !isFinite(v) || v <= 0 || !q.date) continue;
    const t = q.date instanceof Date ? q.date.getTime() : new Date(q.date).getTime();
    if (!isFinite(t)) continue;
    out.push({ t, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Last observation at or before the target. Binary search — the series is daily
// over eleven years, so a linear scan per period per row adds up.
function valueOnOrBefore(series, targetMs) {
  let lo = 0;
  let hi = series.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= targetMs) { best = series[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

function cumulativeReturn(series, fromMs) {
  const start = valueOnOrBefore(series, fromMs);
  const end = series[series.length - 1];
  if (!start || !end || start.v <= 0 || start.t === end.t) return null;
  return (end.v / start.v - 1) * 100;
}

// Annualised, but only when the history actually covers the window. A fund that
// launched in 2012 has no ten-year number, and inventing one from eight years of
// data would read as real.
function annualisedReturn(series, years) {
  const start = valueOnOrBefore(series, yearsAgo(years).getTime());
  const end = series[series.length - 1];
  if (!start || !end || start.v <= 0) return null;
  const actualYears = (end.t - start.t) / YEAR_MS;
  if (actualYears < years * 0.9) return null;
  return (Math.pow(end.v / start.v, 1 / actualYears) - 1) * 100;
}

// Rebased to 100 at the start so every sparkline shares a y-axis meaning.
function sparkline(series) {
  const cut = yearsAgo(SPARK_YEARS).getTime();
  const window = series.filter((p) => p.t >= cut);
  if (window.length < 2) return [];
  const base = window[0].v;
  const step = Math.max(1, Math.floor(window.length / SPARK_POINTS));
  const out = [];
  for (let i = 0; i < window.length; i += step) {
    out.push(Math.round((window[i].v / base) * 10000) / 100);
  }
  const last = window[window.length - 1];
  out.push(Math.round((last.v / base) * 10000) / 100);
  return out;
}

async function fetchSeries(symbol) {
  try {
    const chart = await yahooFinance.chart(
      symbol,
      { period1: yearsAgo(HISTORY_YEARS), interval: '1d' },
      { validateResult: false },
    );
    return { quotes: chart?.quotes || [], meta: chart?.meta || {} };
  } catch {
    // One dead symbol degrades its own row and nothing else.
    return null;
  }
}

export default async function handler(req, res) {
  const mode = req.query.mode === 'price' ? 'price' : 'total';

  try {
    const rowSymbols = INDICES.map((idx) => idx[mode].symbol);
    const allSymbols = [...rowSymbols, VIX.symbol];

    // Quotes give names and the day move in one call; charts give the history.
    // The library caps real concurrency at 4, so this is roughly three waves.
    const [quoteResults, seriesResults] = await Promise.all([
      yahooFinance.quote(allSymbols, {}, { validateResult: false }).catch(() => []),
      Promise.all(allSymbols.map(fetchSeries)),
    ]);

    const quoteList = Array.isArray(quoteResults) ? quoteResults : [quoteResults];
    const quoteBy = new Map(quoteList.filter(Boolean).map((q) => [q.symbol, q]));
    const seriesBy = new Map(allSymbols.map((s, i) => [s, seriesResults[i]]));

    const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();

    const rows = INDICES.map((idx) => {
      const spec = idx[mode];
      const raw = seriesBy.get(spec.symbol);
      const quote = quoteBy.get(spec.symbol);
      const base = {
        key: idx.key,
        label: idx.label,
        group: idx.group,
        symbol: spec.symbol,
        via: spec.via,
        isProxy: Boolean(spec.proxy),
        name: quote?.shortName || quote?.longName || null,
        currency: quote?.currency || raw?.meta?.currency || 'USD',
        level: quote?.regularMarketPrice ?? null,
        dayPct: quote?.regularMarketChangePercent ?? null,
      };

      if (!raw) return { ...base, available: false };

      const series = toSeries(raw.quotes, mode);
      if (series.length < 2) return { ...base, available: false };

      return {
        ...base,
        available: true,
        level: base.level ?? series[series.length - 1].v,
        ytd: cumulativeReturn(series, jan1),
        r1y: cumulativeReturn(series, yearsAgo(1).getTime()),
        r3y: annualisedReturn(series, 3),
        r5y: annualisedReturn(series, 5),
        r10y: annualisedReturn(series, 10),
        spark: sparkline(series),
        since: new Date(series[0].t).toISOString().slice(0, 10),
      };
    });

    // VIX: level and range, deliberately no return figures.
    const vixRaw = seriesBy.get(VIX.symbol);
    const vixQuote = quoteBy.get(VIX.symbol);
    let vix = { ...VIX, available: false };
    if (vixRaw) {
      const series = toSeries(vixRaw.quotes, 'price');
      const decade = series.filter((p) => p.t >= yearsAgo(10).getTime());
      if (decade.length > 1) {
        const values = decade.map((p) => p.v).sort((a, b) => a - b);
        const level = vixQuote?.regularMarketPrice ?? decade[decade.length - 1].v;
        const below = values.filter((v) => v <= level).length;
        vix = {
          ...VIX,
          available: true,
          level,
          dayPct: vixQuote?.regularMarketChangePercent ?? null,
          low: values[0],
          high: values[values.length - 1],
          median: values[Math.floor(values.length / 2)],
          percentile: Math.round((below / values.length) * 100),
          spark: sparkline(decade),
        };
      }
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({
      mode,
      rows,
      vix,
      asOf: new Date().toISOString(),
      source: 'yahoo',
    });

  } catch (err) {
    console.error('Indices error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed to load indices: ${err.message}` });
  }
}
