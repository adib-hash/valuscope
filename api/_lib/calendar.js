// Earnings calendar assembly: pure functions, no network, so the merge rules
// can be tested without Yahoo or the transcript dataset on the line.
//
// Two sources describe the same events from different ends. Yahoo's batch
// quote carries each company's next (or, right after a report, most recent)
// earnings date — good for what is coming, thin on what has passed. The
// transcript dataset carries a report date for every call it holds — the
// ground truth for "is there a transcript to digest", silent about the
// future. The calendar is the union, and where both describe one call the
// transcript's date wins, because that is the date the digest is filed under.

// Yahoo stamps earnings in UTC seconds; the calendar lives in New York.
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const ET_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
});

export function etDate(unixSeconds) {
  if (!unixSeconds) return null;
  const d = new Date(unixSeconds * 1000);
  return isNaN(d) ? null : ET_DATE.format(d);
}

// Before the open, after the close, or unknown. Yahoo's timestamps are only
// as good as the company's own announcement, so a call that lands inside
// market hours is far more likely to be a placeholder than a lunchtime
// release, and is left unlabelled rather than mislabelled.
export function etSession(unixSeconds) {
  if (!unixSeconds) return null;
  const d = new Date(unixSeconds * 1000);
  if (isNaN(d)) return null;
  const parts = ET_HOUR.formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!isFinite(hour)) return null;
  const minutes = (hour % 24) * 60 + (minute || 0);
  if (minutes < 9 * 60 + 30) return 'pre';
  if (minutes >= 16 * 60) return 'post';
  return null;
}

const dayNumber = (isoDate) => Math.round(Date.parse(`${isoDate}T00:00:00Z`) / 86400000);

// A Yahoo date and a transcript report date for the same company that sit
// within this many days of each other are one call, not two. The gap is
// usually a time zone: an after-close call on the 30th is filed on the 30th
// by one source and the 31st by the other.
const SAME_CALL_DAYS = 3;

/**
 * @param {Array<{symbol, name, sector}>} constituents
 * @param {Map<string, object>} quotesBySymbol   Yahoo quote objects, keyed by symbol
 * @param {Map<string, Array<{year, quarter, reportDate}>>} transcriptsBySymbol
 * @param {string} from  YYYY-MM-DD inclusive
 * @param {string} to    YYYY-MM-DD inclusive
 */
export function buildCalendar({ constituents, quotesBySymbol, transcriptsBySymbol, from, to }) {
  const fromN = dayNumber(from);
  const toN = dayNumber(to);
  const inWindow = (date) => {
    const n = dayNumber(date);
    return isFinite(n) && n >= fromN && n <= toN;
  };

  const events = [];

  for (const company of constituents) {
    const quote = quotesBySymbol.get(company.symbol);
    const base = {
      symbol: company.symbol,
      name: quote?.longName || quote?.shortName || company.name,
      sector: company.sector,
      marketCap: quote?.marketCap ?? null,
    };

    // The transcript side: every call the dataset holds for this company
    // inside the window. Usually zero or one; a window spanning a quarter
    // boundary can hold two.
    const calls = (transcriptsBySymbol.get(company.symbol) || [])
      .filter((t) => t.reportDate && inWindow(t.reportDate))
      .map((t) => ({
        ...base,
        date: t.reportDate,
        session: null,
        isEstimate: false,
        transcript: { year: t.year, quarter: t.quarter },
        source: 'transcript',
      }));

    // The Yahoo side: one date, when the quote carries one.
    const stamp = quote?.earningsTimestamp
      || quote?.earningsTimestampStart
      || null;
    const yahooDate = etDate(stamp);
    if (yahooDate) {
      const start = quote.earningsTimestampStart;
      const end = quote.earningsTimestampEnd;
      const windowDays = start && end ? Math.abs(end - start) / 86400 : 0;
      const yahooEvent = {
        ...base,
        date: yahooDate,
        session: etSession(stamp),
        isEstimate: windowDays > 1,
        transcript: null,
        source: 'yahoo',
      };

      const twin = calls.find(
        (c) => Math.abs(dayNumber(c.date) - dayNumber(yahooDate)) <= SAME_CALL_DAYS,
      );
      if (twin) {
        // Same call, two descriptions: keep the transcript's date, take the
        // session from Yahoo, and say both sources agree.
        twin.session = yahooEvent.session;
        twin.source = 'both';
      } else if (inWindow(yahooDate)) {
        // Only a recent or upcoming Yahoo date joins the window on its own.
        // Yahoo keeps the last report's date until the next is announced, so
        // a stale one would otherwise reappear on a past day as "pending"
        // when the transcript simply never arrived — but a call from years
        // ago cannot be in the window anyway, and one from last week is
        // exactly the pending state worth showing.
        calls.push(yahooEvent);
      }
    }

    events.push(...calls);
  }

  // By day, then by size, so a day's list opens on the names most people
  // came to read about.
  events.sort((a, b) =>
    a.date.localeCompare(b.date)
    || (b.marketCap ?? 0) - (a.marketCap ?? 0)
    || a.symbol.localeCompare(b.symbol));

  return events;
}

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`));
