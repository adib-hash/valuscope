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
      period:  'Historical: FY-end EV ÷ FY EBIT. Now (LTM): current EV ÷ most recent FY EBIT. Note: TTM EBIT is not available from this data source; most recent annual figure is used as a proxy.' },
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
};

export const ALL_METRICS = Object.values(GROUPS).flat();

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
