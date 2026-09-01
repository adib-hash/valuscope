// The earnings call summary pipeline.
//
// Two passes, not one. A single prompt over a raw transcript is good on the
// numbers and weak on the Q&A, which is where the signal in an earnings call
// lives: who asked what, who answered, whether they actually answered. So:
//
//   1. segment   — split the transcript into prepared remarks and Q&A on the
//                  operator's cues, and the Q&A into exchanges, so that no
//                  question is ever separated from its answer.
//   2. extract   — one structured pass per transcript: speakers with titles,
//                  every exchange with its directness, every guidance figure
//                  with its prior value, verbatim quotes, the topics covered.
//   3. compose   — the prose summary, written from the extraction alone (and
//                  the prior quarter's extraction when one exists, for the
//                  "what changed" section).
//
// The extraction is stored per call, so the next quarter's "what changed"
// reads it from the store instead of re-reading the old transcript, and so
// the digest's comparison across a day stays cheap.
//
// Quotes are verified against the transcript after each pass and dropped if
// they are not in it, verbatim. The prompt says so too; the check is what
// makes it true.

// ── Segmentation ────────────────────────────────────────────────────────────

// The operator announces the Q&A; the welcome sometimes mentions that a Q&A
// will follow, so the first couple of paragraphs are skipped.
const QA_HANDOVER = [
  /may we have (the |our )?first question/i,
  /we'?ll (now |go ahead and )*take (our|the) first question/i,
  /(begin|open|start)(ing)? (the |our )?question[- ]and[- ]answer/i,
  /open (up )?the (call|floor|lines?) (for|to) questions/i,
  /first question (comes |is |today (comes|is) )?from/i,
  /(question[- ]and[- ]answer|q ?& ?a) (session|portion|period)/i,
];
const PREAMBLE = 2;

// Within the Q&A, the operator hands the line to each questioner.
const NEXT_QUESTION = [
  /(next|first|following|final|last) question (comes |is |today (comes|is) |will come )?from/i,
  /question (comes|is) from (the line of )?/i,
  /we'?ll (now )?(take|go to|move to|hear from) (our|the) (next|first|final|last) question/i,
  /your line is (now )?open/i,
  /please (go ahead|proceed)( with your question)?/i,
  /from the line of/i,
];

// And closes it. Everything after this line is sign-off, not an exchange.
const QA_CLOSE = [
  /(this|that) (concludes|ends|will conclude|will end)( today'?s| the| our)? (question[- ]and[- ]answer|q ?& ?a)/i,
  /(no|there are no) (further|more) questions/i,
  /turn (the|this) (call|conference) (back )?(over )?to .* for (any )?closing remarks/i,
  /(end|conclusion) of (the|our|today'?s) (question[- ]and[- ]answer|q ?& ?a)/i,
];

const isOperator = (p) => /operator|moderator/i.test(p.speaker || '');

export function segmentTranscript(paragraphs) {
  const items = (paragraphs || []).filter((p) => p && p.content);
  let boundary = -1;
  for (let i = PREAMBLE; i < items.length; i++) {
    if (QA_HANDOVER.some((re) => re.test(items[i].content))) { boundary = i; break; }
  }
  // No announcement, but the operator is handing out questions: the first
  // hand-off is the boundary.
  if (boundary < 0) {
    for (let i = PREAMBLE; i < items.length; i++) {
      if (isOperator(items[i]) && NEXT_QUESTION.some((re) => re.test(items[i].content))) { boundary = i; break; }
    }
  }
  if (boundary < 0) {
    return { prepared: items, qa: [], exchanges: [], boundaryFound: false };
  }

  const prepared = items.slice(0, boundary);
  const qa = items.slice(boundary);

  // An exchange begins at an operator cue and runs to the next one. The
  // handover paragraph itself usually names the first questioner, so it opens
  // the first exchange rather than being thrown away.
  const exchanges = [];
  let current = null;
  for (const p of qa) {
    if (isOperator(p) && QA_CLOSE.some((re) => re.test(p.content))) break;
    const cue = isOperator(p) && NEXT_QUESTION.some((re) => re.test(p.content));
    if (cue || !current) {
      if (current?.paragraphs.some((x) => !isOperator(x))) exchanges.push(current);
      current = { paragraphs: [] };
    }
    current.paragraphs.push(p);
  }
  if (current?.paragraphs.some((x) => !isOperator(x))) exchanges.push(current);

  // A closing exchange that is only the CEO's sign-off is not an exchange.
  const trimmed = exchanges.filter((e, i) => {
    if (i < exchanges.length - 1) return true;
    const speakers = new Set(e.paragraphs.filter((x) => !isOperator(x)).map((x) => x.speaker));
    return speakers.size > 1 || exchanges.length === 1;
  });

  return { prepared, qa, exchanges: trimmed.length ? trimmed : exchanges, boundaryFound: true };
}

const renderParagraphs = (list) => list.map((p) => `${p.speaker || 'Unknown'}: ${p.content}`).join('\n\n');

// The extraction prompt's input: labelled parts, numbered exchanges.
export function renderSegmented(seg, { exchangeOffset = 0 } = {}) {
  const prepared = seg.prepared.length
    ? `<prepared_remarks>\n${renderParagraphs(seg.prepared)}\n</prepared_remarks>\n\n`
    : '';
  const qa = seg.exchanges.length
    ? `<qa>\n${seg.exchanges.map((e, i) => `<exchange n="${exchangeOffset + i + 1}">\n${renderParagraphs(e.paragraphs)}\n</exchange>`).join('\n\n')}\n</qa>`
    : seg.qa.length ? `<qa>\n${renderParagraphs(seg.qa)}\n</qa>` : '';
  return prepared + qa;
}

// ── Chunking ────────────────────────────────────────────────────────────────
//
// Gemini's window is far larger than any earnings call, so this almost never
// runs. When it does, the Q&A is split by exchange, never by size, so a
// question is never separated from its answer. Prepared remarks that alone
// exceed the budget are cut at a paragraph boundary.

export const EXTRACTION_CHAR_BUDGET = 400_000;

export function chunkForExtraction(seg, budget = EXTRACTION_CHAR_BUDGET) {
  const whole = renderSegmented(seg);
  if (whole.length <= budget) return [{ text: whole, exchangeOffset: 0, part: 1, of: 1 }];

  const chunks = [];
  // Prepared remarks first, on their own if need be.
  let prepared = seg.prepared;
  let preparedText = renderParagraphs(prepared);
  while (preparedText.length > budget && prepared.length > 1) {
    prepared = prepared.slice(0, -1);
    preparedText = renderParagraphs(prepared);
  }
  let currentExchanges = [];
  let currentPrepared = prepared;
  let offset = 0;
  const flush = () => {
    if (!currentPrepared.length && !currentExchanges.length) return;
    chunks.push({
      text: renderSegmented({ prepared: currentPrepared, qa: [], exchanges: currentExchanges }, { exchangeOffset: offset }),
      exchangeOffset: offset,
    });
    offset += currentExchanges.length;
    currentPrepared = [];
    currentExchanges = [];
  };
  for (const e of seg.exchanges) {
    const trial = renderSegmented({ prepared: currentPrepared, qa: [], exchanges: [...currentExchanges, e] });
    if (trial.length > budget && (currentPrepared.length || currentExchanges.length)) flush();
    currentExchanges.push(e);
  }
  flush();
  return chunks.map((c, i) => ({ ...c, part: i + 1, of: chunks.length }));
}

// ── Pass 1: extraction ──────────────────────────────────────────────────────

export const EXTRACTION_SYSTEM = `You extract structured facts from an earnings call transcript for an investor's own research notes. You are the first of two passes: a second pass writes the summary from your output alone, so anything you leave out is lost and anything you invent will be repeated as fact.

The transcript arrives in two labelled parts, <prepared_remarks> and <qa>, with each Q&A exchange numbered.

Rules:
- Use only the transcript. Never add outside knowledge.
- speakers: every named speaker. Give the title the transcript states or the host's introduction implies (the opening usually names the executives and their roles), and the firm for analysts (the operator usually names it). role is executive, analyst, operator or other.
- exchanges: one entry per numbered exchange, in order, with its number. question is the substance of what the analyst asked in one or two sentences; when they asked two things, keep both. answer is the substance of the reply, keeping every number, range, percentage, date and timing commitment exactly as given. responder is the executive who actually answered; an executive who added to the answer goes in alsoAnswered. directness is direct when the question was answered as asked; partial when only part was addressed, or the answer was general where the question was specific; deflected when the reply moved to a different subject; declined when they said they do not disclose, do not break that out, or would not comment. newInformation is true only when the answer contained something not already in prepared remarks. pushback is true when the executive disagreed with the analyst's premise.
- guidance: every forward-looking figure or range management gave, with the period it covers, the prior value when the transcript states one (a raise or a cut usually names both), the speaker, and whether it came from prepared remarks or Q&A.
- metrics: the headline numbers reported for the quarter — revenue, growth, margins, EPS, segment figures, operating counts — each with the comparison management gave.
- quotes: eight to twelve short verbatim passages spoken by executives, each under 25 words, copied exactly: punctuation, contractions, hesitations and all. Prefer lines that carry tone, conviction or hedging over lines that carry numbers. Never paraphrase, never trim mid-sentence, never clean up wording. A quote that is not exactly in the transcript will be discarded.
- topics: the eight to twelve subjects the call spent the most time on, as short labels, so the next quarter's call can be compared with this one.
- newMentions: the products, segments, customers, markets, partners and programmes named on the call, as short labels, so the next quarter can tell which are new.`;

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    speakers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          firm: { type: 'string' },
          role: { type: 'string', enum: ['executive', 'analyst', 'operator', 'other'] },
        },
        required: ['name', 'role'],
      },
    },
    exchanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          analyst: { type: 'string' },
          firm: { type: 'string' },
          question: { type: 'string' },
          responder: { type: 'string' },
          responderTitle: { type: 'string' },
          alsoAnswered: { type: 'array', items: { type: 'string' } },
          answer: { type: 'string' },
          directness: { type: 'string', enum: ['direct', 'partial', 'deflected', 'declined'] },
          newInformation: { type: 'boolean' },
          pushback: { type: 'boolean' },
        },
        required: ['n', 'analyst', 'question', 'responder', 'answer', 'directness', 'newInformation', 'pushback'],
      },
    },
    guidance: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          current: { type: 'string' },
          prior: { type: 'string' },
          period: { type: 'string' },
          speaker: { type: 'string' },
          source: { type: 'string', enum: ['prepared', 'qa'] },
        },
        required: ['item', 'current', 'period', 'source'],
      },
    },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string' },
          value: { type: 'string' },
          comparison: { type: 'string' },
        },
        required: ['metric', 'value'],
      },
    },
    quotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string' },
          title: { type: 'string' },
          quote: { type: 'string' },
          context: { type: 'string' },
        },
        required: ['speaker', 'quote'],
      },
    },
    topics: { type: 'array', items: { type: 'string' } },
    newMentions: { type: 'array', items: { type: 'string' } },
  },
  required: ['speakers', 'exchanges', 'guidance', 'metrics', 'quotes', 'topics', 'newMentions'],
};

// ── Quote verification ──────────────────────────────────────────────────────

// Curly quotes, dashes, whitespace and case are not what "verbatim" is about.
const fold = (s) => String(s || '')
  .toLowerCase()
  .replace(/[‘’‚‛]/g, "'")
  .replace(/[“”„‟]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/…/g, '...')
  .replace(/[^a-z0-9$%.,'"-]+/g, ' ')
  .trim();

const strip = (s) => fold(s).replace(/^["'\s]+|["'\s.,]+$/g, '');

const MAX_QUOTE_WORDS = 30; // the prompt says 25; the check leaves a little slack

export function verifyQuotes(quotes, paragraphs) {
  const haystack = fold((paragraphs || []).map((p) => p.content).join(' '));
  const seen = new Set();
  const out = [];
  for (const q of Array.isArray(quotes) ? quotes : []) {
    const needle = strip(q?.quote);
    if (!needle || needle.split(' ').length > MAX_QUOTE_WORDS) continue;
    if (!haystack.includes(needle) || seen.has(needle)) continue;
    seen.add(needle);
    out.push(q);
  }
  return out;
}

// ── Pass 2: composition ─────────────────────────────────────────────────────

export const SUMMARY_SYSTEM = `You write earnings call summaries for an investor's own research notes, from a structured extraction of the call and, when one is supplied, the extraction of the prior quarter's call. You never see the transcript, so use only what the extractions contain.

Rules:
- Ground every statement in the extraction. Never add outside knowledge and never speculate.
- Never give investment advice, a price view, a view on how the stock will react, or any recommendation to buy, sell or hold.
- Attribute statements to the person who made them, by name and title — "Jeff Clarke, COO" — never as "management said". Forward-looking statements are attributed ("Yvonne McGill, CFO, expects…"), not asserted.
- Every quantitative claim carries its number. When the extraction gives a figure, "strong growth" or "meaningful improvement" is wrong; "revenue up 19% to $23.4B" is right.
- No filler adjectives (robust, exciting, unprecedented, tremendous, incredible) unless inside a verbatim quote.
- One tight sentence per bullet. The whole summary must stay under roughly 900 words: it is read on a phone.

Sections:
- overview: two or three sentences on the quarter.
- keyTakeaways, financialHighlights, guidance, risksMentioned: the facts, the numbers, the forward figures (old and new when a figure changed), the risks and headwinds named. Three to five bullets each.
- keyMetrics: up to eight headline numbers as label, value and the comparison given.
- qa: four to six exchanges, chosen for signal — answers that gave information not in prepared remarks, disagreed with the analyst's premise, or visibly avoided the question. Skip questions whose answer only restated the prepared remarks. For each: who asked (name and firm), what they asked, who answered (name and title), the substance of the answer with every number, range and timing commitment, and read — one short line on how direct the answer was: answered directly, answered partially, deflected, or declined to quantify.
- unanswered: two to four questions that were deflected, answered with generalities, or explicitly declined ("we don't break that out"), each with who asked, what they asked, and how it was avoided. Draw from exchanges marked partial, deflected or declined. Leave the list empty only if every question was answered directly.
- notableQuotes: three to five of the supplied quotes, verbatim and attributed by name and title, favouring tone, conviction or hedging. Copy each exactly; a changed word means the quote is discarded.
- whatChanged: only when a prior-quarter extraction is supplied, and only by comparing the two extractions. guidanceRevisions: each figure that moved, old number to new number. newMentions: products, segments, customers or markets in this call's list but not the prior's. droppedTopics: topics the prior call spent time on that this one did not mention. toneShift: one or two sentences on how the language changed, or an empty string if it did not. With no prior extraction, leave every whatChanged field empty.`;

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    keyTakeaways: { type: 'array', items: { type: 'string' } },
    financialHighlights: { type: 'array', items: { type: 'string' } },
    keyMetrics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string' },
          value: { type: 'string' },
          comparison: { type: 'string' },
        },
        required: ['metric', 'value'],
      },
    },
    guidance: { type: 'array', items: { type: 'string' } },
    qa: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          analyst: { type: 'string' },
          firm: { type: 'string' },
          question: { type: 'string' },
          responder: { type: 'string' },
          responderTitle: { type: 'string' },
          answer: { type: 'string' },
          read: { type: 'string' },
        },
        required: ['analyst', 'question', 'responder', 'answer', 'read'],
      },
    },
    unanswered: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          analyst: { type: 'string' },
          firm: { type: 'string' },
          question: { type: 'string' },
          how: { type: 'string' },
        },
        required: ['analyst', 'question', 'how'],
      },
    },
    notableQuotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string' },
          title: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['speaker', 'quote'],
      },
    },
    whatChanged: {
      type: 'object',
      properties: {
        guidanceRevisions: { type: 'array', items: { type: 'string' } },
        newMentions: { type: 'array', items: { type: 'string' } },
        droppedTopics: { type: 'array', items: { type: 'string' } },
        toneShift: { type: 'string' },
      },
      required: ['guidanceRevisions', 'newMentions', 'droppedTopics', 'toneShift'],
    },
    risksMentioned: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'overview', 'keyTakeaways', 'financialHighlights', 'keyMetrics', 'guidance',
    'qa', 'unanswered', 'notableQuotes', 'whatChanged', 'risksMentioned',
  ],
};

// ── The pipeline ────────────────────────────────────────────────────────────

const label = (t) => `${t.symbol} fiscal Q${t.quarter} ${t.year}`;

function mergeExtractions(parts) {
  const out = { speakers: [], exchanges: [], guidance: [], metrics: [], quotes: [], topics: [], newMentions: [] };
  const seenSpeakers = new Set();
  for (const p of parts) {
    for (const s of p.speakers || []) {
      const k = (s.name || '').toLowerCase();
      if (!k || seenSpeakers.has(k)) continue;
      seenSpeakers.add(k);
      out.speakers.push(s);
    }
    out.exchanges.push(...(p.exchanges || []));
    out.guidance.push(...(p.guidance || []));
    out.metrics.push(...(p.metrics || []));
    out.quotes.push(...(p.quotes || []));
    out.topics.push(...(p.topics || []));
    out.newMentions.push(...(p.newMentions || []));
  }
  out.exchanges.sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  out.topics = [...new Set(out.topics)];
  out.newMentions = [...new Set(out.newMentions)];
  return out;
}

/**
 * Pass 1. `gemini(system, user, schema, temperature)` returns parsed JSON.
 */
export async function extractCall(gemini, transcript) {
  const seg = segmentTranscript(transcript.paragraphs);
  const chunks = chunkForExtraction(seg);
  const parts = [];
  for (const chunk of chunks) {
    const partNote = chunk.of > 1
      ? ` This is part ${chunk.part} of ${chunk.of}; exchange numbers continue from the previous part.`
      : '';
    const result = await gemini(
      EXTRACTION_SYSTEM,
      `Extract the ${label(transcript)} earnings call.${partNote}\n\n${chunk.text}`,
      EXTRACTION_SCHEMA,
      0.1,
    );
    parts.push(result);
  }
  const merged = parts.length === 1 ? parts[0] : mergeExtractions(parts);
  merged.quotes = verifyQuotes(merged.quotes, transcript.paragraphs);
  return {
    ...merged,
    segmentation: {
      boundaryFound: seg.boundaryFound,
      preparedParagraphs: seg.prepared.length,
      qaParagraphs: seg.qa.length,
      exchanges: seg.exchanges.length,
      chunks: chunks.length,
    },
  };
}

// What the composition pass sees of an extraction: the structured facts, not
// the bookkeeping.
const forPrompt = ({ segmentation, ...rest }) => rest;

/**
 * Pass 2. `prior` is the previous quarter's extraction, or null.
 */
export async function composeSummary(gemini, transcript, extraction, prior) {
  const priorBlock = prior
    ? `\n\n<prior_quarter label="${label(prior.transcript)}">\n${JSON.stringify(forPrompt(prior.extraction))}\n</prior_quarter>`
    : '';
  const summary = await gemini(
    SUMMARY_SYSTEM,
    `Write the summary of the ${label(transcript)} earnings call from this extraction.${prior ? ' The prior quarter\'s extraction follows it.' : ' No prior quarter is available, so leave whatChanged empty.'}\n\n`
      + `<extraction>\n${JSON.stringify(forPrompt(extraction))}\n</extraction>${priorBlock}`,
    SUMMARY_SCHEMA,
    0.2,
  );

  // The model was told to copy quotes exactly; this is what makes that true.
  summary.notableQuotes = verifyQuotes(summary.notableQuotes, transcript.paragraphs).slice(0, 5);

  // The section exists only when there was a prior call to compare with.
  if (!prior) {
    summary.whatChanged = null;
  } else {
    const w = summary.whatChanged || {};
    const empty = !(w.guidanceRevisions?.length || w.newMentions?.length || w.droppedTopics?.length || w.toneShift);
    summary.whatChanged = empty ? null : { ...w, comparedWith: { year: prior.transcript.year, quarter: prior.transcript.quarter } };
  }
  return summary;
}

// Rough, for the log line: the prompt asks for under ~900 words.
export function wordCount(summary) {
  const text = JSON.stringify(summary).replace(/[{}[\]":,]/g, ' ');
  return text.split(/\s+/).filter(Boolean).length;
}
