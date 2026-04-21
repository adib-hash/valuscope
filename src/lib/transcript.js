// Pure helpers for earnings-transcript display. No React imports — safe to unit test.

// Matches "Tim Cook:", "Luca Maestri:", "Operator:", "Analyst:" at the start of a line.
// Requires either an explicit Operator/Analyst label OR ≥2 capitalized words to avoid
// matching section prefixes like "Revenue:" or "Q2:".
const SPEAKER_RE = /^((?:Operator|Analyst|Moderator)|[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+)+):\s/;

export function splitSpeakers(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const lines = raw.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(SPEAKER_RE);
    if (match) {
      if (current) blocks.push(current);
      const rest = line.slice(match[0].length);
      current = { speaker: match[1], text: rest };
    } else if (current) {
      current.text += (current.text ? '\n' : '') + line;
    } else {
      // No speaker matched yet — start an unlabelled block so we keep any prologue text.
      current = { speaker: null, text: line };
    }
  }
  if (current) blocks.push(current);

  // Trim whitespace & drop fully empty blocks.
  return blocks
    .map((b) => ({ speaker: b.speaker, text: b.text.trim() }))
    .filter((b) => b.text.length > 0);
}

// Guidance-style phrases worth surfacing in a management call. Order doesn't
// matter — they're combined into one alternation at highlight time.
export const GUIDANCE_PATTERNS = [
  /we expect/gi,
  /we anticipate/gi,
  /we forecast/gi,
  /we project/gi,
  /full[- ]year guidance/gi,
  /raising our (?:outlook|guidance)/gi,
  /lowering our (?:outlook|guidance)/gi,
  /reiterat(?:e|ing) (?:our )?guidance/gi,
  /headwind/gi,
  /tailwind/gi,
  /next quarter/gi,
  /fiscal year/gi,
  /margin expansion/gi,
  /operating leverage/gi,
  /free cash flow/gi,
  /guidance/gi,
];

// Return a token array so the component can render <mark> without dangerouslySetInnerHTML.
export function highlightGuidance(text) {
  if (!text) return [];
  const sources = GUIDANCE_PATTERNS.map((r) => r.source).join('|');
  const combined = new RegExp(`(${sources})`, 'gi');

  const tokens = [];
  let last = 0;
  let m;
  while ((m = combined.exec(text)) !== null) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), match: false });
    tokens.push({ text: m[0], match: true });
    last = m.index + m[0].length;
    // Guard against zero-width matches (shouldn't happen but just in case).
    if (m[0].length === 0) combined.lastIndex++;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), match: false });
  return tokens;
}

// Returns the most recently *completed* fiscal-ish quarter (calendar). Wraps Q0 to
// prior-year Q4. Used as the default selection when entering the earnings view.
export function defaultQuarterFor(date = new Date()) {
  const month = date.getMonth(); // 0–11
  const currentQuarter = Math.floor(month / 3) + 1;
  const year = date.getFullYear();
  if (currentQuarter === 1) return { year: year - 1, quarter: 4 };
  return { year, quarter: currentQuarter - 1 };
}

// Walk one quarter back from an arbitrary (year, quarter). Used by the auto-fallback.
export function priorQuarter({ year, quarter }) {
  if (quarter === 1) return { year: year - 1, quarter: 4 };
  return { year, quarter: quarter - 1 };
}

// Format the transcript-date string from API Ninjas ("YYYY-MM-DD") for display.
export function formatTranscriptDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
