// Earnings: one company's calendar, surprise history and estimates, and the
// S&P 500-wide calendar. Two ops in one function because the Hobby plan caps
// a deployment at twelve and this app sits on the cap.
//
//   (default)    GET ?ticker=AAPL          → next date, surprise history, estimates
//   op=calendar  GET ?from=&to=            → every S&P 500 call in the window
//
// Valuations reprice around earnings, so knowing when the next call lands, how
// reliably the company has beaten expectations, and which way estimates are
// moving is context the multiples alone can't give.

import YahooFinance from 'yahoo-finance2';
import { getSp500, SP500_AS_OF } from './_lib/sp500.js';
import { getTranscriptIndex } from './_lib/transcripts.js';
import { buildCalendar, isIsoDate } from './_lib/calendar.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const iso = (d) => {
  if (!d) return null;
  const parsed = d instanceof Date ? d : new Date(d);
  return isNaN(parsed) ? null : parsed.toISOString();
};

// Yahoo reports surprise and growth as ratios (0.1012), the UI wants percent.
const pct = (v) => (v == null ? null : v * 100);

// ── op=calendar ─────────────────────────────────────────────────────────────
//
// Five hundred companies is five batch quotes, not five hundred calls: the
// quote endpoint carries each company's earnings timestamp, which is all the
// calendar needs from Yahoo. The transcript dataset's index supplies the
// other half — which of those calls has a transcript to read — in one pass.

const QUOTE_BATCH = 100;
const MAX_WINDOW_DAYS = 70; // a month view plus its padding weeks, with room

// yahoo-finance2 hands back Date objects for these; the calendar maths wants
// the raw seconds Yahoo sent.
const seconds = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return Math.round(v.getTime() / 1000);
  const n = Number(v);
  return isFinite(n) ? n : null;
};

async function quoteAll(symbols) {
  const bySymbol = new Map();
  const batches = [];
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    batches.push(symbols.slice(i, i + QUOTE_BATCH));
  }
  // The library caps real concurrency itself; one failed batch loses its
  // hundred names' dates, not the whole calendar.
  const results = await Promise.all(batches.map((batch) =>
    yahooFinance.quote(batch, {}, { validateResult: false }).catch((err) => {
      console.warn(`Calendar quote batch failed (${batch[0]}…): ${err.message}`);
      return [];
    })));
  let failed = 0;
  results.forEach((list, i) => {
    const arr = Array.isArray(list) ? list : [list];
    if (!arr.length) failed += 1;
    for (const q of arr) {
      if (!q?.symbol) continue;
      bySymbol.set(q.symbol, {
        symbol: q.symbol,
        shortName: q.shortName,
        longName: q.longName,
        marketCap: q.marketCap ?? null,
        earningsTimestamp: seconds(q.earningsTimestamp),
        earningsTimestampStart: seconds(q.earningsTimestampStart),
        earningsTimestampEnd: seconds(q.earningsTimestampEnd),
      });
    }
  });
  return { bySymbol, failedBatches: failed, batches: batches.length };
}

async function opCalendar(req, res) {
  const { from, to } = req.query;
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
  }
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (span < 0 || span > MAX_WINDOW_DAYS) {
    return res.status(400).json({ error: `Window must run forwards and cover at most ${MAX_WINDOW_DAYS} days` });
  }

  const constituents = await getSp500();
  const symbols = constituents.map((c) => c.symbol);
  const warnings = [];

  // Both halves in parallel; either can fail on its own and the calendar
  // still renders from the other, labelled as such.
  const [quotes, index] = await Promise.all([
    quoteAll(symbols).catch((err) => {
      console.error('Calendar quotes failed:', err);
      warnings.push('Upcoming dates from Yahoo Finance are unavailable right now.');
      return { bySymbol: new Map(), failedBatches: 0, batches: 0 };
    }),
    getTranscriptIndex().catch((err) => {
      console.error('Calendar transcript index failed:', err);
      warnings.push('The transcript index could not be loaded, so transcript availability is unknown.');
      return null;
    }),
  ]);
  if (index && !index.rows) {
    warnings.push(index.builtAt
      ? 'The transcript index is empty, so transcript availability is unknown.'
      : 'The transcript index has not been built yet, so transcript availability is unknown.');
  }
  if (quotes.failedBatches && quotes.failedBatches === quotes.batches) {
    warnings.push('Upcoming dates from Yahoo Finance are unavailable right now.');
  } else if (quotes.failedBatches) {
    warnings.push(`Yahoo Finance returned ${quotes.batches - quotes.failedBatches} of ${quotes.batches} quote batches; some upcoming dates may be missing.`);
  }

  const events = buildCalendar({
    constituents,
    quotesBySymbol: quotes.bySymbol,
    transcriptsBySymbol: index?.bySymbol || new Map(),
    from,
    to,
  });

  // Dates move and transcripts land daily; half an hour is fresh enough and
  // keeps a busy earnings week from re-quoting five hundred names per visitor.
  res.setHeader('Cache-Control', warnings.length ? 's-maxage=120' : 's-maxage=1800, stale-while-revalidate=3600');
  return res.status(200).json({
    from,
    to,
    events,
    universe: { count: constituents.length, asOf: SP500_AS_OF, source: 'datasets/s-and-p-500-companies' },
    transcriptsAvailable: !!(index && index.rows),
    transcriptIndex: index ? { builtAt: index.builtAt, rows: index.rows } : null,
    // The digest needs Gemini; the client hides the button on deployments
    // without a key rather than offering an action that can only fail.
    summaryAvailable: !!process.env.GEMINI_API_KEY,
    warnings,
    asOf: new Date().toISOString(),
    source: 'yahoo+defeatbeta',
  });
}

// ── default: one company ────────────────────────────────────────────────────

async function opCompany(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = ticker.toUpperCase().trim();

  try {
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['calendarEvents', 'earningsHistory', 'earningsTrend'],
    }, { validateResult: false });

    const cal = summary.calendarEvents?.earnings || {};

    // Yahoo gives a single date, or a two-element window when the date is not
    // yet confirmed. The earlier bound is the useful one either way.
    const dates = (cal.earningsDate || []).map(iso).filter(Boolean).sort();

    const next = dates.length ? {
      date: dates[0],
      dateEnd: dates.length > 1 ? dates[dates.length - 1] : null,
      isEstimate: cal.isEarningsDateEstimate ?? null,
      epsEstimate: cal.earningsAverage ?? null,
      epsLow: cal.earningsLow ?? null,
      epsHigh: cal.earningsHigh ?? null,
      revenueEstimate: cal.revenueAverage ?? null,
    } : null;

    const history = (summary.earningsHistory?.history || [])
      .map((h) => ({
        quarter: iso(h.quarter),
        epsActual: h.epsActual ?? null,
        epsEstimate: h.epsEstimate ?? null,
        surprisePercent: pct(h.surprisePercent),
      }))
      .filter((h) => h.quarter && h.epsActual != null)
      .sort((a, b) => new Date(a.quarter) - new Date(b.quarter));

    const trendFor = (period) => {
      const t = (summary.earningsTrend?.trend || []).find((x) => x.period === period);
      if (!t) return null;
      const rev = t.epsRevisions || {};
      return {
        period,
        endDate: iso(t.endDate),
        epsEstimate: t.earningsEstimate?.avg ?? null,
        revenueEstimate: t.revenueEstimate?.avg ?? null,
        growthPercent: pct(t.growth),
        revisionsUp: rev.upLast30days ?? null,
        revisionsDown: rev.downLast30days ?? null,
      };
    };

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json({
      symbol,
      next,
      history,
      estimates: {
        currentQuarter: trendFor('0q'),
        currentYear: trendFor('0y'),
        nextYear: trendFor('+1y'),
      },
      source: 'yahoo',
    });

  } catch (err) {
    console.error('Earnings error:', err);
    // Treated as an enhancement: the panel hides itself rather than erroring.
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(200).json({
      symbol, next: null, history: [], estimates: {}, source: 'none', error: err.message,
    });
  }
}

export default async function handler(req, res) {
  if (req.query.op === 'calendar') {
    try {
      return await opCalendar(req, res);
    } catch (err) {
      console.error('Calendar error:', err);
      res.setHeader('Cache-Control', 's-maxage=60');
      return res.status(500).json({ error: `Failed to load the earnings calendar: ${err.message}` });
    }
  }
  return opCompany(req, res);
}
