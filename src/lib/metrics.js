// Metric group definitions and computation helpers

export const GROUPS = {
  'Price Multiples': [
    { key: 'pe',   label: 'P/E',            color: 'rgb(var(--vs-blue))',
      formula: 'Market Cap ÷ Net Income',
      period:  'Historical: FY-end price × period-end shares ÷ FY net income. Now (LTM): live market cap ÷ TTM net income (derived from trailing P/E).' },
    { key: 'ps',   label: 'P/S',            color: 'rgb(var(--vs-rose))',
      formula: 'Market Cap ÷ Revenue',
      period:  'Historical: FY-end price × period-end shares ÷ FY revenue. Now (LTM): live market cap ÷ TTM revenue.' },
    { key: 'pb',   label: 'P/B',            color: 'rgb(var(--vs-green))',
      formula: 'Market Cap ÷ Book Value of Equity',
      period:  'Historical: FY-end price × period-end shares ÷ FY book equity. Now (LTM): Yahoo Finance trailing P/B (market price ÷ book value per share).' },
    { key: 'pGP',  label: 'P/Gross Profit', color: 'rgb(var(--vs-amber))',
      formula: 'Market Cap ÷ Gross Profit',
      period:  'Historical: FY-end price × period-end shares ÷ FY gross profit. Now (LTM): live market cap ÷ TTM gross profit.' },
    { key: 'pfcf', label: 'P/FCF',          color: 'rgb(var(--vs-violet))',
      formula: 'Market Cap ÷ Free Cash Flow',
      period:  'Historical: FY-end price × period-end shares ÷ FY FCF. Now (LTM): live market cap ÷ TTM FCF.' },
    { key: 'pocf', label: 'P/OCF',          color: 'rgb(var(--vs-orange))',
      formula: 'Market Cap ÷ Operating Cash Flow',
      period:  'Historical: FY-end price × period-end shares ÷ FY OCF. Now (LTM): live market cap ÷ TTM OCF.' },
  ],
  'EV Multiples': [
    { key: 'evEbitda', label: 'EV/EBITDA',       color: 'rgb(var(--vs-blue))',
      formula: 'Enterprise Value ÷ EBITDA',
      period:  'Historical: FY-end EV ÷ FY EBITDA. Now (LTM): current EV ÷ TTM EBITDA. EV = Market Cap + Debt + Minority Interest − Cash.' },
    { key: 'evSales',  label: 'EV/Sales',         color: 'rgb(var(--vs-rose))',
      formula: 'Enterprise Value ÷ Revenue',
      period:  'Historical: FY-end EV ÷ FY revenue. Now (LTM): current EV ÷ TTM revenue.' },
    { key: 'evGP',     label: 'EV/Gross Profit',  color: 'rgb(var(--vs-amber))',
      formula: 'Enterprise Value ÷ Gross Profit',
      period:  'Historical: FY-end EV ÷ FY gross profit. Now (LTM): current EV ÷ TTM gross profit.' },
    { key: 'evEbit',   label: 'EV/EBIT',          color: 'rgb(var(--vs-green))',
      formula: 'Enterprise Value ÷ EBIT (Operating Income)',
      period:  'Historical: FY-end EV ÷ FY EBIT. Now (LTM): current EV ÷ TTM EBIT (derived from Yahoo Finance TTM operating margin × TTM revenue).' },
    { key: 'evFcf',    label: 'EV/FCF',           color: 'rgb(var(--vs-violet))',
      formula: 'Enterprise Value ÷ Free Cash Flow',
      period:  'Historical: FY-end EV ÷ FY FCF. Now (LTM): current EV ÷ TTM FCF.' },
    { key: 'evOcf',    label: 'EV/OCF',           color: 'rgb(var(--vs-orange))',
      formula: 'Enterprise Value ÷ Operating Cash Flow',
      period:  'Historical: FY-end EV ÷ FY OCF. Now (LTM): current EV ÷ TTM OCF.' },
  ],
  'Yield Metrics': [
    { key: 'earningsYield', label: 'Earnings Yield', color: 'rgb(var(--vs-blue))', isYield: true,
      formula: 'Net Income ÷ Market Cap × 100  (= 1 ÷ P/E)',
      period:  'Inverse of P/E. Historical: FY basis. Now (LTM): TTM basis.' },
    { key: 'fcfYield',      label: 'FCF Yield',      color: 'rgb(var(--vs-green))', isYield: true,
      formula: 'Free Cash Flow ÷ Market Cap × 100  (= 1 ÷ P/FCF)',
      period:  'Inverse of P/FCF. Historical: FY basis. Now (LTM): TTM basis.' },
    { key: 'buybackYield',  label: 'Buyback Yield',  color: 'rgb(var(--vs-amber))', isYield: true,
      formula: 'Share Repurchases ÷ Market Cap × 100',
      period:  'Historical: FY repurchases ÷ FY-end market cap. Now (LTM): most recent annual repurchases ÷ current market cap.' },
  ],
  'Growth & Margins': [
    { key: 'revenueGrowth', signed: true,   label: 'Rev. Growth',   color: 'rgb(var(--vs-green))', isYield: true,
      formula: '(Revenue − Prior Year Revenue) ÷ Prior Year Revenue × 100',
      period:  'YoY growth using annual fiscal year revenues. "Now (LTM)" not computed (no prior TTM baseline).' },
    { key: 'grossMargin', signed: true,     label: 'Gross Margin',  color: 'rgb(var(--vs-blue))', isYield: true,
      formula: 'Gross Profit ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): TTM gross profit ÷ TTM revenue.' },
    { key: 'ebitdaMargin', signed: true,    label: 'EBITDA Margin', color: 'rgb(var(--vs-amber))', isYield: true,
      formula: 'EBITDA ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): TTM EBITDA ÷ TTM revenue.' },
    { key: 'operatingMargin', signed: true, label: 'Op. Margin',    color: 'rgb(var(--vs-violet))', isYield: true,
      formula: 'EBIT (Operating Income) ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): most recent FY EBIT ÷ TTM revenue (proxy — TTM EBIT unavailable).' },
    { key: 'netMargin', signed: true,       label: 'Net Margin',    color: 'rgb(var(--vs-rose))', isYield: true,
      formula: 'Net Income ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): TTM net income (derived from trailing P/E) ÷ TTM revenue.' },
    { key: 'fcfMargin', signed: true,       label: 'FCF Margin',    color: 'rgb(var(--vs-orange))', isYield: true,
      formula: 'Free Cash Flow ÷ Revenue × 100',
      period:  'Historical: FY basis. Now (LTM): TTM FCF ÷ TTM revenue.' },
  ],
  'Leverage & Returns': [
    { key: 'netDebtToEbitda', signed: true,  label: 'ND/EBITDA',      color: 'rgb(var(--vs-red))',
      formula: '(Total Debt − Cash) ÷ EBITDA',
      period:  'Historical: FY-end balance sheet debt/cash ÷ FY EBITDA. Now (LTM): current debt/cash ÷ TTM EBITDA. Negative = net cash position.' },
    { key: 'interestCoverage', signed: true, label: 'Int. Coverage',  color: 'rgb(var(--vs-blue))',
      formula: 'EBIT ÷ Interest Expense',
      period:  'Historical: FY EBIT ÷ FY interest expense. Now (LTM): most recent FY EBIT ÷ most recent FY interest expense (proxy).' },
    { key: 'currentRatio',     label: 'Current Ratio',  color: 'rgb(var(--vs-amber))',
      formula: 'Current Assets ÷ Current Liabilities',
      period:  'Historical: FY-end balance sheet. Now (LTM): most recent annual balance sheet.' },
    { key: 'roic', signed: true,             label: 'ROIC',           color: 'rgb(var(--vs-green))', isYield: true,
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

// Multiples and yields only exist above zero — a negative P/E is a loss year,
// not a cheap one — so unsigned metrics keep the positive-only filter. Signed
// metrics (growth, margins, ROIC, leverage) carry real information below zero:
// dropping a company's down years from its average revenue growth, or its
// net-cash years from ND/EBITDA, overstates both.
const usable = (m) => (v) => v != null && isFinite(v) && (m.signed || v > 0);

export function computeAverages(years) {
  const result = {};
  ALL_METRICS.forEach((m) => {
    const vals = years.map((d) => d[m.key]).filter(usable(m));
    result[m.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  return result;
}

// Returns { [key]: { min, max, avg } } for each metric over historical years
export function computeRanges(years) {
  const result = {};
  ALL_METRICS.forEach((m) => {
    const vals = years.map((d) => d[m.key]).filter(usable(m));
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
    const vals = histYears.map((d) => d[m.key]).filter(usable(m));
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

// Valuation regime from a metric's percentile against its own history.
// Shared so the dashboard badge and the watchlist rows can never disagree.
export function getRegime(percentile) {
  if (percentile == null) return null;
  if (percentile <= 20) return { label: 'DEEP VALUE',  color: 'rgb(var(--vs-green))' };
  if (percentile <= 40) return { label: 'UNDERVALUED', color: 'rgb(var(--vs-blue))' };
  if (percentile <= 60) return { label: 'FAIR VALUE',  color: 'rgb(var(--vs-soft))' };
  if (percentile <= 80) return { label: 'STRETCHED',   color: 'rgb(var(--vs-amber))' };
  return { label: 'EXPENSIVE', color: 'rgb(var(--vs-red))' };
}

// Theme colours are CSS variables, so a translucent variant cannot be made by
// appending hex alpha the way `${color}12` used to. This rewrites the token
// into rgb(var(--x) / alpha) instead, and leaves anything else untouched.
export function tint(color, alpha) {
  const match = /^rgb\(var\((--[\w-]+)\)\)$/.exec(color || '');
  return match ? `rgb(var(${match[1]}) / ${alpha})` : color;
}
