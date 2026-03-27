import { useState, useEffect, useRef, useCallback } from 'react';

function relativeTime(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

const STORAGE_KEY = (sym) => `vs-thesis-${sym}`;

export default function Thesis({ sym }) {
  const [open,     setOpen]     = useState(false);
  const [text,     setText]     = useState('');
  const [savedAt,  setSavedAt]  = useState(null);
  const [showSaved,setShowSaved]= useState(false);
  const timerRef   = useRef(null);
  const savedFlash = useRef(null);

  // Load from localStorage when sym changes
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY(sym));
    if (raw) {
      try {
        const { text: t, updatedAt } = JSON.parse(raw);
        setText(t || '');
        setSavedAt(updatedAt || null);
        setOpen(true);
      } catch {
        setText('');
        setSavedAt(null);
        setOpen(false);
      }
    } else {
      setText('');
      setSavedAt(null);
      setOpen(false);
    }
  }, [sym]);

  // Debounced save
  const save = useCallback((value) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const now = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY(sym), JSON.stringify({ text: value, updatedAt: now }));
      setSavedAt(now);
      setShowSaved(true);
      clearTimeout(savedFlash.current);
      savedFlash.current = setTimeout(() => setShowSaved(false), 1800);
    }, 500);
  }, [sym]);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    save(val);
  };

  // Auto-resize textarea
  const taRef = useRef(null);
  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      taRef.current.style.height = taRef.current.scrollHeight + 'px';
    }
  }, [text, open]);

  if (!open) {
    return (
      <div className="mt-4">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-vs-dim text-[11px] font-mono hover:text-vs-soft transition-colors cursor-pointer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add investment thesis
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-vs-border bg-vs-card">
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <div className="flex items-center gap-2">
          <p className="text-vs-dim text-[9px] font-mono uppercase tracking-widest">
            My Thesis
          </p>
          {savedAt && (
            <span className="text-vs-dim text-[9px] font-mono">
              &middot; {relativeTime(savedAt)}
            </span>
          )}
          {showSaved && (
            <span className="text-[9px] font-mono" style={{ color: '#38D89A' }}>
              Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {text.length > 0 && (
            <span className="text-vs-dim text-[9px] font-mono">
              {text.length} chars
            </span>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Collapse thesis"
            className="text-vs-dim hover:text-vs-soft transition-colors cursor-pointer"
          >
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 5l4-4 4 4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-4 pb-4">
        <textarea
          ref={taRef}
          value={text}
          onChange={handleChange}
          placeholder="Why are you watching this? What would change your thesis?"
          className="w-full bg-transparent text-vs-text text-[13px] leading-relaxed resize-none outline-none placeholder:text-vs-dim border-0 min-h-[80px]"
          style={{ fontSize: '16px' }}
        />
      </div>
    </div>
  );
}
