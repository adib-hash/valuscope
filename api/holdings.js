// A manager's 13F portfolio for one quarter, optionally diffed against the
// previous one.
//
// Without ?period, returns the list of available quarters plus the most recent
// portfolio. With ?period=YYYY-MM-DD, returns that quarter.

import { listFilings, fetchHoldings, diffHoldings } from './_lib/edgar13f.js';
import { resolveCusips } from './_lib/cusip.js';

// Enough to cover any real portfolio while bounding the response.
const MAX_POSITIONS = 250;

export default async function handler(req, res) {
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
