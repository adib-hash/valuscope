import { useState } from 'react';

const TABLE_ROWS = [
  { section: 'PRICE MULTIPLES' },
  { key: 'pe',   label: 'P/E' },
  { key: 'ps',   label: 'P/S' },
  { key: 'pb',   label: 'P/B' },
  { key: 'pGP',  label: 'P/Gross Profit' },
  { key: 'pfcf', label: 'P/FCF' },
  { key: 'pocf', label: 'P/OCF' },
  { section: 'EV MULTIPLES' },
  { key: 'evSales',  label: 'EV/Sales' },
  { key: 'evGP',     label: 'EV/Gross Profit' },
  { key: 'evEbitda', label: 'EV/EBITDA' },
  { key: 'evEbit',   label: 'EV/EBIT' },
  { key: 'evOcf',    label: 'EV/OCF' },
  { key: 'evFcf',    label: 'EV/FCF' },
  { section: 'YIELD METRICS' },
  { key: 'earningsYield', label: 'Earnings Yield', yld: true },
  { key: 'fcfYield',      label: 'FCF Yield',      yld: true },
  { key: 'buybackYield',  label: 'Buyback Yield',  yld: true },
  { section: 'FUNDAMENTALS ($M)' },
  { key: 'mktCap',     label: 'Market Cap',      raw: true },
  { key: 'ev',         label: 'Enterprise Value', raw: true },
  { key: 'revenue',    label: 'Revenue',          raw: true },
  { key: 'grossProfit',label: 'Gross Profit',     raw: true },
  { key: 'ebitda',     label: 'EBITDA',           raw: true },
  { key: 'ebit',       label: 'EBIT',             raw: true },
  { key: 'netIncome',  label: 'Net Income',       raw: true },
  { key: 'ocf',        label: 'Oper. Cash Flow',  raw: true },
  { key: 'fcf',        label: 'Free Cash Flow',   raw: true },
];

function fmt(v, row) {
  if (v == null || !isFinite(v)) return '\u2014';
  if (row.raw) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (row.yld) return v.toFixed(1) + '%';
  return v < 10 ? v.toFixed(2) + 'x' : v.toFixed(1) + 'x';
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="10"
      height="6"
      viewBox="0 0 10 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block ml-1.5 transition-transform"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
      aria-hidden="true"
    >
      <path d="M1 1l4 4 4-4" />
    </svg>
  );
}

export default function DataTable({ years, averages }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="mt-4 w-full bg-vs-card text-vs-soft border border-vs-border rounded-lg py-2.5 text-xs font-semibold font-mono cursor-pointer text-center hover:bg-vs-card2 transition-colors flex items-center justify-center"
      >
        {open ? 'Hide' : 'Show'} Full Data Table
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="overflow-x-auto mt-2 rounded-lg border border-vs-border">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="border-b-2 border-vs-border">
                <th className="text-left px-2.5 py-2 text-vs-dim font-medium sticky left-0 bg-vs-bg min-w-[120px]">
                  Metric
                </th>
                {years.map((d) => (
                  <th
                    key={d.fiscalYear}
                    className={`text-right px-2.5 py-2 min-w-[80px] ${
                      d.fiscalYear?.startsWith('Now')
                        ? 'text-vs-blue font-bold'
                        : 'text-vs-soft font-medium'
                    }`}
                  >
                    {d.fiscalYear}
                  </th>
                ))}
                <th className="text-right px-2.5 py-2 text-vs-amber font-semibold min-w-[70px]">
                  Avg
                </th>
              </tr>
            </thead>
            <tbody>
              {TABLE_ROWS.map((row) => {
                if (row.section) {
                  return (
                    <tr key={row.section}>
                      <td
                        colSpan={years.length + 2}
                        className="px-2.5 pt-3 pb-1 text-vs-blue font-bold text-[9px] tracking-widest border-b border-vs-border"
                      >
                        {row.section}
                      </td>
                    </tr>
                  );
                }
                const avg = averages[row.key];
                return (
                  <tr key={row.key} className="border-b border-vs-border/10">
                    <td className="px-2.5 py-1 text-vs-soft sticky left-0 bg-vs-bg">
                      {row.label}
                    </td>
                    {years.map((d) => {
                      const isNow = d.fiscalYear?.startsWith('Now');
                      return (
                        <td
                          key={d.fiscalYear}
                          className={`px-2.5 py-1 text-right ${
                            isNow
                              ? 'text-vs-text font-bold bg-vs-blue/[0.03]'
                              : 'text-vs-soft'
                          }`}
                        >
                          {fmt(d[row.key], row)}
                        </td>
                      );
                    })}
                    <td className="px-2.5 py-1 text-right text-vs-amber font-medium">
                      {!row.raw && avg != null ? fmt(avg, row) : '\u2014'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
