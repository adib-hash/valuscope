// The one segmented control. Before this existed there were five different
// "active blue" treatments across nav, period, sorts, ranges and pickers —
// this is the single source of that styling.
const SIZES = {
  sm: 'px-2.5 py-1.5 text-label',
  md: 'px-3.5 py-1.5 text-label',
};

export default function SegmentedControl({ options, value, onChange, size = 'sm', className = '' }) {
  return (
    <div className={`flex gap-1 flex-wrap ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => !opt.disabled && onChange(opt.value)}
            disabled={opt.disabled}
            title={opt.title}
            className={`rounded-md font-mono font-semibold border transition-all ${SIZES[size]} ${
              opt.disabled
                ? 'bg-transparent text-vs-dim border-vs-border opacity-50 cursor-not-allowed'
                : active
                  ? 'bg-vs-blue/15 text-vs-blue border-vs-blue/50 cursor-pointer'
                  : 'bg-transparent text-vs-dim border-vs-border hover:border-vs-borderLight hover:text-vs-soft cursor-pointer'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
