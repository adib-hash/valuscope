import { useMemo } from 'react';
import { computeGrowthStats, computeMarginsTrend } from '../lib/fundamentals';

function SectionHeader({ children }) {
  return (
    <p className="text-vs-dim text-[9px] font-mono uppercase tracking-widest mb-2.5">
      {children}
    </p>
  );
}

function StatChip({ label, value, color }) {
  if (value == null) return null;
  return (
    <div className="flex flex-col">
      <span className="text-vs-dim text-[9px] font-mono uppercase tracking-wider leading-none mb-0.5">
        {label}
      </span>
      <span className="font-mono text-[13px] font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function TrendArrow({ direction }) {
  if (direction === 'up') {
    return (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgb(var(--vs-green))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-0.5" aria-hidden="true">
        <polyline points="2,8 5,2 8,8" />
      </svg>
    );
  }
  if (direction === 'down') {
    return (
      <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgb(var(--vs-red))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-0.5" aria-hidden="true">
        <polyline points="2,2 5,8 8,2" />
      </svg>
    );
  }
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="rgb(var(--vs-dim))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-0.5" aria-hidden="true">
      <line x1="2" y1="5" x2="8" y2="5" />
    </svg>
  );
}

function fmtPct(v, signed = false) {
  if (v == null || !isFinite(v)) return null;
  return (signed && v > 0 ? '+' : '') + v.toFixed(1) + '%';
}

function fmtMult(v) {
  if (v == null || !isFinite(v)) return null;
  return (v < 10 ? v.toFixed(2) : v.toFixed(1)) + 'x';
}

function fmtDollarM(v) {
  if (v == null || !isFinite(v)) return null;
  const abs = Math.abs(v);
  if (abs >= 1000) return (v < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(1) + 'B';
  return (v < 0 ? '-$' : '$') + abs.toFixed(0) + 'M';
}

const MARGIN_LABELS = {
  grossMargin:     'Gross',
  ebitdaMargin:    'EBITDA',
  operatingMargin: 'Op.',
  netMargin:       'Net',
  fcfMargin:       'FCF',
};

export default function FundamentalsPanel({ hist, now, data }) {
  const growth  = useMemo(() => computeGrowthStats(hist),            [hist]);
  const margins = useMemo(() => computeMarginsTrend(hist, now),      [hist, now]);

  const hasGrowth  = Object.values(growth).some((v) => v != null);
  const hasMargins = now && Object.keys(MARGIN_LABELS).some((k) => now[k] != null);
  const hasLeverage = now && (now.netDebt != null || now.netDebtToEbitda != null || now.interestCoverage != null || now.currentRatio != null);
  const hasSignals  = data && (data.beta != null || data.dividendYield != null || data.insiderOwnershipPct != null || data.shortInterestPct != null || data.forwardPE != null || data.pegRatio != null);

  if (!hasGrowth && !hasMargins && !hasLeverage && !hasSignals) return null;

  return (
    <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
      <div className="divide-y divide-vs-border">

        {/* Growth */}
        {hasGrowth && (
          <div className="px-4 py-3.5">
            <SectionHeader>Growth</SectionHeader>
            <div className="space-y-2">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-vs-dim font-mono text-[10px] w-14">Revenue</span>
                <StatChip label="1yr" value={fmtPct(growth.rev1yr, true)} color={growth.rev1yr >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))'} />
                <StatChip label="3yr CAGR" value={fmtPct(growth.rev3yr, true)} color={growth.rev3yr >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))'} />
                <StatChip label="5yr CAGR" value={fmtPct(growth.rev5yr, true)} color={growth.rev5yr >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))'} />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-vs-dim font-mono text-[10px] w-14">EBITDA</span>
                <StatChip label="1yr" value={fmtPct(growth.ebitda1yr, true)} color={growth.ebitda1yr >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))'} />
                <StatChip label="3yr CAGR" value={fmtPct(growth.ebitda3yr, true)} color={growth.ebitda3yr >= 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-red))'} />
              </div>
            </div>
          </div>
        )}

        {/* Margins (LTM) */}
        {hasMargins && (
          <div className="px-4 py-3.5">
            <SectionHeader>Margins (LTM)</SectionHeader>
            <div className="flex gap-4 flex-wrap">
              {Object.entries(MARGIN_LABELS).map(([key, label]) => {
                const val = now[key];
                if (val == null) return null;
                const trend = margins[key];
                return (
                  <div key={key} className="flex flex-col">
                    <span className="text-vs-dim text-[9px] font-mono uppercase tracking-wider leading-none mb-0.5">
                      {label}
                    </span>
                    <span className="font-mono text-[13px] font-semibold text-vs-text">
                      {val.toFixed(1)}%
                      {trend && <TrendArrow direction={trend.direction} />}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Leverage (LTM) */}
        {hasLeverage && (
          <div className="px-4 py-3.5">
            <SectionHeader>Leverage (LTM)</SectionHeader>
            <div className="flex gap-4 flex-wrap">
              {now.netDebt != null && (
                <div className="flex flex-col">
                  <span className="text-vs-dim text-[9px] font-mono uppercase tracking-wider leading-none mb-0.5">
                    Net {now.netDebt < 0 ? 'Cash' : 'Debt'}
                  </span>
                  <span
                    className="font-mono text-[13px] font-semibold"
                    style={{ color: now.netDebt < 0 ? 'rgb(var(--vs-green))' : 'rgb(var(--vs-text))' }}
                  >
                    {fmtDollarM(Math.abs(now.netDebt))}
                  </span>
                </div>
              )}
              <StatChip label="ND/EBITDA" value={fmtMult(now.netDebtToEbitda)} color={
                now.netDebtToEbitda == null ? undefined :
                now.netDebtToEbitda < 0 ? 'rgb(var(--vs-green))' :
                now.netDebtToEbitda < 2 ? 'rgb(var(--vs-text))' :
                now.netDebtToEbitda < 4 ? 'rgb(var(--vs-amber))' : 'rgb(var(--vs-red))'
              } />
              <StatChip label="Int. Coverage" value={fmtMult(now.interestCoverage)} color={
                now.interestCoverage == null ? undefined :
                now.interestCoverage > 5 ? 'rgb(var(--vs-green))' :
                now.interestCoverage > 2 ? 'rgb(var(--vs-amber))' : 'rgb(var(--vs-red))'
              } />
              <StatChip label="Current Ratio" value={fmtMult(now.currentRatio)} color={
                now.currentRatio == null ? undefined :
                now.currentRatio > 2 ? 'rgb(var(--vs-green))' :
                now.currentRatio > 1 ? 'rgb(var(--vs-text))' : 'rgb(var(--vs-red))'
              } />
              {now.roic != null && (
                <StatChip label="ROIC" value={now.roic.toFixed(1) + '%'} color={
                  now.roic > 15 ? 'rgb(var(--vs-green))' :
                  now.roic > 8  ? 'rgb(var(--vs-text))' : 'rgb(var(--vs-red))'
                } />
              )}
            </div>
          </div>
        )}

        {/* Signals */}
        {hasSignals && (
          <div className="px-4 py-3.5">
            <SectionHeader>Signals</SectionHeader>
            <div className="flex gap-4 flex-wrap">
              {data.forwardPE != null && (
                <StatChip label="Fwd P/E (NTM)" value={data.forwardPE.toFixed(1) + 'x'} color="rgb(var(--vs-blue))" />
              )}
              {data.pegRatio != null && (
                <StatChip label="PEG" value={data.pegRatio.toFixed(2) + 'x'} color={
                  data.pegRatio < 1 ? 'rgb(var(--vs-green))' : data.pegRatio < 2 ? 'rgb(var(--vs-soft))' : 'rgb(var(--vs-red))'
                } />
              )}
              {data.beta != null && (
                <StatChip label="Beta" value={data.beta.toFixed(2)} color="rgb(var(--vs-soft))" />
              )}
              {data.insiderOwnershipPct != null && (
                <StatChip label="Insider Own." value={fmtPct(data.insiderOwnershipPct * 100)} color="rgb(var(--vs-soft))" />
              )}
              {data.shortInterestPct != null && (
                <StatChip label="Short Int." value={fmtPct(data.shortInterestPct)} color={data.shortInterestPct > 10 ? 'rgb(var(--vs-red))' : 'rgb(var(--vs-soft))'} />
              )}
              {data.dividendYield != null && data.dividendYield > 0 && (
                <StatChip label="Div. Yield" value={fmtPct(data.dividendYield * 100)} color="rgb(var(--vs-green))" />
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
