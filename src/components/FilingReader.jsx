import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { fetchFilings, fetchFiling } from '../lib/api';
import BackButton from './ui/BackButton';
import ErrorBanner from './ui/ErrorBanner';
import Highlighted, { countMatches } from '../lib/highlight.jsx';

// Reads one filing as structured blocks — transcript-page typography, a sticky
// item nav, in-document search, and a document switcher for 8-K exhibits.
// The converter is best-effort by design; the EDGAR original is always a
// click away.

function Table({ rows, query }) {
  return (
    <div className="overflow-x-auto my-3 rounded-lg border border-vs-border">
      <table className="w-full font-mono text-dense">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={i ? 'border-t border-vs-border/40' : ''}>
              {r.map((c, j) => (
                <td key={j} className={`px-2.5 py-1.5 align-top ${j === 0 ? 'text-vs-soft' : 'text-vs-text text-right whitespace-nowrap'}`}>
                  <Highlighted text={c} query={query} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FilingReader({ ticker, accession, doc, onBack, onSwitchDoc }) {
  const [meta, setMeta] = useState(null);      // row from the filings list
  const [data, setData] = useState(null);      // blocks payload
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const topRef = useRef(null);

  useEffect(() => {
    if (!ticker || !accession) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);
    setQuery('');
    (async () => {
      try {
        // The list is edge-cached; it resolves the CIK and names the form.
        const list = await fetchFilings(ticker);
        if (cancelled) return;
        if (!list.cik) throw new Error('No EDGAR filings for this company');
        setMeta(list.filings.find((f) => f.accession === accession) || null);
        const payload = await fetchFiling(list.cik, accession, doc || undefined);
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load filing');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, accession, doc]);

  const matches = useMemo(() => {
    if (!query || !data) return 0;
    return countMatches(
      data.blocks.flatMap((b) => (b.t === 'table' ? b.rows.flat() : [b.text])),
      query,
    );
  }, [data, query]);

  const jumpTo = (blockIndex) => {
    document.getElementById(`blk-${blockIndex}`)?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="mt-5 pb-10" ref={topRef}>
      <BackButton onClick={onBack} label="All filings" />

      <div className="text-vs-dim text-label font-mono tracking-widest">
        {ticker} · {meta?.form || 'FILING'}
      </div>
      <h1 className="font-display text-title font-extrabold mt-1 leading-tight text-vs-text">
        {meta ? `${meta.form} · filed ${meta.filed}` : accession}
      </h1>
      {meta?.reportDate && /^10-[KQ]/.test(meta.form) && (
        <p className="text-vs-soft text-body mt-0.5">Fiscal period ended {meta.reportDate}</p>
      )}

      {/* Document switcher — an 8-K's substance is usually its Ex-99 exhibit */}
      {data?.docs?.length > 1 && (
        <div className="flex gap-1 mt-3 flex-wrap">
          {data.docs.map((d) => (
            <button
              key={d.name}
              onClick={() => onSwitchDoc(d.name)}
              className={`rounded-md px-2.5 py-1 text-micro font-mono border transition-all cursor-pointer ${
                d.name === data.doc
                  ? 'bg-vs-blue/15 text-vs-blue border-vs-blue/50'
                  : 'bg-transparent text-vs-dim border-vs-border hover:border-vs-borderLight hover:text-vs-soft'
              }`}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      {/* Search + EDGAR link */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this document"
          aria-label="Search this document"
          className="flex-1 min-w-[180px] max-w-sm bg-vs-card border border-vs-border rounded-lg px-3.5 py-2 text-vs-text placeholder:text-vs-dim focus:outline-none focus:border-vs-blue transition-colors"
        />
        {query && (
          <span className="text-vs-soft text-label font-mono">
            {matches} match{matches !== 1 ? 'es' : ''}
          </span>
        )}
        {data?.edgarUrl && (
          <a
            href={data.edgarUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-vs-dim hover:text-vs-soft text-label font-mono ml-auto transition-colors"
          >
            View original on EDGAR <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
          </a>
        )}
      </div>

      {/* Item jump-nav, sticky. Best effort — absent sections mean no nav. */}
      {data?.sections?.length > 1 && (
        <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-vs-bg/95 backdrop-blur border-b border-vs-border mt-3">
          <div className="flex gap-1 overflow-x-auto">
            {data.sections.map((s) => (
              <button
                key={`${s.item}-${s.blockIndex}`}
                onClick={() => jumpTo(s.blockIndex)}
                title={s.title}
                className="rounded-md px-2 py-1 text-micro font-mono whitespace-nowrap border border-vs-border text-vs-dim hover:text-vs-soft hover:border-vs-borderLight cursor-pointer transition-all flex-shrink-0"
              >
                {s.item}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <ErrorBanner className="mt-5">{error}</ErrorBanner>}

      {loading && (
        <div className="mt-6 space-y-3 animate-pulse">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-4 bg-vs-card rounded-md" style={{ width: `${95 - (i % 4) * 12}%` }} />
          ))}
        </div>
      )}

      {data?.truncated && (
        <p className="mt-4 text-vs-amber text-label font-mono">
          This document was too large to convert fully — the tail is cut. The EDGAR original is complete.
        </p>
      )}

      {/* The document */}
      {!loading && data && (
        <div className="mt-6 max-w-[74ch]">
          {data.blocks.map((b, i) => {
            if (b.t === 'h') {
              return (
                <h2
                  key={i}
                  id={`blk-${i}`}
                  className={`scroll-mt-14 font-semibold text-vs-text mt-6 mb-2 ${b.level <= 2 ? 'text-prose' : 'text-body'}`}
                >
                  <Highlighted text={b.text} query={query} />
                </h2>
              );
            }
            if (b.t === 'table') return <Table key={i} rows={b.rows} query={query} />;
            return (
              <p key={i} id={`blk-${i}`} className="scroll-mt-14 text-vs-soft text-prose leading-[1.7] my-2.5">
                <Highlighted text={b.text} query={query} />
              </p>
            );
          })}
        </div>
      )}

      {!loading && data && (
        <div className="mt-10 pt-4 border-t border-vs-border">
          <p className="text-vs-dim text-micro font-mono">
            Rendered from the SEC EDGAR original · formatting is simplified — tables and layout may differ from the filed document
          </p>
        </div>
      )}
    </div>
  );
}
