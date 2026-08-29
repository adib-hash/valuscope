import { useEffect, useRef, useState } from 'react';

// Every upstream this app actually calls, and what each one is responsible for.
// Yahoo is the primary and covers most of the screen, but it is not the whole
// story: the deep history, the 13F pages and the earnings call tooling all come
// from somewhere else, and a header that says only "Yahoo Finance" reads as a
// completeness claim it cannot support.
//
// Ordered by how much of the app each one carries.
export const DATA_SOURCES = [
  {
    name: 'Yahoo Finance',
    use: 'Quotes, financial statements, index levels and returns, price history, earnings estimates, peer comps',
  },
  {
    name: 'SEC EDGAR',
    use: 'Ten to fifteen years of fundamentals from XBRL company facts, and every 13F filing',
  },
  {
    name: 'OpenFIGI',
    use: 'Resolves the CUSIPs in a 13F to tickers',
  },
  {
    name: 'defeatbeta · Hugging Face',
    use: 'Earnings call transcripts',
  },
  {
    name: 'Alpha Vantage',
    use: 'Transcript fallback when the primary dataset is unavailable',
  },
  {
    name: 'Google Gemini',
    use: 'Earnings call summaries, generated only when you ask for one',
  },
];

export default function DataSources() {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={wrap}
      className="relative hidden md:block mr-2"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Show all data sources"
        className="text-vs-soft hover:text-vs-text text-[10px] font-mono cursor-help transition-colors decoration-dotted underline underline-offset-[3px] decoration-vs-border"
      >
        Data: Yahoo Finance +{DATA_SOURCES.length - 1}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-[340px] bg-vs-card2 border border-vs-border rounded-lg shadow-2xl z-50 p-3.5">
          <p className="text-vs-soft text-[9px] font-mono uppercase tracking-widest mb-2.5">
            Where the numbers come from
          </p>
          <div className="space-y-2.5">
            {DATA_SOURCES.map((s) => (
              <div key={s.name}>
                <span className="text-vs-text font-mono text-[11px] font-semibold block">
                  {s.name}
                </span>
                <span className="text-vs-soft text-[11px] leading-snug block mt-0.5">
                  {s.use}
                </span>
              </div>
            ))}
          </div>
          <p className="text-vs-soft text-[10px] font-mono mt-3 pt-2.5 border-t border-vs-border leading-relaxed">
            All free-tier or keyless. Nothing here is real time — quotes are delayed.
          </p>
        </div>
      )}
    </div>
  );
}
