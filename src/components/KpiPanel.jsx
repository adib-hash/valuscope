import { useEffect, useMemo, useState } from 'react';
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart,
} from 'recharts';
import { Sparkles } from 'lucide-react';
import { fetchKpis, buildKpis } from '../lib/api';
import SectionLabel from './ui/SectionLabel';

// Operating KPIs mined from the company's own filings — the numbers that
// define a business (stores, members, comp sales) but live nowhere else.
// Series build incrementally: each press of the button reads a few more
// filings; every point carries the sentence it came from.

function KpiTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-vs-card border border-vs-border rounded-lg px-3.5 py-2.5 shadow-2xl max-w-[320px]">
      <p className="text-vs-text font-semibold text-label font-mono">
        {p.period} · {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}{unit === '%' ? '%' : ''}
      </p>
      <p className="text-vs-soft text-micro mt-1 leading-snug">&ldquo;{p.sourceQuote}&rdquo;</p>
      <p className="text-vs-dim text-micro font-mono mt-1">{p.form}</p>
    </div>
  );
}

export default function KpiPanel({ ticker, onOpenFiling }) {
  const [data, setData] = useState(null);
  const [active, setActive] = useState(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setData(null);
    setActive(null);
    setError('');
    fetchKpis(ticker)
      .then((d) => { if (!cancelled) { setData(d); setActive(d.metrics?.[0]?.name ?? null); } })
      .catch(() => { if (!cancelled) setData({ available: false }); });
    return () => { cancelled = true; };
  }, [ticker]);

  const build = async () => {
    setBuilding(true);
    setError('');
    try {
      const d = await buildKpis(ticker);
      setData(d);
      if (!active && d.metrics?.length) setActive(d.metrics[0].name);
    } catch (e) {
      setError(e.message || 'Extraction failed.');
    } finally {
      setBuilding(false);
    }
  };

  const metric = useMemo(
    () => data?.metrics?.find((m) => m.name === active) || null,
    [data, active],
  );

  if (!data || data.available === false) return null;

  const empty = !data.metrics?.length;

  return (
    <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
      <div className="px-4 pt-3.5">
        <SectionLabel aside={data.coveredFilings ? `${data.coveredFilings} filing${data.coveredFilings !== 1 ? 's' : ''} read` : null}>
          Operating KPIs
        </SectionLabel>
      </div>

      <div className="px-4 py-3">
        {empty && (
          <p className="text-vs-soft text-body max-w-[64ch]">
            Store counts, members, comparable sales — the operating numbers that live only in
            filings. Extract them into time series, a few filings at a time.
          </p>
        )}

        {!empty && (
          <>
            <div className="flex gap-1 flex-wrap">
              {data.metrics.map((m) => (
                <button
                  key={m.name}
                  onClick={() => setActive(m.name)}
                  className={`rounded-md px-2.5 py-1 text-micro font-mono border transition-all cursor-pointer ${
                    m.name === active
                      ? 'bg-vs-blue/15 text-vs-blue border-vs-blue/50'
                      : 'bg-transparent text-vs-dim border-vs-border hover:border-vs-borderLight hover:text-vs-soft'
                  }`}
                >
                  {m.name} <span className="opacity-60">({m.points.length})</span>
                </button>
              ))}
            </div>

            {metric && metric.points.length > 1 && (
              <div className="h-[200px] mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={metric.points} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--vs-border))" />
                    <XAxis dataKey="period" tick={{ fill: 'rgb(var(--vs-soft))', fontSize: 10, fontFamily: '"DM Mono", monospace' }} axisLine={{ stroke: 'rgb(var(--vs-border))' }} tickLine={false} />
                    <YAxis tick={{ fill: 'rgb(var(--vs-soft))', fontSize: 10, fontFamily: '"DM Mono", monospace' }} axisLine={false} tickLine={false} width={70}
                      tickFormatter={(v) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v.toLocaleString())} />
                    <Tooltip content={<KpiTooltip unit={metric.unit} />} />
                    <Line type="monotone" dataKey="value" stroke="rgb(var(--vs-cyan))" strokeWidth={2.5}
                      dot={{ r: 4, fill: 'rgb(var(--vs-bg))', stroke: 'rgb(var(--vs-cyan))', strokeWidth: 2 }} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {metric && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full font-mono text-dense">
                  <thead>
                    <tr className="border-b border-vs-border">
                      <th className="text-left px-2 py-1.5 text-vs-soft font-medium">Period</th>
                      <th className="text-right px-2 py-1.5 text-vs-soft font-medium">{metric.unit}</th>
                      <th className="text-left px-2 py-1.5 text-vs-soft font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...metric.points].reverse().map((p) => (
                      <tr key={p.accession + p.period} className="border-t border-vs-border/40">
                        <td className="px-2 py-1.5 text-vs-text whitespace-nowrap">{p.period}</td>
                        <td className="px-2 py-1.5 text-right text-vs-text font-semibold whitespace-nowrap">
                          {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => onOpenFiling?.(p.accession)}
                            title={p.sourceQuote}
                            className="text-vs-blue hover:underline cursor-pointer"
                          >
                            {p.form}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {error && <p className="text-vs-red text-label font-mono mt-2">{error}</p>}

        {data.remaining > 0 && (
          <button
            onClick={build}
            disabled={building}
            className={`mt-3 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-label font-mono font-semibold border transition-colors ${
              building
                ? 'border-vs-border text-vs-dim cursor-wait'
                : 'border-vs-violet/40 bg-vs-violet/10 text-vs-violet hover:bg-vs-violet/20 cursor-pointer'
            }`}
          >
            <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
            {building ? 'Reading filings…' : `Extract from ${Math.min(3, data.remaining)} more filing${Math.min(3, data.remaining) !== 1 ? 's' : ''}`}
          </button>
        )}
        {data.remaining > 0 && !building && (
          <span className="ml-2 text-vs-dim text-micro font-mono">{data.remaining} unread</span>
        )}

        <p className="text-vs-dim text-micro font-mono mt-3">
          AI-extracted from 10-K/10-Q filings · hover a point or source for the exact sentence · not financial advice
          {data.ephemeral ? ' · no storage configured — extractions last only this session' : ''}
        </p>
      </div>
    </div>
  );
}
