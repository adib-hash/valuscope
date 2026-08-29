// Compare mode: one metric, up to three tickers.
//
// Cross-company comparison forces two decisions this module owns:
//
// 1. Color is the ticker channel. The single-company chart uses color to
//    distinguish metrics; comparing three companies on three metrics would need
//    color to mean both at once, which is unreadable. So compare locks to one
//    metric and spends color on identity. Cyan is the only accent no metric
//    uses; green and red stay semantic.
//
// 2. Fiscal years align by the calendar year that holds most of them — the
//    calendarization convention — not by label. NVIDIA's "FY 2026" ended in
//    January 2026 and is eleven-twelfths of calendar 2025; aligning it by label
//    would place the COVID year against the wrong comparators for every
//    January-ending company. The x-axis shows the neutral calendar year and the
//    tooltip shows each company's own fiscal label, so the offset is visible
//    rather than hidden.

import { computeAverages, computePercentiles, getMetric } from './metrics.js';

export const TICKER_COLORS = [
  'rgb(var(--vs-blue))',  // primary
  'rgb(var(--vs-amber))', // vs #1
  'rgb(var(--vs-cyan))',  // vs #2
];

const isNowRow = (y) => !!y?.fiscalYear?.startsWith('Now');

// endDate → the calendar year containing the majority of that fiscal year.
// June (month index 5) or later → the end year; January–May → the year before.
export function calendarBucket(endDate) {
  if (!endDate) return null;
  const d = new Date(endDate);
  if (isNaN(d)) return null;
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 5 ? y : y - 1;
}

// seriesBySymbol: { AAPL: years[], MSFT: years[] } — each including a Now row.
// Returns Recharts-ready rows: { bucket, fy: { SYM: 'FY 2023' }, SYM: value }.
// The union of buckets is used, so a short-history ticker's line simply starts
// later. All Now (LTM) rows share one final bucket.
export function buildCompareData(seriesBySymbol, metricKey, period) {
  const byBucket = new Map();
  const ends = new Map(); // `${bucket}:${sym}` → endDate, for the 53-week edge

  for (const [symb, years] of Object.entries(seriesBySymbol)) {
    if (!years?.length) continue;
    const hist = years.filter((y) => !isNowRow(y));
    const window = period === 0 ? hist : hist.slice(-period);

    for (const y of window) {
      const b = calendarBucket(y.endDate);
      if (b == null) continue;
      const key = String(b);
      let row = byBucket.get(key);
      if (!row) { row = { bucket: key, fy: {} }; byBucket.set(key, row); }
      // Two fiscal years can collapse into one calendar bucket after a
      // 53-week or year-end shift; the later one wins.
      const ek = `${key}:${symb}`;
      if (row.fy[symb] == null || (y.endDate || '') > (ends.get(ek) || '')) {
        const v = y[metricKey];
        row[symb] = v != null && isFinite(v) ? v : null;
        row.fy[symb] = y.fiscalYear;
        ends.set(ek, y.endDate);
      }
    }

    const now = years.find(isNowRow);
    if (now) {
      let row = byBucket.get('Now');
      if (!row) { row = { bucket: 'Now', fy: {} }; byBucket.set('Now', row); }
      const v = now[metricKey];
      row[symb] = v != null && isFinite(v) ? v : null;
      row.fy[symb] = 'Now (LTM)';
    }
  }

  return [...byBucket.values()].sort((a, b) => {
    if (a.bucket === 'Now') return 1;
    if (b.bucket === 'Now') return -1;
    return Number(a.bucket) - Number(b.bucket);
  });
}

// Per-ticker comparison stats. The average follows the visible period — that
// is what the toggle means — while the percentile is always full-history,
// matching the tile and regime convention everywhere else in the app.
export function compareStats(seriesBySymbol, metricKey, period) {
  const metric = getMetric(metricKey);
  const usable = (v) => v != null && isFinite(v) && (metric?.signed || v > 0);
  const out = {};
  for (const [symb, years] of Object.entries(seriesBySymbol)) {
    if (!years?.length) { out[symb] = null; continue; }
    const hist = years.filter((y) => !isNowRow(y));
    const now = years.find(isNowRow) || null;
    const window = period === 0 ? hist : hist.slice(-period);
    out[symb] = {
      current: now && usable(now[metricKey]) ? now[metricKey] : null,
      avg: computeAverages(window)[metricKey] ?? null,
      avgYears: window.map((y) => y[metricKey]).filter(usable).length,
      percentile: now ? computePercentiles(hist, now)[metricKey] ?? null : null,
    };
  }
  return out;
}
