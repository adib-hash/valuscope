// The mono uppercase micro-label that heads data sections. Six slightly
// different spellings of this existed; this is the one.
export default function SectionLabel({ children, aside, className = '' }) {
  const label = (
    <p className={`text-vs-dim text-micro font-mono uppercase tracking-widest ${aside ? '' : className}`}>
      {children}
    </p>
  );
  if (!aside) return label;
  return (
    <div className={`flex items-baseline justify-between gap-2 ${className}`}>
      {label}
      <span className="text-vs-dim text-micro font-mono">{aside}</span>
    </div>
  );
}
