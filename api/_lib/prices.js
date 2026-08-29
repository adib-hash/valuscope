// Month-end close lookup for pricing fiscal year ends.
//
// Yahoo's monthly bars are timestamped at the *start* of the month while their
// close is the *last* trading day of it. Matching a fiscal year end against the
// raw bar dates therefore picks the following month's bar — a Jan 31 year end
// sits one day from the Feb 1 bar and thirty from the Jan 1 bar — and every
// historical multiple ends up priced a month after the year it describes. In a
// quiet month that is a few percent; NVIDIA's January 2023 year end came out
// 19% high. So each bar is first mapped to the date its close actually
// printed, and only then matched by distance.
//
// `close` is preferred over `adjclose`: adjclose also backs out dividends,
// which is right for total-return math but wrong for a point-in-time market
// cap — it would deflate every pre-dividend year of a payer like Coca-Cola.
export function monthEndCloseNear(quotes, targetDate, maxDays = 60) {
  if (!targetDate) return null;
  const target = new Date(targetDate).getTime();
  if (!isFinite(target)) return null;

  let best = null;
  let bestDiff = Infinity;
  for (const q of quotes || []) {
    const close = q.close ?? q.adjclose;
    if (close == null || !isFinite(close) || close <= 0 || !q.date) continue;
    const d = q.date instanceof Date ? q.date : new Date(q.date);
    if (isNaN(d)) continue;
    // A bar dated in the first days of a month spans that whole month, so its
    // close printed at month end. The trailing partial bar is dated at its own
    // last session and needs no shift.
    const closeTime = d.getUTCDate() <= 3
      ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
      : d.getTime();
    const diff = Math.abs(closeTime - target);
    if (diff < bestDiff) { bestDiff = diff; best = close; }
  }
  return bestDiff <= maxDays * 86400000 ? best : null;
}
