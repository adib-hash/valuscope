import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchEarningsTranscript } from '../lib/api';
import {
  splitSpeakers,
  highlightGuidance,
  defaultQuarterFor,
  priorQuarter,
  formatTranscriptDate,
} from '../lib/transcript';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 2014 }, (_, i) => CURRENT_YEAR - i);
const QUARTER_OPTIONS = [1, 2, 3, 4];

export default function EarningsTranscriptPage({ ticker, companyName, onBack }) {
  const initial = useMemo(() => defaultQuarterFor(), []);
  const [year, setYear]         = useState(initial.year);
  const [quarter, setQuarter]   = useState(initial.quarter);
  const [query, setQuery]       = useState('');
  const [highlights, setHighlights] = useState(true);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [data, setData]         = useState(null);
  const autoFellBackRef = useRef(false);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      setData(null);
      try {
        const result = await fetchEarningsTranscript({ ticker, year, quarter });
        if (!cancelled) setData(result);
      } catch (e) {
        if (cancelled) return;
        const msg = e.message || 'Failed to load transcript';
        // One-shot auto-fallback: if this is the default quarter and we got a "no transcript"
        // error, silently roll back to the prior quarter. User-initiated selections skip this.
        const isDefault =
          year === initial.year && quarter === initial.quarter && !autoFellBackRef.current;
        const looksEmpty = /no transcript available/i.test(msg);
        if (isDefault && looksEmpty) {
          autoFellBackRef.current = true;
          const prev = priorQuarter({ year, quarter });
          setYear(prev.year);
          setQuarter(prev.quarter);
          return;
        }
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [ticker, year, quarter, initial.year, initial.quarter]);

  const onYearChange = (e) => {
    autoFellBackRef.current = true; // any user selection disables the fallback
    setYear(parseInt(e.target.value, 10));
  };
  const onQuarterChange = (e) => {
    autoFellBackRef.current = true;
    setQuarter(parseInt(e.target.value, 10));
  };

  const tryPrevious = () => {
    autoFellBackRef.current = true;
    const prev = priorQuarter({ year, quarter });
    setYear(prev.year);
    setQuarter(prev.quarter);
  };

  const blocks = useMemo(
    () => (data?.transcript ? splitSpeakers(data.transcript) : []),
    [data]
  );

  const filteredBlocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blocks;
    return blocks.filter(
      (b) =>
        b.text.toLowerCase().includes(q) ||
        (b.speaker || '').toLowerCase().includes(q)
    );
  }, [blocks, query]);

  const dateLabel = formatTranscriptDate(data?.date);
  const subline = data
    ? `Q${data.quarter} ${data.year}${dateLabel ? ' · ' + dateLabel : ''}`
    : `Q${quarter} ${year}`;

  return (
    <div className="mt-5">
      {/* Header */}
      <div className="min-w-0">
        <button
          onClick={onBack}
          className="text-vs-dim hover:text-vs-soft text-[11px] font-mono cursor-pointer mb-2 flex items-center gap-1"
        >
          <span>←</span> Back to overview
        </button>
        <div className="text-vs-dim text-[11px] font-mono tracking-widest">
          {ticker} · EARNINGS CALL
        </div>
        <h1 className="font-display text-[26px] font-extrabold mt-1 leading-tight text-vs-text">
          {companyName || ticker}
        </h1>
        <p className="text-vs-soft text-[13px] font-mono mt-0.5">{subline}</p>
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="earnings-year">Year</label>
        <select
          id="earnings-year"
          value={year}
          onChange={onYearChange}
          className="bg-vs-card border border-vs-border rounded-lg px-3 py-2 text-[14px] font-mono text-vs-text hover:border-vs-borderLight focus:border-vs-violet focus:outline-none cursor-pointer"
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="earnings-quarter">Quarter</label>
        <select
          id="earnings-quarter"
          value={quarter}
          onChange={onQuarterChange}
          className="bg-vs-card border border-vs-border rounded-lg px-3 py-2 text-[14px] font-mono text-vs-text hover:border-vs-borderLight focus:border-vs-violet focus:outline-none cursor-pointer"
        >
          {QUARTER_OPTIONS.map((q) => (
            <option key={q} value={q}>Q{q}</option>
          ))}
        </select>

        <input
          type="search"
          aria-label="Search transcript"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search within transcript…"
          className="w-full sm:w-auto sm:flex-1 bg-vs-card border border-vs-border rounded-lg px-3 py-2 text-[16px] sm:text-[14px] text-vs-text placeholder:text-vs-dim hover:border-vs-borderLight focus:border-vs-violet focus:outline-none"
        />

        <button
          onClick={() => setHighlights((v) => !v)}
          aria-pressed={highlights}
          className={`px-3 py-2 text-[11px] font-mono rounded-lg border transition-colors cursor-pointer ${
            highlights
              ? 'bg-vs-amber/15 text-vs-amber border-vs-amber'
              : 'bg-vs-card text-vs-soft border-vs-border hover:border-vs-borderLight'
          }`}
        >
          {highlights ? 'Highlights on' : 'Highlights off'}
        </button>
      </div>

      {/* Body */}
      <div className="mt-4 bg-vs-card border border-vs-border rounded-xl px-5 py-4">
        {loading && (
          <p className="text-vs-dim text-[12px] font-mono py-8 text-center">
            Loading transcript…
          </p>
        )}

        {!loading && error && (
          <div className="py-6">
            <p className="text-vs-text text-[15px] leading-relaxed">{error}</p>
            <p className="text-vs-dim text-[12px] font-mono mt-2">
              API Ninjas may not have this quarter yet, or the call hasn&rsquo;t happened.
            </p>
            <button
              onClick={tryPrevious}
              className="mt-4 inline-flex items-center gap-1 text-vs-violet hover:underline text-[12px] font-mono cursor-pointer"
            >
              ← Try previous quarter (Q{priorQuarter({ year, quarter }).quarter} {priorQuarter({ year, quarter }).year})
            </button>
          </div>
        )}

        {!loading && !error && blocks.length > 0 && (
          <>
            {filteredBlocks.length === 0 && (
              <p className="text-vs-dim text-[12px] font-mono py-6 text-center">
                No blocks match &ldquo;{query}&rdquo;.
              </p>
            )}
            <div className="space-y-5">
              {filteredBlocks.map((block, i) => (
                <section
                  key={i}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '1px 500px' }}
                >
                  {block.speaker && (
                    <h3 className="font-mono text-[11px] tracking-wider uppercase text-vs-violet mb-1.5">
                      {block.speaker}
                    </h3>
                  )}
                  <p className="text-vs-text text-[15px] leading-7 whitespace-pre-wrap">
                    {highlights
                      ? highlightGuidance(block.text).map((tok, j) =>
                          tok.match ? (
                            <mark
                              key={j}
                              className="bg-vs-amber/20 text-vs-text rounded px-0.5"
                            >
                              {tok.text}
                            </mark>
                          ) : (
                            <span key={j}>{tok.text}</span>
                          )
                        )
                      : block.text}
                  </p>
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      {data && !loading && !error && (
        <p className="text-vs-dim text-[10px] font-mono mt-2">
          {blocks.length} speaker blocks · source: API Ninjas
        </p>
      )}
    </div>
  );
}
