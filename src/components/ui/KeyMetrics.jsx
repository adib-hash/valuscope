// The headline numbers a call reported, as a row of chips: label over value,
// with the comparison management gave underneath. Shared by the single-call
// summary and the day digest so a metric reads the same in both.
export default function KeyMetrics({ items, className = '' }) {
  const list = (Array.isArray(items) ? items : []).filter((m) => m?.metric && m?.value);
  if (!list.length) return null;
  return (
    <div className={`flex gap-2 flex-wrap ${className}`}>
      {list.map((m, i) => (
        <div
          key={`${m.metric}-${i}`}
          className="rounded-lg border border-vs-border bg-vs-card2 px-2.5 py-1.5 min-w-[92px] max-w-[220px]"
        >
          <div className="text-vs-dim text-micro font-mono uppercase tracking-wider leading-tight">
            {m.metric}
          </div>
          <div className="font-mono text-body font-semibold text-vs-text leading-tight mt-1">
            {m.value}
          </div>
          {m.comparison && (
            <div className="text-vs-soft text-micro font-mono mt-0.5 leading-tight">
              {m.comparison}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
