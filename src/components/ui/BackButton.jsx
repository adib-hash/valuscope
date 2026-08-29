import { ArrowLeft } from 'lucide-react';

export default function BackButton({ onClick, label = 'Back to overview', className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`text-vs-dim hover:text-vs-soft text-label font-mono cursor-pointer mb-2 flex items-center gap-1 transition-colors ${className}`}
    >
      <ArrowLeft size={13} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}
