// Assembles the numbers the AI brief is allowed to talk about.
//
// Everything is fetched through the app's own endpoints rather than recomputed
// from scratch, so the brief is generated from exactly the figures the page
// shows — and rides the same edge caches. Every comparative figure (premiums,
// upside, percentiles, CAGRs) is precomputed here so the model performs zero
// arithmetic; restating supplied numbers is the strongest anti-hallucination
// guardrail available.

import { mergeHistory } from '../../src/lib/history.js';
import {
  computeAverages,
  computePercentiles,
  getMetric,
  getSectorRecommendation,
} from '../../src/lib/metrics.js';
import {
  computeFairValue,
  computeGrowthStats,
  computeMarginsTrend,
  median,
} from '../../src/lib/fundamentals.js';

const CORE_METRICS = ['pe', 'evEbitda', 'pfcf', 'evSales', 'fcfYield'];

const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export async function assembleBriefInputs(base, symbol) {
  const [finR, histR, earnR] = await Promise.allSettled([
    fetchJson(`${base}/api/financials?ticker=${symbol}`),
    fetchJson(`${base}/api/history?ticker=${symbol}`),
    fetchJson(`${base}/api/earnings?ticker=${symbol}`),
  ]);

  if (finR.status !== 'fulfilled') return null;
  const fin = finR.value;

  const deep = histR.status === 'fulfilled' ? histR.value : null;
  const years = deep?.years?.length
    ? mergeHistory(fin.years, deep.years)
    : fin.years;

  const hist = years.filter((y) => !y.fiscalYear?.startsWith('Now'));
  const now = years.find((y) => y.fiscalYear?.startsWith('Now')) || null;
  if (!now || !hist.length) return null;

  const avgFull = computeAverages(hist);
  const avg3y = computeAverages(hist.slice(-3));
  const percentiles = computePercentiles(hist, now);

  // Core multiples plus whatever the sector recommendation adds.
  const rec = getSectorRecommendation(fin.sector);
  const metricKeys = [...new Set([...CORE_METRICS, ...(rec?.metrics || [])])]
    .filter((k) => getMetric(k));

  const multiples = metricKeys
    .map((key) => {
      const m = getMetric(key);
      const current = now[key];
      if (current == null || !isFinite(current)) return null;
      const full = avgFull[key];
      return {
        key,
        label: m.label,
        unit: m.isYield ? '%' : 'x',
        current: r2(current),
        avg3y: r2(avg3y[key]),
        avgFull: r2(full),
        fullYears: hist.map((y) => y[key]).filter((v) => v != null && isFinite(v) && (m.signed || v > 0)).length,
        percentile: percentiles[key] ?? null,
        premiumVsFullPct: full ? r1(((current - full) / Math.abs(full)) * 100) : null,
      };
    })
    .filter(Boolean);

  const fvRows = computeFairValue(hist, now, fin.currentPrice);
  const blended = fvRows.length ? median(fvRows.map((r) => r.impliedPrice)) : null;
  const fairValue = fvRows.length
    ? {
        rows: fvRows.map((r) => ({
          label: r.label,
          avgMultiple: r2(r.avgMultiple),
          currentMultiple: r2(r.currentMultiple),
          impliedPrice: r2(r.impliedPrice),
          upsidePct: r1(r.upsidePct),
        })),
        blendedImplied: r2(blended),
        blendedUpsidePct: blended != null && fin.currentPrice
          ? r1(((blended - fin.currentPrice) / fin.currentPrice) * 100)
          : null,
      }
    : null;

  const growth = computeGrowthStats(hist);
  const marginTrend = computeMarginsTrend(hist, now);
  const margins = {};
  for (const [k, v] of Object.entries(marginTrend)) {
    if (v?.avg3yr == null && now[k] == null) continue;
    margins[k] = { now: r1(now[k]), avg3y: r1(v.avg3yr), direction: v.direction };
  }

  const earn = earnR.status === 'fulfilled' ? earnR.value : null;
  let earnings = null;
  if (earn?.history?.length || earn?.next) {
    const last4 = (earn.history || []).slice(-4);
    const beats = last4.filter((h) => h.surprisePercent != null && h.surprisePercent > 0).length;
    const surprises = last4.map((h) => h.surprisePercent).filter((v) => v != null);
    const fy = earn.estimates?.currentYear || null;
    earnings = {
      beatsLast4: last4.length ? `${beats} of ${last4.length}` : null,
      avgSurprisePct: surprises.length ? r1(surprises.reduce((a, b) => a + b, 0) / surprises.length) : null,
      nextDate: earn.next?.date?.slice(0, 10) ?? null,
      nextEpsEstimate: r2(earn.next?.epsEstimate),
      fyEpsGrowthPct: r1(fy?.growthPercent),
      revisionsUp30d: fy?.revisionsUp ?? null,
      revisionsDown30d: fy?.revisionsDown ?? null,
    };
  }

  return {
    company: {
      name: fin.companyName,
      symbol,
      sector: fin.sector || null,
      industry: fin.industry || null,
      price: r2(fin.currentPrice),
      mktCapBillions: fin.currentMktCap != null ? r1(fin.currentMktCap / 1e3) : null,
    },
    dataWindow: {
      years: hist.length,
      deepHistory: deep?.source === 'sec-edgar',
    },
    multiples,
    fairValue,
    trajectory: {
      revCagr3yPct: r1(growth.rev3yr),
      revCagr5yPct: r1(growth.rev5yr),
      ebitdaCagr3yPct: r1(growth.ebitda3yr),
      margins,
      netDebtToEbitda: r2(now.netDebtToEbitda),
      roicPct: r1(now.roic),
    },
    earnings,
  };
}
