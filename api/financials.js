// Vercel serverless function — proxies FMP API calls server-side (no CORS)
// Deploy: Vercel auto-detects /api/*.js as serverless functions

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

export default async function handler(req, res) {
  const { ticker } = req.query;

  if (!ticker) {
    return res.status(400).json({ error: 'Missing ticker parameter' });
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'FMP_API_KEY not configured. Add it to Vercel environment variables.' });
  }

  const symbol = ticker.toUpperCase().trim();

  try {
    // Fetch all data in parallel
    const [profileRes, metricsRes, incomeRes, cashflowRes, quoteRes, searchRes] = await Promise.all([
      fetch(`${FMP_BASE}/profile/${symbol}?apikey=${apiKey}`),
      fetch(`${FMP_BASE}/key-metrics/${symbol}?limit=6&apikey=${apiKey}`),
      fetch(`${FMP_BASE}/income-statement/${symbol}?limit=6&apikey=${apiKey}`),
      fetch(`${FMP_BASE}/cash-flow-statement/${symbol}?limit=6&apikey=${apiKey}`),
      fetch(`${FMP_BASE}/quote/${symbol}?apikey=${apiKey}`),
      // Also fetch balance sheet for book value
      fetch(`${FMP_BASE}/balance-sheet-statement/${symbol}?limit=6&apikey=${apiKey}`),
    ]);

    const [profile, metrics, income, cashflow, quote, balanceSheet] = await Promise.all([
      profileRes.json(),
      metricsRes.json(),
      incomeRes.json(),
      cashflowRes.json(),
      quoteRes.json(),
      searchRes.json(),
    ]);

    // Validate we got data
    if (!metrics?.length && !income?.length) {
      return res.status(404).json({ error: `No financial data found for ${symbol}` });
    }

    // Build structured response
    const p = profile?.[0] || {};
    const q = quote?.[0] || {};

    // Reverse arrays so oldest is first (FMP returns newest first)
    const m = (metrics || []).slice(0, 6).reverse();
    const inc = (income || []).slice(0, 6).reverse();
    const cf = (cashflow || []).slice(0, 6).reverse();
    const bs = (balanceSheet || []).slice(0, 6).reverse();

    const years = m.map((ym, i) => {
      const yi = inc[i] || {};
      const yc = cf[i] || {};
      const yb = bs[i] || {};
      const yr = ym.calendarYear || ym.date?.slice(0, 4) || '?';

      return {
        fiscalYear: `FY ${yr}`,
        endDate: ym.date,
        // Pre-computed multiples from FMP key-metrics
        pe: ym.peRatio,
        ps: ym.priceToSalesRatio,
        pb: ym.pbRatio,
        pfcf: ym.pfcfRatio,
        pocf: ym.pocfratio,
        pGP: ym.marketCap && yi.grossProfit ? ym.marketCap / yi.grossProfit : null,
        evSales: ym.evToSales,
        evEbitda: ym.enterpriseValueOverEBITDA,
        evGP: ym.enterpriseValue && yi.grossProfit ? ym.enterpriseValue / yi.grossProfit : null,
        evEbit: ym.enterpriseValue && yi.operatingIncome > 0 ? ym.enterpriseValue / yi.operatingIncome : null,
        evFcf: ym.evToFreeCashFlow,
        evOcf: ym.evToOperatingCashFlow,
        earningsYield: ym.earningsYield != null ? ym.earningsYield * 100 : null,
        fcfYield: ym.freeCashFlowYield != null ? ym.freeCashFlowYield * 100 : null,
        buybackYield: ym.buybackYield != null ? ym.buybackYield * 100 : null,
        // Raw fundamentals (in millions)
        price: ym.marketCap && yi.weightedAverageShsOutDil ? ym.marketCap / yi.weightedAverageShsOutDil : null,
        mktCap: ym.marketCap ? ym.marketCap / 1e6 : null,
        ev: ym.enterpriseValue ? ym.enterpriseValue / 1e6 : null,
        revenue: yi.revenue ? yi.revenue / 1e6 : null,
        grossProfit: yi.grossProfit ? yi.grossProfit / 1e6 : null,
        ebitda: yi.ebitda ? yi.ebitda / 1e6 : null,
        ebit: yi.operatingIncome ? yi.operatingIncome / 1e6 : null,
        netIncome: yi.netIncome ? yi.netIncome / 1e6 : null,
        ocf: yc.operatingCashFlow ? yc.operatingCashFlow / 1e6 : null,
        fcf: yc.freeCashFlow ? yc.freeCashFlow / 1e6 : null,
        bookValue: yb.totalStockholdersEquity ? yb.totalStockholdersEquity / 1e6 : null,
        sharesOut: yi.weightedAverageShsOutDil ? yi.weightedAverageShsOutDil / 1e6 : null,
      };
    }).filter(y => y.pe != null || y.evEbitda != null || y.revenue != null);

    // Add "Now (LTM)" row from latest metrics + live quote
    if (q.price && metrics?.length > 0) {
      const latestM = metrics[0]; // most recent (unreversed)
      const latestI = income?.[0] || {};
      const latestC = cashflow?.[0] || {};
      const latestB = balanceSheet?.[0] || {};
      const nowMktCap = q.marketCap;
      const nowEV = latestM.enterpriseValue;

      years.push({
        fiscalYear: 'Now (LTM)',
        endDate: new Date().toISOString().slice(0, 10),
        pe: q.pe,
        ps: nowMktCap && latestI.revenue ? nowMktCap / latestI.revenue : null,
        pb: latestM.pbRatio,
        pfcf: latestM.pfcfRatio,
        pocf: latestM.pocfratio,
        pGP: nowMktCap && latestI.grossProfit ? nowMktCap / latestI.grossProfit : null,
        evSales: latestM.evToSales,
        evEbitda: latestM.enterpriseValueOverEBITDA,
        evGP: nowEV && latestI.grossProfit ? nowEV / latestI.grossProfit : null,
        evEbit: nowEV && latestI.operatingIncome > 0 ? nowEV / latestI.operatingIncome : null,
        evFcf: latestM.evToFreeCashFlow,
        evOcf: latestM.evToOperatingCashFlow,
        earningsYield: latestM.earningsYield != null ? latestM.earningsYield * 100 : null,
        fcfYield: latestM.freeCashFlowYield != null ? latestM.freeCashFlowYield * 100 : null,
        buybackYield: latestM.buybackYield != null ? latestM.buybackYield * 100 : null,
        price: q.price,
        mktCap: nowMktCap ? nowMktCap / 1e6 : null,
        ev: nowEV ? nowEV / 1e6 : null,
        revenue: latestI.revenue ? latestI.revenue / 1e6 : null,
        grossProfit: latestI.grossProfit ? latestI.grossProfit / 1e6 : null,
        ebitda: latestI.ebitda ? latestI.ebitda / 1e6 : null,
        ebit: latestI.operatingIncome ? latestI.operatingIncome / 1e6 : null,
        netIncome: latestI.netIncome ? latestI.netIncome / 1e6 : null,
        ocf: latestC.operatingCashFlow ? latestC.operatingCashFlow / 1e6 : null,
        fcf: latestC.freeCashFlow ? latestC.freeCashFlow / 1e6 : null,
        bookValue: latestB.totalStockholdersEquity ? latestB.totalStockholdersEquity / 1e6 : null,
        sharesOut: latestI.weightedAverageShsOutDil ? latestI.weightedAverageShsOutDil / 1e6 : null,
      });
    }

    const result = {
      companyName: p.companyName || q.name || symbol,
      symbol: symbol,
      exchange: p.exchangeShortName || '',
      sector: p.sector || '',
      industry: p.industry || '',
      currentPrice: q.price || null,
      change: q.changesPercentage || null,
      currentMktCap: q.marketCap ? q.marketCap / 1e6 : null,
      years,
      source: 'fmp',
    };

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);

  } catch (err) {
    console.error('FMP fetch error:', err);
    return res.status(500).json({ error: `Failed to fetch data: ${err.message}` });
  }
}
