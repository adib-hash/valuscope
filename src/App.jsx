import { useState, useMemo } from 'react';
import SearchBar from './components/SearchBar';
import Pill from './components/Pill';
import ValuChart from './components/ValuChart';
import DataTable from './components/DataTable';
import { fetchFinancials } from './lib/api';
import { GROUPS, ALL_METRICS, computeAverages } from './lib/metrics';

const QUICK_TICKERS = ['AAPL', 'MSFT', 'ULTA', 'COST', 'META', 'AMZN', 'GOOGL', 'NFLX'];

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [group, setGroup] = useState('Price Multiples');
  const [selected, setSelected] = useState(['pe', 'evEbitda']);
  const [history, setHistory] = useState([]);

  const loadCompany = async (ticker) => {
    const sym = ticker.toUpperCase().trim();
    if (!sym) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const result = await fetchFinancials(sym);
      setData(result);
      setHistory((prev) => [sym, ...prev.filter((h) => h !== sym)].slice(0, 8));
    } catch (e) {
      setError(`Failed to load ${sym}: ${e.message}`);
    }
    setLoading(false);
  };

  const years = data?.years || [];
  const now = years[years.length - 1];
  const hist = years.filter((y) => !y.fiscalYear?.startsWith('Now'));
  const metrics = GROUPS[group];
  const isYield = group === 'Yield Metrics';

  const avgs = useMemo(() => computeAverages(hist), [hist]);

  const chartData = years.map((d) => ({
    name: d.fiscalYear,
    ...Object.fromEntries(
      ALL_METRICS.map((m) => [m.key, d[m.key] > 0 ? d[m.key] : null])
    ),
  }));

  const toggle = (k) =>
    setSelected((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const switchGroup = (g) => {
    setGroup(g);
    setSelected(GROUPS[g].map((m) => m.key).slice(0, 2));
  };

  const sym = data?.symbol || '';

  return (
    <div className="min-h-screen bg-vs-bg text-vs-text font-sans">
      {/* Header */}
      <header className="border-b border-vs-border px-5 py-3.5">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[22px] font-extrabold">ValuScope</span>
            <span className="text-vs-dim text-[11px] font-mono">
              historical valuation multiples
            </span>
          </div>
          <span className="text-vs-dim text-[10px] font-mono">
            Data: Financial Modeling Prep API
          </span>
        </div>
      </header>

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

        {/* Loading */}
        {loading && (
          <div className="mt-12 text-center">
            <div className="inline-flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2.5 h-2.5 rounded-full bg-vs-blue"
                  style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
            <style>{`@keyframes pulse { 0%,80%,100% { opacity:0.2; transform:scale(0.8); } 40% { opacity:1; transform:scale(1.2); } }`}</style>
            <div className="text-vs-soft text-sm mt-3 font-mono">Loading financials...</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-5 text-vs-red font-mono text-[13px] px-4 py-3 bg-vs-red/5 rounded-lg border border-vs-red/20">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && !error && (
          <div className="mt-16 text-center">
            <div className="text-[44px] mb-2.5 opacity-40">&#x1F4CA;</div>
            <div className="text-vs-soft text-[15px]">
              Search any US public company by ticker
            </div>
            <div className="text-vs-dim text-xs mt-1.5">
              5 years of historical valuation multiples from SEC filings
            </div>
            <div className="flex gap-2 justify-center mt-5 flex-wrap">
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
        )}

        {/* ─── DASHBOARD ─── */}
        {data && now && !loading && (
          <>
            {/* Company header */}
            <div className="mt-5">
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <span className="text-vs-dim text-[11px] font-mono tracking-widest">
                  {data.exchange}: {sym}
                </span>
                {data.sector && (
                  <span className="text-vs-dim text-[11px]">&middot; {data.sector}</span>
                )}
              </div>
              <h1 className="font-display text-[28px] font-extrabold mt-1 leading-tight">
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

              {/* Validation links */}
              <div className="flex gap-2 mt-2.5 flex-wrap">
                {[
                  {
                    href: `https://stockanalysis.com/stocks/${sym.toLowerCase()}/financials/ratios/`,
                    label: 'StockAnalysis Ratios',
                    color: '#4E94F8',
                  },
                  {
                    href: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${sym}&type=10-K&dateb=&owner=include&count=5&action=getcompany`,
                    label: 'SEC EDGAR 10-Ks',
                    color: '#E8AA30',
                  },
                  {
                    href: `https://finance.yahoo.com/quote/${sym}/financials/`,
                    label: 'Yahoo Finance',
                    color: '#9B7AF5',
                  },
                ].map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-mono no-underline px-2.5 py-1 rounded"
                    style={{
                      color: link.color,
                      border: `1px solid ${link.color}30`,
                      background: `${link.color}08`,
                    }}
                  >
                    {link.label} &#x2197;
                  </a>
                ))}
                <span
                  className="text-[10px] font-mono px-2.5 py-1 rounded"
                  style={{
                    color: '#38D89A',
                    border: '1px solid #38D89A30',
                    background: '#38D89A08',
                  }}
                >
                  &#x25CF; Data: FMP API
                </span>
              </div>
            </div>

            {/* Pills */}
            <div className="flex gap-1.5 mt-5 overflow-x-auto pb-1">
              <Pill label="P/E" current={now.pe} avg={avgs.pe} />
              <Pill label="EV/EBITDA" current={now.evEbitda} avg={avgs.evEbitda} />
              <Pill label="P/FCF" current={now.pfcf} avg={avgs.pfcf} />
              <Pill label="EV/Sales" current={now.evSales} avg={avgs.evSales} />
              <Pill label="FCF Yld" current={now.fcfYield} avg={avgs.fcfYield} isYield />
              <Pill label="P/B" current={now.pb} avg={avgs.pb} />
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
                    background: selected.includes(m.key) ? `${m.color}15` : 'transparent',
                    color: selected.includes(m.key) ? m.color : '#5A6A82',
                    borderColor: selected.includes(m.key) ? m.color : '#1E2738',
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
            />
            <p className="text-vs-dim text-[10px] mt-1 font-mono">
              Dashed = {hist.length}-year avg &middot; "Now" = LTM at current price
            </p>

            {/* Table */}
            <DataTable years={years} averages={avgs} />

            <div className="mt-4 text-center text-vs-dim text-[10px] font-mono pb-8">
              Data: Financial Modeling Prep API &middot; Validate against links above &middot;
              Not financial advice
            </div>
          </>
        )}
      </main>
    </div>
  );
}
