import { useState, useRef, useEffect } from 'react';
import { searchTickers, searchInstitutions } from '../lib/api';

// One search box for the whole app. A 13F filer and a listed company are
// different kinds of thing — one resolves to a CIK, the other to a ticker — but
// splitting them into two boxes made you decide which kind of search you were
// doing before you had typed anything. Both are queried in parallel and the
// results are grouped, so "Berkshire" and "BRK-B" both land somewhere sensible.
//
// EDGAR full-text search needs at least two characters; ticker search is happy
// with one, so a single-character query simply returns companies only.
const MIN_INVESTOR_CHARS = 2;
const MAX_COMPANIES = 5;
const MAX_INVESTORS = 4;

export default function SearchBar({ onSelectTicker, onSelectFiler, loading }) {
  const [query, setQuery] = useState('');
  const [companies, setCompanies] = useState([]);
  const [investors, setInvestors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const timer = useRef(null);
  const box = useRef(null);
  const seq = useRef(0);

  // Flat list mirrors render order, so arrow keys walk both groups as one list.
  const items = [
    ...companies.map((c) => ({ kind: 'company', id: `c:${c.symbol}`, data: c })),
    ...investors.map((f) => ({ kind: 'investor', id: `i:${f.cik}`, data: f })),
  ];

  useEffect(() => {
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const reset = () => {
    setCompanies([]);
    setInvestors([]);
    setOpen(false);
    setCursor(-1);
  };

  const handleChange = (value) => {
    setQuery(value);
    setCursor(-1);
    clearTimeout(timer.current);
    const q = value.trim();
    if (!q) { reset(); setBusy(false); return; }

    timer.current = setTimeout(async () => {
      // Out-of-order responses would otherwise let a stale query overwrite a
      // newer one; only the latest request is allowed to write state.
      const mine = ++seq.current;
      setBusy(true);
      const [tickers, filers] = await Promise.allSettled([
        searchTickers(q),
        q.length >= MIN_INVESTOR_CHARS ? searchInstitutions(q) : Promise.resolve({ filers: [] }),
      ]);
      if (mine !== seq.current) return;
      // One source failing degrades to the other rather than blanking the box.
      setCompanies(tickers.status === 'fulfilled' ? (tickers.value || []).slice(0, MAX_COMPANIES) : []);
      setInvestors(filers.status === 'fulfilled' ? (filers.value?.filers || []).slice(0, MAX_INVESTORS) : []);
      setBusy(false);
      setOpen(true);
    }, 350);
  };

  const choose = (item) => {
    clearTimeout(timer.current);
    if (item.kind === 'company') {
      setQuery(item.data.symbol);
      onSelectTicker(item.data.symbol);
    } else {
      setQuery('');
      onSelectFiler(item.data);
    }
    reset();
  };

  // Enter with nothing highlighted falls back to treating the text as a ticker,
  // which is how this box behaved before investors were in it.
  const submitRaw = () => {
    const q = query.trim();
    if (!q) return;
    clearTimeout(timer.current);
    onSelectTicker(q);
    reset();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (open && cursor >= 0 && items[cursor]) choose(items[cursor]);
      else submitRaw();
      return;
    }
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c <= 0 ? items.length - 1 : c - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setCursor(-1);
    }
  };

  const row = (item, index) => {
    const active = index === cursor;
    const base = `px-3.5 py-2.5 cursor-pointer border-b border-vs-border last:border-0 transition-colors ${
      active ? 'bg-vs-card' : 'hover:bg-vs-card'
    }`;
    if (item.kind === 'company') {
      const c = item.data;
      return (
        <div
          key={item.id}
          onClick={() => choose(item)}
          onMouseEnter={() => setCursor(index)}
          className={`${base} flex justify-between items-center gap-3`}
          role="option"
          aria-selected={active}
        >
          <div className="min-w-0">
            <span className="text-vs-text font-semibold font-mono text-body">{c.symbol}</span>
            <span className="text-vs-soft text-label ml-2.5">{c.name}</span>
          </div>
          <span className="text-vs-dim text-micro font-mono flex-shrink-0">{c.exchange}</span>
        </div>
      );
    }
    const f = item.data;
    return (
      <div
        key={item.id}
        onClick={() => choose(item)}
        onMouseEnter={() => setCursor(index)}
        className={base}
        role="option"
        aria-selected={active}
      >
        <span className="text-vs-text text-body">{f.name}</span>
        <span className="block text-vs-soft text-micro font-mono mt-0.5">CIK {f.cik}</span>
      </div>
    );
  };

  const groupLabel = (text) => (
    <div className="px-3.5 pt-2 pb-1 text-vs-dim text-micro font-mono uppercase tracking-widest bg-vs-card2">
      {text}
    </div>
  );

  const hasResults = items.length > 0;

  return (
    <div className="relative max-w-md" ref={box}>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => hasResults && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search a company or investor"
          aria-label="Search companies and investors"
          autoComplete="off"
          /* 16px on mobile is what stops iOS zooming the page when the field is
             focused; the tighter size is safe from the sm breakpoint up. */
          className="flex-1 bg-vs-card border border-vs-borderLight rounded-lg px-4 py-3 text-vs-text text-[16px] sm:text-prose font-mono outline-none focus:border-vs-blue transition-colors min-w-0"
        />
        <button
          onClick={submitRaw}
          disabled={loading}
          className={`rounded-lg px-5 py-3 text-body font-bold font-mono transition-all flex-shrink-0 ${
            loading
              ? 'bg-vs-dim text-vs-bg cursor-wait opacity-60'
              : 'bg-vs-blue text-vs-bg cursor-pointer hover:brightness-110'
          }`}
        >
          {loading ? '...' : 'Go'}
        </button>
      </div>

      {busy && (
        <span className="absolute right-[86px] top-1/2 -translate-y-1/2 text-vs-dim text-micro font-mono pointer-events-none">
          searching…
        </span>
      )}

      {open && hasResults && (
        <div
          role="listbox"
          className="absolute top-full left-0 right-0 bg-vs-card2 border border-vs-border rounded-lg mt-1 z-20 overflow-hidden shadow-2xl"
        >
          {companies.length > 0 && groupLabel('Companies')}
          {items.map((item, i) => (item.kind === 'company' ? row(item, i) : null))}
          {investors.length > 0 && groupLabel('Investors · 13F')}
          {items.map((item, i) => (item.kind === 'investor' ? row(item, i) : null))}
        </div>
      )}
    </div>
  );
}
