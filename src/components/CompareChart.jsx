import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';

// Multi-ticker chart for compare mode: one metric, one line per company.
// Deliberately no average reference lines — three dashed lines in three colors
// is the clutter the comparison grid exists to replace. The tooltip shows each
// company's own fiscal-year label so calendar alignment never hides an offset.
function CompareTooltip({ active, payload, label, isYield }) {
  if (!active || !payload?.length) return null;
  const fy = payload[0]?.payload?.fy || {};
  return (
    <div className="bg-vs-card border border-vs-border rounded-lg px-4 py-3 shadow-2xl">
      <p className="text-vs-text font-semibold mb-1.5 text-body font-mono">
        {label === 'Now' ? 'Now (LTM)' : label}
      </p>
      {payload.map((e) => (
        <p key={e.dataKey} className="text-label font-mono my-0.5" style={{ color: e.color }}>
          {e.dataKey}
          {fy[e.dataKey] && fy[e.dataKey] !== 'Now (LTM)' && label !== 'Now' ? ` · ${fy[e.dataKey]}` : ''}
          {': '}
          <strong>
            {typeof e.value === 'number'
              ? isYield
                ? e.value.toFixed(1) + '%'
                : (e.value < 10 ? e.value.toFixed(2) : e.value.toFixed(1)) + 'x'
              : '—'}
          </strong>
        </p>
      ))}
    </div>
  );
}

export default function CompareChart({ rows, symbols, colors, isYield }) {
  const gridColor = 'rgb(var(--vs-border))';
  const tickColor = 'rgb(var(--vs-soft))';
  const dotFill   = 'rgb(var(--vs-bg))';

  return (
    <div className="bg-vs-card border border-vs-border rounded-xl pt-4 pr-2 pb-2 mt-3">
      <div className="h-[260px] sm:h-[350px] md:h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="bucket"
              tick={{ fill: tickColor, fontSize: 11, fontFamily: '"DM Mono", monospace' }}
              axisLine={{ stroke: gridColor }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: tickColor, fontSize: 10, fontFamily: '"DM Mono", monospace' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                isYield ? `${v.toFixed(1)}%` : `${v < 10 ? v.toFixed(1) : Math.round(v)}x`
              }
            />
            <Tooltip content={<CompareTooltip isYield={isYield} />} />
            {symbols.map((s) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                name={s}
                stroke={colors[s]}
                strokeWidth={2.5}
                dot={{ r: 4, fill: dotFill, stroke: colors[s], strokeWidth: 2 }}
                activeDot={{ r: 6, fill: colors[s] }}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
