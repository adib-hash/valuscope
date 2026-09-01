import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { fetchEarningsCalendar } from '../lib/api';
import BackButton from './ui/BackButton';
import ErrorBanner from './ui/ErrorBanner';

const EarningsDigest = lazy(() => import('./EarningsDigest'));

// ── Dates ───────────────────────────────────────────────────────────────────
// Everything here is a plain YYYY-MM-DD string built in local time. Passing a
// bare date to `new Date` parses it as UTC midnight and shifts it a day west
// of London, which is how a 30 April call once rendered as 29 April.

const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const todayIso = () => toIso(new Date());

const fmtLong = (iso) => {
  const d = fromIso(iso);
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : iso;
};
const fmtMonth = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

function fmtCap(v) {
  if (v == null) return null;
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(0)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

// Trading weeks only: a Monday-to-Friday grid, padded to whole weeks. Nothing
// reports on a weekend, and five columns leave room for a count in each cell
// on a phone where seven do not.
function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const backToMonday = (first.getDay() + 6) % 7;
  const start = addDays(first, -backToMonday);
  const forwardToFriday = (5 - last.getDay() + 7) % 7;
  const end = addDays(last, last.getDay() === 6 ? 6 : last.getDay() === 0 ? 5 : forwardToFriday);
  const weeks = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push([0, 1, 2, 3, 4].map((i) => addDays(d, i)));
  }
  return { weeks, from: toIso(start), to: toIso(weeks[weeks.length - 1][4]) };
}

const SESSION = { pre: 'Before open', post: 'After close' };

export default function EarningsCalendarPage({ date, onSelectDate, onSelectTicker, onOpenTranscript, onBack }) {
  const today = todayIso();
  const selectedDate = fromIso(date) ? date : null;

  // The visible month follows the selected day when the URL names one, and
  // the current month otherwise.
  const [cursor, setCursor] = useState(() => {
    const d = fromIso(selectedDate) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const grid = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  // One fetch per month, kept for the session so paging back is instant.
  const [months, setMonths] = useState({});
  const key = monthKey(cursor);
  const month = months[key];

  useEffect(() => {
    if (months[key]) return;
    let cancelled = false;
    setMonths((m) => ({ ...m, [key]: { status: 'loading' } }));
    fetchEarningsCalendar(grid.from, grid.to)
      .then((data) => { if (!cancelled) setMonths((m) => ({ ...m, [key]: { status: 'ready', data } })); })
      .catch((e) => { if (!cancelled) setMonths((m) => ({ ...m, [key]: { status: 'error', error: e.message || 'Failed to load the calendar' } })); });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = month?.data?.events || [];
  const byDate = useMemo(() => {
    const map = new Map();
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    }
    return map;
  }, [events]);

  // With no day chosen, open on today when it is in view, else on the first
  // day of the month that has anything on it.
  const effectiveDate = selectedDate
    || (monthKey(fromIso(today)) === key ? today : null)
    || [...byDate.keys()].sort().find((d) => d.startsWith(key))
    || toIso(grid.weeks[0].find((d) => d.getMonth() === cursor.getMonth()) || grid.weeks[0][0]);

  const dayEvents = byDate.get(effectiveDate) || [];
  const withTranscript = dayEvents.filter((e) => e.transcript);
  const summaryAvailable = month?.data?.summaryAvailable;

  const [digestOpen, setDigestOpen] = useState(false);
  useEffect(() => { setDigestOpen(false); }, [effectiveDate]);

  const shiftMonth = (n) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
    onSelectDate?.(null);
  };
  const goToday = () => {
    const d = new Date();
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    onSelectDate?.(today);
  };
  const pick = (iso) => {
    const d = fromIso(iso);
    if (d.getMonth() !== cursor.getMonth()) setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    onSelectDate?.(iso);
  };

  const universe = month?.data?.universe;

  return (
    <div className="mt-5 pb-8">
      {onBack && <BackButton onClick={onBack} />}

      <div className="text-vs-dim text-label font-mono tracking-widest">EARNINGS CALENDAR</div>
      <h1 className="font-display text-display font-extrabold mt-1 leading-tight text-vs-text">
        S&amp;P 500 earnings
      </h1>
      <p className="text-vs-soft text-body mt-0.5 max-w-[68ch]">
        Every constituent's call, by day. Pick a day to see who reported, read any call whose
        transcript has landed, or have the whole day read for you.
      </p>

      {/* Month header */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="p-1.5 rounded-md text-vs-dim hover:text-vs-soft hover:bg-vs-card cursor-pointer transition-colors"
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <span className="font-mono text-body font-semibold text-vs-text min-w-[140px] text-center">
            {fmtMonth(cursor)}
          </span>
          <button
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="p-1.5 rounded-md text-vs-dim hover:text-vs-soft hover:bg-vs-card cursor-pointer transition-colors"
          >
            <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <button
          onClick={goToday}
          className="rounded-md px-2.5 py-1.5 text-label font-mono font-semibold border border-vs-border text-vs-dim hover:border-vs-borderLight hover:text-vs-soft cursor-pointer transition-colors"
        >
          Today
        </button>
      </div>

      {month?.status === 'error' && <ErrorBanner className="mt-3">{month.error}</ErrorBanner>}

      {/* Grid */}
      <div className="mt-3 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
        <div className="grid grid-cols-5 border-b border-vs-border bg-vs-card2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
            <div key={d} className="px-2 py-1.5 text-center text-vs-dim text-micro font-mono uppercase tracking-widest">
              {d}
            </div>
          ))}
        </div>
        {grid.weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-5 border-t border-vs-border first:border-t-0">
            {week.map((d) => {
              const iso = toIso(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const list = byDate.get(iso) || [];
              const loaded = list.filter((e) => e.transcript).length;
              const selected = iso === effectiveDate;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  onClick={() => pick(iso)}
                  aria-pressed={selected}
                  aria-label={`${fmtLong(iso)}: ${list.length} ${list.length === 1 ? 'company' : 'companies'} reporting, ${loaded} with transcripts`}
                  className={`relative min-h-[58px] sm:min-h-[68px] px-1.5 py-1.5 text-left border-l first:border-l-0 border-vs-border cursor-pointer transition-colors ${
                    selected ? 'bg-vs-blue/10' : 'hover:bg-vs-card2'
                  } ${inMonth ? '' : 'opacity-40'}`}
                >
                  <span className={`font-mono text-label leading-none ${
                    isToday ? 'text-vs-blue font-bold' : selected ? 'text-vs-text font-semibold' : 'text-vs-soft'
                  }`}>
                    {d.getDate()}
                  </span>
                  {month?.status === 'loading' && inMonth && (
                    <span className="block mt-2 h-2 w-8 rounded-sm bg-vs-border animate-pulse" />
                  )}
                  {list.length > 0 && (
                    <span className="block mt-1.5 sm:mt-2">
                      <span className="font-mono text-body sm:text-prose font-semibold text-vs-text leading-none">
                        {list.length}
                      </span>
                      {loaded > 0 && (
                        <span className="ml-1 inline-flex items-center gap-0.5 align-baseline text-vs-violet text-micro font-mono">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-vs-violet" aria-hidden="true" />
                          {loaded}
                        </span>
                      )}
                    </span>
                  )}
                  {selected && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-vs-blue" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        ))}
        <div className="px-3 py-2 border-t border-vs-border flex items-center gap-3 flex-wrap">
          <span className="text-vs-dim text-micro font-mono">
            <span className="text-vs-text font-semibold">N</span> reporting
          </span>
          <span className="text-vs-dim text-micro font-mono inline-flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-vs-violet" aria-hidden="true" />
            with transcript loaded
          </span>
          {universe && (
            <span className="text-vs-dim text-micro font-mono ml-auto">
              {universe.count} constituents · list as of {universe.asOf}
            </span>
          )}
        </div>
      </div>

      {(month?.data?.warnings || []).map((w) => (
        <p key={w} className="text-vs-amber text-micro font-mono mt-2">{w}</p>
      ))}

      {/* The day */}
      <div className="mt-6">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="text-vs-dim text-micro font-mono uppercase tracking-widest">
              {effectiveDate === today ? 'Today' : effectiveDate < today ? 'Reported' : 'Scheduled'}
            </p>
            <h2 className="font-display text-title font-bold text-vs-text leading-tight mt-0.5">
              {fmtLong(effectiveDate)}
            </h2>
          </div>
          {month?.status === 'ready' && (
            <p className="text-vs-soft text-label font-mono">
              {dayEvents.length} {dayEvents.length === 1 ? 'company' : 'companies'}
              {dayEvents.length > 0 && ` · ${withTranscript.length} with transcripts`}
            </p>
          )}
        </div>

        {month?.status === 'loading' && (
          <div className="mt-3 rounded-xl border border-vs-border bg-vs-card px-4 py-4 animate-pulse space-y-2.5">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-vs-border rounded-md" />)}
          </div>
        )}

        {month?.status === 'ready' && dayEvents.length === 0 && (
          <p className="mt-3 text-vs-soft text-body">No S&amp;P 500 companies report on this day.</p>
        )}

        {/* Digest call to action. Sits above the list so it is one tap away
            on a phone, where the list on a busy day runs several screens. */}
        {month?.status === 'ready' && dayEvents.length > 0 && (
          <div className="mt-3">
            {withTranscript.length > 0 && summaryAvailable && !digestOpen && (
              <>
                <button
                  onClick={() => setDigestOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-label font-mono font-semibold cursor-pointer border border-vs-violet/40 bg-vs-violet/10 text-vs-violet hover:bg-vs-violet/20 transition-colors"
                >
                  <Sparkles size={13} strokeWidth={2} aria-hidden="true" />
                  Generate earnings digest · {withTranscript.length} {withTranscript.length === 1 ? 'call' : 'calls'}
                </button>
                <p className="text-vs-dim text-micro font-mono mt-1.5">
                  Results, guidance, analyst Q&amp;A and the numbers, for every call with a transcript
                  {withTranscript.length > 6 ? ' · a busy day takes a few minutes' : ' · takes a minute'}
                </p>
              </>
            )}
            {withTranscript.length > 0 && summaryAvailable === false && (
              <p className="text-vs-dim text-micro font-mono">
                The digest needs a Gemini key on this deployment; transcripts are still readable below.
              </p>
            )}
            {withTranscript.length === 0 && (
              <p className="text-vs-dim text-micro font-mono">
                {effectiveDate > today
                  ? 'Transcripts appear here within a day of each call.'
                  : month?.data?.transcriptsAvailable === false
                    ? 'Transcript availability is unknown right now.'
                    : 'No transcripts have landed for this day yet. They usually arrive within a day of the call.'}
              </p>
            )}
          </div>
        )}

        {digestOpen && (
          <Suspense fallback={<div className="mt-4 rounded-xl border border-vs-violet/25 bg-vs-violet/[0.04] h-32 animate-pulse" />}>
            <EarningsDigest
              date={effectiveDate}
              events={withTranscript}
              onClose={() => setDigestOpen(false)}
              onOpenTranscript={onOpenTranscript}
              onSelectTicker={onSelectTicker}
            />
          </Suspense>
        )}

        {/* Who reported */}
        {month?.status === 'ready' && dayEvents.length > 0 && (
          <div className="mt-4 rounded-xl border border-vs-border bg-vs-card overflow-hidden">
            <ul className="divide-y divide-vs-border">
              {dayEvents.map((e) => (
                <li key={`${e.symbol}-${e.date}`} className="px-4 py-2.5 flex items-center gap-3">
                  <button
                    onClick={() => onSelectTicker?.(e.symbol)}
                    className="min-w-0 flex-1 text-left cursor-pointer group"
                    aria-label={`Open ${e.name}`}
                  >
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="font-mono text-label font-bold text-vs-blue group-hover:underline">{e.symbol}</span>
                      <span className="text-vs-text text-body font-semibold truncate">{e.name}</span>
                    </span>
                    <span className="block text-vs-dim text-micro font-mono mt-0.5 truncate">
                      {e.sector}
                      {e.marketCap != null && ` · ${fmtCap(e.marketCap)}`}
                      {e.session && ` · ${SESSION[e.session]}`}
                      {e.isEstimate && ' · date estimated'}
                    </span>
                  </button>
                  {e.transcript ? (
                    <button
                      onClick={() => onOpenTranscript?.(e.symbol)}
                      className="flex-shrink-0 rounded-md px-2.5 py-1.5 text-micro font-mono font-semibold border border-vs-violet/40 bg-vs-violet/10 text-vs-violet hover:bg-vs-violet/20 cursor-pointer transition-colors whitespace-nowrap"
                    >
                      Q{e.transcript.quarter} FY{e.transcript.year} call →
                    </button>
                  ) : (
                    <span className="flex-shrink-0 text-vs-dim text-micro font-mono whitespace-nowrap">
                      {e.date <= today ? 'transcript pending' : 'upcoming'}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-4 py-2.5 border-t border-vs-border">
              <p className="text-vs-dim text-micro font-mono leading-relaxed">
                Dates from Yahoo Finance, transcripts from defeatbeta. A call is filed under the day its transcript
                carries; companies whose date Yahoo has not confirmed are marked estimated.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
