import { useMemo } from 'react';
import { computeFairValue, median } from '../lib/fundamentals';
import { formatMultiple } from '../lib/metrics';

export default function FairValueTable({ hist, now, currentPrice }) {
  const rows = useMemo(
    () => computeFairValue(hist, now, currentPrice),
    [hist, now, currentPrice]
  );

  if (!rows.length || !currentPrice) return null;

  const blendedPrice = median(rows.map((r) => r.impliedPrice));
  const blendedUpside = blendedPrice != null
    ? ((blendedPrice - currentPrice) / currentPrice) * 100 : null;

  const histYears = hist.length;

  return (
    <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
      <div className="px-4 pt-3.5 pb-1">
        <p className="font-display text-[14px] font-bold text-vs-text leading-tight">
          If we return to the historical average&hellip;
        </p>
        <p className="text-vs-dim text-[10px] font-mono mt-0.5">
          Implied price if each multiple reverted to its {histYears}-year average
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="border-y border-vs-border">
              <th className="text-left px-4 py-2 text-vs-dim font-medium">Metric</th>
              <th className="text-right px-3 py-2 text-vs-dim font-medium">Hist. Avg</th>
              <th className="text-right px-3 py-2 text-vs-dim font-medium">Current</th>
              <th className="text-right px-4 py-2 text-vs-amber font-semibold">Implied $</th>
              <th className="text-right px-4 py-2 text-vs-dim font-medium">vs. Today</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-vs-border/20">
                <td className="px-4 py-2 text-vs-soft">{row.label}</td>
                <td className="px-3 py-2 text-right text-vs-dim">
                  {formatMultiple(row.avgMultiple)}
                </td>
                <td className="px-3 py-2 text-right text-vs-soft">
                  {formatMultiple(row.currentMultiple)}
                </td>
                <td className="px-4 py-2 text-right font-semibold text-vs-text">
                  ${row.impliedPrice.toFixed(2)}
                </td>
                <td
                  className="px-4 py-2 text-right font-semibold"
                  style={{ color: row.upsidePct >= 0 ? '#38D89A' : '#F25C5C' }}
                >
                  {row.upsidePct >= 0 ? '+' : ''}{row.upsidePct.toFixed(1)}%
                </td>
              </tr>
            ))}

            {/* Blended row */}
            {blendedPrice != null && (
              <tr className="bg-vs-card2">
                <td className="px-4 py-2.5 text-vs-text font-semibold" colSpan={3}>
                  Blended (median)
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-[13px] text-vs-text">
                  ${blendedPrice.toFixed(2)}
                </td>
                <td
                  className="px-4 py-2.5 text-right font-bold text-[13px]"
                  style={{ color: blendedUpside >= 0 ? '#38D89A' : '#F25C5C' }}
                >
                  {blendedUpside >= 0 ? '+' : ''}{blendedUpside.toFixed(1)}%
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2.5 text-vs-dim text-[9px] font-mono">
        Assumes multiples revert to {histYears}-year average. Not financial advice.
      </p>
    </div>
  );
}
