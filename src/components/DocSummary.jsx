import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchDocSummary } from '../lib/api';
import SectionLabel from './ui/SectionLabel';

// One-click filing summary — CallSummary conventions: violet, button-gated,
// extractive, labeled. Section set adapts to the form family.
const SECTION_LABELS = {
  report: [
    ['businessHighlights', 'Business'],
    ['financialHighlights', 'Financial Highlights'],
    ['managementDiscussion', "Management's Discussion"],
    ['riskFactors', 'Risk Factors'],
  ],
  event: [
    ['whatHappened', 'What Happened'],
    ['keyNumbers', 'Key Numbers'],
    ['statedImpact', 'Stated Impact'],
  ],
  proxy: [
    ['proposals', 'Proposals'],
    ['compensation', 'Compensation'],
    ['governance', 'Governance'],
  ],
};

export default function DocSummary({ cik, accession, form, doc }) {
  const [state, setState] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const generate = async () => {
    setState('loading');
    setError('');
    try {
      setResult(await fetchDocSummary(cik, accession, form, doc));
      setState('done');
    } catch (e) {
      setError(e.message || 'Failed to summarise.');
      setState('error');
    }
  };

  if (state === 'idle') {
    return (
      <div className="mt-4">
        <button
          onClick={generate}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-label font-mono font-semibold border border-vs-violet/40 bg-vs-violet/10 text-vs-violet hover:bg-vs-violet/20 cursor-pointer transition-colors"
        >
          <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
          Summarize this filing
        </button>
        <p className="text-vs-dim text-micro font-mono mt-1.5">
          Key points, figures and risks · takes ~15 seconds
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-vs-violet/25 bg-vs-violet/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-vs-violet/20">
        <span className="flex items-center gap-2 text-vs-violet text-label font-mono font-bold uppercase tracking-widest">
          <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
          Filing Summary
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
          <p className="text-vs-soft text-label font-mono mb-3">Reading the filing&hellip;</p>
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
          <p className="text-vs-text text-prose leading-[1.65] max-w-[68ch]">{result.summary.overview}</p>
          {(SECTION_LABELS[result.family] || []).map(([key, label]) =>
            result.summary[key]?.length ? (
              <div key={key}>
                <SectionLabel className="mt-4 mb-1.5">{label}</SectionLabel>
                <ul className="space-y-1.5">
                  {result.summary[key].map((x, i) => (
                    <li key={i} className="text-vs-soft text-body leading-[1.6] max-w-[68ch] flex gap-2">
                      <span className="text-vs-violet flex-shrink-0">&bull;</span>
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          <div className="mt-4 pt-2.5 border-t border-vs-violet/15">
            <p className="text-vs-dim text-micro font-mono leading-relaxed">
              AI-generated, strictly from this filing · may contain errors · not financial advice
              {result.sectionsUsed ? ` · read ${result.sectionsUsed.join(', ')} of a very large document` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
