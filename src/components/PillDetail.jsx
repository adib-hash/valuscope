import { useState, useEffect } from 'react';
import ValuChart from './ValuChart';
import { formatMultiple } from '../lib/metrics';

export default function PillDetail({ metric, chartData, averages, years, isDark, onClose }) {
  const [visible, setVisible] = useState(false);

  // Trigger slide-up animation on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const now  = years[years.length - 1];
  const hist = years.filter((y) => !y.fiscalYear?.startsWith('Now'));
  const histVals = hist
    .map((y) => y[metric.key])
    .filter((v) => v != null && isFinite(v) && v > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="relative w-full bg-vs-card border-t border-vs-border rounded-t-2xl z-10 max-h-[75vh] overflow-y-auto transition-transform duration-300"
        style={{ transform: visible ? 'translateY(0)' : 'translateY(100%)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-vs-border rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-3 pb-1">
          <div>
            <p className="text-vs-dim text-[10px] font-mono uppercase tracking-wider">
              {metric.label}
            </p>
            <p className="text-vs-text text-[28px] font-bold font-mono leading-tight">
              {formatMultiple(now?.[metric.key], metric.isYield)}
            </p>
            <p className="text-vs-soft text-[12px] mt-0.5">
              Avg: {formatMultiple(averages[metric.key], metric.isYield)}
              {histVals.length > 0 && (
                <span className="ml-2.5 text-vs-dim">
                  Range:{' '}
                  {formatMultiple(Math.min(...histVals), metric.isYield)}
                  {' \u2013 '}
                  {formatMultiple(Math.max(...histVals), metric.isYield)}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-vs-dim hover:text-vs-soft transition-colors cursor-pointer p-1 mt-1 flex-shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Mini chart */}
        <div className="px-2 pb-1">
          <ValuChart
            chartData={chartData}
            selectedMetrics={[metric.key]}
            averages={averages}
            isYield={metric.isYield}
            isDark={isDark}
            compact
          />
        </div>

        {/* Year-by-year table */}
        <div className="px-5 pb-10">
          <p className="text-vs-dim text-[9px] font-mono uppercase tracking-widest mb-2">
            Historical Data
          </p>
          <div>
            {years.map((y) => {
              const val = y[metric.key];
              const isNow = y.fiscalYear?.startsWith('Now');
              return (
                <div
                  key={y.fiscalYear}
                  className={`flex justify-between py-2 border-b border-vs-border/30 ${
                    isNow ? 'text-vs-blue' : ''
                  }`}
                >
                  <span className={`font-mono text-[12px] ${isNow ? 'text-vs-blue font-semibold' : 'text-vs-soft'}`}>
                    {y.fiscalYear}
                  </span>
                  <span className={`font-mono text-[12px] font-semibold ${isNow ? 'text-vs-blue' : 'text-vs-text'}`}>
                    {formatMultiple(val, metric.isYield)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
