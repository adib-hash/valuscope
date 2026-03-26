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
      <p className="text-vs-text font-semibold mb-1.5 text-[13px] font-mono">{label}</p>
      {payload.map((e, i) => (
        <p key={i} className="text-xs font-mono my-0.5" style={{ color: e.color }}>
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

export default function ValuChart({ chartData, selectedMetrics, averages, isYield }) {
  return (
    <div className="bg-vs-card border border-vs-border rounded-xl pt-4 pr-2 pb-2 mt-3">
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E2738" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#94A0B8', fontSize: 11, fontFamily: '"DM Mono", monospace' }}
            axisLine={{ stroke: '#1E2738' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#94A0B8', fontSize: 10, fontFamily: '"DM Mono", monospace' }}
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
                dot={{ r: 4, fill: '#080A10', stroke: info.color, strokeWidth: 2 }}
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
  );
}
