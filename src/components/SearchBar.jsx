import { useState, useRef } from 'react';
import { searchTickers } from '../lib/api';

export default function SearchBar({ onSelect, loading }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const timeout = useRef(null);

  const handleChange = (val) => {
    setQuery(val.toUpperCase());
    if (timeout.current) clearTimeout(timeout.current);
    if (!val.trim()) {
      setSuggestions([]);
      return;
    }
    timeout.current = setTimeout(async () => {
      try {
        const results = await searchTickers(val.trim());
        setSuggestions(results?.slice(0, 6) || []);
      } catch {
        setSuggestions([]);
      }
    }, 350);
  };

  const select = (sym) => {
    setQuery(sym);
    setSuggestions([]);
    onSelect(sym);
  };

  return (
    <div className="relative max-w-md">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) select(query.trim());
          }}
          placeholder="Enter ticker (AAPL, MSFT, ULTA...)"
          className="flex-1 bg-vs-card border border-vs-borderLight rounded-lg px-4 py-3 text-vs-text text-[15px] font-mono outline-none focus:border-vs-blue transition-colors"
        />
        <button
          onClick={() => query.trim() && select(query.trim())}
          disabled={loading}
          className={`rounded-lg px-5 py-3 text-sm font-bold font-mono transition-all ${
            loading
              ? 'bg-vs-dim text-vs-bg cursor-wait opacity-60'
              : 'bg-vs-blue text-vs-bg cursor-pointer hover:brightness-110'
          }`}
        >
          {loading ? '...' : 'Go'}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 bg-vs-card2 border border-vs-border rounded-lg mt-1 z-10 overflow-hidden shadow-2xl">
          {suggestions.map((s) => (
            <div
              key={s.symbol}
              onClick={() => select(s.symbol)}
              className="px-3.5 py-2.5 cursor-pointer border-b border-vs-border flex justify-between items-center hover:bg-vs-card transition-colors"
            >
              <div>
                <span className="text-vs-text font-semibold font-mono text-[13px]">
                  {s.symbol}
                </span>
                <span className="text-vs-soft text-xs ml-2.5">{s.name}</span>
              </div>
              <span className="text-vs-dim text-[10px] font-mono">{s.exchange}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
