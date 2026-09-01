// The sections of a call summary that are not plain bullet lists, shared by
// the single-call summary and the day digest so an exchange or a quote reads
// the same in both.

const who = (name, detail) => (detail ? `${name}, ${detail}` : name);

export function Label({ children }) {
  return (
    <p className="text-vs-dim text-micro font-mono uppercase tracking-widest mb-1.5">{children}</p>
  );
}

export function Bullets({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-vs-soft text-body leading-[1.6] max-w-[68ch]">
          <span className="text-vs-violet flex-shrink-0 mt-[1px]">&bull;</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// Question, answer, and how direct the answer was — the shape the Q&A was
// asked for: who asked, what; who answered, the substance; the read.
export function QaPairs({ items }) {
  const list = (Array.isArray(items) ? items : []).filter((q) => q?.question && q?.answer);
  if (!list.length) return null;
  return (
    <ol className="space-y-3.5">
      {list.map((q, i) => (
        <li key={i} className="max-w-[68ch] border-l-2 border-vs-violet/30 pl-3">
          <p className="text-vs-soft text-body leading-[1.6]">
            <span className="text-vs-text font-semibold">{who(q.analyst || 'Analyst', q.firm)}</span>
            {' '}asked about {q.question.replace(/^(asked about|about)\s+/i, '')}
          </p>
          <p className="text-vs-soft text-body leading-[1.6] mt-1">
            <span className="text-vs-text font-semibold">{who(q.responder || 'Management', q.responderTitle)}:</span>
            {' '}{q.answer}
          </p>
          {q.read && (
            <p className="text-vs-dim text-label font-mono italic mt-1">Read: {q.read}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Unanswered({ items }) {
  const list = (Array.isArray(items) ? items : []).filter((u) => u?.question);
  if (!list.length) return null;
  return (
    <ul className="space-y-1.5">
      {list.map((u, i) => (
        <li key={i} className="flex gap-2 text-vs-soft text-body leading-[1.6] max-w-[68ch]">
          <span className="text-vs-amber flex-shrink-0 mt-[1px]">&bull;</span>
          <span>
            <span className="text-vs-text font-semibold">{who(u.analyst || 'Analyst', u.firm)}</span>
            {' '}on {u.question.replace(/^(asked about|about|on)\s+/i, '')}
            {u.how && <span className="text-vs-dim"> &mdash; {u.how}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NotableQuotes({ items }) {
  const list = (Array.isArray(items) ? items : []).filter((q) => q?.quote);
  if (!list.length) return null;
  return (
    <ul className="space-y-2.5">
      {list.map((q, i) => (
        <li key={i} className="max-w-[68ch]">
          <blockquote className="font-display text-prose text-vs-text leading-[1.5]">
            &ldquo;{q.quote.replace(/^["“]+|["”]+$/g, '')}&rdquo;
          </blockquote>
          <p className="text-vs-dim text-micro font-mono mt-0.5">&mdash; {who(q.speaker || 'Executive', q.title)}</p>
        </li>
      ))}
    </ul>
  );
}

// Present only when there was a prior quarter to compare with; the server
// nulls it otherwise, so an absent section means "no prior call", not "nothing
// changed".
export function WhatChanged({ value }) {
  if (!value) return null;
  const rows = [
    { label: 'Guidance revisions', items: value.guidanceRevisions },
    { label: 'New this quarter', items: value.newMentions },
    { label: 'Dropped from the narrative', items: value.droppedTopics },
  ].filter((r) => Array.isArray(r.items) && r.items.length);
  if (!rows.length && !value.toneShift) return null;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <p className="text-vs-soft text-micro font-mono uppercase tracking-wider mb-1">{r.label}</p>
          <Bullets items={r.items} />
        </div>
      ))}
      {value.toneShift && (
        <p className="text-vs-soft text-body leading-[1.6] max-w-[68ch]">
          <span className="text-vs-text font-semibold">Tone.</span> {value.toneShift}
        </p>
      )}
      {value.comparedWith && (
        <p className="text-vs-dim text-micro font-mono">
          Compared with the Q{value.comparedWith.quarter} FY{value.comparedWith.year} call
        </p>
      )}
    </div>
  );
}

// The full summary body, in reading order. `compact` drops nothing — the
// digest and the single-call view show the same sections.
export function SummaryBody({ summary, KeyMetrics }) {
  if (!summary) return null;
  const s = summary;
  const block = (label, node, key) => (node ? <div key={key} className="mt-4"><Label>{label}</Label>{node}</div> : null);
  const bullets = (items) => (Array.isArray(items) && items.length ? <Bullets items={items} /> : null);
  const qa = s.qa?.length ? <QaPairs items={s.qa} /> : null;
  const unanswered = s.unanswered?.length ? <Unanswered items={s.unanswered} /> : null;
  const quotes = s.notableQuotes?.length ? <NotableQuotes items={s.notableQuotes} /> : null;
  const changed = s.whatChanged ? <WhatChanged value={s.whatChanged} /> : null;
  return (
    <>
      {s.overview && (
        <p className="text-vs-text text-prose leading-[1.65] max-w-[68ch]">{s.overview}</p>
      )}
      {KeyMetrics && <KeyMetrics items={s.keyMetrics} className="mt-4" />}
      {block('Key Takeaways', bullets(s.keyTakeaways), 'kt')}
      {block('Financial Highlights', bullets(s.financialHighlights), 'fh')}
      {block('Guidance', bullets(s.guidance), 'g')}
      {block('What Changed', changed, 'wc')}
      {block('Q&A', qa, 'qa')}
      {block("What Management Didn't Answer", unanswered, 'un')}
      {block('Notable Quotes', quotes, 'nq')}
      {block('Risks & Headwinds', bullets(s.risksMentioned), 'r')}
      {/* Summaries generated before the Q&A rework carry this instead of qa. */}
      {!qa && block('What Analysts Pressed On', bullets(s.analystFocus), 'af')}
    </>
  );
}
