import { useEffect, useState } from 'react';
import { fetchHoldings } from '../lib/api';
import { tint } from '../lib/metrics';
import BackButton from './ui/BackButton';
import ErrorBanner from './ui/ErrorBanner';
import SegmentedControl from './ui/SegmentedControl';

// A few managers worth reading. Shown on the empty state so the page is useful
// before you know whose name to type.
const SEED_FILERS = [
  { cik: '0001067983', name: 'Berkshire Hathaway' },
  { cik: '0001649339', name: 'Scion Asset Management' },
  { cik: '0001336528', name: 'Pershing Square' },
  { cik: '0001536411', name: 'Duquesne Family Office' },
  { cik: '0001061768', name: 'Baupost Group' },
];

const TABS = [
  { key: 'holdings', label: 'Holdings' },
  { key: 'changes', label: 'Changes' },
];

const STATUS = {
  new:     { label: 'New',     color: 'rgb(var(--vs-green))' },
  added:   { label: 'Added',   color: 'rgb(var(--vs-green))' },
  trimmed: { label: 'Trimmed', color: 'rgb(var(--vs-amber))' },
  exited:  { label: 'Exited',  color: 'rgb(var(--vs-red))' },
  held:    { label: 'Held',    color: 'rgb(var(--vs-soft))' },
};

const DASH = '—';

const fmtValue = (v) => {
  if (v == null || !isFinite(v)) return DASH;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtPct = (v, digits = 1) => {
  if (v == null || !isFinite(v)) return DASH;
  const rounded = Math.round(v * 10 ** digits) / 10 ** digits;
  return `${rounded > 0 ? '+' : ''}${(rounded === 0 ? 0 : rounded).toFixed(digits)}%`;
};

const fmtShares = (v) => (v == null || !isFinite(v) ? DASH : Math.round(v).toLocaleString('en-US'));

const quarterLabel = (iso) => {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  return `Q${Math.ceil(Number(m) / 3)} ${y}`;
};

export default function InstitutionsPage({ onBack, onSelectTicker, filer, onPickFiler }) {
  const [period, setPeriod] = useState(null);
  const [tab, setTab] = useState('holdings');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // The filer is owned by the global search bar now. Resetting during render
  // rather than in an effect means the fetch below never fires once with the
  // previous manager's quarter still selected.
  const cik = filer?.cik ?? null;
  const [lastCik, setLastCik] = useState(cik);
  if (cik !== lastCik) {
    setLastCik(cik);
    setPeriod(null);
    setTab('holdings');
    setData(null);
    setError('');
  }

  useEffect(() => {
    if (!filer) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchHoldings(filer.cik, period)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) { setError(e.message || 'Failed to load holdings'); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filer, period]);

  const positions = data?.positions || [];
  // The API orders by change status, which is what the Changes tab wants. The
  // Holdings tab is a portfolio, so it sorts by size.
  const rows = tab === 'holdings'
    ? [...positions].filter((p) => p.status !== 'exited').sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    : positions.filter((p) => p.status && p.status !== 'held');

  return (
    <div className="mt-5 pb-8">
      <BackButton onClick={onBack} />

      <div className="text-vs-dim text-label font-mono tracking-widest">13F HOLDINGS</div>
      <h1 className="font-display text-display font-extrabold mt-1 leading-tight text-vs-text">
        {filer ? filer.name : 'What the big investors own'}
      </h1>
      <p className="text-vs-soft text-body mt-0.5 max-w-[68ch]">
        Institutional managers running over $100M must report their US equity positions
        to the SEC every quarter. This reads those filings directly.
      </p>

      {/* Empty state */}
      {!filer && (
        <div className="mt-4">
          <span className="text-vs-soft text-micro font-mono">
            Search a manager by name in the box above, or try:
          </span>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {SEED_FILERS.map((f) => (
              <button
                key={f.cik}
                onClick={() => onPickFiler(f)}
                className="rounded-md px-2.5 py-1.5 text-label font-mono bg-vs-card text-vs-soft border border-vs-border hover:border-vs-borderLight hover:text-vs-text cursor-pointer transition-all"
              >
                {f.name}
              </button>
            ))}
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

      {!loading && !error && data && (
        <>
          {/* Portfolio summary */}
          <div className="mt-4 flex items-baseline gap-4 flex-wrap">
            <div>
              <span className="text-vs-soft text-micro font-mono uppercase tracking-wider block">
                Portfolio value
              </span>
              <span className="font-mono text-prose font-semibold text-vs-text">
                {fmtValue(data.totalValue)}
              </span>
            </div>
            <div>
              <span className="text-vs-soft text-micro font-mono uppercase tracking-wider block">
                Positions
              </span>
              <span className="font-mono text-prose font-semibold text-vs-text">
                {data.positionCount}
              </span>
            </div>
            <div>
              <span className="text-vs-soft text-micro font-mono uppercase tracking-wider block">
                Quarter
              </span>
              <span className="font-mono text-prose font-semibold text-vs-text">
                {quarterLabel(data.period)}
              </span>
            </div>
            <div>
              <span className="text-vs-soft text-micro font-mono uppercase tracking-wider block">
                Filed
              </span>
              <span className="font-mono text-prose font-semibold text-vs-text">
                {data.filingDate}
              </span>
            </div>
          </div>

          {/* Quarter picker */}
          <div className="mt-4">
            <span className="text-vs-soft text-micro font-mono uppercase tracking-wider">Jump to quarter</span>
            <div className="mt-1.5 overflow-x-auto pb-1">
              <SegmentedControl
                className="flex-nowrap"
                options={data.quarters.slice(0, 24).map((q) => ({
                  value: q.reportDate,
                  label: <span className="whitespace-nowrap">{quarterLabel(q.reportDate)}</span>,
                }))}
                value={data.period}
                onChange={setPeriod}
              />
            </div>
          </div>

          {/* Tabs */}
          <SegmentedControl
            className="mt-3"
            options={TABS.map((t) => ({
              value: t.key,
              disabled: t.key === 'changes' && !data.comparedTo,
              label: t.key === 'changes' && data.comparedTo
                ? `${t.label} vs ${quarterLabel(data.comparedTo.reportDate)}`
                : t.label,
            }))}
            value={tab}
            onChange={setTab}
          />

          {/* Table */}
          <div className="mt-3 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-dense">
                <thead>
                  <tr className="border-b border-vs-border">
                    <th className="text-left px-4 py-2 text-vs-soft font-medium sticky left-0 bg-vs-card z-10 min-w-[170px]">
                      Position
                    </th>
                    {tab === 'changes' && (
                      <th className="text-left px-3 py-2 text-vs-soft font-medium whitespace-nowrap">Change</th>
                    )}
                    <th className="text-right px-3 py-2 text-vs-soft font-medium whitespace-nowrap">Value</th>
                    <th className="text-right px-3 py-2 text-vs-soft font-medium whitespace-nowrap">% of book</th>
                    <th className="text-right px-3 py-2 text-vs-soft font-medium whitespace-nowrap">Shares</th>
                    {tab === 'changes' && (
                      <th className="text-right px-4 py-2 text-vs-soft font-medium whitespace-nowrap">Δ shares</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const status = STATUS[p.status];
                    const clickable = Boolean(p.ticker && onSelectTicker);
                    return (
                      <tr
                        key={`${p.cusip}-${p.putCall || ''}-${p.status || ''}`}
                        onClick={clickable ? () => onSelectTicker(p.ticker) : undefined}
                        className={`border-t border-vs-border ${clickable ? 'cursor-pointer hover:bg-vs-card2 transition-colors' : ''}`}
                      >
                        <td className="px-4 py-2 sticky left-0 bg-vs-card z-10">
                          {p.ticker
                            ? <span className="text-vs-blue font-semibold">{p.ticker}</span>
                            : <span className="text-vs-text font-semibold">{p.issuer}</span>}
                          <span className="block text-vs-soft text-micro mt-0.5 whitespace-nowrap">
                            {p.ticker ? p.issuer : `CUSIP ${p.cusip}`}
                            {p.putCall ? ` · ${p.putCall}` : ''}
                          </span>
                        </td>

                        {tab === 'changes' && (
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span
                              className="inline-block rounded-md px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider"
                              style={{
                                color: status.color,
                                border: `1px solid ${tint(status.color, 0.25)}`,
                                background: tint(status.color, 0.07),
                              }}
                            >
                              {status.label}
                            </span>
                            {p.deltaPct != null && p.status !== 'new' && (
                              <span className="ml-1.5 text-vs-soft">{fmtPct(p.deltaPct, 0)}</span>
                            )}
                          </td>
                        )}

                        <td className="text-right px-3 py-2 text-vs-text font-semibold whitespace-nowrap">
                          {p.status === 'exited' ? fmtValue(p.priorValue) : fmtValue(p.value)}
                        </td>
                        <td className="text-right px-3 py-2 text-vs-soft whitespace-nowrap">
                          {p.status === 'exited' ? DASH : fmtPct(p.pctOfPortfolio, 1).replace('+', '')}
                        </td>
                        <td className="text-right px-3 py-2 text-vs-soft whitespace-nowrap">
                          {p.status === 'exited' ? fmtShares(p.priorShares) : fmtShares(p.shares)}
                        </td>
                        {tab === 'changes' && (
                          <td
                            className="text-right px-4 py-2 whitespace-nowrap font-semibold"
                            style={{ color: (p.deltaShares ?? 0) >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))' }}
                          >
                            {(p.deltaShares ?? 0) > 0 ? '+' : ''}{fmtShares(p.deltaShares)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {rows.length === 0 && (
              <p className="px-4 py-4 text-vs-soft text-label font-mono">
                {tab === 'changes'
                  ? 'No position changes between these two quarters.'
                  : 'No positions in this filing.'}
              </p>
            )}

            <div className="px-4 py-3 border-t border-vs-border">
              <p className="text-vs-soft text-micro font-mono leading-relaxed max-w-[80ch]">
                {`13Fs are filed up to 45 days after quarter-end, so this shows what was held on ${data.period}, not today. They cover US-listed long equity only — short positions, bonds, cash and foreign holdings never appear, so this is not the whole portfolio. Duplicate rows for the same security across managing entities are combined${data.rawRows !== data.positionCount ? `: ${data.rawRows} filed rows became ${data.positionCount} positions` : ''}.`}
              </p>
              <p className="text-vs-soft text-micro font-mono mt-1.5">
                Source: SEC EDGAR {data.form} · tickers matched by CUSIP via OpenFIGI, blank where unmatched.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
