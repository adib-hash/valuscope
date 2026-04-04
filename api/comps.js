// Vercel serverless function — fetches comparable company data via yahoo-finance2
// Uses curated industry comp sets + Yahoo Finance industry classification as fallback

import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// ── Curated comp sets ────────���───────────────────────────────────────────────
// Grouped by how an analyst would actually comp these businesses.
// Each company appears in exactly one group. Order within group is by typical
// market cap (largest first) for consistent display.
const COMP_GROUPS = [
  // Mega-cap Tech / Digital Advertising
  ['GOOGL', 'GOOG', 'META', 'AMZN', 'MSFT', 'AAPL'],
  // Streaming & Entertainment
  ['NFLX', 'DIS', 'WBD', 'PARA', 'CMCSA', 'ROKU'],
  // Enterprise SaaS
  ['CRM', 'ADBE', 'NOW', 'INTU', 'SAP', 'WDAY', 'TEAM', 'HUBS'],
  // Cloud Infrastructure / Dev Tools
  ['MSFT', 'AMZN', 'GOOGL', 'SNOW', 'MDB', 'DDOG', 'NET', 'CRWD'],
  // Semiconductors
  ['NVDA', 'AMD', 'AVGO', 'QCOM', 'INTC', 'TSM', 'TXN', 'MRVL'],
  // AI / Data Infrastructure
  ['NVDA', 'PLTR', 'SNOW', 'DDOG', 'MDB', 'CRWD', 'S'],
  // Payments & Fintech
  ['V', 'MA', 'PYPL', 'SQ', 'AXP', 'FIS', 'GPN', 'ADYEN'],
  // Large Banks
  ['JPM', 'BAC', 'WFC', 'C', 'USB', 'PNC', 'TFC'],
  // Investment Banks / Capital Markets
  ['GS', 'MS', 'SCHW', 'BLK', 'KKR', 'APO', 'BX'],
  // Insurance
  ['BRK-B', 'UNH', 'AIG', 'MET', 'PRU', 'ALL', 'TRV'],
  // Big Pharma
  ['LLY', 'JNJ', 'PFE', 'ABBV', 'MRK', 'NVO', 'AZN', 'BMY'],
  // Medical Devices
  ['ABT', 'ISRG', 'SYK', 'MDT', 'BSX', 'EW', 'DXCM'],
  // Healthcare Services / Managed Care
  ['UNH', 'ELV', 'CI', 'HUM', 'CVS', 'HCA'],
  // Life Sciences / Diagnostics
  ['TMO', 'DHR', 'A', 'ILMN', 'BIO', 'IQV'],
  // Oil & Gas Majors
  ['XOM', 'CVX', 'COP', 'EOG', 'PXD', 'OXY', 'SLB', 'HAL'],
  // Oil & Gas Refining
  ['PSX', 'MPC', 'VLO', 'DINO'],
  // Electric Vehicles / Auto
  ['TSLA', 'F', 'GM', 'RIVN', 'TM', 'STLA'],
  // Consumer Staples / Household
  ['PG', 'KO', 'PEP', 'CL', 'KMB', 'EL', 'CHD'],
  // Discount / Big Box Retail
  ['WMT', 'COST', 'TGT', 'DG', 'DLTR'],
  // Home Improvement
  ['HD', 'LOW', 'SHW', 'POOL'],
  // Restaurants
  ['MCD', 'SBUX', 'CMG', 'YUM', 'DPZ', 'QSR', 'WING'],
  // Specialty Retail / Apparel
  ['NKE', 'LULU', 'ULTA', 'TJX', 'ROST', 'GPS'],
  // E-commerce / Marketplaces
  ['AMZN', 'SHOP', 'ETSY', 'MELI', 'SE', 'EBAY', 'W'],
  // Travel & Mobility
  ['UBER', 'LYFT', 'ABNB', 'BKNG', 'DASH', 'EXPE', 'MAR', 'HLT'],
  // Aerospace & Defense
  ['BA', 'LMT', 'RTX', 'GE', 'NOC', 'GD', 'LHX', 'TDG'],
  // Industrials / Conglomerates
  ['HON', 'CAT', 'DE', 'MMM', 'EMR', 'ITW', 'ETN'],
  // Freight & Logistics
  ['UPS', 'FDX', 'XPO', 'ODFL', 'CHRW'],
  // Telecom
  ['T', 'VZ', 'TMUS', 'CMCSA', 'CHTR'],
  // Utilities
  ['NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE'],
  // REITs — Data Center / Tower
  ['AMT', 'CCI', 'EQIX', 'DLR'],
  // REITs — Diversified
  ['SPG', 'PLD', 'O', 'PSA', 'WELL', 'AVB'],
  // Chemicals / Materials
  ['LIN', 'APD', 'ECL', 'DD', 'DOW', 'PPG'],
  // Mining / Metals
  ['FCX', 'NEM', 'BHP', 'RIO', 'VALE'],
  // Crypto / Digital Finance
  ['COIN', 'HOOD', 'SOFI', 'MSTR'],
  // Social Media / Consumer Internet
  ['META', 'SNAP', 'PINS', 'RDDT', 'MTCH'],
  // Cybersecurity
  ['CRWD', 'PANW', 'FTNT', 'ZS', 'S', 'OKTA'],
];

// Build a lookup: symbol → list of comp group arrays it belongs to
const COMP_LOOKUP = new Map();
for (const group of COMP_GROUPS) {
  for (const sym of group) {
    if (!COMP_LOOKUP.has(sym)) COMP_LOOKUP.set(sym, []);
    COMP_LOOKUP.get(sym).push(group);
  }
}

function getCuratedComps(symbol) {
  const groups = COMP_LOOKUP.get(symbol);
  if (!groups) return null;

  // Merge all groups this symbol belongs to, excluding itself and deduplicating
  const seen = new Set([symbol]);
  const comps = [];
  for (const group of groups) {
    for (const sym of group) {
      if (!seen.has(sym)) {
        seen.add(sym);
        comps.push(sym);
      }
    }
  }
  return comps.length >= 3 ? comps.slice(0, 8) : null;
}

// ── Fetch LTM multiples for a single symbol ──────────────────────────────────
async function fetchMultiples(sym) {
  const summary = await yahooFinance.quoteSummary(sym, {
    modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile'],
  }, { validateResult: false });

  const price = summary.price || {};
  const sd    = summary.summaryDetail || {};
  const stats = summary.defaultKeyStatistics || {};
  const fd    = summary.financialData || {};
  const prof  = summary.assetProfile || {};

  const mktCap   = price.marketCap ?? null;
  const curPrice = price.regularMarketPrice ?? null;

  const ev = mktCap != null
    ? mktCap + (fd.totalDebt || 0) - (fd.totalCash || 0)
    : null;

  const revenue     = fd.totalRevenue ?? null;
  const grossProfit = fd.grossProfits ?? null;
  const ebitda      = fd.ebitda ?? null;
  const fcf         = fd.freeCashflow ?? null;

  const pe   = sd.trailingPE || stats.trailingPE || null;
  const pb   = stats.priceToBook ?? null;
  const ps   = mktCap && revenue > 0 ? mktCap / revenue : null;
  const pfcf = mktCap && fcf > 0 ? mktCap / fcf : null;

  const evEbitda = ev && ebitda > 0 ? ev / ebitda : null;
  const evSales  = ev && revenue > 0 ? ev / revenue : null;
  const evFcf    = ev && fcf > 0 ? ev / fcf : null;

  const fcfYield      = pfcf ? (1 / pfcf) * 100 : null;
  const earningsYield = pe ? (1 / pe) * 100 : null;

  const grossMargin  = revenue > 0 && grossProfit != null ? (grossProfit / revenue) * 100 : null;
  const ebitdaMargin = revenue > 0 && ebitda != null ? (ebitda / revenue) * 100 : null;
  const netMargin    = fd.profitMargins != null ? fd.profitMargins * 100 : null;
  const fcfMargin    = revenue > 0 && fcf != null ? (fcf / revenue) * 100 : null;

  const netDebt = fd.totalDebt != null && fd.totalCash != null
    ? fd.totalDebt - fd.totalCash : null;
  const netDebtToEbitda = netDebt != null && ebitda > 0 ? netDebt / ebitda : null;

  const bookValue = stats.bookValue && curPrice
    ? stats.bookValue * (mktCap / curPrice) : null;
  const opMargin = fd.operatingMargins ?? null;
  const ebit = opMargin != null && revenue ? opMargin * revenue : null;
  const nopat = ebit != null ? ebit * 0.79 : null;
  const investedCap = bookValue != null
    ? (fd.totalDebt || 0) + bookValue - (fd.totalCash || 0) : null;
  const roic = nopat != null && investedCap > 0
    ? (nopat / investedCap) * 100 : null;

  return {
    symbol:  sym,
    name:    price.shortName || price.longName || sym,
    sector:  prof.sector || '',
    industry: prof.industry || '',
    mktCap:  mktCap != null ? mktCap / 1e6 : null,
    price:   curPrice,
    change:  price.regularMarketChangePercent ?? null,
    pe, pb, ps, pfcf,
    evEbitda, evSales, evFcf,
    fcfYield, earningsYield,
    grossMargin, ebitdaMargin, netMargin, fcfMargin,
    netDebtToEbitda, roic,
    revenue: revenue != null ? revenue / 1e6 : null,
  };
}

// ── Fallback: find peers by Yahoo Finance industry classification ─────────────
async function findIndustryPeers(symbol, industry, sector, mktCap) {
  if (!industry) return [];

  // Use search to find companies, then filter by matching industry
  // Try searching for the industry name — Yahoo search returns stocks
  const searchTerms = industry.split(/[-&]/).map((s) => s.trim()).filter(Boolean);
  const query = searchTerms.slice(0, 2).join(' ');

  try {
    const results = await yahooFinance.search(query, {
      newsCount: 0, quotesCount: 20,
    }, { validateResult: false });

    const candidates = (results.quotes || [])
      .filter((q) => q.quoteType === 'EQUITY' && q.symbol !== symbol && q.exchange)
      .map((q) => q.symbol)
      .slice(0, 15);

    if (!candidates.length) return [];

    // Fetch profiles to verify industry match
    const profiles = await Promise.all(
      candidates.map(async (sym) => {
        try {
          const s = await yahooFinance.quoteSummary(sym, {
            modules: ['assetProfile', 'price'],
          }, { validateResult: false });
          return {
            symbol: sym,
            industry: s.assetProfile?.industry || '',
            sector: s.assetProfile?.sector || '',
            mktCap: s.price?.marketCap || 0,
          };
        } catch { return null; }
      })
    );

    // Filter: same industry, or same sector with reasonable market cap range
    return profiles
      .filter(Boolean)
      .filter((p) => {
        if (p.industry === industry) return true;
        // Same sector + within 10x market cap range as loose fallback
        if (p.sector === sector && mktCap) {
          const ratio = p.mktCap / mktCap;
          return ratio > 0.1 && ratio < 10;
        }
        return false;
      })
      // Prefer exact industry matches, then sort by market cap descending
      .sort((a, b) => {
        const aExact = a.industry === industry ? 1 : 0;
        const bExact = b.industry === industry ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return (b.mktCap || 0) - (a.mktCap || 0);
      })
      .slice(0, 6)
      .map((p) => p.symbol);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();

  try {
    // Step 1: Get subject company data (needed for industry fallback + display)
    const subjectData = await fetchMultiples(symbol);

    // Step 2: Find comps — curated first, industry fallback second
    let peerSymbols = getCuratedComps(symbol);
    let source = 'curated';

    if (!peerSymbols) {
      peerSymbols = await findIndustryPeers(
        symbol,
        subjectData.industry,
        subjectData.sector,
        subjectData.mktCap ? subjectData.mktCap * 1e6 : null
      );
      source = 'industry';
    }

    // Quality gate: need at least 3 comps or return nothing
    if (!peerSymbols || peerSymbols.length < 3) {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ symbol, comps: [subjectData], source: 'none' });
    }

    // Step 3: Fetch multiples for all peers in parallel
    const peerResults = await Promise.all(
      peerSymbols.map(async (sym) => {
        try { return await fetchMultiples(sym); }
        catch { return null; }
      })
    );

    const comps = [subjectData, ...peerResults.filter(Boolean)];

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ symbol, comps, source });

  } catch (err) {
    console.error('Comps error:', err);
    return res.status(500).json({ error: `Failed to fetch comps: ${err.message || ''}` });
  }
}
