// Merges the SEC EDGAR deep-history series into the Yahoo-backed year list.
//
// Yahoo returns roughly four years of annual statements; EDGAR reaches back
// fifteen. Where both cover a year, Yahoo wins: its figures are normalised, and
// the two agree within a few percent, so nothing visibly steps at the seam.
// EDGAR only fills the years Yahoo never had.

const isNowRow = (y) => !!y?.fiscalYear?.startsWith('Now');

export function mergeHistory(yahooYears = [], edgarYears = []) {
  if (!edgarYears.length) return yahooYears;

  const historical = yahooYears.filter((y) => !isNowRow(y));
  const nowRow     = yahooYears.find(isNowRow);

  const covered = new Set(historical.map((y) => y.fiscalYear));
  const extra   = edgarYears.filter((y) => !covered.has(y.fiscalYear));
  if (!extra.length) return yahooYears;

  const merged = [...extra, ...historical].sort(
    (a, b) => new Date(a.endDate || 0) - new Date(b.endDate || 0)
  );

  // Year-over-year growth is positional, so it has to be recomputed once the
  // earlier years are in place — the oldest Yahoo year previously had nothing
  // to compare against and reported null.
  for (let i = 0; i < merged.length; i++) {
    const prev = i > 0 ? merged[i - 1] : null;
    merged[i] = {
      ...merged[i],
      revenueGrowth: prev?.revenue > 0 && merged[i].revenue != null
        ? ((merged[i].revenue - prev.revenue) / prev.revenue) * 100
        : null,
    };
  }

  return nowRow ? [...merged, nowRow] : merged;
}
