// Metric group definitions and computation helpers

export const GROUPS = {
  'Price Multiples': [
    { key: 'pe', label: 'P/E', color: '#4E94F8' },
    { key: 'ps', label: 'P/S', color: '#E070A0' },
    { key: 'pb', label: 'P/B', color: '#38D89A' },
    { key: 'pGP', label: 'P/Gross Profit', color: '#E8AA30' },
    { key: 'pfcf', label: 'P/FCF', color: '#9B7AF5' },
    { key: 'pocf', label: 'P/OCF', color: '#E88A3A' },
  ],
  'EV Multiples': [
    { key: 'evEbitda', label: 'EV/EBITDA', color: '#4E94F8' },
    { key: 'evSales', label: 'EV/Sales', color: '#E070A0' },
    { key: 'evGP', label: 'EV/Gross Profit', color: '#E8AA30' },
    { key: 'evEbit', label: 'EV/EBIT', color: '#38D89A' },
    { key: 'evFcf', label: 'EV/FCF', color: '#9B7AF5' },
    { key: 'evOcf', label: 'EV/OCF', color: '#E88A3A' },
  ],
  'Yield Metrics': [
    { key: 'earningsYield', label: 'Earnings Yield', color: '#4E94F8' },
    { key: 'fcfYield', label: 'FCF Yield', color: '#38D89A' },
    { key: 'buybackYield', label: 'Buyback Yield', color: '#E8AA30' },
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
    result[m.key] = vals.length
      ? vals.reduce((a, b) => a + b, 0) / vals.length
      : null;
  });
  return result;
}
