import SectionLabel from './SectionLabel';

// The one card shell. `title` renders the serif heading used by interpretive
// cards (fair value, comps); `label` the mono micro-label used by data cards.
// `footer` is the standard footnote row.
export default function Card({ title, subtitle, label, aside, footer, className = '', children }) {
  return (
    <div className={`rounded-xl border border-vs-border bg-vs-card overflow-hidden ${className}`}>
      {title && (
        <div className="px-4 pt-3.5 pb-1">
          <p className="font-display text-prose font-bold text-vs-text leading-tight">{title}</p>
          {subtitle && <p className="text-vs-dim text-micro font-mono mt-0.5">{subtitle}</p>}
        </div>
      )}
      {label && (
        <div className="px-4 pt-3.5">
          <SectionLabel aside={aside}>{label}</SectionLabel>
        </div>
      )}
      {children}
      {footer && (
        <div className="px-4 py-2.5 border-t border-vs-border">
          <p className="text-vs-dim text-micro font-mono leading-relaxed">{footer}</p>
        </div>
      )}
    </div>
  );
}
