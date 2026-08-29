import { useEffect, useMemo, useState } from 'react';
import { fetchFilings } from '../lib/api';
import BackButton from './ui/BackButton';
import ErrorBanner from './ui/ErrorBanner';
import SegmentedControl from './ui/SegmentedControl';
import { lazy, Suspense } from 'react';

const KpiPanel = lazy(() => import('./KpiPanel'));

// The filings index for a company: what EDGAR has, filtered to the forms
// worth reading, each row one click from the in-app reader.
const FILTERS = [
  { value: 'all',   label: 'All' },
  { value: '10-K',  label: '10-K' },
  { value: '10-Q',  label: '10-Q' },
  { value: '8-K',   label: '8-K' },
  { value: 'proxy', label: 'Proxy' },
  { value: 'other', label: 'Other' },
];

const matchesFilter = (form, filter) => {
  if (filter === 'all') return true;
  if (filter === 'proxy') return form.startsWith('DEF') || form.startsWith('DEFA');
  if (filter === 'other') return !/^(10-K|10-Q|8-K|DEF|DEFA)/.test(form);
  return form === filter || form === `${filter}/A`;
};

// Annual and quarterly reports carry their fiscal period; the rest are events.
const periodLabel = (f) =>
  f.reportDate && /^10-[KQ]/.test(f.form) ? `period ${f.reportDate}` : null;

export default function FilingsPage({ ticker, companyName, onBack, onOpenFiling }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchFilings(ticker)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load filings'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  const visible = useMemo(
    () => (data?.filings || []).filter((f) => matchesFilter(f.form, filter)),
    [data, filter],
  );

  return (
    <div className="mt-5 pb-8">
      <BackButton onClick={onBack} />

      <div className="text-vs-dim text-label font-mono tracking-widest">{ticker} · FILINGS &amp; DOCS</div>
      <h1 className="font-display text-display font-extrabold mt-1 leading-tight text-vs-text">
        {companyName || data?.name || ticker}
      </h1>
      <p className="text-vs-soft text-body mt-0.5 max-w-[68ch]">
        Everything material the company filed with the SEC, readable here.
      </p>

      {/* Operating KPIs — mined from these very filings */}
      <Suspense fallback={null}>
        <KpiPanel ticker={ticker} onOpenFiling={onOpenFiling} />
      </Suspense>

      <SegmentedControl
        className="mt-4"
        options={FILTERS}
        value={filter}
        onChange={setFilter}
      />

      {error && <ErrorBanner className="mt-5">{error}</ErrorBanner>}

      {loading && (
        <div className="mt-4 rounded-xl border border-vs-border bg-vs-card px-4 py-6">
          <div className="animate-pulse space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 bg-vs-border rounded-md" />
            ))}
          </div>
        </div>
      )}

      {!loading && !error && data && !data.cik && (
        <p className="mt-5 text-vs-soft text-body">
          No EDGAR filings — foreign private issuers and some ADRs file outside the US system.
        </p>
      )}

      {!loading && !error && visible.length > 0 && (
        <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden divide-y divide-vs-border">
          {visible.map((f) => (
            <button
              key={f.accession}
              onClick={() => onOpenFiling(f.accession)}
              className="w-full px-4 py-3 flex items-baseline gap-3 text-left cursor-pointer hover:bg-vs-card2 transition-colors"
            >
              <span className="font-mono text-label font-semibold text-vs-blue w-16 flex-shrink-0">
                {f.form}
              </span>
              <span className="font-mono text-label text-vs-text flex-shrink-0">{f.filed}</span>
              <span className="text-vs-soft text-label truncate">
                {periodLabel(f) || f.description || ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {!loading && !error && data?.cik && visible.length === 0 && (
        <p className="mt-5 text-vs-soft text-body">Nothing under this filter.</p>
      )}

      {data?.cik && (
        <p className="mt-3 text-vs-dim text-micro font-mono">
          Source: SEC EDGAR · roughly the last thousand filings, material forms only
        </p>
      )}
    </div>
  );
}
