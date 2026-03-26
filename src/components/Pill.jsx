import { formatMultiple } from '../lib/metrics';

export default function Pill({ label, current, avg, isYield }) {
  if (current == null || avg == null || !isFinite(current) || !isFinite(avg) || avg === 0)
    return null;

  const better = isYield ? current > avg : current < avg;
  const pct = Math.abs(((current - avg) / avg) * 100).toFixed(0);

  return (
    <div className="bg-vs-card border border-vs-border rounded-lg px-3.5 py-3 min-w-[120px] flex-1">
      <div className="text-vs-dim text-[9px] font-mono uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-vs-text text-xl font-bold font-mono">
        {formatMultiple(current, isYield)}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span
          className="inline-block w-[5px] h-[5px] rounded-full"
          style={{ background: better ? '#38D89A' : '#F25C5C' }}
        />
        <span
          className="text-[10px] font-semibold font-mono"
          style={{ color: better ? '#38D89A' : '#F25C5C' }}
        >
          {pct}% {better ? 'below' : 'above'} avg
        </span>
      </div>
    </div>
  );
}
