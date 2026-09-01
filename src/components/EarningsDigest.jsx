import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { runDigest, digestCacheKey, getFinishedDigest, setFinishedDigest } from '../lib/digest';
import KeyMetrics from './ui/KeyMetrics';
import { SummaryBody } from './ui/SummarySections';

const fmtLong = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  return d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : iso;
};

const STATUS_CLASS = {
  queued:  'border-vs-border text-vs-dim',
  reading: 'border-vs-blue/50 text-vs-blue animate-pulse',
  done:    'border-vs-green/40 text-vs-green',
  failed:  'border-vs-red/40 text-vs-red',
};

export default function EarningsDigest({ date, events, onClose, onOpenTranscript, onSelectTicker }) {
  const cacheKey = digestCacheKey(date, events);
  const [state, setState] = useState(() => getFinishedDigest(cacheKey));
  const [run, setRun] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    const cached = getFinishedDigest(cacheKey);
    if (cached && run === 0) { setState(cached); return undefined; }
    const controller = new AbortController();
    abortRef.current = controller;
    runDigest(date, events, { onUpdate: setState, signal: controller.signal })
      .then((final) => {
        if (controller.signal.aborted) return;
        // Only a complete run is worth remembering; a run with failures is
        // left uncached so "Try again" does real work.
        if (final.calls.every((c) => c.status === 'done') && final.synthesis.status !== 'failed') {
          setFinishedDigest(cacheKey, final);
        }
      });
    return () => controller.abort();
  }, [cacheKey, run]); // eslint-disable-line react-hooks/exhaustive-deps

  const calls = state?.calls || [];
  const done = calls.filter((c) => c.status === 'done').length;
  const failed = calls.filter((c) => c.status === 'failed').length;
  const reading = calls.some((c) => c.status === 'reading' || c.status === 'queued');
  const synthesis = state?.synthesis || { status: 'idle' };
  const busy = reading || synthesis.status === 'running';
  const digest = synthesis.result?.digest;

  const jumpTo = (symbol) => {
    document.getElementById(`digest-${symbol}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mt-4 rounded-xl border border-vs-violet/25 bg-vs-violet/[0.04] overflow-hidden">
      {/* Header + progress */}
      <div className="px-4 py-3 border-b border-vs-violet/20">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-vs-violet text-label font-mono font-bold uppercase tracking-widest">
            <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
            Earnings digest · {fmtLong(date)}
          </span>
          <div className="flex items-center gap-3">
            {!busy && failed > 0 && (
              <button
                onClick={() => setRun((r) => r + 1)}
                className="text-vs-blue hover:underline text-micro font-mono cursor-pointer"
              >
                Try again
              </button>
            )}
            <button
              onClick={onClose}
              className="text-vs-dim hover:text-vs-soft text-micro font-mono cursor-pointer transition-colors"
            >
              {busy ? 'Cancel' : 'Hide'}
            </button>
          </div>
        </div>

        <div className="mt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-vs-soft text-label font-mono" aria-live="polite">
              {reading
                ? `Reading ${Math.min(done + 1, calls.length)} of ${calls.length} calls…`
                : synthesis.status === 'running'
                  ? 'Reading across the day…'
                  : `${done} of ${calls.length} calls read${failed ? ` · ${failed} failed` : ''}`}
            </p>
            {reading && calls.length > 4 && (
              <span className="text-vs-dim text-micro font-mono">paced for the free tier</span>
            )}
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-vs-border overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={calls.length} aria-valuenow={done}>
            <div
              className="h-full bg-vs-violet transition-[width] duration-500"
              style={{ width: `${calls.length ? ((done + failed) / calls.length) * 100 : 0}%` }}
            />
          </div>
          <div className="mt-2 flex gap-1 flex-wrap">
            {calls.map((c) => (
              <button
                key={c.event.symbol}
                onClick={() => c.status === 'done' && jumpTo(c.event.symbol)}
                title={c.status === 'failed' ? c.error : c.status}
                className={`rounded border px-1.5 py-0.5 text-micro font-mono ${STATUS_CLASS[c.status]} ${c.status === 'done' ? 'cursor-pointer hover:bg-vs-violet/10' : 'cursor-default'}`}
              >
                {c.event.symbol}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The day in brief */}
      {(synthesis.status === 'running' || digest || synthesis.status === 'failed') && (
        <div className="px-4 py-4 border-b border-vs-violet/20">
          <p className="text-vs-dim text-micro font-mono uppercase tracking-widest mb-2">The day in brief</p>
          {synthesis.status === 'running' && (
            <div className="animate-pulse space-y-2.5">
              <div className="h-3 bg-vs-card rounded-md w-full" />
              <div className="h-3 bg-vs-card rounded-md w-[88%]" />
              <div className="h-3 bg-vs-card rounded-md w-[70%]" />
            </div>
          )}
          {synthesis.status === 'failed' && (
            <p className="text-vs-red text-label font-mono">{synthesis.error}</p>
          )}
          {digest && (
            <>
              <p className="text-vs-text text-prose leading-[1.65] max-w-[68ch]">{digest.overview}</p>
              {digest.themes?.length > 0 && (
                <div className="mt-4">
                  <p className="text-vs-dim text-micro font-mono uppercase tracking-widest mb-2">Threads across calls</p>
                  <ul className="space-y-2.5">
                    {digest.themes.map((t, i) => (
                      <li key={i} className="max-w-[68ch]">
                        <span className="text-vs-text text-body font-semibold">{t.theme}.</span>{' '}
                        <span className="text-vs-soft text-body leading-[1.6]">{t.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {digest.standouts?.length > 0 && (
                <div className="mt-4">
                  <p className="text-vs-dim text-micro font-mono uppercase tracking-widest mb-2">Worth reading in full</p>
                  <ul className="space-y-1.5">
                    {digest.standouts.map((s, i) => (
                      <li key={i} className="flex gap-2 text-body leading-[1.6] max-w-[68ch]">
                        <button
                          onClick={() => jumpTo(String(s.symbol).toUpperCase())}
                          className="font-mono text-label font-bold text-vs-blue hover:underline cursor-pointer flex-shrink-0 mt-[1px]"
                        >
                          {String(s.symbol).toUpperCase()}
                        </button>
                        <span className="text-vs-soft">{s.note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* One section per call, in the calendar's order (largest first). */}
      <div className="divide-y divide-vs-violet/20">
        {calls.map((c) => {
          const s = c.result?.summary;
          const e = c.event;
          return (
            <section key={e.symbol} id={`digest-${e.symbol}`} className="px-4 py-4 scroll-mt-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <button
                    onClick={() => onSelectTicker?.(e.symbol)}
                    className="text-left cursor-pointer group"
                  >
                    <span className="font-display text-prose font-bold text-vs-text group-hover:underline">{e.name}</span>
                    <span className="font-mono text-label font-bold text-vs-blue ml-2">{e.symbol}</span>
                  </button>
                  <p className="text-vs-dim text-micro font-mono mt-0.5">
                    Q{e.transcript.quarter} FY{e.transcript.year}
                    {e.sector && ` · ${e.sector}`}
                    {c.result?.cached && ' · read earlier'}
                  </p>
                </div>
                <button
                  onClick={() => onOpenTranscript?.(e.symbol)}
                  className="text-vs-blue hover:underline text-label font-mono cursor-pointer whitespace-nowrap"
                >
                  Read the call →
                </button>
              </div>

              {c.status === 'queued' && (
                <p className="text-vs-dim text-label font-mono mt-3">Waiting…</p>
              )}
              {c.status === 'reading' && (
                <div className="mt-3 animate-pulse space-y-2">
                  <div className="h-3 bg-vs-card rounded-md w-full" />
                  <div className="h-3 bg-vs-card rounded-md w-[80%]" />
                </div>
              )}
              {c.status === 'failed' && (
                <p className="text-vs-red text-label font-mono mt-3">{c.error}</p>
              )}

              {s && (
                <div className="mt-3">
                  <SummaryBody summary={s} KeyMetrics={KeyMetrics} />
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="px-4 py-3 border-t border-vs-violet/20">
        <p className="text-vs-dim text-micro font-mono">
          AI-generated from each call's transcript &middot; may contain errors &middot; not financial advice
        </p>
      </div>
    </div>
  );
}
