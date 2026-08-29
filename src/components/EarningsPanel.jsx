import { useEffect, useMemo, useState } from 'react';
import { fetchEarnings } from '../lib/api';
import SectionLabel from './ui/SectionLabel';
import StatChip from './ui/StatChip';

const fmtEps = (v) => (v == null ? null : `$${v.toFixed(2)}`);

function fmtBig(v) {
  if (v == null) return null;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// "in 3 days" / "today" / "2 weeks ago" — earnings proximity is the thing you
// actually want to read off this panel.
function relativeDays(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((startOfDay(target) - startOfDay(new Date())) / 86400000);
  if (diff === 0)  return 'today';
  if (diff === 1)  return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 0)    return diff < 14 ? `in ${diff} days` : `in ${Math.round(diff / 7)} weeks`;
  const ago = Math.abs(diff);
  return ago < 14 ? `${ago} days ago` : `${Math.round(ago / 7)} weeks ago`;
}

function quarterLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `Q${Math.floor(d.getMonth() / 3) + 1} '${String(d.getFullYear()).slice(2)}`;
}

export default function EarningsPanel({ symbol, onOpenTranscript }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetchEarnings(symbol)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  const history = data?.history || [];

  // A company that consistently clears expectations is worth flagging, but only
  // once there are enough quarters for the count to mean anything.
  const beatRate = useMemo(() => {
    const scored = history.filter((h) => h.surprisePercent != null);
    if (scored.length < 4) return null;
    return Math.round((scored.filter((h) => h.surprisePercent > 0).length / scored.length) * 100);
  }, [history]);

  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-vs-border bg-vs-card px-4 py-3.5">
        <div className="animate-pulse space-y-2">
          <div className="h-2 bg-vs-card2 rounded-md w-24" />
          <div className="h-4 bg-vs-card2 rounded-md w-40" />
        </div>
      </div>
    );
  }

  const next = data?.next;
  const fy   = data?.estimates?.currentYear;
  const nextFy = data?.estimates?.nextYear;
  if (!next && !history.length && !fy) return null;

  return (
    <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
      <div className="divide-y divide-vs-border">

        {next && (
          <div className="px-4 py-3.5">
            <SectionLabel className="mb-2.5" aside={next.isEstimate ? 'date estimated' : null}>
              Next Earnings
            </SectionLabel>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono text-prose font-semibold text-vs-text">
                {fmtDate(next.date)}
              </span>
              <span className="text-vs-blue text-label font-mono">
                {relativeDays(next.date)}
              </span>
            </div>
            {onOpenTranscript && (
              <button
                onClick={onOpenTranscript}
                className="mt-2 text-vs-blue hover:underline text-label font-mono cursor-pointer"
              >
                Read the last earnings call →
              </button>
            )}
            {(next.epsEstimate != null || next.revenueEstimate != null) && (
              <div className="flex gap-4 flex-wrap mt-2.5">
                <StatChip label="Consensus EPS" value={fmtEps(next.epsEstimate)} />
                {next.epsLow != null && next.epsHigh != null && (
                  <Stat
                    label="Range"
                    value={`${fmtEps(next.epsLow)} – ${fmtEps(next.epsHigh)}`}
                    color="rgb(var(--vs-soft))"
                  />
                )}
                <StatChip label="Consensus Rev" value={fmtBig(next.revenueEstimate)} />
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="px-4 py-3.5">
            <SectionLabel
              className="mb-2.5"
              aside={beatRate != null ? `beat ${beatRate}% of last ${history.length}` : null}
            >
              EPS vs Estimate
            </SectionLabel>
            <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ WebkitOverflowScrolling: 'touch' }}>
              {history.map((h) => {
                const beat = h.surprisePercent != null && h.surprisePercent >= 0;
                const color = h.surprisePercent == null ? 'rgb(var(--vs-dim))'
                  : beat ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))';
                return (
                  <div
                    key={h.quarter}
                    className="flex-1 min-w-[74px] rounded-lg border border-vs-border bg-vs-card2 px-2.5 py-2"
                  >
                    <div className="text-vs-dim text-micro font-mono uppercase tracking-wider leading-none mb-1">
                      {quarterLabel(h.quarter)}
                    </div>
                    <div className="font-mono text-body font-semibold leading-none" style={{ color }}>
                      {h.surprisePercent == null ? '—'
                        : `${h.surprisePercent >= 0 ? '+' : ''}${h.surprisePercent.toFixed(1)}%`}
                    </div>
                    <div className="text-vs-dim text-micro font-mono mt-1 leading-none">
                      {fmtEps(h.epsActual)} vs {fmtEps(h.epsEstimate)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(fy || nextFy) && (
          <div className="px-4 py-3.5">
            <SectionLabel className="mb-2.5">Analyst Estimates</SectionLabel>
            <div className="space-y-2">
              {[fy, nextFy].filter(Boolean).map((est, i) => (
                <div key={est.period} className="flex items-center gap-4 flex-wrap">
                  <span className="text-vs-dim font-mono text-micro w-14 flex-shrink-0">
                    {i === 0 ? 'This FY' : 'Next FY'}
                  </span>
                  <StatChip label="EPS" value={fmtEps(est.epsEstimate)} />
                  <StatChip label="Revenue" value={fmtBig(est.revenueEstimate)} />
                  {est.growthPercent != null && (
                    <Stat
                      label="EPS Growth"
                      value={`${est.growthPercent >= 0 ? '+' : ''}${est.growthPercent.toFixed(1)}%`}
                      color={est.growthPercent >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))'}
                    />
                  )}
                  {(est.revisionsUp != null || est.revisionsDown != null) && (
                    <Stat
                      label="Revisions 30d"
                      value={`${est.revisionsUp ?? 0} up / ${est.revisionsDown ?? 0} down`}
                      color={
                        (est.revisionsUp ?? 0) > (est.revisionsDown ?? 0) ? 'rgb(var(--vs-green))'
                          : (est.revisionsUp ?? 0) < (est.revisionsDown ?? 0) ? 'rgb(var(--vs-red))'
                          : 'rgb(var(--vs-soft))'
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
