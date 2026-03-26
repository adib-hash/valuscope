// Vercel serverless function — fetches financial data via yahoo-finance2
// No API key required; yahoo-finance2 scrapes Yahoo Finance's public endpoints

import yahooFinance from 'yahoo-finance2';

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();

  try {
    // Fetch all fundamental data in one call
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: [
        'price',
        'summaryDetail',
        'defaultKeyStatistics',
        'financialData',
        'incomeStatementHistory',
        'cashflowStatementHistory',
        'balanceSheetHistory',
        'assetProfile',
      ],
      validateResult: false,
    });

    const incStatements = summary.incomeStatementHistory?.incomeStatementHistory || [];
    const cfStatements  = summary.cashflowStatementHistory?.cashflowStatements   || [];
    const bsStatements  = summary.balanceSheetHistory?.balanceSheetStatements     || [];

    if (!incStatements.length) {
      return res.status(404).json({
        error: `No financial data found for ${symbol}. Verify the ticker is a valid public US company.`,
      });
    }

    // Fetch monthly historical prices to compute historical valuation multiples
    const oldestPeriod = incStatements[incStatements.length - 1]?.endDate;
    let priceHistory = [];
    if (oldestPeriod) {
      try {
        priceHistory = await yahooFinance.historical(symbol, {
          period1: oldestPeriod,
          period2: new Date(),
          interval: '1mo',
        }, { validateResult: false });
      } catch (_) {
        // Historical prices unavailable — multiples will be null for historical years
      }
    }

    // Find the monthly close price nearest to a given date
    const getPriceNear = (date) => {
      if (!date || !priceHistory.length) return null;
      const target = new Date(date).getTime();
      let best = null, bestDiff = Infinity;
      for (const p of priceHistory) {
        const diff = Math.abs(new Date(p.date).getTime() - target);
        if (diff < bestDiff) { bestDiff = diff; best = p.close; }
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
    const currentShares = stats.sharesOutstanding || stats.impliedSharesOutstanding || null;
    const currentEV     = currentMktCap != null
      ? currentMktCap + (fd.totalDebt || 0) - (fd.totalCash || 0)
      : null;

    // Yahoo returns newest-first; reverse so we go oldest → newest
    const incRev = [...incStatements].reverse();
    const cfRev  = [...cfStatements].reverse();
    const bsRev  = [...bsStatements].reverse();

    const years = incRev.map((yi, i) => {
      const yc = cfRev[i] || {};
      const yb = bsRev[i] || {};

      const endDate    = yi.endDate;
      const yr         = endDate ? new Date(endDate).getFullYear() : '?';
      const revenue    = yi.totalRevenue    ?? null;
      const grossProfit= yi.grossProfit     ?? null;
      const ebit       = yi.ebit ?? yi.operatingIncome ?? null;
      const netIncome  = yi.netIncome       ?? null;
      const ocf        = yc.totalCashFromOperatingActivities ?? null;
      const capex      = yc.capitalExpenditures ?? null; // negative in Yahoo
      const fcf        = ocf != null && capex != null ? ocf + capex : null;
      const da         = yc.depreciation    ?? null;
      const ebitda     = ebit != null && da != null ? ebit + da : null;
      const bookValue  = yb.totalStockholderEquity ?? null;
      const totalDebt  = (yb.shortLongTermDebt || 0) + (yb.longTermDebt || 0);
      const cash       = (yb.cash || 0) + (yb.shortTermInvestments || 0);

      // Historical market cap: price at year-end × current shares (approximate)
      // Note: uses current share count as proxy; small drift for most companies
      const histPrice = getPriceNear(endDate);
      const mktCap    = histPrice != null && currentShares ? histPrice * currentShares : null;
      const ev        = mktCap != null ? mktCap + totalDebt - cash : null;

      const pe    = mktCap && netIncome  > 0 ? mktCap / netIncome  : null;
      const ps    = mktCap && revenue    > 0 ? mktCap / revenue    : null;
      const pb    = mktCap && bookValue  > 0 ? mktCap / bookValue  : null;
      const pfcf  = mktCap && fcf        > 0 ? mktCap / fcf        : null;
      const pocf  = mktCap && ocf        > 0 ? mktCap / ocf        : null;
      const pGP   = mktCap && grossProfit> 0 ? mktCap / grossProfit: null;
      const evSales  = ev && revenue     > 0 ? ev / revenue    : null;
      const evEbitda = ev && ebitda      > 0 ? ev / ebitda     : null;
      const evEbit   = ev && ebit        > 0 ? ev / ebit       : null;
      const evGP     = ev && grossProfit > 0 ? ev / grossProfit: null;
      const evFcf    = ev && fcf         > 0 ? ev / fcf        : null;
      const evOcf    = ev && ocf         > 0 ? ev / ocf        : null;
      const buybacks     = yc.repurchaseOfStock ? Math.abs(yc.repurchaseOfStock) : null;
      const buybackYield = mktCap && buybacks   ? (buybacks / mktCap) * 100      : null;

      return {
        fiscalYear:   `FY ${yr}`,
        endDate:      endDate ? new Date(endDate).toISOString().slice(0, 10) : null,
        pe, ps, pb, pfcf, pocf, pGP,
        evSales, evEbitda, evEbit, evGP, evFcf, evOcf,
        earningsYield: pe   ? (1 / pe)   * 100 : null,
        fcfYield:      pfcf ? (1 / pfcf) * 100 : null,
        buybackYield,
        price:      histPrice,
        mktCap:     mktCap     != null ? mktCap     / 1e6 : null,
        ev:         ev         != null ? ev         / 1e6 : null,
        revenue:    revenue    != null ? revenue    / 1e6 : null,
        grossProfit:grossProfit!= null ? grossProfit/ 1e6 : null,
        ebitda:     ebitda     != null ? ebitda     / 1e6 : null,
        ebit:       ebit       != null ? ebit       / 1e6 : null,
        netIncome:  netIncome  != null ? netIncome  / 1e6 : null,
        ocf:        ocf        != null ? ocf        / 1e6 : null,
        fcf:        fcf        != null ? fcf        / 1e6 : null,
        bookValue:  bookValue  != null ? bookValue  / 1e6 : null,
        sharesOut:  currentShares != null ? currentShares / 1e6 : null,
      };
    }).filter(y => y.revenue != null || y.ebitda != null);

    // "Now (LTM)" row — uses TTM figures from financialData + current price
    const nowRevenue    = fd.totalRevenue     ?? null;
    const nowGrossProfit= fd.grossProfits     ?? null;
    const nowEbitda     = fd.ebitda           ?? null;
    const nowOcf        = fd.operatingCashflow?? null;
    const nowFcf        = fd.freeCashflow     ?? null;
    const nowBookValue  = bsStatements[0]?.totalStockholderEquity ?? null;
    const nowPe         = sd.trailingPE  || stats.trailingPE  || null;
    const nowPb         = stats.priceToBook ?? null;
    const nowPs         = currentMktCap && nowRevenue    > 0 ? currentMktCap / nowRevenue    : null;
    const nowPfcf       = currentMktCap && nowFcf        > 0 ? currentMktCap / nowFcf        : null;
    const nowPocf       = currentMktCap && nowOcf        > 0 ? currentMktCap / nowOcf        : null;
    const nowPGP        = currentMktCap && nowGrossProfit> 0 ? currentMktCap / nowGrossProfit: null;
    const nowEvSales    = currentEV     && nowRevenue    > 0 ? currentEV     / nowRevenue    : null;
    const nowEvEbitda   = currentEV     && nowEbitda     > 0 ? currentEV     / nowEbitda     : null;
    const nowEvGP       = currentEV     && nowGrossProfit> 0 ? currentEV     / nowGrossProfit: null;
    const nowEvFcf      = currentEV     && nowFcf        > 0 ? currentEV     / nowFcf        : null;
    const nowEvOcf      = currentEV     && nowOcf        > 0 ? currentEV     / nowOcf        : null;

    years.push({
      fiscalYear:   'Now (LTM)',
      endDate:      new Date().toISOString().slice(0, 10),
      pe:  nowPe,  ps: nowPs,  pb: nowPb,
      pfcf: nowPfcf, pocf: nowPocf, pGP: nowPGP,
      evSales: nowEvSales, evEbitda: nowEvEbitda, evEbit: null,
      evGP: nowEvGP, evFcf: nowEvFcf, evOcf: nowEvOcf,
      earningsYield: nowPe   ? (1 / nowPe)   * 100 : null,
      fcfYield:      nowPfcf ? (1 / nowPfcf) * 100 : null,
      buybackYield:  null,
      price:      currentPrice,
      mktCap:     currentMktCap != null ? currentMktCap / 1e6 : null,
      ev:         currentEV     != null ? currentEV     / 1e6 : null,
      revenue:    nowRevenue    != null ? nowRevenue    / 1e6 : null,
      grossProfit:nowGrossProfit!= null ? nowGrossProfit/ 1e6 : null,
      ebitda:     nowEbitda     != null ? nowEbitda     / 1e6 : null,
      ebit:       null,
      netIncome:  null,
      ocf:        nowOcf        != null ? nowOcf        / 1e6 : null,
      fcf:        nowFcf        != null ? nowFcf        / 1e6 : null,
      bookValue:  nowBookValue  != null ? nowBookValue  / 1e6 : null,
      sharesOut:  currentShares != null ? currentShares / 1e6 : null,
    });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      companyName:    priceData.longName || priceData.shortName || symbol,
      symbol,
      exchange:       priceData.exchangeName || '',
      sector:         profile.sector   || '',
      industry:       profile.industry || '',
      currentPrice,
      change:         priceData.regularMarketChangePercent ?? null,
      currentMktCap:  currentMktCap != null ? currentMktCap / 1e6 : null,
      years,
      source:         'yahoo',
    });

  } catch (err) {
    console.error('Yahoo Finance error:', err);
    const msg = err.message || '';
    if (msg.includes('No fundamentals') || msg.includes('404') || msg.includes('Not Found')) {
      return res.status(404).json({ error: `No data found for ${symbol}. Verify the ticker symbol.` });
    }
    return res.status(500).json({ error: `Failed to fetch data: ${msg}` });
  }
}
