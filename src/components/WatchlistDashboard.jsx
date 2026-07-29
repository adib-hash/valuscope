import { useEffect, useMemo, useState } from 'react';
import { fetchOverview } from '../lib/api';
import { getSummaries } from '../lib/summaryCache';
import { tint } from '../lib/metrics';

const SORTS = [
  { key: 'cheapest', label: 'Cheapest' },
  { key: 'move',     label: "Today's move" },
  { key: 'alpha',    label: 'A–Z' },
];

function fmtPrice(v, currency = 'USD') {
  if (v == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, maximumFractionDigits: v < 10 ? 3 : 2,
    }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

const fmtPct = (v, signed = true) =>
  v == null ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(1)}%`;

// Relative earnings proximity — "in 2 days" reads faster than a date here.
function earningsIn(iso) {
  if (!iso) return null;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / 86400000);
  if (diff < -3) return null; // already reported, no longer interesting
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 0)   return 'just reported';
  if (diff <= 14) return `in ${diff}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function staleness(updatedAt) {
  if (!updatedAt) return null;
  const hours = (Date.now() - updatedAt) / 3600000;
  if (hours < 1)  return 'just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function RegimeBadge({ label, color }) {
  if (!label) return null;
  return (
    <span
      className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color, border: `1px solid ${tint(color, 0.25)}`, background: tint(color, 0.07) }}
    >
      {label}
    </span>
  );
}

const changeColor = (v) =>
  v == null ? 'rgb(var(--vs-soft))' : v >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))';

export default function WatchlistDashboard({ symbols, onSelectTicker }) {
  const [quotes, setQuotes]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [sort, setSort]       = useState('cheapest');

  // Cached valuation summaries are read once per mount; they only change when a
  // ticker's own dashboard is visited.
  const summaries = useMemo(() => getSummaries(symbols), [symbols]);

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchOverview(symbols)
      .then((d) => { if (!cancelled) setQuotes(d.quotes || []); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load quotes'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbols.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const bySymbol = new Map((quotes || []).map((q) => [q.symbol, q]));
    const merged = symbols.map((s) => ({
      symbol: s,
      quote: bySymbol.get(s) || null,
      summary: summaries[s] || null,
    }));

    const cmp = {
      // Nulls sort last in every mode so un-visited tickers never lead.
      cheapest: (a, b) => {
        const av = a.summary?.percentile, bv = b.summary?.percentile;
        if (av == null && bv == null) return a.symbol.localeCompare(b.symbol);
        if (av == null) return 1;
        if (bv == null) return -1;
        return av - bv;
      },
      move: (a, b) => {
        const av = a.quote?.changePercent, bv = b.quote?.changePercent;
        if (av == null && bv == null) return a.symbol.localeCompare(b.symbol);
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      },
      alpha: (a, b) => a.symbol.localeCompare(b.symbol),
    }[sort];

    return [...merged].sort(cmp);
  }, [quotes, summaries, symbols, sort]);

  if (!symbols.length) return null;

  const anySummary = rows.some((r) => r.summary);

  return (
    <div className="mt-8 text-left">
      <div className="flex items-end justify-between gap-3 mb-2.5 flex-wrap">
        <div>
          <p className="text-vs-dim text-[10px] font-mono uppercase tracking-widest">
            Watchlist
          </p>
          <p className="text-vs-soft text-[11px] font-mono mt-0.5">
            {symbols.length} ticker{symbols.length !== 1 ? 's' : ''}
            {loading && ' · loading quotes…'}
          </p>
        </div>
        <div className="flex gap-1">
          {SORTS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`rounded px-2.5 py-1.5 text-[11px] font-mono font-semibold cursor-pointer border transition-all ${
                sort === key
                  ? 'bg-vs-blue/15 text-vs-blue border-vs-blue/50'
                  : 'bg-transparent text-vs-dim border-vs-border hover:border-vs-borderLight hover:text-vs-soft'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-vs-red font-mono text-[12px] px-3.5 py-2.5 bg-vs-red/5 rounded-lg border border-vs-red/20 mb-2">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-vs-border bg-vs-card overflow-hidden divide-y divide-vs-border">
        {rows.map(({ symbol, quote, summary }) => {
          const earnings = earningsIn(quote?.nextEarnings);
          return (
            <button
              key={symbol}
              onClick={() => onSelectTicker(symbol)}
              className="w-full text-left px-4 py-3 hover:bg-vs-card2 transition-colors cursor-pointer block"
            >
              {/* Line 1: identity and price */}
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-mono text-[13px] font-bold text-vs-text">{symbol}</span>
                  <span className="text-vs-dim text-[11px] truncate">
                    {quote?.name || summary?.name || ''}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 flex-shrink-0">
                  <span className="font-mono text-[13px] text-vs-text">
                    {fmtPrice(quote?.price, quote?.currency)}
                  </span>
                  <span
                    className="font-mono text-[11px] font-semibold w-[58px] text-right inline-block"
                    style={{ color: changeColor(quote?.changePercent) }}
                  >
                    {fmtPct(quote?.changePercent)}
                  </span>
                </div>
              </div>

              {/* Line 2: valuation context */}
              <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
                {summary ? (
                  <>
                    <RegimeBadge label={summary.regimeLabel} color={summary.regimeColor} />
                    {summary.percentile != null && (
                      <span className="text-vs-dim text-[10px] font-mono">
                        {summary.percentile}th pct vs {summary.histYears}y
                      </span>
                    )}
                    {summary.upsidePercent != null && (
                      <span className="text-[10px] font-mono" style={{ color: changeColor(summary.upsidePercent) }}>
                        {fmtPct(summary.upsidePercent)} to fair value
                      </span>
                    )}
                    {/* Least load-bearing item on the line — dropped on narrow
                        screens so the row stays a single line. */}
                    <span className="text-vs-dim text-[9px] font-mono opacity-70 hidden sm:inline">
                      {staleness(summary.updatedAt)}
                    </span>
                  </>
                ) : (
                  <span className="text-vs-dim text-[10px] font-mono">
                    Open to compute valuation
                  </span>
                )}
                {earnings && (
                  <span className="text-vs-amber text-[10px] font-mono ml-auto whitespace-nowrap">
                    Earnings {earnings}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {!anySummary && !loading && (
        <p className="text-vs-dim text-[10px] font-mono mt-2">
          Valuation figures fill in as you open each ticker.
        </p>
      )}
    </div>
  );
}
