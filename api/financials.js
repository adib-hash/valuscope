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
    // currentEV is computed below in the Now section after latestBs is available

    const years = validFinYears.map((fin, i) => {
      const endDate = fin.date;
      const yr      = endDate ? new Date(endDate).getFullYear() : '?';

      // Match balance sheet and cash flow entries to this fiscal year-end
      const bs = bsSeries.length ? findNearest(bsSeries, endDate) : {};
      const cf = cfSeries.length ? findNearest(cfSeries, endDate) : {};

      // Income statement
      const revenue     = fin.totalRevenue  ?? null;
      const grossProfit = fin.grossProfit   ?? null;
      const ebit        = fin.EBIT          ?? fin.operatingIncome ?? null;
      const ebitda      = fin.EBITDA        ?? fin.normalizedEBITDA ?? null;
      const netIncome   = fin.netIncome     ?? null;

      // Income statement additions for derived metrics
      const interestExpense = fin.interestExpense ? Math.abs(fin.interestExpense) : null;
      const taxProvision    = fin.taxProvision    ?? null;
      const pretaxIncome    = fin.pretaxIncome    ?? null;

      // Cash flow
      const ocf      = cf.operatingCashFlow ?? null;
      const fcf      = cf.freeCashFlow      ?? null;
      const buybacks = cf.repurchaseOfCapitalStock
        ? Math.abs(cf.repurchaseOfCapitalStock) : null;

      // Balance sheet
      const bookValue = bs.commonStockEquity ?? bs.stockholdersEquity ?? null;
      const totalDebt = bs.totalDebt         ?? null;
      const cash      = bs.cashCashEquivalentsAndShortTermInvestments
                     ?? bs.cashAndCashEquivalents ?? null;
      const minorityInterest   = bs.minorityInterest   ?? null;
      const currentAssets      = bs.currentAssets      ?? null;
      const currentLiabilities = bs.currentLiabilities ?? null;

      // Historical market cap: use shares OUTSTANDING at period-end (balance sheet),
      // falling back to diluted average shares only if period-end figure is missing.
      // Note: dilutedAverageShares is a weighted average used for EPS — not the right
      // figure for market cap, which needs shares outstanding at a specific date.
      const shares = bs.commonStockSharesOutstanding ?? fin.dilutedAverageShares ?? null;

      // Historical market cap = price at fiscal year-end × shares outstanding that date
      const histPrice = getPriceNear(endDate);
      const mktCap    = histPrice != null && shares ? histPrice * shares : null;

      // EV = Market Cap + Total Debt + Minority Interest − Cash
      const ev = mktCap != null
        ? mktCap + (totalDebt || 0) + (minorityInterest || 0) - (cash || 0)
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

      // Growth & Margins
      const prevFin       = i > 0 ? validFinYears[i - 1] : null;
      const prevRevenue   = prevFin?.totalRevenue ?? null;
      const grossMargin     = revenue > 0 && grossProfit != null ? (grossProfit / revenue) * 100 : null;
      const ebitdaMargin    = revenue > 0 && ebitda      != null ? (ebitda      / revenue) * 100 : null;
      const operatingMargin = revenue > 0 && ebit        != null ? (ebit        / revenue) * 100 : null;
      const netMargin       = revenue > 0 && netIncome   != null ? (netIncome   / revenue) * 100 : null;
      const fcfMargin       = revenue > 0 && fcf         != null ? (fcf         / revenue) * 100 : null;
      const revenueGrowth   = revenue && prevRevenue && prevRevenue > 0
        ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;

      // Leverage & Returns
      const netDebtRaw     = totalDebt != null && cash != null ? totalDebt - cash : null;
      const netDebtToEbitda = netDebtRaw != null && ebitda && ebitda > 0
        ? netDebtRaw / ebitda : null;
      const interestCoverage = ebit && interestExpense && interestExpense > 0
        ? ebit / interestExpense : null;
      const currentRatio = currentAssets && currentLiabilities && currentLiabilities > 0
        ? currentAssets / currentLiabilities : null;

      // ROIC = NOPAT / Invested Capital
      const effectiveTaxRate = taxProvision != null && pretaxIncome && pretaxIncome > 0
        ? Math.min(0.5, Math.max(0, taxProvision / pretaxIncome))
        : 0.21;
      const nopat = ebit != null ? ebit * (1 - effectiveTaxRate) : null;
      const investedCapital = (totalDebt || 0) + (bookValue || 0) - (cash || 0);
      const roic = nopat != null && investedCapital > 0
        ? (nopat / investedCapital) * 100 : null;

      return {
        fiscalYear:    `FY ${yr}`,
        endDate:       endDate ? new Date(endDate).toISOString().slice(0, 10) : null,
        pe, ps, pb, pfcf, pocf, pGP,
        evSales, evEbitda, evEbit, evGP, evFcf, evOcf,
        earningsYield: pe   ? (1 / pe)   * 100 : null,
        fcfYield:      pfcf ? (1 / pfcf) * 100 : null,
        buybackYield,
        // Growth & Margins
        grossMargin, ebitdaMargin, operatingMargin, netMargin, fcfMargin, revenueGrowth,
        // Leverage & Returns
        netDebtToEbitda, interestCoverage, currentRatio, roic,
        // Fundamentals
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
        netDebt:     netDebtRaw  != null ? netDebtRaw  / 1e6 : null,
        // Store effective tax rate for Now row ROIC (used below)
        _effectiveTaxRate: effectiveTaxRate,
      };
    });

    // ── "Now (LTM)" row ──────────────────────────────────────────────────────
    // Income statement: TTM figures from financialData
    const nowRevenue     = fd.totalRevenue      ?? null;
    const nowGrossProfit = fd.grossProfits      ?? null;
    const nowEbitda      = fd.ebitda            ?? null;
    const nowOcf         = fd.operatingCashflow ?? null;
    const nowFcf         = fd.freeCashflow      ?? null;

    // Balance sheet: most recent annual entry (closest to today)
    const latestBs = bsSeries.length ? findNearest(bsSeries, new Date()) : {};
    const nowBookValue       = latestBs.commonStockEquity ?? null;
    const nowMinorityInterest = latestBs.minorityInterest ?? null;

    // EV: live market cap + TTM debt/cash + most recent minority interest
    const currentEV = currentMktCap != null
      ? currentMktCap + (fd.totalDebt || 0) + (nowMinorityInterest || 0) - (fd.totalCash || 0)
      : null;

    // Price multiples: use Yahoo's pre-computed trailing P/E and P/B where available
    // (more accurate than recomputing from TTM net income, which can differ due to
    // adjustments Yahoo makes)
    const nowPe   = sd.trailingPE  || stats.trailingPE  || null;
    const nowPb   = stats.priceToBook                   ?? null;
    const nowPs   = currentMktCap && nowRevenue     > 0 ? currentMktCap / nowRevenue     : null;
    const nowPfcf = currentMktCap && nowFcf         > 0 ? currentMktCap / nowFcf         : null;
    const nowPocf = currentMktCap && nowOcf         > 0 ? currentMktCap / nowOcf         : null;
    const nowPGP  = currentMktCap && nowGrossProfit > 0 ? currentMktCap / nowGrossProfit : null;

    // EV multiples
    const nowEvSales  = currentEV && nowRevenue     > 0 ? currentEV / nowRevenue     : null;
    const nowEvEbitda = currentEV && nowEbitda      > 0 ? currentEV / nowEbitda      : null;
    const nowEvGP     = currentEV && nowGrossProfit > 0 ? currentEV / nowGrossProfit : null;
    const nowEvFcf    = currentEV && nowFcf         > 0 ? currentEV / nowFcf         : null;
    const nowEvOcf    = currentEV && nowOcf         > 0 ? currentEV / nowOcf         : null;

    // EBIT: financialData doesn't expose TTM EBIT directly; use most recent FY as proxy.
    // The tooltip in the UI makes this approximation clear to the user.
    const lastFin   = validFinYears[validFinYears.length - 1];
    const nowEbit   = lastFin ? (lastFin.EBIT ?? lastFin.operatingIncome ?? null) : null;
    const nowEvEbit = currentEV && nowEbit > 0 ? currentEV / nowEbit : null;

    // Net income: derive from trailing P/E × market cap
    // (Yahoo's trailingPE = mktCap / TTM net income, so netIncome = mktCap / PE)
    const nowNetIncome = currentMktCap && nowPe ? currentMktCap / nowPe : null;

    // Buyback yield: most recent annual CF data (same source as historical years)
    const latestCf  = cfSeries.length ? findNearest(cfSeries, new Date()) : {};
    const nowBuybackRaw = latestCf.repurchaseOfCapitalStock
      ? Math.abs(latestCf.repurchaseOfCapitalStock) : null;
    const nowBuybackYield = currentMktCap && nowBuybackRaw
      ? (nowBuybackRaw / currentMktCap) * 100 : null;

    // Shares outstanding: derive from market cap / price
    const nowSharesOut = currentMktCap && currentPrice
      ? currentMktCap / currentPrice : null;

    // Now (LTM) Growth & Margins
    const nowGrossMargin     = nowRevenue > 0 && nowGrossProfit != null ? (nowGrossProfit / nowRevenue) * 100 : null;
    const nowEbitdaMargin    = nowRevenue > 0 && nowEbitda      != null ? (nowEbitda      / nowRevenue) * 100 : null;
    const nowOperatingMargin = nowRevenue > 0 && nowEbit        != null ? (nowEbit        / nowRevenue) * 100 : null;
    const nowNetMargin       = nowRevenue > 0 && nowNetIncome   != null ? (nowNetIncome   / nowRevenue) * 100 : null;
    const nowFcfMargin       = nowRevenue > 0 && nowFcf         != null ? (nowFcf         / nowRevenue) * 100 : null;

    // Now (LTM) Leverage & Returns
    const nowNetDebtRaw      = fd.totalDebt != null && fd.totalCash != null
      ? fd.totalDebt - fd.totalCash : null;
    const nowNetDebtToEbitda = nowNetDebtRaw != null && nowEbitda && nowEbitda > 0
      ? nowNetDebtRaw / nowEbitda : null;
    const nowCurrentRatio    = latestBs.currentAssets && latestBs.currentLiabilities > 0
      ? latestBs.currentAssets / latestBs.currentLiabilities : null;

    // Now ROIC — use last historical year's effective tax rate as proxy
    const lastHistYear     = years[years.length - 1];
    const lastTaxRate      = lastHistYear?._effectiveTaxRate ?? 0.21;
    const nowNopat         = nowEbit != null ? nowEbit * (1 - lastTaxRate) : null;
    const nowInvCapital    = (fd.totalDebt || 0) + (nowBookValue || 0) - (fd.totalCash || 0);
    const nowRoic          = nowNopat != null && nowInvCapital > 0
      ? (nowNopat / nowInvCapital) * 100 : null;

    // Now interest coverage: use most recent annual interest expense as proxy
    const latestFinYear    = validFinYears[validFinYears.length - 1];
    const nowInterestExpense = latestFinYear?.interestExpense
      ? Math.abs(latestFinYear.interestExpense) : null;
    const nowInterestCoverage = nowEbit && nowInterestExpense && nowInterestExpense > 0
      ? nowEbit / nowInterestExpense : null;

    years.push({
      fiscalYear:    'Now (LTM)',
      endDate:       new Date().toISOString().slice(0, 10),
      pe: nowPe, ps: nowPs, pb: nowPb,
      pfcf: nowPfcf, pocf: nowPocf, pGP: nowPGP,
      evSales: nowEvSales, evEbitda: nowEvEbitda, evEbit: nowEvEbit,
      evGP: nowEvGP, evFcf: nowEvFcf, evOcf: nowEvOcf,
      earningsYield: nowPe   ? (1 / nowPe)   * 100 : null,
      fcfYield:      nowPfcf ? (1 / nowPfcf) * 100 : null,
      buybackYield:  nowBuybackYield,
      // Growth & Margins
      grossMargin: nowGrossMargin, ebitdaMargin: nowEbitdaMargin,
      operatingMargin: nowOperatingMargin, netMargin: nowNetMargin,
      fcfMargin: nowFcfMargin, revenueGrowth: null,
      // Leverage & Returns
      netDebtToEbitda: nowNetDebtToEbitda, interestCoverage: nowInterestCoverage,
      currentRatio: nowCurrentRatio, roic: nowRoic,
      // Fundamentals
      price:       currentPrice,
      mktCap:      currentMktCap   != null ? currentMktCap   / 1e6 : null,
      ev:          currentEV       != null ? currentEV       / 1e6 : null,
      revenue:     nowRevenue      != null ? nowRevenue      / 1e6 : null,
      grossProfit: nowGrossProfit  != null ? nowGrossProfit  / 1e6 : null,
      ebitda:      nowEbitda       != null ? nowEbitda       / 1e6 : null,
      ebit:        nowEbit         != null ? nowEbit         / 1e6 : null,
      netIncome:   nowNetIncome    != null ? nowNetIncome    / 1e6 : null,
      ocf:         nowOcf          != null ? nowOcf          / 1e6 : null,
      fcf:         nowFcf          != null ? nowFcf          / 1e6 : null,
      bookValue:   nowBookValue    != null ? nowBookValue    / 1e6 : null,
      sharesOut:   nowSharesOut    != null ? nowSharesOut    / 1e6 : null,
      netDebt:     nowNetDebtRaw   != null ? nowNetDebtRaw   / 1e6 : null,
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      companyName:   priceData.longName || priceData.shortName || symbol,
      symbol,
      exchange:      priceData.exchangeName || '',
      sector:        profile.sector              || '',
      industry:      profile.industry            || '',
      description:   profile.longBusinessSummary || '',
      currentPrice,
      change:        priceData.regularMarketChangePercent ?? null,
      currentMktCap: currentMktCap != null ? currentMktCap / 1e6 : null,
      // Signal fields
      beta:                sd.beta                    ?? null,
      dividendYield:       sd.dividendYield           ?? null,
      insiderOwnershipPct: stats.heldPercentInsiders  ?? null,
      institutionalPct:    stats.heldPercentInstitutions ?? null,
      shortInterestPct:    (stats.sharesShort && stats.sharesFloat)
        ? (stats.sharesShort / stats.sharesFloat) * 100 : null,
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
