import { useMemo } from 'react';
import { computeFairValue, median } from '../lib/fundamentals';
import { formatMultiple } from '../lib/metrics';
import Card from './ui/Card';

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
    <Card
      className="mt-4"
      title={<>If we return to the historical average&hellip;</>}
      subtitle={`Implied price if each multiple reverted to its ${histYears}-year average`}
    >

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-dense">
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
                  style={{ color: row.upsidePct >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))' }}
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
                <td className="px-4 py-2.5 text-right font-bold text-body text-vs-text">
                  ${blendedPrice.toFixed(2)}
                </td>
                <td
                  className="px-4 py-2.5 text-right font-bold text-body"
                  style={{ color: blendedUpside >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))' }}
                >
                  {blendedUpside >= 0 ? '+' : ''}{blendedUpside.toFixed(1)}%
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="px-4 py-2.5 text-vs-dim text-micro font-mono">
        Assumes multiples revert to {histYears}-year average. Not financial advice.
      </p>
    </Card>
  );
}
