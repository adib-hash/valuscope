import { tint } from '../../lib/metrics';

// The valuation regime chip. Rendered identically on the dashboard and the
// watchlist — one component, so the two can never drift apart.
export default function RegimeBadge({ label, color, className = '' }) {
  if (!label) return null;
  return (
    <span
      className={`text-micro font-mono font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${className}`}
      style={{
        color,
        border: `1px solid ${tint(color, 0.25)}`,
        background: tint(color, 0.07),
      }}
    >
      {label}
    </span>
  );
}
