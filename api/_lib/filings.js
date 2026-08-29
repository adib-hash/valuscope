// SEC EDGAR filings client — the document layer of the Filings & Docs Hub.
//
// Same conventions as _lib/sec.js and _lib/edgar13f.js: descriptive
// User-Agent, few requests per invocation, warm-instance caches, keyless.

const UA = 'ValueScope/1.0 (adib@ihsan.build)';

// The forms worth reading in-app. Everything else (S-8s, 4s, 144s…) is noise
// for desk research and stays reachable through the EDGAR link.
const FORM_WHITELIST = new Set([
  '10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A',
  'DEF 14A', 'DEFA14A', '20-F', '20-F/A', '40-F', '6-K', 'ARS',
]);

const submissionsCache = new Map(); // cik → { at, data }
const SUBMISSIONS_TTL = 6 * 60 * 60 * 1000;
const indexCache = new Map(); // accession → index.json (immutable)
const INDEX_MAX = 60;

async function secFetch(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept } });
  if (!res.ok) throw new Error(`SEC responded ${res.status} for ${url}`);
  return res;
}

const padCik = (cik) => String(cik).replace(/\D/g, '').padStart(10, '0');
const bareAccession = (acc) => String(acc).replace(/[^0-9]/g, '');

// Recent filings for a company, whitelisted and newest-first. The submissions
// API's `recent` block covers roughly a thousand filings — years of history
// for any normal filer — so the older-pages pagination is deliberately not
// walked here.
export async function listCompanyFilings(cik) {
  const padded = padCik(cik);
  const hit = submissionsCache.get(padded);
  let data = hit && Date.now() - hit.at < SUBMISSIONS_TTL ? hit.data : null;
  if (!data) {
    const res = await secFetch(`https://data.sec.gov/submissions/CIK${padded}.json`, 'application/json');
    data = await res.json();
    submissionsCache.set(padded, { at: Date.now(), data });
  }

  const r = data.filings?.recent;
  if (!r?.accessionNumber?.length) return { name: data.name || null, filings: [] };

  const filings = [];
  for (let i = 0; i < r.accessionNumber.length; i++) {
    const form = r.form[i];
    if (!FORM_WHITELIST.has(form)) continue;
    filings.push({
      accession: r.accessionNumber[i],
      form,
      filed: r.filingDate[i],
      reportDate: r.reportDate?.[i] || null,
      primaryDoc: r.primaryDocument?.[i] || null,
      description: r.primaryDocDescription?.[i] || null,
      size: r.size?.[i] ?? null,
    });
  }
  return { name: data.name || null, filings };
}

// A filing's index.json — the authoritative list of its documents. Needed to
// reach 8-K exhibits (the Ex-99.1 earnings release is usually the substance).
export async function getFilingIndex(cik, accession) {
  const key = bareAccession(accession);
  if (indexCache.has(key)) return indexCache.get(key);
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(padCik(cik))}/${key}/index.json`;
  const res = await secFetch(url, 'application/json');
  const data = await res.json();
  const items = (data?.directory?.item || []).map((it) => ({
    name: it.name,
    size: it.size ?? null,
    type: it.type ?? null,
  }));
  if (indexCache.size >= INDEX_MAX) indexCache.delete(indexCache.keys().next().value);
  indexCache.set(key, items);
  return items;
}

// The document itself. Inline-XBRL 10-Ks run 5-15MB; the abort guard keeps a
// pathological filing from eating the function's memory.
const HTML_BYTE_CAP = 25 * 1024 * 1024;

export async function fetchFilingHtml(cik, accession, doc) {
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(padCik(cik))}/${bareAccession(accession)}/${doc}`;
  const res = await secFetch(url, 'text/html,text/plain');
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > HTML_BYTE_CAP) {
      reader.cancel().catch(() => {});
      throw new Error('Filing document exceeds the 25MB processing cap');
    }
    chunks.push(value);
  }
  return { html: Buffer.concat(chunks).toString('utf8'), edgarUrl: url };
}
