// Vercel serverless function — fetches comparable company data via yahoo-finance2
// Uses curated industry comp sets + Yahoo Finance industry classification as fallback

import YahooFinance from 'yahoo-finance2';
import { similarPeers, geminiPeers } from './_lib/peers.js';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// ── Curated comp sets ────────���───────────────────────────────────────────────
// Grouped by how an analyst would actually comp these businesses.
// Each company appears in exactly one group. Order within group is by typical
// market cap (largest first) for consistent display.
const COMP_GROUPS = [
  // Mega-cap Tech / Digital Advertising
  ['GOOGL', 'META', 'AMZN', 'MSFT', 'AAPL'],
  // Streaming & Entertainment
  ['NFLX', 'DIS', 'WBD', 'PSKY', 'CMCSA', 'ROKU'],
  // Enterprise SaaS
  ['CRM', 'ADBE', 'NOW', 'INTU', 'SAP', 'WDAY', 'TEAM', 'HUBS'],
  // Cloud Infrastructure / Dev Tools
  ['MSFT', 'AMZN', 'GOOGL', 'SNOW', 'MDB', 'DDOG', 'NET', 'CRWD'],
  // Semiconductors
  ['NVDA', 'AMD', 'AVGO', 'QCOM', 'INTC', 'TSM', 'TXN', 'MRVL'],
  // AI / Data Infrastructure
  ['NVDA', 'PLTR', 'SNOW', 'DDOG', 'MDB', 'CRWD', 'S'],
  // Payments & Fintech
  ['V', 'MA', 'PYPL', 'XYZ', 'AXP', 'FIS', 'GPN', 'ADYEY'],
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
  ['XOM', 'CVX', 'COP', 'EOG', 'FANG', 'OXY', 'SLB', 'HAL'],
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
  ['NKE', 'LULU', 'ULTA', 'TJX', 'ROST', 'GAP'],
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

// A peer set can cross currencies (SAP in a US SaaS comp, TSM among semis).
// Statement fields arrive in the filing currency, so convert them at the
// latest rate before any multiple is computed — same bug class as the
// financials endpoint's historical conversion.
const fxRateCache = new Map(); // "JPYUSD" → { rate, at }
async function latestFxRate(from, to) {
  const key = from + to;
  const hit = fxRateCache.get(key);
  if (hit && Date.now() - hit.at < 3600e3) return hit.rate;
  const p1 = new Date();
  p1.setDate(p1.getDate() - 7);
  const chart = await yahooFinance.chart(`${from}${to}=X`,
    { period1: p1, interval: '1d' }, { validateResult: false });
  const bars = (chart?.quotes || []).filter((q) => (q.adjclose ?? q.close) != null);
  const rate = bars.length ? (bars[bars.length - 1].adjclose ?? bars[bars.length - 1].close) : null;
  if (rate) fxRateCache.set(key, { rate, at: Date.now() });
  return rate;
}

const FD_MONETARY = ['totalRevenue', 'grossProfits', 'ebitda', 'operatingCashflow',
  'freeCashflow', 'totalDebt', 'totalCash'];

// ── Fetch LTM multiples for a single symbol ──────────────────────────────────
async function fetchMultiples(sym) {
  const TWO_YEARS_AGO = new Date();
  TWO_YEARS_AGO.setFullYear(TWO_YEARS_AGO.getFullYear() - 2);

  const [summary, qtrCf] = await Promise.all([
    yahooFinance.quoteSummary(sym, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile'],
    }, { validateResult: false }),
    // Quarterly cash flow, so P/FCF here matches the financials endpoint's
    // TTM-from-quarterlies definition instead of Yahoo's levered-FCF field
    // (which put AAPL at 43x on this table and 34x on the overview).
    yahooFinance.fundamentalsTimeSeries(sym, {
      period1: TWO_YEARS_AGO, type: 'quarterly', module: 'cash-flow',
    }, { validateResult: false }).catch(() => null),
  ]);

  const price = summary.price || {};
  const sd    = summary.summaryDetail || {};
  const stats = summary.defaultKeyStatistics || {};
  const fd    = summary.financialData || {};
  const prof  = summary.assetProfile || {};

  const mktCap   = price.marketCap ?? null;
  const curPrice = price.regularMarketPrice ?? null;

  const sumLast4 = (series, key) => {
    const valid = (series || []).filter((q) => q[key] != null).slice(-4);
    if (valid.length < 4) return null;
    return valid.reduce((acc, q) => acc + q[key], 0);
  };
  let fcfTtm = sumLast4(qtrCf, 'freeCashFlow');

  // Currency normalization: statements in the filing currency, cap in the
  // trading currency. Convert at the latest rate; if the rate is unavailable,
  // null the statement fields rather than serve mixed-currency multiples.
  const finCcy = fd.financialCurrency, tradeCcy = price.currency;
  if (finCcy && tradeCcy && finCcy !== tradeCcy && tradeCcy !== 'GBp') {
    const rate = await latestFxRate(finCcy, tradeCcy).catch(() => null);
    if (rate) {
      for (const f of FD_MONETARY) if (fd[f] != null) fd[f] *= rate;
      if (stats.bookValue != null) stats.bookValue *= rate;
      if (fcfTtm != null) fcfTtm *= rate;
    } else {
      for (const f of FD_MONETARY) fd[f] = null;
      stats.bookValue = null;
      fcfTtm = null;
    }
  }

  const ev = mktCap != null
    ? mktCap + (fd.totalDebt || 0) - (fd.totalCash || 0)
    : null;

  const revenue     = fd.totalRevenue ?? null;
  const grossProfit = fd.grossProfits ?? null;
  const ebitda      = fd.ebitda ?? null;
  const fcf         = fcfTtm ?? fd.freeCashflow ?? null;

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
    description: prof.longBusinessSummary || '',
    mktCap:  mktCap != null ? mktCap / 1e6 : null,
    price:   curPrice,
    change:  price.regularMarketChangePercent != null
                 ? price.regularMarketChangePercent * 100 : null, // quoteSummary returns a fraction, not a percent
    pe, pb, ps, pfcf,
    evEbitda, evSales, evFcf,
    fcfYield, earningsYield,
    grossMargin, ebitdaMargin, netMargin, fcfMargin,
    netDebtToEbitda, roic,
    revenue: revenue != null ? revenue / 1e6 : null,
  };
}

export default async function handler(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();

  try {
    // Step 1: Get subject company data (needed for industry fallback + display)
    const subjectData = await fetchMultiples(symbol);

    // Step 2: the discovery ladder. Curated sets are analyst-grade and win
    // outright. Yahoo's similar-stocks graph, industry-verified, covers most
    // liquid names. Gemini handles the idiosyncratic tail — and only the tail,
    // so the model is rarely in the hot path.
    const subjectForPeers = {
      name: subjectData.name,
      sector: subjectData.sector,
      industry: subjectData.industry,
      description: subjectData.description,
      mktCap: subjectData.mktCap ? subjectData.mktCap * 1e6 : null,
    };

    let peerSymbols = getCuratedComps(symbol);
    let source = 'curated';

    if (!peerSymbols) {
      peerSymbols = await similarPeers(yahooFinance, symbol, subjectForPeers);
      source = 'similar';
    }

    if (source !== 'curated' && peerSymbols.length < 3) {
      const ai = await geminiPeers(yahooFinance, symbol, subjectForPeers);
      if (ai.length) {
        const seen = new Set(peerSymbols);
        peerSymbols = [...peerSymbols, ...ai.filter((t) => !seen.has(t))].slice(0, 8);
        source = 'ai';
      }
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

    // The description was only ever a briefing for Gemini — strip it so the
    // payload doesn't carry a paragraph of prose per row. Share classes of the
    // same issuer (GOOGL/GOOG, BRK-A/-B) collapse to the first row seen, so a
    // company is never counted twice in the peer median.
    const seenNames = new Set();
    const comps = [subjectData, ...peerResults.filter(Boolean)]
      .filter((c) => {
        const nameKey = (c.name || c.symbol).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (seenNames.has(nameKey)) return false;
        seenNames.add(nameKey);
        return true;
      })
      .map(({ description, ...c }) => c);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ symbol, comps, source });

  } catch (err) {
    console.error('Comps error:', err);
    return res.status(500).json({ error: `Failed to fetch comps: ${err.message || ''}` });
  }
}
