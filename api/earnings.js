// Earnings calendar, surprise history and forward estimates.
//
// Valuations reprice around earnings, so knowing when the next call lands, how
// reliably the company has beaten expectations, and which way estimates are
// moving is context the multiples alone can't give.

import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const iso = (d) => {
  if (!d) return null;
  const parsed = d instanceof Date ? d : new Date(d);
  return isNaN(parsed) ? null : parsed.toISOString();
};

// Yahoo reports surprise and growth as ratios (0.1012), the UI wants percent.
const pct = (v) => (v == null ? null : v * 100);

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();

  try {
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['calendarEvents', 'earningsHistory', 'earningsTrend'],
    }, { validateResult: false });

    const cal = summary.calendarEvents?.earnings || {};

    // Yahoo gives a single date, or a two-element window when the date is not
    // yet confirmed. The earlier bound is the useful one either way.
    const dates = (cal.earningsDate || []).map(iso).filter(Boolean).sort();

    const next = dates.length ? {
      date: dates[0],
      dateEnd: dates.length > 1 ? dates[dates.length - 1] : null,
      isEstimate: cal.isEarningsDateEstimate ?? null,
      epsEstimate: cal.earningsAverage ?? null,
      epsLow: cal.earningsLow ?? null,
      epsHigh: cal.earningsHigh ?? null,
      revenueEstimate: cal.revenueAverage ?? null,
    } : null;

    const history = (summary.earningsHistory?.history || [])
      .map((h) => ({
        quarter: iso(h.quarter),
        epsActual: h.epsActual ?? null,
        epsEstimate: h.epsEstimate ?? null,
        surprisePercent: pct(h.surprisePercent),
      }))
      .filter((h) => h.quarter && h.epsActual != null)
      .sort((a, b) => new Date(a.quarter) - new Date(b.quarter));

    const trendFor = (period) => {
      const t = (summary.earningsTrend?.trend || []).find((x) => x.period === period);
      if (!t) return null;
      const rev = t.epsRevisions || {};
      return {
        period,
        endDate: iso(t.endDate),
        epsEstimate: t.earningsEstimate?.avg ?? null,
        revenueEstimate: t.revenueEstimate?.avg ?? null,
        growthPercent: pct(t.growth),
        revisionsUp: rev.upLast30days ?? null,
        revisionsDown: rev.downLast30days ?? null,
      };
    };

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({
      symbol,
      next,
      history,
      estimates: {
        currentQuarter: trendFor('0q'),
        currentYear: trendFor('0y'),
        nextYear: trendFor('+1y'),
      },
      source: 'yahoo',
    });

  } catch (err) {
    console.error('Earnings error:', err);
    // Treated as an enhancement: the panel hides itself rather than erroring.
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      symbol, next: null, history: [], estimates: {}, source: 'none', error: err.message,
    });
  }
}
