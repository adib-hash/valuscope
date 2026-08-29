import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchBrief } from '../lib/api';
import SectionLabel from './ui/SectionLabel';

// AI valuation brief — the CallSummary conventions apply: violet family,
// explicitly user-triggered, never auto-fires, honest about being generated.
// Mount keyed by symbol so a new company always resets to idle.
export default function CompanyBrief({ ticker }) {
  const [state, setState] = useState('idle'); // idle | loading | error | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const generate = async () => {
    setState('loading');
    setError('');
    try {
      const data = await fetchBrief(ticker);
      setResult(data);
      setState('done');
    } catch (e) {
      setError(e.message || 'Failed to build the brief.');
      setState('error');
    }
  };

  if (state === 'idle') {
    return (
      <div className="mt-5">
        <button
          onClick={generate}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-label font-mono font-semibold border border-vs-violet/40 bg-vs-violet/10 text-vs-violet hover:bg-vs-violet/20 cursor-pointer transition-colors"
        >
          <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
          Generate company brief
        </button>
        <p className="text-vs-dim text-micro font-mono mt-1.5">
          What you&rsquo;re paying, how that compares to history, bull &amp; bear — from this page&rsquo;s numbers · takes 15–30 seconds
        </p>
      </div>
    );
  }

  const freshness = (() => {
    if (!result) return null;
    const genDay = result.generatedAt?.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const when = new Date(result.inputsAsOf.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const stale = genDay && genDay !== today ? 'From an earlier day’s data · ' : '';
    return `${stale}Generated from ${when} data · price then $${result.inputsAsOf.price}`;
  })();

  return (
    <div className="mt-5 rounded-xl border border-vs-violet/25 bg-vs-violet/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-vs-violet/20">
        <span className="flex items-center gap-2 text-vs-violet text-label font-mono font-bold uppercase tracking-widest">
          <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
          Company Brief
        </span>
        {state === 'done' && (
          <button
            onClick={() => { setState('idle'); setResult(null); }}
            className="text-vs-dim hover:text-vs-soft text-micro font-mono cursor-pointer"
          >
            Hide
          </button>
        )}
      </div>

      {state === 'loading' && (
        <div className="px-4 py-4">
          <p className="text-vs-soft text-label font-mono mb-3">Reading the numbers&hellip;</p>
          <div className="space-y-2">
            {[100, 88, 94, 70].map((w, i) => (
              <div key={i} className="h-3 bg-vs-violet/10 rounded-md animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="px-4 py-4">
          <p className="text-vs-red text-label font-mono">{error}</p>
          <button onClick={generate} className="mt-2 text-vs-blue text-label font-mono cursor-pointer hover:underline">
            Try again
          </button>
        </div>
      )}

      {state === 'done' && result && (
        <div className="px-4 py-4">
          <p className="text-vs-text text-prose leading-[1.65] max-w-[68ch]">{result.brief.payingToday}</p>

          <SectionLabel className="mt-4 mb-1.5">Against its own history</SectionLabel>
          <p className="text-vs-soft text-body leading-[1.6] max-w-[68ch]">{result.brief.vsHistory}</p>

          <SectionLabel className="mt-4 mb-1.5">Business trajectory</SectionLabel>
          <p className="text-vs-soft text-body leading-[1.6] max-w-[68ch]">{result.brief.trajectory}</p>

          {result.brief.whatMustBeTrue.length > 0 && (
            <>
              <SectionLabel className="mt-4 mb-1.5">What would have to be true</SectionLabel>
              <ul className="space-y-1.5">
                {result.brief.whatMustBeTrue.map((x, i) => (
                  <li key={i} className="text-vs-soft text-body leading-[1.6] max-w-[68ch] flex gap-2">
                    <span className="text-vs-violet flex-shrink-0">&bull;</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 mt-4">
            <div>
              <SectionLabel className="mb-1.5">Bull case</SectionLabel>
              <ul className="space-y-1.5">
                {result.brief.bullCase.map((x, i) => (
                  <li key={i} className="text-vs-soft text-body leading-[1.6] flex gap-2">
                    <span className="text-vs-green flex-shrink-0">&bull;</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionLabel className="mb-1.5">Bear case</SectionLabel>
              <ul className="space-y-1.5">
                {result.brief.bearCase.map((x, i) => (
                  <li key={i} className="text-vs-soft text-body leading-[1.6] flex gap-2">
                    <span className="text-vs-red flex-shrink-0">&bull;</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-vs-dim text-label mt-4 max-w-[68ch] leading-relaxed">{result.brief.caveats}</p>

          <div className="mt-3 pt-2.5 border-t border-vs-violet/15">
            <p className="text-vs-dim text-micro font-mono leading-relaxed">
              AI-generated from the valuation data on this page · analyst figures are estimates · may contain errors · not financial advice
            </p>
            {freshness && (
              <p className="text-vs-dim text-micro font-mono mt-0.5">{freshness}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
