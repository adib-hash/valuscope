// Fundamental analysis helpers: growth stats, fair value, margin trends

// CAGR helper: ((end / start) ^ (1/years)) - 1
function cagr(start, end, years) {
  if (!start || !end || start <= 0 || years <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

// hist = historical years array (no "Now" entry), sorted oldest → newest
export function computeGrowthStats(hist) {
  if (!hist.length) return {};
  const n = hist.length;
  const last = hist[n - 1];

  // Revenue CAGR
  const rev1yr = n >= 2
    ? cagr(hist[n - 2].revenue, last.revenue, 1) : null;
  const rev3yr = n >= 4
    ? cagr(hist[n - 4].revenue, last.revenue, 3) : null;
  const rev5yr = n >= 6
    ? cagr(hist[n - 6].revenue, last.revenue, 5) : null;

  // EBITDA CAGR
  const ebitda1yr = n >= 2
    ? cagr(hist[n - 2].ebitda, last.ebitda, 1) : null;
  const ebitda3yr = n >= 4
    ? cagr(hist[n - 4].ebitda, last.ebitda, 3) : null;

  return { rev1yr, rev3yr, rev5yr, ebitda1yr, ebitda3yr };
}

// Returns { [key]: { avg3yr, direction: 'up'|'down'|'flat' } } for margin metrics
export function computeMarginsTrend(hist, now) {
  const MARGIN_KEYS = ['grossMargin', 'ebitdaMargin', 'operatingMargin', 'netMargin', 'fcfMargin'];
  const result = {};
  const validHist = hist.filter(
    (y) => y.grossMargin != null || y.ebitdaMargin != null
  );

  MARGIN_KEYS.forEach((key) => {
    const recent3 = validHist.slice(-3).map((y) => y[key]).filter((v) => v != null);
    const avg3yr = recent3.length ? recent3.reduce((a, b) => a + b, 0) / recent3.length : null;
    const current = now?.[key] ?? null;

    let direction = 'flat';
    if (avg3yr != null && current != null) {
      const diff = current - avg3yr;
      if (diff > 1) direction = 'up';
      else if (diff < -1) direction = 'down';
    }

    result[key] = { avg3yr, direction };
  });

  return result;
}

// Metrics used for fair value estimation
const FAIR_VALUE_METRICS = [
  { key: 'pe',       label: 'P/E' },
  { key: 'evEbitda', label: 'EV/EBITDA' },
  { key: 'pfcf',     label: 'P/FCF' },
  { key: 'ps',       label: 'P/S' },
  { key: 'evSales',  label: 'EV/Sales' },
];

// Returns array of { key, label, avgMultiple, currentMultiple, impliedPrice, upsidePct }
// impliedPrice = currentPrice × (historicalAvg / currentMultiple)
export function computeFairValue(hist, now, currentPrice) {
  if (!currentPrice || !now) return [];

  // Compute historical averages (positive values only)
  const avgs = {};
  FAIR_VALUE_METRICS.forEach(({ key }) => {
    const vals = hist
      .map((y) => y[key])
      .filter((v) => v != null && isFinite(v) && v > 0);
    avgs[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });

  const rows = FAIR_VALUE_METRICS
    .map(({ key, label }) => {
      const avg = avgs[key];
      const current = now[key];
      if (!avg || !current || !isFinite(avg) || !isFinite(current)) return null;

      const impliedPrice = currentPrice * (avg / current);
      const upsidePct = ((impliedPrice - currentPrice) / currentPrice) * 100;

      return { key, label, avgMultiple: avg, currentMultiple: current, impliedPrice, upsidePct };
    })
    .filter(Boolean);

  return rows;
}

// Median of an array of numbers
export function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
