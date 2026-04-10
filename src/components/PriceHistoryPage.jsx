import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchPriceHistory } from '../lib/api';

const RANGES = [
  { key: '1D',  label: 'Today' },
  { key: '5D',  label: '5D'    },
  { key: '1M',  label: '1M'    },
  { key: 'YTD', label: 'YTD'   },
  { key: '1Y',  label: '1Y'    },
  { key: '5Y',  label: '5Y'    },
  { key: 'MAX', label: 'Max'   },
];

const fmtPrice = (v, currency = 'USD') => {
  if (v == null || !isFinite(v)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: v < 10 ? 4 : 2,
    }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
};

function formatTick(dateStr, range) {
  const d = new Date(dateStr);
  if (range === '1D' || range === '5D') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (range === '1M' || range === 'YTD' || range === '1Y') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function formatTooltipDate(dateStr, range) {
  const d = new Date(dateStr);
  if (range === '1D' || range === '5D') {
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function PriceTooltip({ active, payload, range, currency }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-vs-card border border-vs-border rounded-lg px-3.5 py-2.5 shadow-2xl">
      <p className="text-vs-dim text-[10px] font-mono mb-0.5">
        {formatTooltipDate(p.date, range)}
      </p>
      <p className="text-vs-text text-[14px] font-mono font-semibold">
        {fmtPrice(p.close, currency)}
      </p>
    </div>
  );
}

export default function PriceHistoryPage({ ticker, companyName, onBack }) {
  const [range, setRange]     = useState('1Y');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [data, setData]       = useState(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const result = await fetchPriceHistory(ticker, range);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load price history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, range]);

  const quotes = data?.quotes || [];
  const currency = data?.currency || 'USD';

  const { minY, maxY } = useMemo(() => {
    if (!quotes.length) return { minY: 0, maxY: 0 };
    let lo = Infinity, hi = -Infinity;
    for (const q of quotes) {
      if (q.close < lo) lo = q.close;
      if (q.close > hi) hi = q.close;
    }
    const pad = (hi - lo) * 0.08 || hi * 0.02 || 1;
    return { minY: Math.max(0, lo - pad), maxY: hi + pad };
  }, [quotes]);

  const up = (data?.changePct ?? 0) >= 0;
  const lineColor = up ? '#38D89A' : '#F25C5C';
  const gradId = up ? 'gradUp' : 'gradDown';

  return (
    <div className="mt-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <button
            onClick={onBack}
            className="text-vs-dim hover:text-vs-soft text-[11px] font-mono cursor-pointer mb-2 flex items-center gap-1"
          >
            <span>←</span> Back to overview
          </button>
          <div className="text-vs-dim text-[11px] font-mono tracking-widest">
            {ticker} · PRICE HISTORY
          </div>
          <h1 className="font-display text-[26px] font-extrabold mt-1 leading-tight text-vs-text">
            {companyName || ticker}
          </h1>
          {data && (
            <p className="text-vs-soft text-[13px] mt-0.5 flex items-center gap-2 flex-wrap">
              <span className="font-mono font-semibold text-vs-text">
                {fmtPrice(data.last, currency)}
              </span>
              <span
                className="font-mono text-[12px]"
                style={{ color: lineColor }}
              >
                {up ? '+' : ''}{(data.change ?? 0).toFixed(2)} ({up ? '+' : ''}{(data.changePct ?? 0).toFixed(2)}%)
              </span>
              <span className="text-vs-dim text-[11px]">
                {RANGES.find((r) => r.key === range)?.label} change
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Range buttons */}
      <div className="flex gap-1 mt-4 flex-wrap">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-3 py-1.5 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
              range === r.key
                ? 'bg-vs-blue/15 text-vs-blue border-vs-blue'
                : 'bg-vs-card text-vs-soft border-vs-border hover:border-vs-borderLight'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div className="bg-vs-card border border-vs-border rounded-xl mt-4 p-4">
        <div className="h-[320px] sm:h-[420px] md:h-[480px]">
          {loading && (
            <div className="h-full flex items-center justify-center text-vs-dim text-[12px] font-mono">
              Loading price history…
            </div>
          )}
          {error && !loading && (
            <div className="h-full flex items-center justify-center text-vs-red text-[12px] font-mono">
              {error}
            </div>
          )}
          {!loading && !error && quotes.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={quotes} margin={{ top: 10, right: 16, left: 8, bottom: 8 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={lineColor} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E2738" className="dark:stroke-vs-border" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#94A0B8', fontSize: 10, fontFamily: '"DM Mono", monospace' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                  tickFormatter={(v) => formatTick(v, range)}
                />
                <YAxis
                  domain={[minY, maxY]}
                  tick={{ fill: '#94A0B8', fontSize: 10, fontFamily: '"DM Mono", monospace' }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                  tickFormatter={(v) => fmtPrice(v, currency)}
                />
                <Tooltip content={<PriceTooltip range={range} currency={currency} />} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={lineColor}
                  strokeWidth={2}
                  fill={`url(#${gradId})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {data && (
        <p className="text-vs-dim text-[10px] font-mono mt-2">
          {quotes.length} points · interval {data.interval} · {data.exchange || 'Yahoo Finance'}
        </p>
      )}
    </div>
  );
}
