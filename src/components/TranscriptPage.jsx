import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTranscript } from '../lib/api';

const QUARTER_LABEL = (q) => `Q${q.quarter} FY${q.year}`;

// Report dates arrive as plain YYYY-MM-DD. Passing that to `new Date` parses it
// as UTC midnight, which renders as the previous day anywhere west of London —
// a 2026-04-30 call was showing as April 29. Build the date in local time.
function fmtDate(d) {
  if (!d) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  const parsed = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(d);
  return isNaN(parsed) ? null : parsed.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

// Earnings calls split into prepared remarks and Q&A, and the handover is
// always announced. The opening welcome usually mentions that a Q&A will follow
// later on, so the first couple of paragraphs are skipped — otherwise the seam
// lands on paragraph one and the whole call reads as Q&A.
const QA_HANDOVER = [
  /may we have (the |our )?first question/i,
  /we'?ll (now |go ahead and )*take (our|the) first question/i,
  /(begin|open|start)(ing)? (the |our )?question[- ]and[- ]answer/i,
  /open (up )?the (call|floor|lines?) (for|to) questions/i,
  /first question (comes |is )?from/i,
];
const PREAMBLE = 2;

function splitSections(paragraphs) {
  let index = -1;
  for (let i = PREAMBLE; i < paragraphs.length; i++) {
    if (QA_HANDOVER.some((re) => re.test(paragraphs[i].content))) { index = i; break; }
  }
  if (index < 0) return [{ title: null, items: paragraphs }];
  return [
    { title: 'Prepared Remarks', items: paragraphs.slice(0, index) },
    { title: 'Question & Answer', items: paragraphs.slice(index) },
  ];
}

// Wraps query matches in a <mark> without risking HTML injection.
function Highlighted({ text, query }) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-vs-amber/30 text-vs-text rounded px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  );
}

export default function TranscriptPage({ ticker, companyName, onBack }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [selected, setSelected] = useState(null); // { year, quarter }
  const [query, setQuery]     = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchTranscript(ticker, selected?.year, selected?.quarter)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load transcript'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, selected?.year, selected?.quarter]);

  const paragraphs = data?.paragraphs || [];

  const filtered = useMemo(() => {
    if (!query.trim()) return paragraphs;
    const q = query.toLowerCase();
    return paragraphs.filter((p) =>
      p.content.toLowerCase().includes(q) || p.speaker.toLowerCase().includes(q)
    );
  }, [paragraphs, query]);

  const sections = useMemo(
    () => (query.trim() ? [{ title: null, items: filtered }] : splitSections(paragraphs)),
    [paragraphs, filtered, query]
  );

  const quarters = data?.quarters || [];

  return (
    <div className="mt-5 pb-10">
      <button
        onClick={onBack}
        className="text-vs-dim hover:text-vs-soft transition-colors text-[11px] font-mono cursor-pointer inline-flex items-center gap-1"
      >
        ← Back
      </button>

      <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-vs-dim text-[11px] font-mono tracking-widest">{ticker}</p>
          <h1 className="font-display text-[26px] font-extrabold leading-tight text-vs-text mt-0.5">
            {companyName || ticker}
          </h1>
          <p className="text-vs-soft text-[13px] mt-1">
            Earnings Call
            {data && (
              <>
                {' '}&middot; <span className="font-mono">Q{data.quarter} FY{data.year}</span>
                {data.reportDate && <> &middot; {fmtDate(data.reportDate)}</>}
              </>
            )}
          </p>
        </div>

        {/* Quarter picker */}
        {quarters.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="rounded-md px-3 py-2 text-[12px] font-mono font-semibold cursor-pointer border bg-vs-card text-vs-soft border-vs-border hover:border-vs-borderLight transition-colors flex items-center gap-2"
            >
              {data ? `Q${data.quarter} FY${data.year}` : 'Select quarter'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 mt-1 z-20 max-h-[320px] overflow-y-auto rounded-lg border border-vs-border bg-vs-card shadow-2xl min-w-[170px]">
                  {quarters.map((q) => {
                    const active = data && q.year === data.year && q.quarter === data.quarter;
                    return (
                      <button
                        key={`${q.year}-${q.quarter}`}
                        onClick={() => { setSelected({ year: q.year, quarter: q.quarter }); setPickerOpen(false); setQuery(''); }}
                        className={`w-full text-left px-3.5 py-2 text-[12px] font-mono cursor-pointer transition-colors ${
                          active ? 'bg-vs-blue/15 text-vs-blue' : 'text-vs-soft hover:bg-vs-card2'
                        }`}
                      >
                        {QUARTER_LABEL(q)}
                        {q.reportDate && (
                          <span className="text-vs-dim ml-2">{q.reportDate}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Search within the call */}
      {paragraphs.length > 0 && (
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this call…"
            className="flex-1 min-w-[180px] bg-vs-card border border-vs-border rounded-lg px-3.5 py-2 text-vs-text placeholder:text-vs-dim outline-none focus:border-vs-blue transition-colors"
          />
          {query && (
            <span className="text-vs-dim text-[11px] font-mono">
              {filtered.length} of {paragraphs.length}
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="mt-6 animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-2.5 bg-vs-card rounded w-32" />
              <div className="h-3 bg-vs-card rounded w-full" />
              <div className="h-3 bg-vs-card rounded w-[92%]" />
            </div>
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="mt-5 text-vs-red font-mono text-[13px] px-4 py-3 bg-vs-red/5 rounded-lg border border-vs-red/20">
          {error}
        </div>
      )}

      {!loading && !error && !paragraphs.length && (
        <p className="mt-6 text-vs-soft text-[14px]">No transcript available for {ticker}.</p>
      )}

      {!loading && !error && query && !filtered.length && (
        <p className="mt-6 text-vs-soft text-[14px]">No matches for &ldquo;{query}&rdquo;.</p>
      )}

      {/* The call itself. Body type here is deliberately larger than the rest of
          the app — this is prose to be read, not a data table to be scanned. */}
      {!loading && sections.map((section, si) => (
        <div key={si} className="mt-7">
          {section.title && (
            <h2 className="text-vs-dim text-[10px] font-mono uppercase tracking-widest mb-4 pb-2 border-b border-vs-border">
              {section.title}
            </h2>
          )}
          <div className="space-y-5">
            {section.items.map((p) => (
              <div key={p.n}>
                {p.speaker && (
                  <p className="font-mono text-[12px] font-semibold text-vs-blue mb-1">
                    <Highlighted text={p.speaker} query={query} />
                  </p>
                )}
                <p className="text-vs-text text-[15px] leading-[1.7] max-w-[68ch]">
                  <Highlighted text={p.content} query={query} />
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {data && (
        <p className="mt-10 pt-4 border-t border-vs-border text-vs-dim text-[10px] font-mono">
          Transcript data via{' '}
          <a
            href="https://huggingface.co/datasets/defeatbeta/yahoo-finance-data"
            target="_blank"
            rel="noreferrer"
            className="hover:text-vs-soft hover:underline transition-colors"
          >
            defeatbeta
          </a>
          {' '}/ Yahoo Finance
          {data.source === 'alphavantage' && ' · served via Alpha Vantage'}
          {' '}&middot; licensed ODC-BY
        </p>
      )}
    </div>
  );
}
