// One error banner. Never fail silently, and never fail in three different
// shades of the same banner either.
export default function ErrorBanner({ children, className = '' }) {
  return (
    <div className={`text-vs-red font-mono text-body px-4 py-3 bg-vs-red/5 rounded-lg border border-vs-red/20 ${className}`}>
      {children}
    </div>
  );
}
