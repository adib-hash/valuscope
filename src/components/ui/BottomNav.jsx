// Mobile-only bottom navigation. Fixed, blurred, safe-area aware; z-40 sits
// deliberately below the z-50 sheets and modals, which should cover it.
export default function BottomNav({ items, activeKey, onSelect }) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 sm:hidden border-t border-vs-border bg-vs-card/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex h-14">
        {items.map(({ key, label, icon: Icon }) => {
          const active = key === activeKey;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 h-full flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                active ? 'text-vs-blue' : 'text-vs-dim hover:text-vs-soft'
              }`}
            >
              <Icon size={21} strokeWidth={2} aria-hidden="true" />
              <span className="text-micro font-mono">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
