// Vercel serverless function — fetches comparable company data via yahoo-finance2
// Uses recommendationsBySymbol for peer discovery + quoteSummary for LTM multiples

import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();

  try {
    // Get peer recommendations from Yahoo Finance
    const recs = await yahooFinance.recommendationsBySymbol(symbol, {}, { validateResult: false });
    const peers = (recs?.recommendedSymbols || [])
      .filter((p) => p.score >= 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!peers.length) {
      return res.status(200).json({ symbol, comps: [] });
    }

    // Fetch LTM multiples for each peer in parallel
    const allSymbols = [symbol, ...peers.map((p) => p.symbol)];
    const results = await Promise.all(
      allSymbols.map(async (sym) => {
        try {
          const summary = await yahooFinance.quoteSummary(sym, {
            modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile'],
          }, { validateResult: false });

          const price = summary.price || {};
          const sd    = summary.summaryDetail || {};
          const stats = summary.defaultKeyStatistics || {};
          const fd    = summary.financialData || {};
          const prof  = summary.assetProfile || {};

          const mktCap   = price.marketCap ?? null;
          const curPrice  = price.regularMarketPrice ?? null;

          // EV computation
          const ev = mktCap != null
            ? mktCap + (fd.totalDebt || 0) - (fd.totalCash || 0)
            : null;

          // Revenue & profitability from financialData (TTM)
          const revenue     = fd.totalRevenue ?? null;
          const grossProfit = fd.grossProfits ?? null;
          const ebitda      = fd.ebitda ?? null;
          const ocf         = fd.operatingCashflow ?? null;
          const fcf         = fd.freeCashflow ?? null;

          // Multiples
          const pe   = sd.trailingPE || stats.trailingPE || null;
          const pb   = stats.priceToBook ?? null;
          const ps   = mktCap && revenue > 0 ? mktCap / revenue : null;
          const pfcf = mktCap && fcf > 0 ? mktCap / fcf : null;

          const evEbitda = ev && ebitda > 0 ? ev / ebitda : null;
          const evSales  = ev && revenue > 0 ? ev / revenue : null;
          const evFcf    = ev && fcf > 0 ? ev / fcf : null;

          const fcfYield      = pfcf ? (1 / pfcf) * 100 : null;
          const earningsYield = pe ? (1 / pe) * 100 : null;

          // Margins
          const grossMargin  = revenue > 0 && grossProfit != null ? (grossProfit / revenue) * 100 : null;
          const ebitdaMargin = revenue > 0 && ebitda != null ? (ebitda / revenue) * 100 : null;
          const netMargin    = fd.profitMargins != null ? fd.profitMargins * 100 : null;
          const fcfMargin    = revenue > 0 && fcf != null ? (fcf / revenue) * 100 : null;

          // Leverage
          const netDebt = fd.totalDebt != null && fd.totalCash != null
            ? fd.totalDebt - fd.totalCash : null;
          const netDebtToEbitda = netDebt != null && ebitda > 0 ? netDebt / ebitda : null;

          // ROIC approximation
          const bookValue = stats.bookValue && curPrice
            ? stats.bookValue * (mktCap / curPrice) // bookValue per share × shares
            : null;
          const opMargin = fd.operatingMargins ?? null;
          const ebit = opMargin != null && revenue ? opMargin * revenue : null;
          const nopat = ebit != null ? ebit * 0.79 : null; // assume ~21% tax
          const investedCap = bookValue != null
            ? (fd.totalDebt || 0) + bookValue - (fd.totalCash || 0)
            : null;
          const roic = nopat != null && investedCap > 0
            ? (nopat / investedCap) * 100 : null;

          return {
            symbol:  sym,
            name:    price.shortName || price.longName || sym,
            sector:  prof.sector || '',
            industry: prof.industry || '',
            mktCap:  mktCap != null ? mktCap / 1e6 : null, // in millions
            price:   curPrice,
            change:  price.regularMarketChangePercent ?? null,
            // Multiples
            pe, pb, ps, pfcf,
            evEbitda, evSales, evFcf,
            fcfYield, earningsYield,
            // Margins
            grossMargin, ebitdaMargin, netMargin, fcfMargin,
            // Leverage & Returns
            netDebtToEbitda, roic,
            // Revenue for context
            revenue: revenue != null ? revenue / 1e6 : null,
            // Peer score (null for the subject company)
            _peerScore: sym === symbol ? null : (peers.find((p) => p.symbol === sym)?.score ?? null),
          };
        } catch {
          return null; // skip peers that fail
        }
      })
    );

    const comps = results.filter(Boolean);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ symbol, comps });

  } catch (err) {
    console.error('Comps error:', err);
    return res.status(500).json({ error: `Failed to fetch comps: ${err.message || ''}` });
  }
}
