// Action buttons. `primary` is the filled call-to-action, `ghost` the quiet
// icon button, `chip` the bordered pick-me tile (recents, quick picks).
const VARIANTS = {
  primary: 'bg-vs-blue text-vs-bg rounded-md px-3.5 py-1.5 text-label font-mono font-bold cursor-pointer hover:brightness-110 transition-all',
  ghost:   'p-2 rounded-md text-vs-dim hover:text-vs-soft hover:bg-vs-card transition-colors cursor-pointer',
  chip:    'bg-vs-card text-vs-soft border border-vs-border rounded-md px-2.5 py-1.5 text-label font-mono cursor-pointer hover:border-vs-borderLight hover:text-vs-text transition-colors',
};

export default function Button({ variant = 'primary', className = '', children, ...rest }) {
  return (
    <button className={`${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
