import { Download } from 'lucide-react';
import { downloadCsv } from '../../lib/csv';

// Builds the rows only when clicked, so a page with an export button pays
// nothing for it until it is used.
export default function ExportButton({ filename, getRows, disabled = false, label = 'CSV', title, className = '' }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        downloadCsv(filename, getRows());
      }}
      title={title || 'Download as CSV'}
      aria-label={title || 'Download as CSV'}
      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-label font-mono font-semibold border border-vs-border text-vs-dim hover:border-vs-borderLight hover:text-vs-soft cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      <Download size={12} strokeWidth={2.5} aria-hidden="true" /> {label}
    </button>
  );
}
