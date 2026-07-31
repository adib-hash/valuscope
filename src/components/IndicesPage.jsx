import { Fragment, useEffect, useState } from 'react';
import { fetchIndices } from '../lib/api';

const MODES = [
  { key: 'total', label: 'Total return · USD' },
  { key: 'price', label: 'Price · local' },
];

const COLUMNS = [
  { key: 'ytd', label: 'YTD' },
  { key: 'r1y', label: '1Y' },
  { key: 'r3y', label: '3Y p.a.' },
  { key: 'r5y', label: '5Y p.a.' },
  { key: 'r10y', label: '10Y p.a.' },
];

const DASH = '—';

const fmtPct = (v) => {
  if (v == null || !isFinite(v)) return DASH;
  // Round first, then take the sign. Otherwise -0.04 renders as "-0.0%".
  const rounded = Math.round(v * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${(rounded === 0 ? 0 : rounded).toFixed(1)}%`;
};

const fmtLevel = (v) => {
  if (v == null || !isFinite(v)) return DASH;
  const digits = v >= 1000 ? 0 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const returnColor = (v) =>
  v == null || !isFinite(v)
    ? 'rgb(var(--vs-soft))'
    : v >= 0
      ? 'rgb(var(--vs-green))'
      : 'rgb(var(--vs-red))';

// Hand-rolled rather than Recharts. Eleven ResponsiveContainers to draw eleven
// 92x24 shapes is a lot of machinery for a decoration, and these never need a
// tooltip or an axis.
function Sparkline({ points, width = 92, height = 24 }) {
  if (!points || points.length < 2) return <span className="text-vs-soft">{DASH}</span>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const y = (v) => height - 2 - ((v - min) / span) * (height - 4);

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const color = points[points.length - 1] >= points[0] ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="block">
      <path d={area} fill={color} fillOpacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function IndicesPage({ onBack }) {
  const [mode, setMode] = useState('total');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchIndices(mode)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load index returns'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode]);

  const rows = data?.rows || [];
  const vix = data?.vix;
  const isTotal = mode === 'total';

  // Group headers are derived from the data so the API owns the ordering.
  const groups = [];
  for (const row of rows) {
    if (!groups.length || groups[groups.length - 1].name !== row.group) {
      groups.push({ name: row.group, rows: [row] });
    } else {
      groups[groups.length - 1].rows.push(row);
    }
  }

  return (
    <div className="mt-5 pb-8">
      <button
        onClick={onBack}
        className="text-vs-dim hover:text-vs-soft text-[11px] font-mono cursor-pointer mb-2 flex items-center gap-1"
      >
        <span>←</span> Back to overview
      </button>

      <div className="text-vs-dim text-[11px] font-mono tracking-widest">WORLD INDICES</div>
      <h1 className="font-display text-[26px] font-extrabold mt-1 leading-tight text-vs-text">
        Index returns
      </h1>
      <p className="text-vs-soft text-[13px] mt-0.5 max-w-[68ch]">
        {isTotal
          ? 'Dividends and coupons reinvested, everything converted to USD, so every row is measured the same way.'
          : 'The indices themselves, in their own currency, price only — the numbers you see quoted in the press.'}
      </p>

      {/* Basis toggle */}
      <div className="flex items-center gap-1 mt-4 flex-wrap">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`rounded px-2.5 py-1.5 text-[11px] font-mono font-semibold cursor-pointer border transition-all ${
              mode === m.key
                ? 'bg-vs-blue/15 text-vs-blue border-vs-blue/50'
                : 'bg-transparent text-vs-dim border-vs-border hover:border-vs-borderLight hover:text-vs-soft'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Why the toggle exists. Worth saying once, plainly. */}
      <p className="text-vs-soft text-[10px] font-mono mt-2 max-w-[68ch] leading-relaxed">
        {isTotal
          ? 'Bonds and property earn most of their return as income, so price-only figures understate them badly.'
          : 'Price return ignores income. US bonds look like a loss on this basis; on a total-return basis they are not.'}
      </p>

      {error && (
        <div className="mt-5 text-vs-red font-mono text-[13px] px-4 py-3 bg-vs-red/5 rounded-lg border border-vs-red/20">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-4 rounded-xl border border-vs-border bg-vs-card px-4 py-6">
          <div className="animate-pulse space-y-2">
            <div className="h-3 bg-vs-border rounded w-48" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 bg-vs-border rounded" />
            ))}
          </div>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[11px]">
              <thead>
                <tr className="border-b border-vs-border">
                  <th className="text-left px-4 py-2 text-vs-soft font-medium sticky left-0 bg-vs-card z-10 min-w-[150px]">
                    Market
                  </th>
                  <th className="text-right px-3 py-2 text-vs-soft font-medium whitespace-nowrap">Level</th>
                  <th className="text-right px-3 py-2 text-vs-soft font-medium whitespace-nowrap">Day</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="text-right px-3 py-2 text-vs-soft font-medium whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                  <th className="text-right px-4 py-2 text-vs-soft font-medium whitespace-nowrap">5-yr shape</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.name}>
                    <tr className="bg-vs-card2">
                      <td
                        colSpan={COLUMNS.length + 4}
                        className="px-4 py-1.5 text-vs-soft font-bold text-[9px] tracking-widest uppercase sticky left-0 bg-vs-card2 z-10"
                      >
                        {group.name}
                      </td>
                    </tr>

                    {group.rows.map((row) => (
                      <tr key={row.key} className="border-t border-vs-border">
                        <td className="px-4 py-2 sticky left-0 bg-vs-card z-10">
                          <span className="text-vs-text font-semibold">{row.label}</span>
                          <span className="block text-vs-soft text-[9px] mt-0.5 whitespace-nowrap">
                            via {row.symbol}
                            {row.isProxy ? ' · proxy' : ''}
                            {row.currency && row.currency !== 'USD' ? ` · ${row.currency}` : ''}
                          </span>
                        </td>

                        <td className="text-right px-3 py-2 text-vs-soft whitespace-nowrap">
                          {fmtLevel(row.level)}
                        </td>

                        <td
                          className="text-right px-3 py-2 whitespace-nowrap"
                          style={{ color: returnColor(row.dayPct) }}
                        >
                          {fmtPct(row.dayPct)}
                        </td>

                        {COLUMNS.map((c) => (
                          <td
                            key={c.key}
                            className="text-right px-3 py-2 whitespace-nowrap font-semibold"
                            style={{ color: returnColor(row[c.key]) }}
                          >
                            {row.available ? fmtPct(row[c.key]) : DASH}
                          </td>
                        ))}

                        <td className="px-4 py-2 text-right">
                          <div className="flex justify-end">
                            <Sparkline points={row.spark} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}

                {/* VIX is a level, not a return, so it gets its own row shape. */}
                {vix?.available && (
                  <>
                    <tr className="bg-vs-card2">
                      <td
                        colSpan={COLUMNS.length + 4}
                        className="px-4 py-1.5 text-vs-soft font-bold text-[9px] tracking-widest uppercase sticky left-0 bg-vs-card2 z-10"
                      >
                        Volatility
                      </td>
                    </tr>
                    <tr className="border-t border-vs-border">
                      <td className="px-4 py-2 sticky left-0 bg-vs-card z-10">
                        <span className="text-vs-text font-semibold">{vix.label}</span>
                        <span className="block text-vs-soft text-[9px] mt-0.5 whitespace-nowrap">
                          via {vix.symbol} · level, not a return
                        </span>
                      </td>
                      <td className="text-right px-3 py-2 text-vs-text font-semibold whitespace-nowrap">
                        {fmtLevel(vix.level)}
                      </td>
                      <td
                        className="text-right px-3 py-2 whitespace-nowrap"
                        style={{ color: returnColor(vix.dayPct) }}
                      >
                        {fmtPct(vix.dayPct)}
                      </td>
                      <td colSpan={COLUMNS.length} className="px-3 py-2 text-vs-soft">
                        {`10-yr range ${fmtLevel(vix.low)}–${fmtLevel(vix.high)} · median ${fmtLevel(vix.median)} · currently higher than ${vix.percentile}% of the last decade`}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end">
                          <Sparkline points={vix.spark} />
                        </div>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-vs-border">
            <p className="text-vs-soft text-[9px] font-mono leading-relaxed max-w-[80ch]">
              {isTotal
                ? 'Total return uses investable ETFs as the measuring instrument, priced in USD with distributions reinvested. FTSE 100 and Nikkei 225 have no free total-return series, so MSCI UK and MSCI Japan stand in — those rows are marked as proxies and are not the same indices. Annualised figures are suppressed where the instrument has too little history to cover the window.'
                : 'Price return excludes dividends and coupons, and each index is shown in its own currency, so rows are not comparable with one another. Real estate, energy and bond rows still use ETFs — no free index series exists for them — which is why their price returns understate what a holder actually earned.'}
            </p>
            <p className="text-vs-soft text-[9px] font-mono mt-1.5">
              Data: Yahoo Finance. Past returns say nothing about future ones.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
