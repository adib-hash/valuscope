// Vercel serverless function — fetches financial data via yahoo-finance2
// Uses fundamentalsTimeSeries (recommended post-Nov 2024) + chart() for prices

import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const SIX_YEARS_AGO = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 6);
  return d;
};

// Find the series entry whose date is closest to targetDate (within 6 months)
const findNearest = (series, targetDate) => {
  if (!series?.length) return {};
  const target = new Date(targetDate).getTime();
  const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;
  let best = null, bestDiff = Infinity;
  for (const y of series) {
    const diff = Math.abs(new Date(y.date).getTime() - target);
    if (diff < bestDiff && diff < SIX_MONTHS) { bestDiff = diff; best = y; }
  }
  return best || {};
};

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();

  try {
    const period1 = SIX_YEARS_AGO();

    const [summary, finSeries, bsSeries, cfSeries, priceChart] = await Promise.all([
      // quoteSummary: only non-financial modules (financial statement modules
      // are deprecated since Nov 2024 and cause errors in some environments)
      yahooFinance.quoteSummary(symbol, {
        modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile'],
      }, { validateResult: false }),

      // Annual income statement data
      yahooFinance.fundamentalsTimeSeries(symbol, {
        period1, type: 'annual', module: 'financials',
      }, { validateResult: false }),

      // Annual balance sheet data
      yahooFinance.fundamentalsTimeSeries(symbol, {
        period1, type: 'annual', module: 'balance-sheet',
      }, { validateResult: false }),

      // Annual cash flow data
      yahooFinance.fundamentalsTimeSeries(symbol, {
        period1, type: 'annual', module: 'cash-flow',
      }, { validateResult: false }),

      // Monthly price history for computing historical multiples
      yahooFinance.chart(symbol, { period1, interval: '1mo' }, { validateResult: false }),
    ]);

    // Only keep years that have the core income statement data
    const validFinYears = (finSeries || []).filter(y => y.totalRevenue != null);

    if (!validFinYears.length) {
      return res.status(404).json({
        error: `No financial data found for ${symbol}. Verify the ticker is a valid public company.`,
      });
    }

    // Find the monthly chart price nearest to a given date
    const priceQuotes = priceChart?.quotes || [];
    const getPriceNear = (date) => {
      if (!date || !priceQuotes.length) return null;
      const target = new Date(date).getTime();
      let best = null, bestDiff = Infinity;
      for (const q of priceQuotes) {
        const diff = Math.abs(new Date(q.date).getTime() - target);
        if (diff < bestDiff) { bestDiff = diff; best = q.adjclose ?? q.close; }
      }
      return best;
    };

    const priceData = summary.price                || {};
    const stats     = summary.defaultKeyStatistics || {};
    const fd        = summary.financialData        || {};
    const sd        = summary.summaryDetail        || {};
    const profile   = summary.assetProfile         || {};

    const currentPrice  = priceData.regularMarketPrice ?? null;
    const currentMktCap = priceData.marketCap          ?? null;
    const currentEV     = currentMktCap != null
      ? currentMktCap + (fd.totalDebt || 0) - (fd.totalCash || 0)
      : null;

    const years = validFinYears.map(fin => {
      const endDate = fin.date;
      const yr      = endDate ? new Date(endDate).getFullYear() : '?';

      // Match balance sheet and cash flow entries to this fiscal year-end
      const bs = findNearest(bsSeries, endDate);
      const cf = findNearest(cfSeries, endDate);

      // Income statement
      const revenue     = fin.totalRevenue  ?? null;
      const grossProfit = fin.grossProfit   ?? null;
      const ebit        = fin.EBIT          ?? fin.operatingIncome ?? null;
      const ebitda      = fin.EBITDA        ?? fin.normalizedEBITDA ?? null;
      const netIncome   = fin.netIncome     ?? null;
      const shares      = fin.dilutedAverageShares ?? null; // historical shares

      // Cash flow
      const ocf     = cf.operatingCashFlow ?? null;
      const fcf     = cf.freeCashFlow      ?? null;
      const buybacks = cf.repurchaseOfCapitalStock
        ? Math.abs(cf.repurchaseOfCapitalStock) : null;

      // Balance sheet
      const bookValue = bs.commonStockEquity ?? bs.stockholdersEquity ?? null;
      const totalDebt = bs.totalDebt         ?? null;
      const cash      = bs.cashCashEquivalentsAndShortTermInvestments
                     ?? bs.cashAndCashEquivalents ?? null;

      // Historical market cap = price at year-end × diluted shares outstanding that year
      const histPrice = getPriceNear(endDate);
      const mktCap    = histPrice != null && shares ? histPrice * shares : null;
      const ev        = mktCap != null
        ? mktCap + (totalDebt || 0) - (cash || 0)
        : null;

      const pe    = mktCap && netIncome   > 0 ? mktCap / netIncome   : null;
      const ps    = mktCap && revenue     > 0 ? mktCap / revenue     : null;
      const pb    = mktCap && bookValue   > 0 ? mktCap / bookValue   : null;
      const pfcf  = mktCap && fcf         > 0 ? mktCap / fcf         : null;
      const pocf  = mktCap && ocf         > 0 ? mktCap / ocf         : null;
      const pGP   = mktCap && grossProfit > 0 ? mktCap / grossProfit : null;
      const evSales  = ev && revenue     > 0 ? ev / revenue     : null;
      const evEbitda = ev && ebitda      > 0 ? ev / ebitda      : null;
      const evEbit   = ev && ebit        > 0 ? ev / ebit        : null;
      const evGP     = ev && grossProfit > 0 ? ev / grossProfit : null;
      const evFcf    = ev && fcf         > 0 ? ev / fcf         : null;
      const evOcf    = ev && ocf         > 0 ? ev / ocf         : null;
      const buybackYield = mktCap && buybacks ? (buybacks / mktCap) * 100 : null;

      return {
        fiscalYear:    `FY ${yr}`,
        endDate:       endDate ? new Date(endDate).toISOString().slice(0, 10) : null,
        pe, ps, pb, pfcf, pocf, pGP,
        evSales, evEbitda, evEbit, evGP, evFcf, evOcf,
        earningsYield: pe   ? (1 / pe)   * 100 : null,
        fcfYield:      pfcf ? (1 / pfcf) * 100 : null,
        buybackYield,
        price:       histPrice,
        mktCap:      mktCap      != null ? mktCap      / 1e6 : null,
        ev:          ev          != null ? ev          / 1e6 : null,
        revenue:     revenue     != null ? revenue     / 1e6 : null,
        grossProfit: grossProfit != null ? grossProfit / 1e6 : null,
        ebitda:      ebitda      != null ? ebitda      / 1e6 : null,
        ebit:        ebit        != null ? ebit        / 1e6 : null,
        netIncome:   netIncome   != null ? netIncome   / 1e6 : null,
        ocf:         ocf         != null ? ocf         / 1e6 : null,
        fcf:         fcf         != null ? fcf         / 1e6 : null,
        bookValue:   bookValue   != null ? bookValue   / 1e6 : null,
        sharesOut:   shares      != null ? shares      / 1e6 : null,
      };
    });

    // "Now (LTM)" row — TTM figures from financialData + live price
    const nowRevenue     = fd.totalRevenue      ?? null;
    const nowGrossProfit = fd.grossProfits      ?? null;
    const nowEbitda      = fd.ebitda            ?? null;
    const nowOcf         = fd.operatingCashflow ?? null;
    const nowFcf         = fd.freeCashflow      ?? null;
    const latestBs       = findNearest(bsSeries, new Date());
    const nowBookValue   = latestBs.commonStockEquity ?? null;
    const nowPe          = sd.trailingPE || stats.trailingPE || null;
    const nowPb          = stats.priceToBook ?? null;
    const nowPs          = currentMktCap && nowRevenue     > 0 ? currentMktCap / nowRevenue     : null;
    const nowPfcf        = currentMktCap && nowFcf         > 0 ? currentMktCap / nowFcf         : null;
    const nowPocf        = currentMktCap && nowOcf         > 0 ? currentMktCap / nowOcf         : null;
    const nowPGP         = currentMktCap && nowGrossProfit > 0 ? currentMktCap / nowGrossProfit : null;
    const nowEvSales     = currentEV     && nowRevenue     > 0 ? currentEV     / nowRevenue     : null;
    const nowEvEbitda    = currentEV     && nowEbitda      > 0 ? currentEV     / nowEbitda      : null;
    const nowEvGP        = currentEV     && nowGrossProfit > 0 ? currentEV     / nowGrossProfit : null;
    const nowEvFcf       = currentEV     && nowFcf         > 0 ? currentEV     / nowFcf         : null;
    const nowEvOcf       = currentEV     && nowOcf         > 0 ? currentEV     / nowOcf         : null;

    years.push({
      fiscalYear:    'Now (LTM)',
      endDate:       new Date().toISOString().slice(0, 10),
      pe: nowPe, ps: nowPs, pb: nowPb,
      pfcf: nowPfcf, pocf: nowPocf, pGP: nowPGP,
      evSales: nowEvSales, evEbitda: nowEvEbitda, evEbit: null,
      evGP: nowEvGP, evFcf: nowEvFcf, evOcf: nowEvOcf,
      earningsYield: nowPe   ? (1 / nowPe)   * 100 : null,
      fcfYield:      nowPfcf ? (1 / nowPfcf) * 100 : null,
      buybackYield:  null,
      price:       currentPrice,
      mktCap:      currentMktCap  != null ? currentMktCap  / 1e6 : null,
      ev:          currentEV      != null ? currentEV      / 1e6 : null,
      revenue:     nowRevenue     != null ? nowRevenue     / 1e6 : null,
      grossProfit: nowGrossProfit != null ? nowGrossProfit / 1e6 : null,
      ebitda:      nowEbitda      != null ? nowEbitda      / 1e6 : null,
      ebit:        null,
      netIncome:   null,
      ocf:         nowOcf         != null ? nowOcf         / 1e6 : null,
      fcf:         nowFcf         != null ? nowFcf         / 1e6 : null,
      bookValue:   nowBookValue   != null ? nowBookValue   / 1e6 : null,
      sharesOut:   null,
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      companyName:   priceData.longName || priceData.shortName || symbol,
      symbol,
      exchange:      priceData.exchangeName || '',
      sector:        profile.sector   || '',
      industry:      profile.industry || '',
      currentPrice,
      change:        priceData.regularMarketChangePercent ?? null,
      currentMktCap: currentMktCap != null ? currentMktCap / 1e6 : null,
      years,
      source:        'yahoo',
    });

  } catch (err) {
    console.error('Yahoo Finance error:', err);
    const msg = err.message || '';
    if (
      msg.includes('No fundamentals') || msg.includes('404') ||
      msg.includes('Not Found')       || msg.includes('No data found') ||
      msg.includes('Will not fetch')
    ) {
      return res.status(404).json({ error: `No data found for ${symbol}. Verify the ticker symbol.` });
    }
    return res.status(500).json({ error: `Failed to fetch data: ${msg}` });
  }
}
