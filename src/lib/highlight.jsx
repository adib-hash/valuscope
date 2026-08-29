// Shared search-highlighting, used by the transcript page and the filing
// reader. Splits on the query, wraps matches in <mark>.
export default function Highlighted({ text, query }) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(text).split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-vs-amber/30 text-vs-text rounded-md px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  );
}

// Occurrence count across a set of strings — for "N matches" labels.
export function countMatches(texts, query) {
  if (!query) return 0;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'ig');
  let n = 0;
  for (const t of texts) n += (String(t).match(re) || []).length;
  return n;
}
