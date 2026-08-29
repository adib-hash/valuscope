// The Filings & Docs Hub — one function, dispatched on `op`.
//
// The plan this implements called for separate filings/filing/docsummary/
// docchat/kpis functions, but the Hobby plan caps a deployment at twelve and
// this app has been bitten by that ceiling once already. One function costs
// one slot; edge caching still works per-op because the cache key is the full
// URL. Ops arriving in later phases 501 until they exist.
//
//   op=list  GET ?ticker=            → filings index for a company
//   op=doc   GET ?cik&accession&doc? → structured blocks + sections
//   op=summary / op=chat / op=kpis   → phases 2-3

import { lookupCik } from './_lib/sec.js';
import { listCompanyFilings, getFilingIndex, fetchFilingHtml } from './_lib/filings.js';
import { htmlToBlocks, detectSections } from './_lib/filingText.js';

// Filings are immutable; this only bounds memory on a warm instance.
const docCache = new Map();
const DOC_CACHE_MAX = 6;

async function opList(req, res) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });
  const symbol = String(ticker).toUpperCase().trim();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) return res.status(400).json({ error: 'Invalid ticker' });

  const cik = await lookupCik(symbol);
  if (!cik) {
    // Non-US filers without an EDGAR presence — a state, not an error.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({ symbol, cik: null, name: null, filings: [] });
  }

  const { name, filings } = await listCompanyFilings(cik);
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json({ symbol, cik, name, filings });
}

async function opDoc(req, res) {
  const { cik, accession } = req.query;
  if (!cik || !accession) return res.status(400).json({ error: 'Missing cik or accession' });
  if (!/^\d{1,10}$/.test(String(cik).replace(/\D/g, '')) || !/^[\d-]{18,20}$/.test(accession)) {
    return res.status(400).json({ error: 'Invalid cik or accession' });
  }

  // The document list comes from the filing's own index — it is what makes
  // 8-K exhibits (the Ex-99.1 earnings release is usually the substance)
  // reachable. Only render-able formats are offered.
  const items = await getFilingIndex(cik, accession);
  // Index pages, XBRL viewer renders (R1.htm…) and the raw submission bundle
  // are plumbing, not documents. Old filings are the exception: pre-2001 the
  // full-submission .txt IS the document, so it stays when nothing else does.
  const isJunk = (n) => /index/i.test(n) || /^R\d+\.htm$/i.test(n);
  let renderable = items.filter((it) => /\.(htm|html|txt)$/i.test(it.name) && !isJunk(it.name));
  const submissionTxt = `${accession}.txt`;
  const properDocs = renderable.filter((it) => it.name !== submissionTxt);
  if (properDocs.length) renderable = properDocs;

  let doc = req.query.doc;
  if (doc && !renderable.some((it) => it.name === doc)) {
    return res.status(400).json({ error: 'Unknown document in this filing' });
  }
  if (!doc) {
    // Largest HTML document is the primary in virtually every filing.
    const ranked = [...renderable].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    doc = ranked[0]?.name;
  }
  if (!doc) return res.status(404).json({ error: 'No readable document in this filing' });

  const cacheKey = `${cik}:${accession}:${doc}`;
  let body = docCache.get(cacheKey);
  if (!body) {
    const { html, edgarUrl } = await fetchFilingHtml(cik, accession, doc);
    const { blocks, truncated } = htmlToBlocks(html);
    body = {
      blocks,
      sections: detectSections(blocks),
      docs: renderable.map(({ name, size }) => ({ name, size })),
      doc,
      edgarUrl,
      truncated,
      aiAvailable: !!process.env.GEMINI_API_KEY,
    };
    if (docCache.size >= DOC_CACHE_MAX) docCache.delete(docCache.keys().next().value);
    docCache.set(cacheKey, body);
  }

  res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=2592000');
  return res.status(200).json(body);
}

export default async function handler(req, res) {
  const { op } = req.query;
  try {
    if (op === 'list') return await opList(req, res);
    if (op === 'doc') return await opDoc(req, res);
    if (op === 'summary' || op === 'chat' || op === 'kpis') {
      return res.status(501).json({ error: 'Not available yet.' });
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (err) {
    console.error(`docs op=${op} error:`, err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed: ${err.message}` });
  }
}
