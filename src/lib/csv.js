// CSV export. Everything here is pure except downloadCsv, so the table
// builders can be checked from node without a browser.
//
// Values are written as plain numbers, not as the page formats them: "24.3x"
// and "$1.2T" are display strings a spreadsheet can't sum or chart, so units
// live in the column header ("P/E (x)", "Revenue (USD M)") and the cells stay
// numeric. Missing values are empty cells, never "—" or 0.

import { ALL_METRICS, getMetric } from './metrics.js';

const isNow = (y) => !!y?.fiscalYear?.startsWith('Now');

// Enough precision for any multiple or $M figure without float noise
// (12.340000000000002).
function num(v) {
  if (v == null || typeof v !== 'number' || !isFinite(v)) return '';
  return String(Math.round(v * 1e4) / 1e4);
}

function cell(v) {
  if (v == null) return '';
  const s = typeof v === 'number' ? num(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// The BOM makes Excel read the file as UTF-8; other tools ignore it.
export function downloadCsv(filename, rows) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// AAPL_vs_MSFT_ev-ebitda_5Y_2026-11-24.csv
export function csvFilename(...parts) {
  const slug = parts
    .filter(Boolean)
    .map((p) => String(p).replace(/\//g, '-').replace(/[^A-Za-z0-9.\-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('_');
  return `${slug}_${new Date().toISOString().slice(0, 10)}.csv`;
}

export const periodLabel = (period) => (period === 0 ? 'All' : `${period}Y`);

const unit = (m) => (m?.isYield ? '%' : 'x');
const metricHeader = (k) => {
  const m = getMetric(k);
  return m ? `${m.label} (${unit(m)})` : k;
};

// ── Single-company chart ─────────────────────────────────────────────────────
// One row per fiscal year, one column per metric on the chart, closed by the
// period average the chart draws as its dashed line.
export function chartTable(years, metricKeys, averages, period) {
  const rows = [['Fiscal Year', 'Period End', ...metricKeys.map(metricHeader)]];
  for (const y of years) {
    rows.push([y.fiscalYear, y.endDate || '', ...metricKeys.map((k) => y[k])]);
  }
  rows.push([`Average (${periodLabel(period)})`, '', ...metricKeys.map((k) => averages[k])]);
  return rows;
}

// ── Compare chart ────────────────────────────────────────────────────────────
// compareRows come from buildCompareData: calendar-aligned buckets. Each
// ticker gets its value and the fiscal year that fed the bucket, so the
// calendarization stays visible in the file just as it is in the tooltip.
// The grid's per-ticker stats follow as summary rows.
export function compareTable(compareRows, symbols, metricKey, stats, period) {
  const m = getMetric(metricKey);
  const rows = [[
    'Calendar Year',
    ...symbols.flatMap((s) => [`${s} ${m?.label || metricKey} (${unit(m)})`, `${s} Fiscal Year`]),
  ]];
  for (const r of compareRows) {
    rows.push([
      r.bucket === 'Now' ? 'Now (LTM)' : r.bucket,
      ...symbols.flatMap((s) => [r[s], r.fy?.[s] || '']),
    ]);
  }
  const statRow = (label, pick) => [label, ...symbols.flatMap((s) => [stats[s] ? pick(stats[s]) : null, ''])];
  rows.push(statRow(`Average (${periodLabel(period)})`, (st) => st.avg));
  rows.push(statRow('Years in Average', (st) => st.avgYears));
  rows.push(statRow('Current vs Average (%)', (st) =>
    st.current != null && st.avg ? ((st.current - st.avg) / Math.abs(st.avg)) * 100 : null));
  rows.push(statRow('Percentile (full history)', (st) => st.percentile));
  return rows;
}

// ── Full financials ──────────────────────────────────────────────────────────
// The Data tab's layout (metrics down, years across, average last) but a
// superset of it: every metric group the app computes, plus the raw
// fundamentals behind them, so the file stands on its own in a model.
const FUNDAMENTAL_ROWS = [
  { key: 'price',       label: 'Share Price',        money: true, perShare: true },
  { key: 'sharesOut',   label: 'Shares Outstanding (M)' },
  { key: 'mktCap',      label: 'Market Cap',         money: true },
  { key: 'netDebt',     label: 'Net Debt',           money: true },
  { key: 'ev',          label: 'Enterprise Value',   money: true },
  { key: 'revenue',     label: 'Revenue',            money: true },
  { key: 'grossProfit', label: 'Gross Profit',       money: true },
  { key: 'ebitda',      label: 'EBITDA',             money: true },
  { key: 'ebit',        label: 'EBIT',               money: true },
  { key: 'netIncome',   label: 'Net Income',         money: true },
  { key: 'ocf',         label: 'Operating Cash Flow', money: true },
  { key: 'fcf',         label: 'Free Cash Flow',     money: true },
  { key: 'bookValue',   label: 'Book Value of Equity', money: true },
];

export function financialsTable(years, averages, currency = 'USD', period) {
  const hasAvg = years.some((y) => !isNow(y));
  const header = ['Metric', ...years.map((y) => y.fiscalYear)];
  if (hasAvg) header.push(`Average (${periodLabel(period)})`);
  const rows = [header, ['Period End', ...years.map((y) => y.endDate || '')]];

  for (const m of ALL_METRICS) {
    const r = [metricHeader(m.key), ...years.map((y) => y[m.key])];
    if (hasAvg) r.push(averages[m.key]);
    rows.push(r);
  }
  for (const f of FUNDAMENTAL_ROWS) {
    const label = f.money ? `${f.label} (${currency}${f.perShare ? '' : ' M'})` : f.label;
    rows.push([label, ...years.map((y) => y[f.key])]);
  }
  return rows;
}

// ── Comps ────────────────────────────────────────────────────────────────────
export function compsTable(subject, peers, medians, metrics, currency = 'USD') {
  const rows = [['Role', 'Symbol', 'Company', `Market Cap (${currency} M)`, ...metrics.map((m) => `${m.label} (${unit(m)})`)]];
  const line = (role, c) => [role, c.symbol, c.name || '', c.mktCap, ...metrics.map((m) => c[m.key])];
  if (subject) rows.push(line('Subject', subject));
  for (const p of peers) rows.push(line('Peer', p));
  rows.push(['Peer Median', '', '', medians.mktCap, ...metrics.map((m) => medians[m.key])]);
  return rows;
}
