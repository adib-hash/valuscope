import { useState } from 'react';
import { formatMultiple } from '../lib/metrics';

export default function Pill({ label, current, avg, min, max, percentile, isYield, onClick }) {
  const [hoverAvg, setHoverAvg] = useState(false);
  if (current == null || avg == null || !isFinite(current) || !isFinite(avg) || avg === 0)
    return null;

  const better = isYield ? current > avg : current < avg;
  const accentColor = better ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))';
  const pct = Math.abs(((current - avg) / avg) * 100).toFixed(0);

  // Range bar: position of avg and current between historical min/max
  const showRange = min != null && max != null && (max - min) > 0.001;
  const avgPos     = showRange ? Math.max(0, Math.min(1, (avg     - min) / (max - min))) : null;
  const currentPos = showRange ? Math.max(0, Math.min(1, (current - min) / (max - min))) : null;

  return (
    <div
      className="bg-vs-card border border-vs-border rounded-lg px-3.5 py-3 min-w-[130px] flex-1 cursor-pointer hover:border-vs-borderLight transition-all active:scale-[0.98] select-none"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      <div className="text-vs-dim text-[9px] font-mono uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-vs-text text-xl font-bold font-mono">
        {formatMultiple(current, isYield)}
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span
          className="inline-block w-[5px] h-[5px] rounded-full flex-shrink-0"
          style={{ background: accentColor }}
        />
        <span className="text-[10px] font-semibold font-mono" style={{ color: accentColor }}>
          {pct}% {better ? 'below' : 'above'} avg
        </span>
      </div>

      {/* Min/max range bar. The amber tick marks the historical average, which
          on its own only shows position — hovering the bar names the number.
          The padding widens the hover target without moving anything. */}
      {showRange && (
        <div
          className="mt-1 pt-1.5 pb-1.5"
          onMouseEnter={() => setHoverAvg(true)}
          onMouseLeave={() => setHoverAvg(false)}
        >
          <div className="relative h-[3px] bg-vs-border rounded-full">
            {/* Avg tick */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-[2px] h-[6px] bg-vs-amber rounded-full"
              style={{ left: `${avgPos * 100}%` }}
            />
            {/* Current position dot */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-[8px] h-[8px] rounded-full border-2 border-vs-card"
              style={{
                left: `calc(${currentPos * 100}% - 4px)`,
                background: accentColor,
              }}
            />
          </div>
        </div>
      )}

      {/* Fixed height, so revealing the average never nudges the card. The row
          these sit in scrolls horizontally, which would clip a floating
          tooltip, so the value is swapped in here instead. */}
      {(showRange || percentile != null) && (
        <div className="h-[13px] leading-[13px] text-[9px] font-mono">
          {hoverAvg && showRange ? (
            <span className="text-vs-amber font-semibold">
              Avg {formatMultiple(avg, isYield)}
            </span>
          ) : percentile != null ? (
            <span className="text-vs-dim">{percentile}th pctl of hist.</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
