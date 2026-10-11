import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { fetchInsiders, fetchInsiderFiling } from '../lib/api';
import Card from './ui/Card';
import SegmentedControl from './ui/SegmentedControl';
import StatChip from './ui/StatChip';

// Who inside the company bought and sold its stock, from SEC Forms 3, 4 and 5.
// The API returns eighteen months; the window chips cut it here, so switching
// is instant. Dollar amounts are estimates (shares × that day's close) until a
// filing is opened for its exact price.

const WINDOWS = [
  { value: 6, label: '6M' },
  { value: 12, label: '12M' },
  { value: 18, label: '18M' },
];
const ROWS_SHOWN = 25;

const RED = 'rgb(var(--vs-red))';
const GREEN = 'rgb(var(--vs-green))';

function fmtUsd(v, approx = true) {
  if (v == null) return '—';
  const a = Math.abs(v);
  const s = a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B`
    : a >= 1e6 ? `$${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`
      : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K`
        : `$${Math.round(v)}`;
  return approx && v ? `≈${s}` : s;
}

const fmtShares = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(0)}K` : n.toLocaleString('en-US'));
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtMonth = (ym) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

function sinceIso(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// One row per filing per insider: an insider's Form 4 often reports a day's
// sale across several trusts and LLCs, which reads as one decision.
function groupFilings(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.accession}|${r.code}`;
    if (!map.has(key)) map.set(key, { ...r, shares: 0, estValue: 0, lines: 0 });
    const g = map.get(key);
    g.shares += r.shares;
    g.estValue += r.estValue || 0;
    g.lines++;
    if (r.date < g.date) g.date = r.date;
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function summarise(transactions, showAll) {
  const people = new Map();
  const months = new Map();
  for (const t of transactions) {
    if (!showAll && !t.openMarket) continue;
    const key = t.ownerCik || t.name;
    if (!people.has(key)) {
      people.set(key, { key, name: t.name, role: t.role, sold: 0, bought: 0, soldTrades: 0, boughtTrades: 0, rows: [], last: t.date });
    }
    const p = people.get(key);
    p.rows.push(t);
    if (t.date > p.last) p.last = t.date;
    if (t.openMarket) {
      const side = t.code === 'S' ? 'sold' : 'bought';
      p[side] += t.estValue || 0;
      p[`${side}Trades`]++;
      const m = t.date.slice(0, 7);
      if (!months.has(m)) months.set(m, { month: m, sold: 0, bought: 0 });
      months.get(m)[side] += t.estValue || 0;
    }
  }
  const insiders = [...people.values()].map((p) => ({ ...p, filings: groupFilings(p.rows) }))
    .sort((a, b) => (b.sold + b.bought) - (a.sold + a.bought) || b.last.localeCompare(a.last));
  const totals = insiders.reduce((t, p) => ({
    sold: t.sold + p.sold,
    bought: t.bought + p.bought,
    sellers: t.sellers + (p.soldTrades ? 1 : 0),
    buyers: t.buyers + (p.boughtTrades ? 1 : 0),
  }), { sold: 0, bought: 0, sellers: 0, buyers: 0 });
  return { insiders, totals, months };
}

// Buying above the line, selling below it, one bar per month in the window.
function MonthlyBars({ months, windowMonths }) {
  const keys = [];
  const d = new Date();
  d.setDate(15);
  for (let i = windowMonths - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 15);
    keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  const data = keys.map((k) => months.get(k) || { month: k, sold: 0, bought: 0 });
  const max = Math.max(1, ...data.map((m) => Math.max(m.sold, m.bought)));
  const hasBuys = data.some((m) => m.bought > 0);
  const up = hasBuys ? 28 : 0;
  const down = 44;
  const w = 100 / data.length;
  const label = `Open-market insider selling and buying by month, ${fmtMonth(keys[0])} to ${fmtMonth(keys.at(-1))}`;
  return (
    <div className="px-4 pt-3">
      <svg viewBox={`0 0 100 ${up + down + 1}`} preserveAspectRatio="none" className="w-full" style={{ height: up + down + 1 }} role="img" aria-label={label}>
        {data.map((m, i) => (
          <g key={m.month}>
            <title>{`${fmtMonth(m.month)}: sold ${fmtUsd(m.sold)}, bought ${fmtUsd(m.bought)}`}</title>
            {m.bought > 0 && <rect x={i * w + w * 0.15} width={w * 0.7} y={up - (m.bought / max) * up} height={(m.bought / max) * up} fill={GREEN} rx="0.6" />}
            {m.sold > 0 && <rect x={i * w + w * 0.15} width={w * 0.7} y={up + 1} height={Math.max(0.8, (m.sold / max) * down)} fill={RED} opacity="0.85" rx="0.6" />}
          </g>
        ))}
        <line x1="0" x2="100" y1={up + 0.5} y2={up + 0.5} stroke="rgb(var(--vs-border))" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-vs-dim text-micro font-mono mt-1">
        <span>{fmtMonth(keys[0])}</span>
        <span>{hasBuys ? 'bought ▲ · sold ▼' : 'sold, by month'}</span>
        <span>{fmtMonth(keys.at(-1))}</span>
      </div>
    </div>
  );
}

function FilingRow({ f, cik }) {
  const [detail, setDetail] = useState(null);
  const [state, setState] = useState('idle');
  const sell = f.code === 'S';
  const color = f.openMarket ? (sell ? RED : GREEN) : undefined;

  const load = () => {
    if (state !== 'idle' || !f.accession) return;
    setState('loading');
    fetchInsiderFiling(cik, f.accession)
      .then((d) => { setDetail(d); setState('done'); })
      .catch(() => setState('error'));
  };

  const exact = detail?.lines?.filter((l) => l.code === f.code) || [];
  const exactShares = exact.reduce((a, l) => a + l.shares, 0);
  const exactValue = exact.reduce((a, l) => a + (l.price ? l.price * l.shares : 0), 0);

  return (
    <li className="py-2 border-t border-vs-border first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label text-vs-soft">
            <span className="font-mono text-vs-text">{fmtDate(f.date)}</span>
            <span className="text-vs-dim"> · {f.label}{f.common ? '' : ` (${f.security})`}</span>
          </p>
          <p className="text-micro font-mono text-vs-dim mt-0.5">
            {fmtShares(f.shares)} sh{f.estPrice && f.common ? ` · close $${f.estPrice.toFixed(2)}` : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-body font-semibold" style={{ color }}>{f.common ? fmtUsd(f.estValue) : '—'}</p>
          {f.accession && state === 'idle' && (
            <button type="button" onClick={load} className="text-micro font-mono text-vs-blue hover:underline">
              Exact price
            </button>
          )}
          {state === 'loading' && <p className="text-micro font-mono text-vs-dim">Reading filing…</p>}
          {state === 'error' && <p className="text-micro font-mono text-vs-dim">Filing unavailable</p>}
        </div>
      </div>
      {state === 'done' && (
        <div className="mt-1.5 rounded-md bg-vs-card2 px-2.5 py-2 text-label text-vs-soft">
          {exactShares && exactValue ? (
            <p>
              <span className="font-mono text-vs-text">{fmtUsd(exactValue, false)}</span>
              {' '}at an average of <span className="font-mono text-vs-text">${(exactValue / exactShares).toFixed(2)}</span>
            </p>
          ) : <p>No price reported on this filing (common for grants, gifts and exercises).</p>}
          <p className="mt-0.5">
            10b5-1 trading plan:{' '}
            <span className="text-vs-text">{detail.plan === true ? 'yes, pre-scheduled' : detail.plan === false ? 'no' : 'not stated'}</span>
          </p>
          <a href={detail.filing} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-1 text-micro font-mono text-vs-blue hover:underline">
            Filing on SEC EDGAR <ExternalLink size={11} aria-hidden="true" />
          </a>
        </div>
      )}
    </li>
  );
}

function InsiderRow({ p, cik, open, onToggle, showAll }) {
  const [limit, setLimit] = useState(ROWS_SHOWN);
  const net = p.sold || p.bought;
  const side = p.sold >= p.bought ? 'sold' : 'bought';
  const trades = p.soldTrades + p.boughtTrades;
  return (
    <li className="border-t border-vs-border">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-vs-card2/60 transition-colors">
        <div className="min-w-0">
          <p className="text-body text-vs-text font-semibold truncate">{p.name}</p>
          <p className="text-micro font-mono text-vs-dim truncate mt-0.5">{p.role || 'Insider'}</p>
        </div>
        <div className="text-right shrink-0 flex items-start gap-2">
          <div>
            {net ? (
              <p className="font-mono text-body font-semibold" style={{ color: side === 'sold' ? RED : GREEN }}>
                {fmtUsd(side === 'sold' ? p.sold : p.bought)} {side}
              </p>
            ) : <p className="font-mono text-body text-vs-dim">No open-market trades</p>}
            {p.sold && p.bought ? <p className="font-mono text-micro" style={{ color: GREEN }}>{fmtUsd(p.bought)} bought</p> : null}
            <p className="text-micro font-mono text-vs-dim mt-0.5">
              {trades ? `${trades} trade${trades === 1 ? '' : 's'} · ` : `${p.rows.length} filing line${p.rows.length === 1 ? '' : 's'} · `}{fmtDate(p.last)}
            </p>
          </div>
          <ChevronDown size={14} aria-hidden="true" className={`mt-1 text-vs-dim transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <ul>
            {p.filings.slice(0, limit).map((f) => <FilingRow key={`${f.accession}|${f.code}`} f={f} cik={cik} />)}
          </ul>
          {p.filings.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + ROWS_SHOWN)} className="mt-1 text-label font-mono text-vs-blue hover:underline">
              Show {Math.min(ROWS_SHOWN, p.filings.length - limit)} more of {p.filings.length - limit}
            </button>
          )}
          {!showAll && p.filings.length === 0 && <p className="text-label text-vs-dim">Only grants, exercises, tax or gifts in this window.</p>}
        </div>
      )}
    </li>
  );
}

export default function InsidersPanel({ symbol }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [months, setMonths] = useState(12);
  const [showAll, setShowAll] = useState(false);
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    setOpenKey(null);
    fetchInsiders(symbol)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  const inWindow = useMemo(() => {
    if (!data) return [];
    const since = sinceIso(months);
    return data.transactions.filter((t) => t.date >= since);
  }, [data, months]);
  const { insiders, totals, months: monthly } = useMemo(() => summarise(inWindow, showAll), [inWindow, showAll]);
  const otherCount = inWindow.filter((t) => !t.openMarket).length;

  if (loading) {
    return (
      <Card label="Insider transactions" className="mt-4">
        <div className="px-4 py-6">
          <div className="h-16 rounded-lg bg-vs-card2 animate-pulse" />
          <p className="text-label text-vs-dim mt-3">Reading SEC insider filings… this takes a few seconds the first time.</p>
        </div>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card label="Insider transactions" className="mt-4">
        <p className="px-4 py-5 text-label text-vs-dim">{error || 'No insider data.'}</p>
      </Card>
    );
  }

  const label = WINDOWS.find((w) => w.value === months)?.label;
  return (
    <Card
      label="Insider transactions"
      aside={`SEC Form 4 · last ${months} months`}
      className="mt-4"
      footer={(
        <>
          Open-market trades only unless you include the rest. Dollar amounts are estimates: shares × that day&rsquo;s closing price.
          Tap a trade for the exact price and whether it was pre-scheduled under a Rule 10b5-1 plan. Roles are as filed with the SEC.
          Source: SEC EDGAR Forms 3, 4 and 5.
        </>
      )}
    >
      <div className="px-4 pt-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl options={WINDOWS} value={months} onChange={(v) => { setMonths(v); setOpenKey(null); }} />
      </div>

      <div className="px-4 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatChip label="Sold" value={totals.sold ? fmtUsd(totals.sold) : '$0'} color={totals.sold ? RED : undefined} />
        <StatChip label="Sellers" value={String(totals.sellers)} />
        <StatChip label="Bought" value={totals.bought ? fmtUsd(totals.bought) : '$0'} color={totals.bought ? GREEN : undefined} />
        <StatChip label="Buyers" value={String(totals.buyers)} />
      </div>

      {(totals.sold > 0 || totals.bought > 0) && <MonthlyBars months={monthly} windowMonths={months} />}

      {insiders.length ? (
        <ul className="mt-3">
          {insiders.map((p) => (
            <InsiderRow key={p.key} p={p} cik={data.cik} showAll={showAll} open={openKey === p.key} onToggle={() => setOpenKey(openKey === p.key ? null : p.key)} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-label text-vs-dim">
          No open-market insider trades in the last {label}.
          {otherCount ? ` There were ${otherCount} other filing lines (grants, exercises, tax withholding or gifts).` : ''}
        </p>
      )}

      {otherCount > 0 && (
        <label className="flex items-center gap-2 px-4 py-3 border-t border-vs-border text-label text-vs-soft cursor-pointer">
          <input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); setOpenKey(null); }} className="accent-[rgb(var(--vs-blue))]" />
          Include grants, exercises, tax withholding and gifts ({otherCount})
        </label>
      )}
    </Card>
  );
}
