import { Fragment, useEffect, useMemo, useState } from 'react';
import { fetchIndices } from '../lib/api';
import { tint } from '../lib/metrics';
import BackButton from './ui/BackButton';
import ErrorBanner from './ui/ErrorBanner';
import SegmentedControl from './ui/SegmentedControl';

const MODES = [
  { key: 'total', label: 'Total return · USD' },
  { key: 'price', label: 'Price · local' },
];

// Shortest window first, so a row reads left-to-right as it zooms out.
const COLUMNS = [
  { key: 'wtd', label: 'WTD' },
  { key: 'mtd', label: 'MTD' },
  { key: 'ytd', label: 'YTD' },
  { key: 'r1y', label: '1Y' },
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

// Heat map. Each timeframe column gets its own scale spanning every market, so
// a column reads as a ranking. The scale is anchored at zero rather than at the
// column's worst value: green always means the market made money. Scaling to
// the column range instead would paint a market up 15% red simply for lagging.
const MIN_ALPHA = 0.04;
// Ceiling set by contrast, not taste: the value sits on top of this tint, and
// green in dark mode is the binding case. Measured against vs-text on vs-card,
// 0.42 leaves 5.2:1 and 0.55 drops to 3.87:1, under the AA floor.
const MAX_ALPHA = 0.42;
// Below 1 so mid-range cells stay legible instead of washing out behind a
// single outlier — Energy at +39% would otherwise flatten everything else.
const RAMP = 0.7;

function columnScales(rows, columns) {
  const scales = {};
  for (const col of columns) {
    let maxAbs = 0;
    for (const row of rows) {
      const v = row[col.key];
      if (v != null && isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
    }
    scales[col.key] = maxAbs;
  }
  return scales;
}

function heatStyle(value, maxAbs) {
  if (value == null || !isFinite(value) || !maxAbs) return undefined;
  const ratio = Math.min(1, Math.abs(value) / maxAbs);
  // The floor keeps a near-zero return faintly tinted, so an empty cell always
  // means missing data rather than a small number.
  const alpha = MIN_ALPHA + Math.pow(ratio, RAMP) * (MAX_ALPHA - MIN_ALPHA);
  const token = value >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))';
  return { background: tint(token, Number(alpha.toFixed(3))) };
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

  // One scale per column, across every market — not per section. Global has a
  // single row and Emerging has two, so a per-section scale would paint a 2-point
  // gap as the full spectrum.
  const scales = useMemo(() => columnScales(rows, COLUMNS), [rows]);

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
      {onBack && <BackButton onClick={onBack} />}

      <div className="text-vs-dim text-label font-mono tracking-widest">WORLD INDICES</div>
      <h1 className="font-display text-display font-extrabold mt-1 leading-tight text-vs-text">
        Index returns
      </h1>
      <p className="text-vs-soft text-body mt-0.5 max-w-[68ch]">
        {isTotal
          ? 'Dividends and coupons reinvested, everything converted to USD, so every row is measured the same way.'
          : 'The indices themselves, in their own currency, price only — the numbers you see quoted in the press.'}
      </p>

      {/* Basis toggle */}
      <SegmentedControl
        className="mt-4"
        options={MODES.map((m) => ({ value: m.key, label: m.label }))}
        value={mode}
        onChange={setMode}
      />

      {/* Why the toggle exists. Worth saying once, plainly. */}
      <p className="text-vs-soft text-micro font-mono mt-2 max-w-[68ch] leading-relaxed">
        {isTotal
          ? 'Bonds and property earn most of their return as income, so price-only figures understate them badly.'
          : 'Price return ignores income. US bonds look like a loss on this basis; on a total-return basis they are not.'}
      </p>

      {/* Heat scale legend */}
      {!loading && !error && rows.length > 0 && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="text-vs-soft text-micro font-mono uppercase tracking-wider">
            Shaded per column
          </span>
          <div className="flex items-center gap-1">
            <span className="text-vs-soft text-micro font-mono">loss</span>
            {[-1, -0.55, -0.2, 0.2, 0.55, 1].map((step) => (
              <span
                key={step}
                className="inline-block w-5 h-3 rounded-sm border border-vs-border"
                style={heatStyle(step, 1)}
              />
            ))}
            <span className="text-vs-soft text-micro font-mono">gain</span>
          </div>
        </div>
      )}

      {error && <ErrorBanner className="mt-5">{error}</ErrorBanner>}

      {loading && (
        <div className="mt-4 rounded-xl border border-vs-border bg-vs-card px-4 py-6">
          <div className="animate-pulse space-y-2">
            <div className="h-3 bg-vs-border rounded-md w-48" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 bg-vs-border rounded-md" />
            ))}
          </div>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-dense">
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
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.name}>
                    <tr className="bg-vs-card2">
                      <td
                        colSpan={COLUMNS.length + 3}
                        className="px-4 py-1.5 text-vs-soft font-bold text-micro tracking-widest uppercase sticky left-0 bg-vs-card2 z-10"
                      >
                        {group.name}
                      </td>
                    </tr>

                    {group.rows.map((row) => (
                      <tr key={row.key} className="border-t border-vs-border">
                        <td className="px-4 py-2 sticky left-0 bg-vs-card z-10">
                          <span className="text-vs-text font-semibold">{row.label}</span>
                          <span className="block text-vs-soft text-micro mt-0.5 whitespace-nowrap">
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
                            className={`text-right px-3 py-2 whitespace-nowrap font-semibold ${
                              row[c.key] == null ? 'text-vs-soft' : 'text-vs-text'
                            }`}
                            style={row.available ? heatStyle(row[c.key], scales[c.key]) : undefined}
                          >
                            {row.available ? fmtPct(row[c.key]) : DASH}
                          </td>
                        ))}

                      </tr>
                    ))}
                  </Fragment>
                ))}

                {/* VIX is a level, not a return, so it gets its own row shape. */}
                {vix?.available && (
                  <>
                    <tr className="bg-vs-card2">
                      <td
                        colSpan={COLUMNS.length + 3}
                        className="px-4 py-1.5 text-vs-soft font-bold text-micro tracking-widest uppercase sticky left-0 bg-vs-card2 z-10"
                      >
                        Volatility
                      </td>
                    </tr>
                    <tr className="border-t border-vs-border">
                      <td className="px-4 py-2 sticky left-0 bg-vs-card z-10">
                        <span className="text-vs-text font-semibold">{vix.label}</span>
                        <span className="block text-vs-soft text-micro mt-0.5 whitespace-nowrap">
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
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t border-vs-border">
            <p className="text-vs-soft text-micro font-mono leading-relaxed max-w-[80ch]">
              {isTotal
                ? 'Total return uses investable ETFs as the measuring instrument, priced in USD with distributions reinvested. FTSE 100 and Nikkei 225 have no free total-return series, so MSCI UK and MSCI Japan stand in — those rows are marked as proxies and are not the same indices. Annualised figures are suppressed where the instrument has too little history to cover the window.'
                : 'Price return excludes dividends and coupons, and each index is shown in its own currency, so rows are not comparable with one another. Real estate, energy and bond rows still use ETFs — no free index series exists for them — which is why their price returns understate what a holder actually earned.'}
            </p>
            <p className="text-vs-soft text-micro font-mono mt-1.5">
              Data: Yahoo Finance. Past returns say nothing about future ones.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
