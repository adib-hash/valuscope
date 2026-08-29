import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { searchTickers } from '../lib/api';

// The compare affordance: ticker chips that double as the chart legend, plus a
// lightweight inline typeahead for adding one. Deliberately not the global
// SearchBar — that box changes the subject of the whole page; this one adds a
// comparator, searches companies only, and goes away when you're done.
function TickerInput({ onPick, onClose, exclude }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const timer = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleChange = (v) => {
    setQuery(v.toUpperCase());
    clearTimeout(timer.current);
    if (!v.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await searchTickers(v.trim());
        setResults((r || []).filter((x) => !exclude.includes(x.symbol)).slice(0, 5));
      } catch {
        setResults([]);
      }
    }, 300);
  };

  const pick = (t) => {
    const symb = t.toUpperCase().trim();
    if (/^[A-Z.\-]{1,10}$/.test(symb) && !exclude.includes(symb)) onPick(symb);
    onClose();
  };

  return (
    <div className="relative" ref={box}>
      <input
        autoFocus
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) pick(query.trim());
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Ticker"
        aria-label="Add a ticker to compare"
        className="w-28 bg-vs-card border border-vs-blue rounded-md px-2.5 py-1 text-[16px] sm:text-label font-mono text-vs-text outline-none"
      />
      {results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-vs-card2 border border-vs-border rounded-lg overflow-hidden shadow-2xl z-30">
          {results.map((r) => (
            <div
              key={r.symbol}
              onClick={() => pick(r.symbol)}
              className="px-3 py-2 cursor-pointer hover:bg-vs-card border-b border-vs-border last:border-0"
            >
              <span className="text-vs-text font-semibold font-mono text-label">{r.symbol}</span>
              <span className="text-vs-soft text-label ml-2">{r.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CompareControl({
  primary,
  compareList,
  colors,
  onAdd,
  onRemove,
  onExit,
  className = '',
}) {
  const [adding, setAdding] = useState(false);
  const comparing = compareList.length > 0;

  if (!comparing && !adding) {
    return (
      <div className={className}>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-label font-mono font-semibold border border-vs-border text-vs-dim hover:border-vs-borderLight hover:text-vs-soft cursor-pointer transition-all"
        >
          <Plus size={12} strokeWidth={2.5} aria-hidden="true" /> Compare
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {comparing && (
        <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-label font-mono font-semibold border border-vs-border text-vs-text">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: colors[primary] }} />
          {primary}
        </span>
      )}
      {compareList.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-label font-mono font-semibold border border-vs-border text-vs-text"
        >
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: colors[t] }} />
          {t}
          <button onClick={() => onRemove(t)} aria-label={`Remove ${t}`} className="text-vs-dim hover:text-vs-red cursor-pointer -mr-0.5">
            <X size={11} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </span>
      ))}
      {adding ? (
        <TickerInput
          onPick={onAdd}
          onClose={() => setAdding(false)}
          exclude={[primary, ...compareList]}
        />
      ) : (
        compareList.length < 2 && (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-label font-mono border border-vs-border text-vs-dim hover:border-vs-borderLight hover:text-vs-soft cursor-pointer transition-all"
          >
            <Plus size={12} strokeWidth={2.5} aria-hidden="true" /> Add
          </button>
        )
      )}
      {comparing && (
        <button onClick={onExit} className="text-vs-dim hover:text-vs-soft text-label font-mono cursor-pointer ml-1 hover:underline">
          Exit compare
        </button>
      )}
    </div>
  );
}
