// Metric group definitions and computation helpers

export const GROUPS = {
  'Price Multiples': [
    { key: 'pe',   label: 'P/E',            color: '#4E94F8',
      formula: 'Market Cap ÷ Net Income',
      period:  'Historical: FY-end price × period-end shares ÷ FY net income. Now (LTM): live market cap ÷ TTM net income (derived from trailing P/E).' },
    { key: 'ps',   label: 'P/S',            color: '#E070A0',
      formula: 'Market Cap ÷ Revenue',
      period:  'Historical: FY-end price × period-end shares ÷ FY revenue. Now (LTM): live market cap ÷ TTM revenue.' },
    { key: 'pb',   label: 'P/B',            color: '#38D89A',
      formula: 'Market Cap ÷ Book Value of Equity',
      period:  'Historical: FY-end price × period-end shares ÷ FY book equity. Now (LTM): Yahoo Finance trailing P/B (market price ÷ book value per share).' },
    { key: 'pGP',  label: 'P/Gross Profit', color: '#E8AA30',
      formula: 'Market Cap ÷ Gross Profit',
      period:  'Historical: FY-end price × period-end shares ÷ FY gross profit. Now (LTM): live market cap ÷ TTM gross profit.' },
    { key: 'pfcf', label: 'P/FCF',          color: '#9B7AF5',
      formula: 'Market Cap ÷ Free Cash Flow',
      period:  'Historical: FY-end price × period-end shares ÷ FY FCF. Now (LTM): live market cap ÷ TTM FCF.' },
    { key: 'pocf', label: 'P/OCF',          color: '#E88A3A',
      formula: 'Market Cap ÷ Operating Cash Flow',
      period:  'Historical: FY-end price × period-end shares ÷ FY OCF. Now (LTM): live market cap ÷ TTM OCF.' },
  ],
  'EV Multiples': [
    { key: 'evEbitda', label: 'EV/EBITDA',       color: '#4E94F8',
      formula: 'Enterprise Value ÷ EBITDA',
      period:  'Historical: FY-end EV ÷ FY EBITDA. Now (LTM): current EV ÷ TTM EBITDA. EV = Market Cap + Debt + Minority Interest − Cash.' },
    { key: 'evSales',  label: 'EV/Sales',         color: '#E070A0',
      formula: 'Enterprise Value ÷ Revenue',
      period:  'Historical: FY-end EV ÷ FY revenue. Now (LTM): current EV ÷ TTM revenue.' },
    { key: 'evGP',     label: 'EV/Gross Profit',  color: '#E8AA30',
      formula: 'Enterprise Value ÷ Gross Profit',
      period:  'Historical: FY-end EV ÷ FY gross profit. Now (LTM): current EV ÷ TTM gross profit.' },
    { key: 'evEbit',   label: 'EV/EBIT',          color: '#38D89A',
      formula: 'Enterprise Value ÷ EBIT (Operating Income)',
      period:  'Historical: FY-end EV ÷ FY EBIT. Now (LTM): current EV ÷ TTM EBIT (derived from Yahoo Finance TTM operating margin × TTM revenue).' },
    { key: 'evFcf',    label: 'EV/FCF',           color: '#9B7AF5',
      formula: 'Enterprise Value ÷ Free Cash Flow',
      period:  'Historical: FY-end EV ÷ FY FCF. Now (LTM): current EV ÷ TTM FCF.' },
    { key: 'evOcf',    label: 'EV/OCF',           color: '#E88A3A',
      formula: 'Enterprise Value ÷ Operating Cash Flow',
      period:  'Historical: FY-end EV ÷ FY OCF. Now (LTM): current EV ÷ TTM OCF.' },
  ],
  'Yield Metrics': [
    { key: 'earningsYield', label: 'Earnings Yield', color: '#4E94F8', isYield: true,
      formula: 'Net Income ÷ Market Cap × 100  (= 1 ÷ P/E)',
      period:  'Inverse of P/E. Historical: FY basis. Now (LTM): TTM basis.' },
    { key: 'fcfYield',      label: 'FCF Yield',      color: '#38D89A', isYield: true,
      formula: 'Free Cash Flow ÷ Market Cap × 100  (= 1 ÷ P/FCF)',
      period:  'Inverse of P/FCF. Historical: FY basis. Now (LTM): TTM basis.' },
    { key: 'buybackYield',  label: 'Buyback Yield',  color: '#E8AA30', isYield: true,
      formula: 'Share Repurchases ÷ Market Cap × 100',
      period:  'Historical: FY repurchases ÷ FY-end market cap. Now (LTM): most recent annual repurchases ÷ current market cap.' },
  ],
  'Growth & Margins': [
    { key: 'revenueGrowth',   label: 'Rev. Growth',   color: '#38D89A', isYield: true,
      formula: '(Revenue − Prior Year Revenue) ÷ Prior Year Revenue × 100',
      period:  'YoY growth using annual fiscal year revenues. "Now (LTM)" not computed (no prior TTM baseline).' },
    { key: 'grossMargin',     label: 'Gross Margin',  color: '#4E94F8', isYield: true,
      formula: 'Gross Profit ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): TTM gross profit ÷ TTM revenue.' },
    { key: 'ebitdaMargin',    label: 'EBITDA Margin', color: '#E8AA30', isYield: true,
      formula: 'EBITDA ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): TTM EBITDA ÷ TTM revenue.' },
    { key: 'operatingMargin', label: 'Op. Margin',    color: '#9B7AF5', isYield: true,
      formula: 'EBIT (Operating Income) ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): most recent FY EBIT ÷ TTM revenue (proxy — TTM EBIT unavailable).' },
    { key: 'netMargin',       label: 'Net Margin',    color: '#E070A0', isYield: true,
      formula: 'Net Income ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): TTM net income (derived from trailing P/E) ÷ TTM revenue.' },
    { key: 'fcfMargin',       label: 'FCF Margin',    color: '#E88A3A', isYield: true,
      formula: 'Free Cash Flow ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): TTM FCF ÷ TTM revenue.' },
  ],
  'Leverage & Returns': [
    { key: 'netDebtToEbitda',  label: 'ND/EBITDA',      color: '#F25C5C',
      formula: '(Total Debt − Cash) ÷ EBITDA',
      period:  'Historical: FY-end balance sheet debt/cash ÷ FY EBITDA. Now (LTM): current debt/cash ÷ TTM EBITDA. Negative = net cash position.' },
    { key: 'interestCoverage', label: 'Int. Coverage',  color: '#4E94F8',
      formula: 'EBIT ÷ Interest Expense',
      period:  'Historical: FY EBIT ÷ FY interest expense. Now (LTM): most recent FY EBIT ÷ most recent FY interest expense (proxy).' },
    { key: 'currentRatio',     label: 'Current Ratio',  color: '#E8AA30',
      formula: 'Current Assets ÷ Current Liabilities',
      period:  'Historical: FY-end balance sheet. Now (LTM): most recent annual balance sheet.' },
    { key: 'roic',             label: 'ROIC',           color: '#38D89A', isYield: true,
      formula: 'NOPAT ÷ Invested Capital × 100  (NOPAT = EBIT × (1 − Effective Tax Rate); Invested Capital = Debt + Book Equity − Cash)',
      period:  'Historical: FY basis with FY effective tax rate. Now (LTM): most recent FY EBIT × (1 − last effective tax rate) ÷ current invested capital.' },
  ],
};

export const ALL_METRICS = Object.values(GROUPS).flat();

// ── Sector-based metric recommendations ────────────────────────────────────
// Maps Yahoo Finance sector names → recommended metrics + rationale
export const SECTOR_RECOMMENDATIONS = {
  'Technology': {
    metrics: ['pe', 'evEbitda', 'evSales', 'pfcf', 'grossMargin', 'revenueGrowth'],
    defaultGroup: 'EV Multiples',
    defaultSelected: ['evEbitda', 'evSales'],
    rationale: 'Tech stocks are typically valued on EV/EBITDA & EV/Sales, with growth and margins as key drivers.',
  },
  'Financial Services': {
    metrics: ['pb', 'pe', 'roic', 'earningsYield', 'netMargin', 'currentRatio'],
    defaultGroup: 'Price Multiples',
    defaultSelected: ['pb', 'pe'],
    rationale: 'Financials are best valued on P/B and P/E — EV multiples are less meaningful due to how debt works in banking.',
  },
  'Healthcare': {
    metrics: ['evEbitda', 'pe', 'evSales', 'pfcf', 'grossMargin', 'revenueGrowth'],
    defaultGroup: 'EV Multiples',
    defaultSelected: ['evEbitda', 'evSales'],
    rationale: 'Healthcare favors EV/EBITDA for profitable firms and EV/Sales for high-growth biotech/pharma.',
  },
  'Consumer Cyclical': {
    metrics: ['pe', 'evEbitda', 'pfcf', 'evSales', 'grossMargin', 'fcfMargin'],
    defaultGroup: 'Price Multiples',
    defaultSelected: ['pe', 'evEbitda'],
    rationale: 'Consumer cyclicals are valued on P/E & EV/EBITDA — watch margins for cyclical shifts.',
  },
  'Consumer Defensive': {
    metrics: ['pe', 'evEbitda', 'fcfYield', 'pfcf', 'grossMargin', 'netDebtToEbitda'],
    defaultGroup: 'Price Multiples',
    defaultSelected: ['pe', 'evEbitda'],
    rationale: 'Staples trade on P/E & EV/EBITDA — FCF yield and leverage matter for dividend sustainability.',
  },
  'Industrials': {
    metrics: ['evEbitda', 'pe', 'pfcf', 'roic', 'ebitdaMargin', 'netDebtToEbitda'],
    defaultGroup: 'EV Multiples',
    defaultSelected: ['evEbitda', 'pe'],
    rationale: 'Industrials are best viewed through EV/EBITDA & P/E, with ROIC as a quality signal.',
  },
  'Energy': {
    metrics: ['evEbitda', 'pfcf', 'fcfYield', 'netDebtToEbitda', 'ebitdaMargin', 'roic'],
    defaultGroup: 'EV Multiples',
    defaultSelected: ['evEbitda', 'pfcf'],
    rationale: 'Energy is valued on EV/EBITDA & FCF — leverage and cash generation matter more than earnings.',
  },
  'Real Estate': {
    metrics: ['pb', 'pe', 'evEbitda', 'fcfYield', 'netDebtToEbitda', 'currentRatio'],
    defaultGroup: 'Price Multiples',
    defaultSelected: ['pb', 'pe'],
    rationale: 'REITs and real estate trade on P/B and earnings multiples — P/FFO is ideal but P/E is a proxy.',
  },
  'Utilities': {
    metrics: ['pe', 'evEbitda', 'fcfYield', 'netDebtToEbitda', 'ebitdaMargin', 'interestCoverage'],
    defaultGroup: 'Price Multiples',
    defaultSelected: ['pe', 'evEbitda'],
    rationale: 'Utilities are valued on P/E & EV/EBITDA — leverage and interest coverage are critical for regulated businesses.',
  },
  'Communication Services': {
    metrics: ['evEbitda', 'evSales', 'pfcf', 'revenueGrowth', 'ebitdaMargin', 'fcfMargin'],
    defaultGroup: 'EV Multiples',
    defaultSelected: ['evEbitda', 'evSales'],
    rationale: 'Media & telecom are valued on EV/EBITDA & EV/Sales — growth and cash flow margins differentiate.',
  },
  'Basic Materials': {
    metrics: ['evEbitda', 'pe', 'pb', 'netDebtToEbitda', 'ebitdaMargin', 'roic'],
    defaultGroup: 'EV Multiples',
    defaultSelected: ['evEbitda', 'pe'],
    rationale: 'Materials trade on EV/EBITDA & P/E — P/B and leverage are important for capital-intensive businesses.',
  },
};

export function getSectorRecommendation(sector) {
  if (!sector) return null;
  return SECTOR_RECOMMENDATIONS[sector] || null;
}

export function isRecommendedMetric(sector, metricKey) {
  const rec = getSectorRecommendation(sector);
  return rec ? rec.metrics.includes(metricKey) : false;
}

export function getMetric(key) {
  return ALL_METRICS.find((m) => m.key === key);
}

export function formatMultiple(value, isYield = false) {
  if (value == null || !isFinite(value)) return '\u2014';
  if (isYield) return value.toFixed(1) + '%';
  return (value < 10 ? value.toFixed(2) : value.toFixed(1)) + 'x';
}

export function computeAverages(years) {
  const result = {};
  ALL_METRICS.forEach((m) => {
    const vals = years
      .map((d) => d[m.key])
      .filter((v) => v != null && isFinite(v) && v > 0);
    result[m.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  return result;
}

// Returns { [key]: { min, max, avg } } for each metric over historical years
export function computeRanges(years) {
  const result = {};
  ALL_METRICS.forEach((m) => {
    const vals = years
      .map((d) => d[m.key])
      .filter((v) => v != null && isFinite(v) && v > 0);
    if (!vals.length) { result[m.key] = null; return; }
    result[m.key] = {
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  });
  return result;
}

// Returns { [key]: 0–100 } showing what percentile the current (LTM) value is vs history
export function computePercentiles(histYears, nowYear) {
  const result = {};
  ALL_METRICS.forEach((m) => {
    const vals = histYears
      .map((d) => d[m.key])
      .filter((v) => v != null && isFinite(v) && v > 0);
    const current = nowYear?.[m.key];
    if (!vals.length || current == null || !isFinite(current)) {
      result[m.key] = null;
      return;
    }
    result[m.key] = Math.round(
      (vals.filter((v) => v <= current).length / vals.length) * 100
    );
  });
  return result;
}
