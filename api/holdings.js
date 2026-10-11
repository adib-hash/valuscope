// Who owns what, from SEC filings. Two subjects in one function because the
// Hobby plan caps a deployment at twelve and this app sits on the cap:
//
//   ?cik=…                       a manager's 13F portfolio (below)
//   ?op=insiders&ticker=…        a company's insider transactions (Form 4)
//   ?op=insiderFiling&cik=…&acc=… one Form 4's exact prices and 10b5-1 flag
//
// A manager's 13F portfolio for one quarter, optionally diffed against the
// previous one.
//
// Without ?period, returns the list of available quarters plus the most recent
// portfolio. With ?period=YYYY-MM-DD, returns that quarter.

import YahooFinance from 'yahoo-finance2';
import { listFilings, fetchHoldings, diffHoldings } from './_lib/edgar13f.js';
import { resolveCusips } from './_lib/cusip.js';
import { lookupCik } from './_lib/sec.js';
import { fetchInsiderTransactions, filingDetail } from './_lib/insiders.js';
import { summariseInsiders } from './_lib/insiderSummary.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// Enough to cover any real portfolio while bounding the response.
const MAX_POSITIONS = 250;

// Eighteen months: the longest window the tab offers. Shorter windows are cut
// in the browser from the same response, so switching costs nothing.
const INSIDER_MONTHS = 18;

async function insiders(req, res) {
  const symbol = String(req.query.ticker || '').toUpperCase().trim();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return res.status(400).json({ error: 'Missing or invalid ticker' });
  const cik = await lookupCik(symbol.replace('.', '-')).catch(() => null) || await lookupCik(symbol).catch(() => null);
  if (!cik) {
    res.setHeader('Cache-Control', 's-maxage=86400');
    return res.status(404).json({ error: `${symbol} has no SEC filer record, so there are no insider filings to show.` });
  }
  const since = new Date();
  since.setMonth(since.getMonth() - INSIDER_MONTHS);
  const sinceIso = since.toISOString().slice(0, 10);

  const [transactions, chart] = await Promise.all([
    fetchInsiderTransactions(cik, sinceIso),
    yahooFinance.chart(symbol, { period1: since, interval: '1d' }, { validateResult: false }).catch(() => null),
  ]);
  const closes = (chart?.quotes || [])
    .filter((q) => q.close != null)
    .map((q) => ({ date: new Date(q.date).toISOString().slice(0, 10), close: q.close }));

  // New Form 4s arrive within two business days of a trade; a few hours of
  // staleness costs nothing and keeps SEC's pages off the hot path.
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  return res.status(200).json({ symbol, cik, since: sinceIso, priceBasis: 'close', ...summariseInsiders(transactions, closes) });
}

async function insiderFiling(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  const acc = String(req.query.acc || '');
  if (!cik || !/^\d{10}-\d{2}-\d{6}$/.test(acc)) return res.status(400).json({ error: 'Missing or invalid cik or acc' });
  const detail = await filingDetail(cik, acc);
  // A filing never changes once published.
  res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000');
  return res.status(200).json(detail);
}

export default async function handler(req, res) {
  if (req.query.op === 'insiders' || req.query.op === 'insiderFiling') {
    try {
      return await (req.query.op === 'insiders' ? insiders(req, res) : insiderFiling(req, res));
    } catch (err) {
      console.error(`Insiders (${req.query.op}): ${err.message}`);
      res.setHeader('Cache-Control', 's-maxage=60');
      return res.status(502).json({ error: 'SEC filings are unavailable right now. Try again shortly.' });
    }
  }

  const { cik, period, compare } = req.query;
  if (!cik || !/^\d{1,10}$/.test(String(cik).replace(/\D/g, ''))) {
    return res.status(400).json({ error: 'Missing or invalid cik parameter' });
  }

  try {
    const { name, filings } = await listFilings(cik);
    if (!filings.length) {
      res.setHeader('Cache-Control', 's-maxage=3600');
      return res.status(404).json({ error: 'No 13F filings found for that filer' });
    }

    const current = period
      ? filings.find((f) => f.reportDate === period)
      : filings[0];
    if (!current) {
      return res.status(404).json({ error: `No 13F filing for period ${period}` });
    }

    const held = await fetchHoldings(cik, current.accession, current.filingDate);

    // The prior quarter is the one immediately after in the newest-first list.
    const priorIndex = filings.indexOf(current) + 1;
    const prior = compare === 'false' ? null : filings[priorIndex] || null;

    let positions = held.positions;
    let comparedTo = null;

    if (prior) {
      try {
        const before = await fetchHoldings(cik, prior.accession, prior.filingDate);
        positions = diffHoldings(held.positions, before.positions);
        comparedTo = { reportDate: prior.reportDate, totalValue: before.totalValue };
      } catch {
        // The diff is a bonus. A missing prior filing must not lose the current one.
      }
    }

    positions = positions.slice(0, MAX_POSITIONS);

    // Tickers turn a holdings list into something you can click into. Best
    // effort only — unresolved rows keep their issuer name.
    let tickers = {};
    try {
      tickers = await resolveCusips(positions.map((p) => p.cusip));
    } catch {
      tickers = {};
    }

    const enriched = positions.map((p) => ({
      ...p,
      ticker: tickers[p.cusip]?.ticker || null,
      resolvedName: tickers[p.cusip]?.name || null,
    }));

    // Filings never change once published.
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=2592000');
    return res.status(200).json({
      filer: { cik: String(cik).replace(/\D/g, '').padStart(10, '0'), name },
      period: current.reportDate,
      filingDate: current.filingDate,
      form: current.form,
      totalValue: held.totalValue,
      positionCount: held.positions.length,
      rawRows: held.rawRows,
      comparedTo,
      positions: enriched,
      quarters: filings.map((f) => ({
        reportDate: f.reportDate,
        filingDate: f.filingDate,
        form: f.form,
      })),
      source: 'sec-edgar',
    });

  } catch (err) {
    console.error('Holdings error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed to load holdings: ${err.message}` });
  }
}
