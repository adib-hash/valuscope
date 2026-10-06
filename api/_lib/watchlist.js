// The earnings calendar's universe beyond the S&P 500: recent IPOs, large US
// tech and software names the index has not taken in, and the global
// heavyweights that move international indices. Hand-curated, so it changes
// only with a commit; a name the S&P 500 later adds is dropped from here at
// runtime rather than listed twice (see getCalendarUniverse).
//
// Symbols are Yahoo's. A US listing (common stock or ADR) is preferred
// wherever one exists, because the transcript dataset only covers US symbols.
// Roche and Nestlé use their OTC ADRs because Yahoo does not resolve their
// Swiss symbols. A suffixed symbol (005930.KS, MC.PA) is a home-exchange listing: the
// calendar shows its date, dated in that exchange's time zone, but there is no
// transcript to read and no before-open / after-close label, since those are
// New York sessions.

import { getSp500, SP500_AS_OF } from './sp500.js';

export const WATCHLIST_AS_OF = '2026-10-06';

export const GROUPS = {
  sp500: 'S&P 500',
  ipo: 'Recent IPOs',
  tech: 'US tech',
  global: 'Global',
};

// [symbol, company, sector, group]
export const WATCHLIST = [
  // Recent IPOs, 2025–26
  ['SPCX', 'SpaceX', 'Industrials', 'ipo'],
  ['CBRS', 'Cerebras Systems', 'Information Technology', 'ipo'],
  ['SKHY', 'SK Hynix', 'Information Technology', 'ipo'],
  ['CRWV', 'CoreWeave', 'Information Technology', 'ipo'],
  ['FIG', 'Figma', 'Information Technology', 'ipo'],
  ['CRCL', 'Circle Internet Group', 'Financials', 'ipo'],
  ['CHYM', 'Chime Financial', 'Financials', 'ipo'],
  ['KLAR', 'Klarna', 'Financials', 'ipo'],
  ['STUB', 'StubHub', 'Communication Services', 'ipo'],
  ['HNGE', 'Hinge Health', 'Health Care', 'ipo'],
  ['QNT', 'Quantinuum', 'Information Technology', 'ipo'],
  ['FRVO', 'Fervo Energy', 'Utilities', 'ipo'],

  // US tech and software outside the S&P 500
  ['SNOW', 'Snowflake', 'Information Technology', 'tech'],
  ['NET', 'Cloudflare', 'Information Technology', 'tech'],
  ['MDB', 'MongoDB', 'Information Technology', 'tech'],
  ['ZS', 'Zscaler', 'Information Technology', 'tech'],
  ['TEAM', 'Atlassian', 'Information Technology', 'tech'],
  ['HUBS', 'HubSpot', 'Information Technology', 'tech'],
  ['OKTA', 'Okta', 'Information Technology', 'tech'],
  ['TWLO', 'Twilio', 'Information Technology', 'tech'],
  ['GTLB', 'GitLab', 'Information Technology', 'tech'],
  ['PATH', 'UiPath', 'Information Technology', 'tech'],
  ['ESTC', 'Elastic', 'Information Technology', 'tech'],
  ['MNDY', 'monday.com', 'Information Technology', 'tech'],
  ['WIX', 'Wix.com', 'Information Technology', 'tech'],
  ['CHKP', 'Check Point Software', 'Information Technology', 'tech'],
  ['DUOL', 'Duolingo', 'Consumer Discretionary', 'tech'],
  ['TOST', 'Toast', 'Financials', 'tech'],
  ['RBLX', 'Roblox', 'Communication Services', 'tech'],
  ['ARM', 'Arm Holdings', 'Information Technology', 'tech'],
  ['SPOT', 'Spotify', 'Communication Services', 'tech'],
  ['MSTR', 'Strategy', 'Information Technology', 'tech'],
  ['SOFI', 'SoFi Technologies', 'Financials', 'tech'],
  ['AFRM', 'Affirm', 'Financials', 'tech'],
  ['ALAB', 'Astera Labs', 'Information Technology', 'tech'],
  ['CRDO', 'Credo Technology', 'Information Technology', 'tech'],
  ['NBIS', 'Nebius Group', 'Information Technology', 'tech'],
  ['IONQ', 'IonQ', 'Information Technology', 'tech'],
  ['RKLB', 'Rocket Lab', 'Industrials', 'tech'],
  ['ASTS', 'AST SpaceMobile', 'Communication Services', 'tech'],

  // Global — Europe
  ['ASML', 'ASML Holding', 'Information Technology', 'global'],
  ['SAP', 'SAP', 'Information Technology', 'global'],
  ['NVO', 'Novo Nordisk', 'Health Care', 'global'],
  ['AZN', 'AstraZeneca', 'Health Care', 'global'],
  ['NVS', 'Novartis', 'Health Care', 'global'],
  ['RHHBY', 'Roche', 'Health Care', 'global'],
  ['NSRGY', 'Nestlé', 'Consumer Staples', 'global'],
  ['MC.PA', 'LVMH', 'Consumer Discretionary', 'global'],
  ['SIE.DE', 'Siemens', 'Industrials', 'global'],
  ['SHEL', 'Shell', 'Energy', 'global'],
  ['TTE', 'TotalEnergies', 'Energy', 'global'],
  ['BP', 'BP', 'Energy', 'global'],
  ['HSBC', 'HSBC', 'Financials', 'global'],
  ['UBS', 'UBS', 'Financials', 'global'],
  ['SAN', 'Banco Santander', 'Financials', 'global'],
  ['UL', 'Unilever', 'Consumer Staples', 'global'],

  // Global — Asia
  ['TSM', 'Taiwan Semiconductor', 'Information Technology', 'global'],
  ['005930.KS', 'Samsung Electronics', 'Information Technology', 'global'],
  ['TM', 'Toyota Motor', 'Consumer Discretionary', 'global'],
  ['SONY', 'Sony Group', 'Consumer Discretionary', 'global'],
  ['MUFG', 'Mitsubishi UFJ Financial', 'Financials', 'global'],
  ['8035.T', 'Tokyo Electron', 'Information Technology', 'global'],
  ['9984.T', 'SoftBank Group', 'Communication Services', 'global'],
  ['0700.HK', 'Tencent', 'Communication Services', 'global'],
  ['BABA', 'Alibaba', 'Consumer Discretionary', 'global'],
  ['PDD', 'PDD Holdings', 'Consumer Discretionary', 'global'],
  ['JD', 'JD.com', 'Consumer Discretionary', 'global'],
  ['BIDU', 'Baidu', 'Communication Services', 'global'],
  ['1810.HK', 'Xiaomi', 'Information Technology', 'global'],
  ['1211.HK', 'BYD', 'Consumer Discretionary', 'global'],
  ['3750.HK', 'CATL', 'Industrials', 'global'],
  ['INFY', 'Infosys', 'Information Technology', 'global'],
  ['HDB', 'HDFC Bank', 'Financials', 'global'],
  ['IBN', 'ICICI Bank', 'Financials', 'global'],
  ['RELIANCE.NS', 'Reliance Industries', 'Energy', 'global'],
  ['SE', 'Sea Limited', 'Consumer Discretionary', 'global'],
  ['GRAB', 'Grab Holdings', 'Industrials', 'global'],
  ['CPNG', 'Coupang', 'Consumer Discretionary', 'global'],

  // Global — Americas outside the US, and Australia
  ['SHOP', 'Shopify', 'Information Technology', 'global'],
  ['MELI', 'MercadoLibre', 'Consumer Discretionary', 'global'],
  ['NU', 'Nu Holdings', 'Financials', 'global'],
  ['RY', 'Royal Bank of Canada', 'Financials', 'global'],
  ['VALE', 'Vale', 'Materials', 'global'],
  ['PBR', 'Petrobras', 'Energy', 'global'],
  ['BHP', 'BHP Group', 'Materials', 'global'],
  ['RIO', 'Rio Tinto', 'Materials', 'global'],
];

// Home exchange, by Yahoo suffix: the time zone a company's own announcement
// is dated in.
const EXCHANGE_TZ = {
  KS: 'Asia/Seoul',
  T: 'Asia/Tokyo',
  HK: 'Asia/Hong_Kong',
  NS: 'Asia/Kolkata',
  PA: 'Europe/Paris',
  DE: 'Europe/Berlin',
};

export function homeTimeZone(symbol) {
  const suffix = /\.([A-Z]+)$/.exec(symbol)?.[1];
  return suffix ? EXCHANGE_TZ[suffix] || null : null;
}

/**
 * The S&P 500 plus the watchlist, each company tagged with its group, and
 * home-exchange listings with the time zone their dates are read in.
 */
export async function getCalendarUniverse() {
  const sp500 = await getSp500();
  const inIndex = new Set(sp500.map((c) => c.symbol));
  const extra = WATCHLIST
    .filter(([symbol]) => !inIndex.has(symbol))
    .map(([symbol, name, sector, group]) => ({ symbol, name, sector, group, timeZone: homeTimeZone(symbol) }));
  const companies = [...sp500.map((c) => ({ ...c, group: 'sp500', timeZone: null })), ...extra];

  const counts = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, 0]));
  for (const c of companies) counts[c.group] += 1;

  return {
    companies,
    meta: {
      count: companies.length,
      groups: Object.entries(GROUPS).map(([id, label]) => ({ id, label, count: counts[id] })),
      asOf: SP500_AS_OF,
      watchlistAsOf: WATCHLIST_AS_OF,
      source: 'datasets/s-and-p-500-companies + watchlist',
    },
  };
}
