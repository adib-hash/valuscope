import { useState, useMemo, useEffect } from 'react';
import SearchBar from './components/SearchBar';
import Pill from './components/Pill';
import ValuChart from './components/ValuChart';
import DataTable from './components/DataTable';
import PillDetail from './components/PillDetail';
import FundamentalsPanel from './components/FundamentalsPanel';
import FairValueTable from './components/FairValueTable';
import Thesis from './components/Thesis';
import { fetchFinancials } from './lib/api';
import {
  GROUPS,
  ALL_METRICS,
  computeAverages,
  computeRanges,
  computePercentiles,
} from './lib/metrics';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  isWatched,
} from './lib/watchlist';

const QUICK_TICKERS = ['AAPL', 'MSFT', 'ULTA', 'COST', 'META', 'AMZN', 'GOOGL', 'NFLX'];
const APP_VERSION   = 'v0.4.0';

// Pills shown in the summary row
const PILL_METRICS = [
  { key: 'pe',       label: 'P/E' },
  { key: 'evEbitda', label: 'EV/EBITDA' },
  { key: 'pfcf',     label: 'P/FCF' },
  { key: 'evSales',  label: 'EV/Sales' },
  { key: 'fcfYield', label: 'FCF Yld', isYield: true },
  { key: 'pb',       label: 'P/B' },
];

export default function App() {
  // ── Data state ──────────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [data,     setData]     = useState(null);
  const [group,    setGroup]    = useState('Price Multiples');
  const [selected, setSelected] = useState(['pe', 'evEbitda']);
  const [history,  setHistory]  = useState([]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [descOpen,     setDescOpen]     = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePill,   setActivePill]   = useState(null);

  // ── Theme ────────────────────────────────────────────────────────────────────
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('vs-theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('vs-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // ── Watchlist ────────────────────────────────────────────────────────────────
  const [watchlist, setWatchlist] = useState(() => getWatchlist());

  const toggleWatchlist = (sym) => {
    if (isWatched(sym)) removeFromWatchlist(sym);
    else addToWatchlist(sym);
    setWatchlist(getWatchlist());
  };

  // ── Scroll lock for modals (CLAUDE.md position:fixed pattern) ───────────────
  const isAnyModalOpen = settingsOpen || !!activePill;

  useEffect(() => {
    if (isAnyModalOpen) {
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top      = `-${scrollY}px`;
      document.body.style.width    = '100%';
      return () => {
        const sy = Math.abs(parseInt(document.body.style.top || '0'));
        document.body.style.position = '';
        document.body.style.top      = '';
        document.body.style.width    = '';
        window.scrollTo(0, sy);
      };
    }
  }, [isAnyModalOpen]);

  // ── App actions ──────────────────────────────────────────────────────────────
  const resetApp = () => {
    setData(null);
    setError('');
    setLoading(false);
    setGroup('Price Multiples');
    setSelected(['pe', 'evEbitda']);
    setDescOpen(false);
    setActivePill(null);
  };

  const loadCompany = async (ticker) => {
    const sym = ticker.toUpperCase().trim();
    if (!sym) return;
    setLoading(true);
    setError('');
    setData(null);
    setDescOpen(false);
    setActivePill(null);
    try {
      const result = await fetchFinancials(sym);
      setData(result);
      setHistory((prev) => [sym, ...prev.filter((h) => h !== sym)].slice(0, 8));
    } catch (e) {
      setError(`Failed to load ${sym}: ${e.message}`);
    }
    setLoading(false);
  };

  // ── Derived data ─────────────────────────────────────────────────────────────
  const years   = data?.years || [];
  const now     = years[years.length - 1];
  const hist    = years.filter((y) => !y.fiscalYear?.startsWith('Now'));
  const metrics = GROUPS[group];
  const isYield = group === 'Yield Metrics' || group === 'Growth & Margins';
  const sym     = data?.symbol || '';
  const watched = sym ? isWatched(sym) : false;

  const avgs        = useMemo(() => computeAverages(hist),               [hist]);
  const ranges      = useMemo(() => computeRanges(hist),                 [hist]);
  const percentiles = useMemo(() => computePercentiles(hist, now),       [hist, now]);

  const regimePercentile = useMemo(() => {
    const vals = PILL_METRICS.map((m) => percentiles[m.key]).filter((v) => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [percentiles]);

  const REGIME = regimePercentile == null  ? null
    : regimePercentile <= 20 ? { label: 'DEEP VALUE', color: '#38D89A' }
    : regimePercentile <= 40 ? { label: 'UNDERVALUED', color: '#4E94F8' }
    : regimePercentile <= 60 ? { label: 'FAIR VALUE',  color: '#94A0B8' }
    : regimePercentile <= 80 ? { label: 'STRETCHED',   color: '#E8AA30' }
    :                          { label: 'EXPENSIVE',   color: '#F25C5C' };

  const chartData = years.map((d) => ({
    name: d.fiscalYear,
    ...Object.fromEntries(
      ALL_METRICS.map((m) => [m.key, d[m.key] != null && isFinite(d[m.key]) ? d[m.key] : null])
    ),
  }));

  const toggle = (k) =>
    setSelected((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const switchGroup = (g) => {
    setGroup(g);
    setSelected(GROUPS[g].map((m) => m.key).slice(0, 2));
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-vs-bg text-vs-text font-sans">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <header className="border-b border-vs-border px-5 py-3.5">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between gap-3">

          {/* Logo — clickable home/reset button */}
          <button
            onClick={resetApp}
            aria-label="ValuScope home"
            className="flex items-baseline gap-2 bg-transparent border-0 p-0 cursor-pointer"
          >
            <span className="font-display text-[22px] font-extrabold text-vs-text">
              ValuScope
            </span>
            <span className="text-vs-dim text-[11px] font-mono hidden sm:inline">
              historical valuation multiples
            </span>
          </button>

          {/* Header right: attribution + theme toggle + settings */}
          <div className="flex items-center gap-1">
            <span className="text-vs-dim text-[10px] font-mono hidden md:inline mr-2">
              Data: Yahoo Finance
            </span>

            {/* Theme toggle */}
            <button
              onClick={() => setIsDark(!isDark)}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="text-vs-dim hover:text-vs-soft transition-colors p-2 cursor-pointer rounded-md hover:bg-vs-card"
            >
              {isDark ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>

            {/* Settings */}
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              className="text-vs-dim hover:text-vs-soft transition-colors p-2 cursor-pointer rounded-md hover:bg-vs-card"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────────────── */}
      <main className="max-w-[1100px] mx-auto px-4 py-5">

        {/* Search */}
        <SearchBar onSelect={loadCompany} loading={loading} />

        {/* Recent searches */}
        {history.length > 0 && !loading && (
          <div className="flex gap-1.5 mt-2.5 flex-wrap items-center">
            <span className="text-vs-dim text-[10px] font-mono leading-6">Recent:</span>
            {history.map((h) => (
              <button
                key={h}
                onClick={() => loadCompany(h)}
                className={`border rounded px-2.5 py-0.5 text-[11px] font-mono cursor-pointer transition-colors ${
                  h === sym
                    ? 'bg-vs-blue/10 text-vs-blue border-vs-blue'
                    : 'bg-vs-card text-vs-soft border-vs-border hover:border-vs-borderLight'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        )}

        {/* ── Loading skeleton ───────────────────────────────────────────────── */}
        {loading && (
          <div className="mt-6">
            <div className="animate-pulse space-y-2.5">
              <div className="h-3 bg-vs-card rounded w-28" />
              <div className="h-7 bg-vs-card rounded w-56" />
              <div className="h-3 bg-vs-card rounded w-44" />
            </div>
            <div className="flex gap-1.5 mt-5 overflow-x-hidden">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse bg-vs-card border border-vs-border rounded-lg min-w-[130px] flex-1 h-[104px]"
                />
              ))}
            </div>
            <div className="animate-pulse mt-6 space-y-2">
              <div className="h-3 bg-vs-card rounded w-36" />
              <div className="bg-vs-card border border-vs-border rounded-xl h-[260px] sm:h-[350px]" />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-5 text-vs-red font-mono text-[13px] px-4 py-3 bg-vs-red/5 rounded-lg border border-vs-red/20">
            {error}
          </div>
        )}

        {/* ── Empty state ────────────────────────────────────────────────────── */}
        {!data && !loading && !error && (
          <div className="mt-16 text-center">
            {/* SVG bar chart icon */}
            <div className="flex justify-center mb-2.5 opacity-40">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3"  y="12" width="4" height="9" rx="1" className="fill-vs-dim" />
                <rect x="10" y="7"  width="4" height="14" rx="1" className="fill-vs-dim" />
                <rect x="17" y="3"  width="4" height="18" rx="1" className="fill-vs-dim" />
              </svg>
            </div>
            <div className="text-vs-soft text-[15px]">
              Search any US public company by ticker
            </div>
            <div className="text-vs-dim text-xs mt-1.5">
              Historical valuation multiples from Yahoo Finance
            </div>

            {/* Watchlist */}
            {watchlist.length > 0 && (
              <div className="mt-6">
                <p className="text-vs-dim text-[10px] font-mono uppercase tracking-widest mb-2.5">
                  Watchlist
                </p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {watchlist.map((t) => (
                    <button
                      key={t}
                      onClick={() => loadCompany(t)}
                      className="bg-vs-blue/10 text-vs-blue border border-vs-blue/30 rounded-md px-3.5 py-1.5 text-xs font-mono cursor-pointer hover:bg-vs-blue/20 transition-colors"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick picks */}
            <div className={watchlist.length > 0 ? 'mt-5' : 'mt-5'}>
              {watchlist.length > 0 && (
                <p className="text-vs-dim text-[10px] font-mono uppercase tracking-widest mb-2.5">
                  Quick Picks
                </p>
              )}
              <div className="flex gap-2 justify-center flex-wrap">
                {QUICK_TICKERS.map((t) => (
                  <button
                    key={t}
                    onClick={() => loadCompany(t)}
                    className="bg-vs-card text-vs-soft border border-vs-border rounded-md px-3.5 py-1.5 text-xs font-mono cursor-pointer hover:border-vs-borderLight hover:text-vs-text transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Dashboard ──────────────────────────────────────────────────────── */}
        {data && now && !loading && (
          <>
            {/* Company header */}
            <div className="mt-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="text-vs-dim text-[11px] font-mono tracking-widest">
                      {data.exchange}: {sym}
                    </span>
                    {data.sector && (
                      <span className="text-vs-dim text-[11px]">&middot; {data.sector}</span>
                    )}
                  </div>
                  <h1 className="font-display text-[28px] font-extrabold mt-1 leading-tight text-vs-text">
                    {data.companyName || sym}
                  </h1>
                  <p className="text-vs-soft text-[13px] mt-0.5">
                    {hist.length}-year trailing multiples vs. current LTM
                    {data.currentPrice && <> &middot; ${data.currentPrice.toFixed(2)}</>}
                    {data.change != null && (
                      <span
                        className="ml-1.5"
                        style={{ color: data.change >= 0 ? '#38D89A' : '#F25C5C' }}
                      >
                        {data.change >= 0 ? '+' : ''}
                        {data.change.toFixed(2)}%
                      </span>
                    )}
                  </p>

                  {/* Collapsible company description */}
                  {data.description && (
                    <p className="text-vs-dim text-[12px] mt-2 leading-relaxed">
                      {descOpen
                        ? data.description
                        : data.description.slice(0, 150)}
                      {data.description.length > 150 && (
                        <>
                          {!descOpen && '...'}
                          <button
                            onClick={() => setDescOpen(!descOpen)}
                            className="ml-1.5 text-vs-blue text-[11px] font-mono cursor-pointer hover:underline"
                          >
                            {descOpen ? 'less' : 'more'}
                          </button>
                        </>
                      )}
                    </p>
                  )}
                </div>

                {/* Watchlist star */}
                <button
                  onClick={() => toggleWatchlist(sym)}
                  aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                  className="mt-1 p-1.5 rounded-lg transition-colors cursor-pointer flex-shrink-0"
                  style={{ color: watched ? '#E8AA30' : 'rgb(var(--vs-dim))' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={watched ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </button>
              </div>

              {/* Validation links */}
              <div className="flex gap-2 mt-2.5 flex-wrap">
                {[
                  { href: `https://stockanalysis.com/stocks/${sym.toLowerCase()}/financials/ratios/`, label: 'StockAnalysis', color: '#4E94F8' },
                  { href: `https://finance.yahoo.com/quote/${sym}/financials/`, label: 'Yahoo Finance', color: '#9B7AF5' },
                  { href: `https://quartr.com/companies/${sym.toLowerCase()}`, label: 'Quartr', color: '#38D89A' },
                  { href: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=8-K&dateb=&owner=include&count=5`, label: 'SEC 8-K', color: '#E8AA30' },
                  { href: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${sym}&type=10-K&dateb=&owner=include&count=5&action=getcompany`, label: 'SEC 10-K', color: '#E88A3A' },
                ].map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono no-underline px-2.5 py-1 rounded"
                    style={{ color: link.color, border: `1px solid ${link.color}30`, background: `${link.color}08` }}
                  >
                    {link.label} &#x2197;
                  </a>
                ))}
                <span
                  className="text-[10px] font-mono px-2.5 py-1 rounded"
                  style={{ color: '#38D89A', border: '1px solid #38D89A30', background: '#38D89A08' }}
                >
                  &#x25CF; Data: Yahoo Finance
                </span>
              </div>
            </div>

            {/* Pills section header with regime badge */}
            <div className="flex items-center gap-2 mt-5 mb-0">
              <span className="text-vs-dim text-[10px] font-mono">
                Now (LTM) vs {hist.length}-year avg
              </span>
              {REGIME && (
                <span
                  className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full"
                  style={{
                    color: REGIME.color,
                    border: `1px solid ${REGIME.color}40`,
                    background: `${REGIME.color}12`,
                  }}
                >
                  {REGIME.label}
                </span>
              )}
            </div>

            {/* Pills — snap-scroll on mobile */}
            <div
              className="flex gap-1.5 mt-2 overflow-x-auto pb-1 snap-x snap-mandatory"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {PILL_METRICS.map(({ key, label, isYield: pillIsYield }) => {
                const metricInfo = ALL_METRICS.find((m) => m.key === key);
                return (
                  <div key={key} className="snap-start shrink-0">
                    <Pill
                      label={label}
                      current={now[key]}
                      avg={avgs[key]}
                      min={ranges[key]?.min}
                      max={ranges[key]?.max}
                      percentile={percentiles[key]}
                      isYield={!!pillIsYield}
                      onClick={() =>
                        metricInfo &&
                        setActivePill({
                          key,
                          label,
                          isYield: !!pillIsYield,
                          color: metricInfo.color,
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>

            {/* Group tabs */}
            <div className="flex gap-1.5 mt-6 flex-wrap">
              {Object.keys(GROUPS).map((g) => (
                <button
                  key={g}
                  onClick={() => switchGroup(g)}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold font-mono cursor-pointer border transition-all ${
                    group === g
                      ? 'bg-vs-blue text-vs-bg border-vs-blue'
                      : 'bg-vs-card text-vs-soft border-vs-border hover:border-vs-borderLight'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>

            {/* Metric toggles */}
            <div className="flex gap-1 mt-2 flex-wrap">
              {metrics.map((m) => (
                <button
                  key={m.key}
                  onClick={() => toggle(m.key)}
                  className="rounded px-2.5 py-1 text-[11px] font-medium font-mono cursor-pointer border transition-all"
                  style={{
                    background:  selected.includes(m.key) ? `${m.color}15` : 'transparent',
                    color:       selected.includes(m.key) ? m.color : 'rgb(var(--vs-dim))',
                    borderColor: selected.includes(m.key) ? m.color : 'rgb(var(--vs-border))',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Chart */}
            <ValuChart
              chartData={chartData}
              selectedMetrics={selected}
              averages={avgs}
              isYield={isYield}
              isDark={isDark}
            />
            <p className="text-vs-dim text-[10px] mt-1 font-mono">
              Dashed = {hist.length}-year avg &middot; "Now" = LTM at current price &middot; Tap a pill for detail
            </p>

            {/* Fundamentals Panel */}
            <FundamentalsPanel hist={hist} now={now} data={data} />

            {/* Fair Value Table */}
            <FairValueTable hist={hist} now={now} currentPrice={data.currentPrice} />

            {/* Full Data Table */}
            <DataTable years={years} averages={avgs} />

            {/* Investment Thesis */}
            <Thesis sym={sym} />

            <div className="mt-4 text-center text-vs-dim text-[10px] font-mono pb-8">
              Data: Yahoo Finance &middot; Validate against links above &middot; Not financial advice
            </div>
          </>
        )}
      </main>

      {/* ── Settings modal ────────────────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSettingsOpen(false)}
            aria-hidden="true"
          />
          <div className="relative bg-vs-card border border-vs-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm mx-0 sm:mx-4 p-6 pb-10 sm:pb-6 z-10">
            <div className="flex items-center justify-between mb-5">
              <span className="font-display text-[18px] font-bold text-vs-text">Settings</span>
              <button
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                className="text-vs-dim hover:text-vs-soft transition-colors cursor-pointer p-1"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="divide-y divide-vs-border">
              {[
                { label: 'App',         value: 'ValuScope' },
                { label: 'Version',     value: APP_VERSION },
                { label: 'Data source', value: 'Yahoo Finance' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center py-3">
                  <span className="text-vs-soft text-[13px]">{label}</span>
                  <span className="text-vs-text font-mono text-[13px] font-semibold">{value}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-3">
                <span className="text-vs-soft text-[13px]">Theme</span>
                <button
                  onClick={() => setIsDark(!isDark)}
                  className="text-vs-blue font-mono text-[13px] cursor-pointer hover:underline"
                >
                  {isDark ? 'Dark' : 'Light'}
                </button>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-vs-soft text-[13px]">Watchlist</span>
                <span className="text-vs-dim font-mono text-[13px]">
                  {watchlist.length} ticker{watchlist.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            <p className="text-vs-dim text-[10px] font-mono mt-6 text-center">
              Historical valuation multiples &middot; Not financial advice
            </p>
          </div>
        </div>
      )}

      {/* ── Pill detail bottom sheet ──────────────────────────────────────────── */}
      {activePill && (
        <PillDetail
          metric={activePill}
          chartData={chartData}
          averages={avgs}
          years={years}
          isDark={isDark}
          onClose={() => setActivePill(null)}
        />
      )}
    </div>
  );
}
