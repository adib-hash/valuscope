import { useRef, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { askDocument } from '../lib/api';

// Gemini answers arrive with light markdown. Render **bold** inline instead
// of showing literal asterisks; everything else stays plain text.
const renderAnswer = (text) =>
  String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold text-vs-text">{part.slice(2, -2)}</strong>
      : part
  );

// Ask-this-document. Stateless server, history lives here and resets with the
// document. Deliberately small: a question box and a transcript, nothing more.
export default function DocChat({ cik, accession, doc }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState([]); // { role: 'user'|'ai', text, note? }
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    setBusy(true);
    setTurns((t) => [...t, { role: 'user', text: q }]);
    try {
      const res = await askDocument({
        cik, accession, doc,
        question: q,
        history: turns.slice(-10),
      });
      setTurns((t) => [...t, { role: 'ai', text: res.answer, note: res.contextNote }]);
    } catch (e) {
      setTurns((t) => [...t, { role: 'ai', text: e.message || 'Failed to answer.', error: true }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="mt-2 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-label font-mono font-semibold border border-vs-violet/40 bg-vs-violet/10 text-vs-violet hover:bg-vs-violet/20 cursor-pointer transition-colors"
      >
        <MessageCircleQuestion size={13} strokeWidth={2} aria-hidden="true" />
        Ask this document
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-vs-violet/25 bg-vs-violet/[0.04] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-vs-violet/20">
        <span className="flex items-center gap-2 text-vs-violet text-label font-mono font-bold uppercase tracking-widest">
          <MessageCircleQuestion size={13} strokeWidth={2} aria-hidden="true" />
          Ask This Document
        </span>
        <button
          onClick={() => setOpen(false)}
          className="text-vs-dim hover:text-vs-soft text-micro font-mono cursor-pointer"
        >
          Hide
        </button>
      </div>

      {turns.length > 0 && (
        <div className="px-4 py-3 space-y-3 max-h-[50vh] overflow-y-auto">
          {turns.map((t, i) => (
            <div key={i}>
              <p className={`text-body leading-[1.6] max-w-[68ch] ${
                t.role === 'user'
                  ? 'text-vs-text font-medium'
                  : t.error ? 'text-vs-red' : 'text-vs-soft whitespace-pre-wrap'
              }`}>
                {t.role === 'user' ? `› ${t.text}` : t.error ? t.text : renderAnswer(t.text)}
              </p>
              {t.note && <p className="text-vs-dim text-micro font-mono mt-1">{t.note}</p>}
            </div>
          ))}
          {busy && <p className="text-vs-soft text-label font-mono animate-pulse">Reading&hellip;</p>}
        </div>
      )}

      <div className="px-4 py-3 border-t border-vs-violet/15 flex gap-2">
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="What does this filing say about…"
          aria-label="Ask a question about this document"
          className="flex-1 bg-vs-card border border-vs-border rounded-lg px-3.5 py-2 text-vs-text placeholder:text-vs-dim focus:outline-none focus:border-vs-violet transition-colors min-w-0"
        />
        <button
          onClick={ask}
          disabled={busy || !question.trim()}
          className={`rounded-lg px-4 py-2 text-label font-bold font-mono transition-all flex-shrink-0 ${
            busy || !question.trim()
              ? 'bg-vs-card text-vs-dim border border-vs-border cursor-not-allowed'
              : 'bg-vs-violet text-vs-bg cursor-pointer hover:brightness-110'
          }`}
        >
          Ask
        </button>
      </div>

      <p className="px-4 pb-3 text-vs-dim text-micro font-mono">
        Answers only from this filing · AI-generated · not financial advice
      </p>
    </div>
  );
}
