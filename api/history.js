// Deep history endpoint — extends the multiples series back 10+ years using SEC
// EDGAR fundamentals paired with Yahoo month-end prices. Yahoo alone only
// returns ~4 years of annual statements, which is too short a window to call
// anything a "historical average".
//
// The client fetches this in parallel with /api/financials and merges, so the
// dashboard renders immediately on Yahoo data and deepens when this lands.

import YahooFinance from 'yahoo-finance2';
import { lookupCik, fetchCompanyFacts, extractAnnualFundamentals } from './_lib/sec.js';
import { computeYearRow } from './_lib/valuation.js';
import { monthEndCloseNear } from './_lib/prices.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const MAX_YEARS = 15;

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();

  try {
    const cik = await lookupCik(symbol);
    if (!cik) {
      // Non-US filers and ADRs have no EDGAR XBRL data. Not an error — the
      // dashboard simply stays on its Yahoo-only history.
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
      return res.status(200).json({ symbol, years: [], source: 'none', reason: 'no-cik' });
    }

    const periodStart = new Date();
    periodStart.setFullYear(periodStart.getFullYear() - (MAX_YEARS + 2));

    const [companyFacts, priceChart] = await Promise.all([
      fetchCompanyFacts(cik),
      yahooFinance.chart(
        symbol,
        { period1: periodStart, interval: '1mo', events: 'split' },
        { validateResult: false },
      ).catch(() => null),
    ]);

    const fundamentals = extractAnnualFundamentals(companyFacts)
      .filter((f) => f.revenue != null || f.netIncome != null);

    if (!fundamentals.length) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
      return res.status(200).json({ symbol, years: [], source: 'none', reason: 'no-facts' });
    }

    // Month-end closes, used to price each fiscal year end. Yahoo reports `close`
    // already restated for splits, while EDGAR reports share counts exactly as
    // filed at the time. Multiplying the two directly understates every year
    // before a split — Apple's FY2011 market cap comes out 28x too small. So we
    // restate historical share counts into today's split-adjusted terms.
    // `close` rather than `adjclose`: the latter also backs out dividends, which
    // is right for total-return math but wrong for a point-in-time market cap.
    const quotes = priceChart?.quotes || [];
    const splits = priceChart?.events?.splits || [];

    // A price more than ~3 months from the year end isn't a year-end price.
    // Bars are matched on the date their close printed, not the bar timestamp —
    // see _lib/prices.js for the month-start trap this avoids.
    const priceNear = (date) => monthEndCloseNear(quotes, date, 100);

    // Cumulative ratio of every split that happened after `date`. Applied from
    // the date a share count was *filed*, not the period it describes: a FY2019
    // figure restated in the FY2021 10-K already reflects the 2020 split.
    const splitFactorSince = (date) => {
      const t = new Date(date).getTime();
      let factor = 1;
      for (const s of splits) {
        const num = s.numerator, den = s.denominator;
        if (!num || !den) continue;
        if (new Date(s.date).getTime() > t) factor *= num / den;
      }
      return factor;
    };

    const recent = fundamentals.slice(-MAX_YEARS);
    const years = recent.map((f, i) => computeYearRow({
      ...f,
      fiscalYear: `FY ${new Date(f.endDate).getFullYear()}`,
      price: priceNear(f.endDate),
      shares: f.shares != null
        ? f.shares * splitFactorSince(f.sharesFiled || f.endDate)
        : null,
      prevRevenue: i > 0 ? recent[i - 1].revenue : null,
    }));

    // A year with no price yields no multiples — keep only rows that carry signal.
    const usable = years.filter((y) => y.mktCap != null);

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({
      symbol,
      cik,
      years: usable,
      source: usable.length ? 'sec-edgar' : 'none',
    });

  } catch (err) {
    console.error('EDGAR history error:', err);
    // Deep history is an enhancement — never let its failure break the dashboard.
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      symbol, years: [], source: 'none', reason: 'error', error: err.message,
    });
  }
}
