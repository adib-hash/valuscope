import { useState, useEffect, useMemo } from 'react';
import { fetchComps } from '../lib/api';
import { formatMultiple, getSectorRecommendation } from '../lib/metrics';

// Metrics we can show in the comps table — ordered by general relevance
const COMP_METRICS = [
  { key: 'pe',             label: 'P/E',          isYield: false },
  { key: 'evEbitda',       label: 'EV/EBITDA',    isYield: false },
  { key: 'ps',             label: 'P/S',          isYield: false },
  { key: 'pb',             label: 'P/B',          isYield: false },
  { key: 'pfcf',           label: 'P/FCF',        isYield: false },
  { key: 'evSales',        label: 'EV/Sales',     isYield: false },
  { key: 'evFcf',          label: 'EV/FCF',       isYield: false },
  { key: 'fcfYield',       label: 'FCF Yield',    isYield: true  },
  { key: 'grossMargin',    label: 'Gross Margin', isYield: true  },
  { key: 'ebitdaMargin',   label: 'EBITDA Margin',isYield: true  },
  { key: 'netMargin',      label: 'Net Margin',   isYield: true  },
  { key: 'netDebtToEbitda',label: 'ND/EBITDA',    isYield: false },
  { key: 'roic',           label: 'ROIC',         isYield: true  },
];

function pickMetrics(sector) {
  const rec = getSectorRecommendation(sector);
  if (!rec) return COMP_METRICS.slice(0, 6).map((m) => m.key);
  // Use sector-recommended metrics, filtered to ones we have in COMP_METRICS
  const available = new Set(COMP_METRICS.map((m) => m.key));
  return rec.metrics.filter((k) => available.has(k));
}

function fmtMktCap(m) {
  if (m == null) return '\u2014';
  if (m >= 1e6) return `$${(m / 1e6).toFixed(1)}T`;
  if (m >= 1e3) return `$${(m / 1e3).toFixed(0)}B`;
  return `$${m.toFixed(0)}M`;
}

function computeMedian(vals) {
  const sorted = vals.filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function CompsTable({ symbol, sector, onSelectTicker }) {
  const [comps, setComps]     = useState(null);
  const [source, setSource]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setComps(null);
    setSource(null);
    setExpanded(false);

    fetchComps(symbol)
      .then((data) => {
        if (!cancelled) {
          setComps(data.comps || []);
          setSource(data.source || 'none');
        }
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [symbol]);

  const visibleMetricKeys = useMemo(() => pickMetrics(sector), [sector]);
  const visibleMetrics = useMemo(
    () => visibleMetricKeys.map((k) => COMP_METRICS.find((m) => m.key === k)).filter(Boolean),
    [visibleMetricKeys]
  );

  // Separate subject company from peers
  const subject = comps?.find((c) => c.symbol === symbol);
  const peers   = comps?.filter((c) => c.symbol !== symbol) || [];

  // Median of peers for each metric
  const peerMedians = useMemo(() => {
    if (!peers.length) return {};
    const result = {};
    COMP_METRICS.forEach((m) => {
      result[m.key] = computeMedian(peers.map((p) => p[m.key]));
    });
    return result;
  }, [peers]);

  if (!symbol) return null;

  // Don't render anything if we loaded and got no real comps
  if (!loading && !error && source === 'none') return null;

  // Collapsed state — show just header
  if (!expanded) {
    // Don't show collapsed header while still loading or if no comps
    if (loading || !comps || peers.length === 0) return null;
    return (
      <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-4 py-3.5 flex items-center justify-between cursor-pointer hover:bg-vs-card2 transition-colors"
        >
          <div className="text-left">
            <p className="font-display text-[14px] font-bold text-vs-text leading-tight">
              Comps
            </p>
            <p className="text-vs-dim text-[10px] font-mono mt-0.5">
              {`${peers.length} peer${peers.length !== 1 ? 's' : ''} \u00b7 LTM multiples`}
            </p>
          </div>
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            className="text-vs-dim flex-shrink-0"
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(false)}
        className="w-full px-4 pt-3.5 pb-1 flex items-center justify-between cursor-pointer"
      >
        <div className="text-left">
          <p className="font-display text-[14px] font-bold text-vs-text leading-tight">
            Comps
          </p>
          <p className="text-vs-dim text-[10px] font-mono mt-0.5">
            {peers.length
              ? `${peers.length} peer${peers.length !== 1 ? 's' : ''} \u00b7 ${source === 'curated' ? 'curated comp set' : 'by industry'} \u00b7 LTM multiples`
              : 'Loading\u2026'}
          </p>
        </div>
        <svg
          width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className="text-vs-dim flex-shrink-0 rotate-180"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Loading */}
      {loading && (
        <div className="px-4 py-6">
          <div className="animate-pulse space-y-2">
            <div className="h-3 bg-vs-border rounded w-48" />
            <div className="h-8 bg-vs-border rounded" />
            <div className="h-8 bg-vs-border rounded" />
            <div className="h-8 bg-vs-border rounded" />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="px-4 py-4 text-vs-red text-[12px] font-mono">
          {error}
        </p>
      )}

      {/* Table */}
      {!loading && !error && comps && peers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="border-y border-vs-border">
                <th className="text-left px-4 py-2 text-vs-dim font-medium sticky left-0 bg-vs-card z-10 min-w-[120px]">
                  Company
                </th>
                <th className="text-right px-3 py-2 text-vs-dim font-medium whitespace-nowrap">
                  Mkt Cap
                </th>
                {visibleMetrics.map((m) => (
                  <th key={m.key} className="text-right px-3 py-2 text-vs-dim font-medium whitespace-nowrap">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Subject company row — highlighted */}
              {subject && (
                <tr className="border-b border-vs-border bg-vs-blue/5">
                  <td className="px-4 py-2 sticky left-0 bg-vs-blue/5 z-10">
                    <span className="text-vs-blue font-semibold">{subject.symbol}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-vs-soft whitespace-nowrap">
                    {fmtMktCap(subject.mktCap)}
                  </td>
                  {visibleMetrics.map((m) => {
                    const val = subject[m.key];
                    const medianVal = peerMedians[m.key];
                    // For multiples (not yields/margins), lower is cheaper
                    const isCheaper = val != null && medianVal != null && !m.isYield && val < medianVal;
                    const isHigherYield = val != null && medianVal != null && m.isYield && val > medianVal;
                    const isGreen = isCheaper || isHigherYield;
                    return (
                      <td
                        key={m.key}
                        className="px-3 py-2 text-right font-semibold whitespace-nowrap"
                        style={{ color: isGreen ? '#38D89A' : val != null && medianVal != null ? '#F25C5C' : 'rgb(var(--vs-text))' }}
                      >
                        {formatMultiple(val, m.isYield)}
                      </td>
                    );
                  })}
                </tr>
              )}

              {/* Peer rows */}
              {peers.map((peer) => (
                <tr
                  key={peer.symbol}
                  className="border-b border-vs-border/20 hover:bg-vs-card2 transition-colors cursor-pointer"
                  onClick={() => onSelectTicker?.(peer.symbol)}
                >
                  <td className="px-4 py-2 sticky left-0 bg-vs-card z-10 group-hover:bg-vs-card2">
                    <span className="text-vs-soft hover:text-vs-blue transition-colors">
                      {peer.symbol}
                    </span>
                    <span className="text-vs-dim text-[9px] ml-1.5 hidden sm:inline">
                      {peer.name?.length > 20 ? peer.name.slice(0, 20) + '\u2026' : peer.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-vs-dim whitespace-nowrap">
                    {fmtMktCap(peer.mktCap)}
                  </td>
                  {visibleMetrics.map((m) => (
                    <td key={m.key} className="px-3 py-2 text-right text-vs-soft whitespace-nowrap">
                      {formatMultiple(peer[m.key], m.isYield)}
                    </td>
                  ))}
                </tr>
              ))}

              {/* Peer median row */}
              <tr className="bg-vs-card2 border-t border-vs-border">
                <td className="px-4 py-2.5 sticky left-0 bg-vs-card2 z-10 text-vs-text font-semibold">
                  Peer Median
                </td>
                <td className="px-3 py-2.5 text-right text-vs-dim whitespace-nowrap">
                  {fmtMktCap(computeMedian(peers.map((p) => p.mktCap)))}
                </td>
                {visibleMetrics.map((m) => (
                  <td key={m.key} className="px-3 py-2.5 text-right text-vs-text font-semibold whitespace-nowrap">
                    {formatMultiple(peerMedians[m.key], m.isYield)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* No peers */}
      {!loading && !error && comps && peers.length === 0 && (
        <p className="px-4 py-4 text-vs-dim text-[12px]">
          No comparable companies found for {symbol}.
        </p>
      )}

      <p className="px-4 py-2.5 text-vs-dim text-[9px] font-mono">
        {source === 'curated' ? 'Curated comp set' : 'Peers by industry classification'} &middot; LTM multiples &middot; Tap a peer to view
      </p>
    </div>
  );
}
