import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
} from 'recharts';
import { getMetric } from '../lib/metrics';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-vs-card border border-vs-border rounded-lg px-4 py-3 shadow-2xl">
      <p className="text-vs-text font-semibold mb-1.5 text-body font-mono">{label}</p>
      {payload.map((e, i) => (
        <p key={i} className="text-label font-mono my-0.5" style={{ color: e.color }}>
          {e.name}:{' '}
          <strong>
            {typeof e.value === 'number'
              ? e.unit === '%'
                ? e.value.toFixed(1) + '%'
                : (e.value < 10 ? e.value.toFixed(2) : e.value.toFixed(1)) + 'x'
              : e.value}
          </strong>
        </p>
      ))}
    </div>
  );
}

export default function ValuChart({
  chartData,
  selectedMetrics,
  averages,
  isYield,
  isDark = true,
  compact = false,
}) {
  // These follow the theme through CSS variables, so no isDark branch is needed.
  const gridColor = 'rgb(var(--vs-border))';
  const tickColor = 'rgb(var(--vs-soft))';
  const dotFill   = 'rgb(var(--vs-bg))';

  return (
    <div className="bg-vs-card border border-vs-border rounded-xl pt-4 pr-2 pb-2 mt-3">
      <div className={compact ? 'h-[180px]' : 'h-[260px] sm:h-[350px] md:h-[420px]'}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="name"
              tick={{ fill: tickColor, fontSize: 11, fontFamily: '"DM Mono", monospace' }}
              axisLine={{ stroke: gridColor }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: tickColor, fontSize: 10, fontFamily: '"DM Mono", monospace' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                isYield
                  ? `${v.toFixed(1)}%`
                  : `${v < 10 ? v.toFixed(1) : Math.round(v)}x`
              }
            />
            <Tooltip content={<CustomTooltip />} />
            {selectedMetrics.map((k) => {
              const info = getMetric(k);
              if (!info) return null;
              return (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  name={info.label}
                  stroke={info.color}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: dotFill, stroke: info.color, strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: info.color }}
                  unit={isYield ? '%' : 'x'}
                  connectNulls
                />
              );
            })}
            {selectedMetrics.map((k) => {
              const info = getMetric(k);
              const avg = averages[k];
              if (!info || avg == null) return null;
              return (
                <ReferenceLine
                  key={`avg-${k}`}
                  y={avg}
                  stroke={info.color}
                  strokeDasharray="6 4"
                  strokeOpacity={0.25}
                  label={{
                    value: 'avg',
                    position: 'right',
                    fill: info.color,
                    fontSize: 9,
                    fontFamily: '"DM Mono", monospace',
                    opacity: 0.4,
                  }}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
