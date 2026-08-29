import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchBar from './components/SearchBar';
import SegmentedControl from './components/ui/SegmentedControl';
import Button from './components/ui/Button';
import ErrorBanner from './components/ui/ErrorBanner';
import RegimeBadge from './components/ui/RegimeBadge';
import BottomNav from './components/ui/BottomNav';
import { Sun, Moon, Settings, Link2, Check, Star, X, Globe, LineChart, Landmark } from 'lucide-react';

// Recharts is over a third of the bundle, and the Indices landing view never
// draws a chart — so everything that imports it loads on demand instead of
// riding in the entry chunk.
const ValuChart        = lazy(() => import('./components/ValuChart'));
// Tab-only panels load when their tab is first opened — the default Overview
// tab keeps its panels static so it never waterfalls.
const EarningsPanel    = lazy(() => import('./components/EarningsPanel'));
const CompsTable       = lazy(() => import('./components/CompsTable'));
const DataTable        = lazy(() => import('./components/DataTable'));
const PillDetail       = lazy(() => import('./components/PillDetail'));
const PriceHistoryPage = lazy(() => import('./components/PriceHistoryPage'));
import Pill from './components/Pill';
import FundamentalsPanel from './components/FundamentalsPanel';
import FairValueTable from './components/FairValueTable';
import Thesis from './components/Thesis';
import WatchlistDashboard from './components/WatchlistDashboard';
import TranscriptPage from './components/TranscriptPage';
import IndicesPage from './components/IndicesPage';
import DataSources, { DATA_SOURCES } from './components/DataSources';
import InstitutionsPage from './components/InstitutionsPage';
import { fetchFinancials, fetchHistory } from './lib/api';
import { mergeHistory } from './lib/history';
import {
  GROUPS,
  ALL_METRICS,
  computeAverages,
  computeRanges,
  computePercentiles,
  getSectorRecommendation,
  isRecommendedMetric,
  getRegime,
  tint,
} from './lib/metrics';
import { computeFairValue, median } from './lib/fundamentals';
import { saveSummary, pruneSummaries } from './lib/summaryCache';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  isWatched,
} from './lib/watchlist';

const QUICK_TICKERS = ['AAPL', 'MSFT', 'ULTA', 'COST', 'META', 'AMZN', 'GOOGL', 'NFLX'];
const APP_VERSION   = 'v0.18.4';

// The view the app opens on when the URL names neither a company nor a view.
const DEFAULT_VIEW = 'indices';

// Top-level nav. 'valuation' is the company dashboard and its search page; it
// is a named view rather than null so the nav can return to it without a ticker
// now that the app no longer lands there.
const NAV_ITEMS = [
  { label: 'Indices',   view: 'indices' },
  { label: 'Valuation', view: 'valuation' },
  { label: '13F',       view: 'institutions' },
  { label: 'Watchlist', view: 'watchlist' },
];

// Bottom bar (mobile). Watchlist earns the fourth slot over Settings: the gear
// is already in the header, while the watchlist was unreachable once a company
// was loaded without resetting the whole app.
const BOTTOM_NAV = [
  { key: 'indices',      label: 'Indices',   icon: Globe },
  { key: 'valuation',    label: 'Valuation', icon: LineChart },
  { key: 'institutions', label: '13F',       icon: Landmark },
  { key: 'watchlist',    label: 'Watchlist', icon: Star },
];

// Tiles shown in the summary row.
const PILL_METRICS = [
  { key: 'pe',       label: 'P/E' },
  { key: 'evEbitda', label: 'EV/EBITDA' },
  { key: 'pfcf',     label: 'P/FCF' },
  { key: 'evSales',  label: 'EV/Sales' },
];

// The company page's section tabs. Overview is the default and canonical URL
// carries no tab param.
const COMPANY_TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'earnings', label: 'Earnings' },
  { value: 'comps',    label: 'Comps' },
  { value: 'data',     label: 'Data' },
];

// The regime badge and the saved watchlist summary average a wider basket than
// the tiles show. Holding these six fixed means dropping a tile from the row
// does not quietly reprice every watchlist entry that was written under the old
// basket.
const REGIME_METRICS = ['pe', 'evEbitda', 'pfcf', 'evSales', 'fcfYield', 'pb'];

export default function App() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawView = searchParams.get('view');

  // A ticker in the URL means the valuation dashboard; anything else with no
  // explicit view falls through to the default landing view.
  const view = rawView ?? (searchParams.get('ticker') ? null : DEFAULT_VIEW);
  const isValuationView = view === null || view === 'valuation';

  // Section tab on the company page. Derived from the URL, never useState —
  // an invalid or absent param is simply Overview.
  const tabParam = searchParams.get('tab');
  const activeTab = COMPANY_TABS.some((t) => t.value === tabParam) ? tabParam : 'overview';

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [data,     setData]     = useState(null);
  const [group,    setGroup]    = useState('Price Multiples');
  const [selected, setSelected] = useState(['pe', 'evEbitda']);
  const [history,  setHistory]  = useState([]);
  const [period,   setPeriod]   = useState(3); // 3 | 5 | 10 | 0 (all)

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [descOpen,     setDescOpen]     = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activePill,   setActivePill]   = useState(null);
  // The 13F manager is held here rather than inside InstitutionsPage, because
  // the global search bar is what picks one now.
  const [filer,        setFiler]        = useState(null);
  const [copied,       setCopied]       = useState(false);
  const copyTimer = useRef(null);
  const activeSymbol = useRef('');

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
    // Keep the browser chrome color in step with the app theme.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDark ? '#080A10' : '#F4F6FA');
  }, [isDark]);

  // Load ticker from URL on mount
  useEffect(() => {
    const t = searchParams.get('ticker');
    if (t) loadCompany(t, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Watchlist ────────────────────────────────────────────────────────────────
  const [watchlist, setWatchlist] = useState(() => getWatchlist());

  // Tabs stay mounted once opened (hidden, not unmounted), so switching away
  // never drops fetched data or in-progress Thesis keystrokes. Reset per
  // company. Initialised with the deep-linked tab so a shared &tab= URL
  // renders it on first paint.
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(['overview', activeTab]));
  useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set([...prev, activeTab])));
  }, [activeTab]);

  const toggleWatchlist = (sym) => {
    if (isWatched(sym)) removeFromWatchlist(sym);
    else addToWatchlist(sym);
    const next = getWatchlist();
    setWatchlist(next);
    pruneSummaries(next);
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
    setPeriod(3);
    setDescOpen(false);
    setActivePill(null);
    setFiler(null);
    setSearchParams({});
  };

  const setTab = (key) => {
    if (!sym) return;
    const next = { ticker: sym };
    if (key !== 'overview') next.tab = key;
    setSearchParams(next, { replace: true });
  };

  // Company-scoped views carry the active tab through, so Earnings tab →
  // transcript → back lands on Earnings rather than resetting to Overview.
  const openView = (name) => {
    if (!sym) return;
    const next = { ticker: sym, view: name };
    if (activeTab !== 'overview') next.tab = activeTab;
    setSearchParams(next, { replace: false });
    window.scrollTo(0, 0);
  };

  // Top-level nav. openView() bails when there is no ticker, which is right for
  // the company-scoped views but wrong for these. Returning to Valuation keeps
  // the loaded company rather than dropping it.
  const openNav = (target) => {
    if (target === 'valuation') {
      setSearchParams(sym ? { ticker: sym } : { view: 'valuation' });
    } else {
      setSearchParams({ view: target });
    }
    window.scrollTo(0, 0);
  };

  // Choosing an investor in the global search jumps straight to their filings.
  const openFiler = (next) => {
    setFiler(next);
    setSearchParams({ view: 'institutions' });
    window.scrollTo(0, 0);
  };

  const closeView = () => {
    if (!sym) { setSearchParams({ view: 'valuation' }); return; }
    const next = { ticker: sym };
    if (activeTab !== 'overview') next.tab = activeTab;
    setSearchParams(next, { replace: false });
    window.scrollTo(0, 0);
  };

  // `keepView` is set when loading straight from the URL, so that a shared link
  // like ?ticker=AAPL&view=transcript lands on the view it names instead of
  // being reset to the dashboard.
  const loadCompany = async (ticker, keepView = false) => {
    const sym = ticker.toUpperCase().trim();
    if (!sym) return;
    setLoading(true);
    setError('');
    setData(null);
    setDescOpen(false);
    setActivePill(null);
    const currentView = keepView ? searchParams.get('view') : null;
    const currentTab  = keepView ? searchParams.get('tab')  : null;
    const nextParams = { ticker: sym };
    if (currentView) nextParams.view = currentView;
    if (currentTab && COMPANY_TABS.some((t) => t.value === currentTab)) nextParams.tab = currentTab;
    setSearchParams(nextParams, { replace: true });
    setVisitedTabs(new Set(['overview', currentTab || 'overview']));
    activeSymbol.current = sym;
    try {
      const result = await fetchFinancials(sym);
      setData(result);
      setHistory((prev) => [sym, ...prev.filter((h) => h !== sym)].slice(0, 8));

      // Deep history is fetched separately and merged in when it arrives, so a
      // slow SEC response never holds up the dashboard. Failures are silent by
      // design: the Yahoo-only view is still perfectly usable.
      fetchHistory(sym)
        .then((deep) => {
          if (activeSymbol.current !== sym || !deep?.years?.length) return;
          setData((prev) => (prev && prev.symbol === sym
            ? { ...prev, years: mergeHistory(prev.years, deep.years), historySource: deep.source }
            : prev));
        })
        .catch(() => {});

      // Auto-select recommended metrics for this sector
      const rec = getSectorRecommendation(result.sector);
      if (rec) {
        setGroup(rec.defaultGroup);
        setSelected(rec.defaultSelected);
      } else {
        setGroup('Price Multiples');
        setSelected(['pe', 'evEbitda']);
      }
    } catch (e) {
      setError(`Failed to load ${sym}: ${e.message}`);
    }
    setLoading(false);
  };

  // ── Derived data ─────────────────────────────────────────────────────────────
  const years   = data?.years || [];
  const now     = years[years.length - 1];
  const allHist = years.filter((y) => !y.fiscalYear?.startsWith('Now'));
  const hist    = period === 0 ? allHist : allHist.slice(-period);
  const metrics = GROUPS[group];
  const isYield = group === 'Yield Metrics' || group === 'Growth & Margins';
  const sym     = data?.symbol || '';
  const watched = sym ? isWatched(sym) : false;

  // 5Y and 10Y only appear once SEC EDGAR history has deepened the series --
  // offering a 10Y average over four years of data would be misleading.
  const periodOptions = useMemo(() => {
    const opts = [{ value: 3, label: '3Y' }];
    if (allHist.length > 5)  opts.push({ value: 5,  label: '5Y'  });
    if (allHist.length > 10) opts.push({ value: 10, label: '10Y' });
    opts.push({ value: 0, label: 'All' });
    return opts;
  }, [allHist.length]);

  const avgs   = useMemo(() => computeAverages(hist), [hist]);
  const ranges = useMemo(() => computeRanges(hist),   [hist]);

  // Averages and ranges follow the visible period — that is the point of the
  // toggle, and the heading says so. Percentiles do not: the tiles label them
  // "pctl of hist." and the regime badge must agree with the one the watchlist
  // saves, which is deliberately full-history. Scoping them to a 3-year default
  // would also leave only four rankable observations.
  const percentiles = useMemo(() => computePercentiles(allHist, now), [allHist, now]);

  const regimePercentile = useMemo(() => {
    const vals = REGIME_METRICS.map((k) => percentiles[k]).filter((v) => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [percentiles]);

  const REGIME = getRegime(regimePercentile);

  // The watchlist summary is always computed against the *full* history rather
  // than the visible period, so toggling to 3Y doesn't quietly change what the
  // watchlist reports for this ticker.
  useEffect(() => {
    if (!sym || !data || !now || !allHist.length) return;
    const fullPercentiles = computePercentiles(allHist, now);
    const vals = REGIME_METRICS
      .map((k) => fullPercentiles[k])
      .filter((v) => v != null);
    const percentile = vals.length
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : null;
    const regime = getRegime(percentile);

    const fairValue = computeFairValue(allHist, now, data.currentPrice);
    const blended = fairValue.length ? median(fairValue.map((r) => r.impliedPrice)) : null;
    const upsidePercent = blended != null && data.currentPrice
      ? ((blended - data.currentPrice) / data.currentPrice) * 100
      : null;

    saveSummary(sym, {
      name: data.companyName,
      sector: data.sector,
      regimeLabel: regime?.label ?? null,
      regimeColor: regime?.color ?? null,
      percentile,
      upsidePercent,
      histYears: allHist.length,
    });
  }, [sym, data, now, allHist]);

  const visibleYears = [...hist, now].filter(Boolean);
  const chartData = visibleYears.map((d) => ({
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

  const fmtMarketCap = (m) => {
    if (m == null) return null;
    if (m >= 1e6)  return `$${(m / 1e6).toFixed(2)}T`;
    if (m >= 1e3)  return `$${(m / 1e3).toFixed(1)}B`;
    return `$${m.toFixed(0)}M`;
  };

  const copyShare = () => {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
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
            aria-label="ValueScope home"
            className="flex items-baseline gap-2 bg-transparent border-0 p-0 cursor-pointer"
          >
            <span className="font-display text-[22px] font-extrabold text-vs-text">
              ValueScope
            </span>
          </button>

          {/* Header right: attribution + theme toggle + settings */}
          <div className="flex items-center gap-1">
            <DataSources />

            {/* Theme toggle */}
            <Button
              variant="ghost"
              onClick={() => setIsDark(!isDark)}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark
                ? <Sun size={16} strokeWidth={2} aria-hidden="true" />
                : <Moon size={16} strokeWidth={2} aria-hidden="true" />}
            </Button>

            {/* Settings */}
            <Button variant="ghost" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Settings size={16} strokeWidth={2} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────────────── */}
      <main className="max-w-[1100px] mx-auto px-4 pt-5 pb-[calc(4.5rem_+_env(safe-area-inset-bottom))] sm:pb-5">

        {/* Top-level nav */}
        <SegmentedControl
          className="mb-3 hidden sm:flex"
          options={NAV_ITEMS.map((item) => ({ value: item.view, label: item.label }))}
          value={NAV_ITEMS.find((i) => (i.view === 'valuation' ? isValuationView : view === i.view))?.view}
          onChange={openNav}
        />

        {/* Search */}
        <SearchBar
          onSelectTicker={loadCompany}
          onSelectFiler={openFiler}
          loading={loading}
        />

        {/* Recent searches */}
        {history.length > 0 && !loading && (
          <div className="flex gap-1.5 mt-2.5 flex-wrap items-center">
            <span className="text-vs-dim text-[10px] font-mono leading-6">Recent:</span>
            {history.map((h) => (
              <Button
                key={h}
                variant="chip"
                onClick={() => loadCompany(h)}
                className={`!py-0.5 ${h === sym ? '!bg-vs-blue/10 !text-vs-blue !border-vs-blue' : ''}`}
              >
                {h}
              </Button>
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
        {error && <ErrorBanner className="mt-5">{error}</ErrorBanner>}

        {/* ── Empty state ────────────────────────────────────────────────────── */}
        {!data && !loading && !error && isValuationView && (
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

            {/* Watchlist command centre */}
            <WatchlistDashboard symbols={watchlist} onSelectTicker={loadCompany} />

            {/* Quick picks */}
            <div className={watchlist.length > 0 ? 'mt-8' : 'mt-5'}>
              {watchlist.length > 0 && (
                <p className="text-vs-dim text-[10px] font-mono uppercase tracking-widest mb-2.5 text-left">
                  Quick Picks
                </p>
              )}
              <div className="flex gap-2 justify-center flex-wrap">
                {QUICK_TICKERS.map((t) => (
                  <Button key={t} variant="chip" className="!px-3.5" onClick={() => loadCompany(t)}>
                    {t}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── World Indices (no ticker required) ───────────────────────────── */}
        {view === 'indices' && <IndicesPage onBack={sym ? closeView : null} />}

        {/* ── Watchlist (no ticker required) ───────────────────────────────── */}
        {view === 'watchlist' && (
          <div className="mt-1">
            {watchlist.length === 0 && (
              <div className="mt-16 text-center">
                <div className="flex justify-center mb-2.5 opacity-40">
                  <Star size={40} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <p className="text-vs-soft text-prose">No companies watched yet</p>
                <p className="text-vs-dim text-label mt-1.5">
                  Open any company and tap the star to build your watchlist.
                </p>
              </div>
            )}
            <WatchlistDashboard symbols={watchlist} onSelectTicker={loadCompany} />
          </div>
        )}

        {/* ── 13F Holdings (no ticker required) ────────────────────────────── */}
        {view === 'institutions' && (
          <InstitutionsPage
            onBack={closeView}
            onSelectTicker={loadCompany}
            filer={filer}
            onPickFiler={setFiler}
          />
        )}

        {/* ── Price Chart Page ─────────────────────────────────────────────── */}
        {data && !loading && view === 'price' && (
          <Suspense fallback={<div className="mt-5 bg-vs-card border border-vs-border rounded-xl h-[320px] animate-pulse" />}>
            <PriceHistoryPage
              ticker={sym}
              companyName={data.companyName}
              onBack={closeView}
            />
          </Suspense>
        )}

        {/* ── Earnings Call Transcript ─────────────────────────────────────── */}
        {data && !loading && view === 'transcript' && (
          <TranscriptPage
            ticker={sym}
            companyName={data.companyName}
            onBack={closeView}
          />
        )}

        {/* ── Dashboard ──────────────────────────────────────────────────────── */}
        {data && now && !loading && isValuationView && (
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
                  <p className="text-vs-soft text-[13px] mt-0.5 flex flex-wrap items-center gap-x-1.5">
                    {data.currentPrice && <span>${data.currentPrice.toFixed(2)}</span>}
                    {data.change != null && (
                      <span style={{ color: data.change >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))' }}>
                        {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)}%
                      </span>
                    )}
                    {data.currentMktCap != null && (
                      <>
                        <span className="text-vs-dim">&middot;</span>
                        <span>Mkt Cap {fmtMarketCap(data.currentMktCap)}</span>
                      </>
                    )}
                    {now?.ev != null && (
                      <>
                        <span className="text-vs-dim">&middot;</span>
                        <span>EV {fmtMarketCap(now.ev)}</span>
                      </>
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

                {/* Share + Watchlist buttons */}
                <div className="flex items-center gap-0.5 mt-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    onClick={copyShare}
                    aria-label="Copy share link"
                    title={copied ? 'Copied!' : 'Copy link'}
                    className={copied ? '!text-vs-green' : ''}
                  >
                    {copied
                      ? <Check size={16} strokeWidth={2.5} aria-hidden="true" />
                      : <Link2 size={16} strokeWidth={2} aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => toggleWatchlist(sym)}
                    aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                    className={watched ? '!text-vs-amber' : ''}
                  >
                    <Star size={17} strokeWidth={2} fill={watched ? 'currentColor' : 'none'} aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {/* Research link */}
              <a
                href={`https://stockanalysis.com/stocks/${sym.toLowerCase()}/financials/ratios/`}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-2 text-vs-dim hover:text-vs-soft hover:underline transition-colors text-[11px] font-mono"
              >
                StockAnalysis &#x2197;
              </a>
              <button
                onClick={() => openView('price')}
                className="inline-flex items-center gap-1 ml-3 text-vs-blue hover:underline text-[11px] font-mono cursor-pointer"
              >
                Price chart →
              </button>
              <button
                onClick={() => openView('transcript')}
                className="inline-flex items-center gap-1 ml-3 text-vs-blue hover:underline text-[11px] font-mono cursor-pointer"
              >
                Earnings call →
              </button>
            </div>

            {/* Sector valuation insight */}
            {data.sector && getSectorRecommendation(data.sector) && (
              <p className="mt-5 mb-0 text-vs-soft text-[11px] leading-relaxed">
                <span className="font-mono font-semibold text-vs-blue">{data.sector}:</span>{' '}
                {getSectorRecommendation(data.sector).rationale}
              </p>
            )}

            {/* Pills — snap-scroll on mobile, with inline regime badge */}
            <div className={`flex items-center gap-2 mb-1.5 ${data.sector && getSectorRecommendation(data.sector) ? 'mt-3' : 'mt-5'}`}>
              <span className="text-vs-dim text-[10px] font-mono">
                LTM vs {hist.length}yr avg
              </span>
              {data.historySource === 'sec-edgar' && (
                <span
                  className="text-vs-dim text-[9px] font-mono hidden sm:inline"
                  title="Years beyond Yahoo Finance's ~4-year window come from SEC EDGAR filings"
                >
                  &middot; SEC EDGAR
                </span>
              )}
              {REGIME && <RegimeBadge label={REGIME.label} color={REGIME.color} />}
            </div>
            <div
              className="flex gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory"
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

            {/* Period toggle + Group tabs — single row */}
            <div className="flex items-start justify-between gap-2 mt-5 flex-wrap">
              <SegmentedControl
                size="md"
                options={Object.keys(GROUPS).map((g) => {
                  const rec = getSectorRecommendation(data.sector);
                  const isRecGroup = rec && rec.defaultGroup === g;
                  const hasRecMetrics = rec && GROUPS[g].some((m) => rec.metrics.includes(m.key));
                  return {
                    value: g,
                    title: isRecGroup ? 'Recommended for this sector'
                      : hasRecMetrics ? 'Contains recommended metrics' : undefined,
                    label: (
                      <span className="flex items-center gap-1.5">
                        {g}
                        {isRecGroup && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 bg-vs-blue" />
                        )}
                        {!isRecGroup && hasRecMetrics && (
                          <span className="inline-block w-1 h-1 rounded-full flex-shrink-0 bg-vs-blue opacity-50" />
                        )}
                      </span>
                    ),
                  };
                })}
                value={group}
                onChange={switchGroup}
              />
              <SegmentedControl
                options={periodOptions.map(({ value, label }) => ({ value, label }))}
                value={period}
                onChange={setPeriod}
              />
            </div>

            {/* Metric toggles */}
            <div className="flex gap-1 mt-2 flex-wrap">
              {metrics.map((m) => {
                const isRec = isRecommendedMetric(data.sector, m.key);
                return (
                  <button
                    key={m.key}
                    onClick={() => toggle(m.key)}
                    className="rounded-md px-2.5 py-1 text-[11px] font-medium font-mono cursor-pointer border transition-all flex items-center gap-1"
                    style={{
                      background:  selected.includes(m.key) ? tint(m.color, 0.08) : 'transparent',
                      color:       selected.includes(m.key) ? m.color : isRec ? 'rgb(var(--vs-soft))' : 'rgb(var(--vs-dim))',
                      borderColor: selected.includes(m.key) ? m.color : isRec ? 'rgb(var(--vs-blue) / 0.35)' : 'rgb(var(--vs-border))',
                    }}
                  >
                    {m.label}
                    {isRec && !selected.includes(m.key) && (
                      <span
                        className="inline-block w-1 h-1 rounded-full flex-shrink-0"
                        style={{ background: 'rgb(var(--vs-blue))' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Chart */}
            <Suspense fallback={<div className="bg-vs-card border border-vs-border rounded-xl mt-3 h-[292px] sm:h-[382px] md:h-[452px] animate-pulse" />}>
              <ValuChart
                chartData={chartData}
                selectedMetrics={selected}
                averages={avgs}
                isYield={isYield}
                isDark={isDark}
              />
            </Suspense>

            {/* Section tabs — everything below the chart lives in one of these */}
            <SegmentedControl
              size="md"
              className="mt-6"
              options={COMPANY_TABS}
              value={activeTab}
              onChange={setTab}
            />

            {/* Overview — static imports, always mounted */}
            <div hidden={activeTab !== 'overview'}>
              <FundamentalsPanel hist={hist} now={now} data={data} />
              <FairValueTable hist={hist} now={now} currentPrice={data.currentPrice} />
              <Thesis sym={sym} />
            </div>

            {/* Visited tabs stay mounted but hidden, so their data and any
                in-progress state survive switching away. */}
            {visitedTabs.has('earnings') && (
              <div hidden={activeTab !== 'earnings'}>
                <Suspense fallback={<div className="mt-4 rounded-xl border border-vs-border bg-vs-card h-40 animate-pulse" />}>
                  <EarningsPanel symbol={sym} onOpenTranscript={() => openView('transcript')} />
                </Suspense>
              </div>
            )}
            {visitedTabs.has('comps') && (
              <div hidden={activeTab !== 'comps'}>
                <Suspense fallback={<div className="mt-4 rounded-xl border border-vs-border bg-vs-card h-40 animate-pulse" />}>
                  <CompsTable symbol={sym} sector={data.sector} onSelectTicker={loadCompany} defaultExpanded />
                </Suspense>
              </div>
            )}
            {visitedTabs.has('data') && (
              <div hidden={activeTab !== 'data'}>
                <Suspense fallback={<div className="mt-4 rounded-xl border border-vs-border bg-vs-card h-40 animate-pulse" />}>
                  <DataTable years={visibleYears} averages={avgs} defaultOpen />
                </Suspense>
              </div>
            )}

            <div className="mt-4 text-center text-vs-dim text-[10px] font-mono pb-8">
              Not financial advice
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
          <div className="relative bg-vs-card border border-vs-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm mx-0 sm:mx-4 p-6 pb-[calc(2.5rem_+_env(safe-area-inset-bottom))] sm:pb-6 z-10">
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
                { label: 'App',     value: 'ValueScope' },
                { label: 'Version', value: APP_VERSION },
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
              <div className="py-3">
                <span className="text-vs-soft text-[13px] block mb-2">Data sources</span>
                <div className="space-y-1.5">
                  {DATA_SOURCES.map((s) => (
                    <div key={s.name} className="flex justify-between items-baseline gap-3">
                      <span className="text-vs-text font-mono text-[12px] flex-shrink-0">{s.name}</span>
                      <span className="text-vs-soft text-[11px] text-right leading-snug">{s.use}</span>
                    </div>
                  ))}
                </div>
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

      {/* ── Bottom navigation (mobile) ────────────────────────────────────────── */}
      <BottomNav
        items={BOTTOM_NAV}
        activeKey={view === 'watchlist' ? 'watchlist' : isValuationView ? 'valuation' : view}
        onSelect={openNav}
      />

      {/* ── Pill detail bottom sheet ──────────────────────────────────────────── */}
      {activePill && (
        <Suspense fallback={null}>
          <PillDetail
            metric={activePill}
            chartData={chartData}
            averages={avgs}
            years={years}
            isDark={isDark}
            onClose={() => setActivePill(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
