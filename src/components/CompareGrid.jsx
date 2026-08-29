import { formatMultiple, ordinal } from '../lib/metrics';

// Replaces the metric tiles while comparing. The tiles ask "this company
// against its own history, four metrics at once"; compare asks "these
// companies, each against its own history, one metric". One row per ticker.
export default function CompareGrid({
  symbols,        // ordered, primary first
  colors,         // { SYM: color }
  stats,          // { SYM: { current, avg, avgYears, percentile } | null }
  statuses,       // { SYM: 'loading' | 'ready' | 'error' } (primary always ready)
  errors,         // { SYM: message }
  isYield,
  metricLabel,
  onRetry,
  onRemove,
}) {
  const fmtPct = (n) => `${Math.abs(n).toFixed(0)}%`;

  return (
    <div className="rounded-xl border border-vs-border bg-vs-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-dense">
          <thead>
            <tr className="border-b border-vs-border">
              <th className="text-left px-3 py-2 text-vs-soft font-medium">{metricLabel}</th>
              <th className="text-right px-2 py-2 text-vs-soft font-medium whitespace-nowrap">Current</th>
              <th className="text-right px-2 py-2 text-vs-soft font-medium whitespace-nowrap">Avg</th>
              <th className="text-right px-2 py-2 text-vs-soft font-medium whitespace-nowrap">vs avg</th>
              <th className="text-right px-3 pl-2 py-2 text-vs-soft font-medium whitespace-nowrap" title="Percentile of full history">Pctl</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((s) => {
              const status = statuses[s] || 'ready';
              const st = stats[s];

              if (status === 'loading') {
                return (
                  <tr key={s} className="border-t border-vs-border">
                    <td className="px-4 py-2.5">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors[s] }} />
                      <span className="text-vs-text font-semibold">{s}</span>
                    </td>
                    <td colSpan={4} className="px-4 py-2.5">
                      <div className="h-3 bg-vs-border rounded-md animate-pulse w-2/3 ml-auto" />
                    </td>
                  </tr>
                );
              }

              if (status === 'error') {
                return (
                  <tr key={s} className="border-t border-vs-border">
                    <td className="px-4 py-2.5">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors[s] }} />
                      <span className="text-vs-text font-semibold">{s}</span>
                    </td>
                    <td colSpan={4} className="px-4 py-2.5 text-right">
                      <span className="text-vs-red">{errors[s] || 'failed to load'}</span>
                      <button onClick={() => onRetry(s)} className="ml-3 text-vs-blue cursor-pointer hover:underline">retry</button>
                      <button onClick={() => onRemove(s)} className="ml-2 text-vs-dim cursor-pointer hover:underline">remove</button>
                    </td>
                  </tr>
                );
              }

              const hasBoth = st && st.current != null && st.avg != null && st.avg !== 0;
              const diffPct = hasBoth ? ((st.current - st.avg) / Math.abs(st.avg)) * 100 : null;
              const better = hasBoth ? (isYield ? st.current > st.avg : st.current < st.avg) : null;

              return (
                <tr key={s} className="border-t border-vs-border">
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: colors[s] }} />
                    <span className="text-vs-text font-semibold">{s}</span>
                  </td>
                  <td className="text-right px-2 py-2.5 text-vs-text font-semibold whitespace-nowrap">
                    {formatMultiple(st?.current, isYield)}
                  </td>
                  <td className="text-right px-2 py-2.5 text-vs-soft whitespace-nowrap">
                    {formatMultiple(st?.avg, isYield)}
                    {st?.avgYears ? <span className="text-vs-dim text-micro"> ({st.avgYears}y)</span> : null}
                  </td>
                  <td
                    className="text-right px-2 py-2.5 font-semibold whitespace-nowrap"
                    style={hasBoth ? { color: better ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))' } : undefined}
                  >
                    {hasBoth ? `${diffPct >= 0 ? '+' : '\u2212'}${fmtPct(diffPct)}` : '—'}
                  </td>
                  <td className="text-right px-2 py-2.5 text-vs-soft whitespace-nowrap">
                    {st?.percentile != null ? ordinal(st.percentile) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-vs-border">
        <p className="text-vs-dim text-micro font-mono">
          Each row compares a company to its own history, never to the others. Years align by calendar.
        </p>
      </div>
    </div>
  );
}
