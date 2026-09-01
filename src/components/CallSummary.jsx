import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fetchSummary } from '../lib/api';
import KeyMetrics from './ui/KeyMetrics';
import { SummaryBody } from './ui/SummarySections';

export default function CallSummary({ ticker, year, quarter }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchSummary(ticker, year, quarter);
      setSummary(result.summary);
    } catch (e) {
      setError(e.message || 'Could not generate a summary.');
    } finally {
      setLoading(false);
    }
  };

  // Idle: just the invitation. Nothing is generated until it is asked for.
  if (!summary && !loading && !error) {
    return (
      <div className="mt-5">
        <button
          onClick={run}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-label font-mono font-semibold cursor-pointer border border-vs-violet/40 bg-vs-violet/10 text-vs-violet hover:bg-vs-violet/20 transition-colors"
        >
          <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
          Summarize this call
        </button>
        <p className="text-vs-dim text-micro font-mono mt-1.5">
          Results, guidance, the Q&amp;A that mattered, what changed &middot; takes about half a minute
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-vs-violet/25 bg-vs-violet/[0.04] overflow-hidden">
      <div className="px-4 py-3 border-b border-vs-violet/20 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-vs-violet text-label font-mono font-bold uppercase tracking-widest">
          <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
          Call Summary
        </span>
        {summary && (
          <button
            onClick={() => { setSummary(null); setError(''); }}
            className="text-vs-dim hover:text-vs-soft text-micro font-mono cursor-pointer transition-colors"
          >
            Hide
          </button>
        )}
      </div>

      {loading && (
        <div className="px-4 py-4">
          <p className="text-vs-soft text-label font-mono mb-3">
            Reading the call&hellip;
          </p>
          <div className="animate-pulse space-y-2.5">
            <div className="h-3 bg-vs-card rounded-md w-full" />
            <div className="h-3 bg-vs-card rounded-md w-[88%]" />
            <div className="h-3 bg-vs-card rounded-md w-[94%]" />
            <div className="h-3 bg-vs-card rounded-md w-[70%]" />
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="px-4 py-4">
          <p className="text-vs-red text-label font-mono">{error}</p>
          <button
            onClick={run}
            className="mt-2.5 text-vs-blue hover:underline text-label font-mono cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {summary && !loading && (
        <div className="px-4 py-4">
          <SummaryBody summary={summary} KeyMetrics={KeyMetrics} />

          <p className="text-vs-dim text-micro font-mono mt-5 pt-3 border-t border-vs-violet/15">
            AI-generated from the transcript above &middot; may contain errors &middot; not financial advice
          </p>
        </div>
      )}
    </div>
  );
}
