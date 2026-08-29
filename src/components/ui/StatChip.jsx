// A tiny label-over-value stat. Null value → nothing, so callers can map over
// optional data without guarding every chip.
export default function StatChip({ label, value, color, className = '' }) {
  if (value == null || value === '') return null;
  return (
    <div className={className}>
      <span className="text-vs-dim text-micro font-mono uppercase tracking-wider block">
        {label}
      </span>
      <span
        className="font-mono text-body font-semibold text-vs-text"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
