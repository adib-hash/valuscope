// SEC EDGAR 13F client — institutional holdings, free and keyless.
//
// Three hops per portfolio:
//   1. efts.sec.gov full-text search, filtered to 13F-HR, resolves a manager
//      name to a CIK.
//   2. data.sec.gov/submissions lists every 13F that manager has filed.
//   3. The filing's index.json points at the information table XML.
//
// Same conventions as _lib/sec.js: descriptive User-Agent, few requests per
// invocation, cached hard.

const UA = 'ValuScope/1.0 (adib@ihsan.build)';

const holdingsCache = new Map();
const HOLDINGS_MAX = 40; // filings are immutable; this only bounds memory

async function secFetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`SEC responded ${res.status}`);
  return res.json();
}

// sec.js only ever needs JSON. Information tables are XML.
async function secFetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/plain' } });
  if (!res.ok) throw new Error(`SEC responded ${res.status}`);
  return res.text();
}

const padCik = (cik) => String(cik).replace(/\D/g, '').padStart(10, '0');

// "Scion Asset Management, LLC  (CIK 0001649339)" and occasionally
// "PERSHING SQUARE INC.  (PS)  (CIK 0002026053)" with a ticker in the middle.
function parseDisplayName(display) {
  const match = /\(CIK (\d{10})\)\s*$/.exec(display || '');
  if (!match) return null;
  return {
    cik: match[1],
    name: display.slice(0, match.index).replace(/\s*\([A-Z.\-]{1,6}\)\s*$/, '').trim(),
  };
}

export async function searchFilers(query) {
  const url = new URL('https://efts.sec.gov/LATEST/search-index');
  url.searchParams.set('q', '');
  url.searchParams.set('forms', '13F-HR');
  url.searchParams.set('entityName', query);

  const data = await secFetchJson(url.toString());
  const seen = new Map();
  for (const hit of data?.hits?.hits || []) {
    for (const display of hit._source?.display_names || []) {
      const parsed = parseDisplayName(display);
      if (parsed && !seen.has(parsed.cik)) seen.set(parsed.cik, parsed);
    }
  }
  return [...seen.values()].slice(0, 8);
}

export async function listFilings(cik) {
  const data = await secFetchJson(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`);
  const recent = data?.filings?.recent;
  if (!recent) return { name: data?.name || null, filings: [] };

  const filings = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (!recent.form[i]?.startsWith('13F-HR')) continue;
    filings.push({
      form: recent.form[i],
      isAmendment: recent.form[i].includes('/A'),
      reportDate: recent.reportDate[i],
      filingDate: recent.filingDate[i],
      accession: recent.accessionNumber[i],
    });
  }

  // Newest first. An amendment supersedes the original for the same quarter, and
  // amendments file later, so keeping the first occurrence per period is right.
  filings.sort((a, b) => (b.reportDate || '').localeCompare(a.reportDate || '')
    || (b.filingDate || '').localeCompare(a.filingDate || ''));

  const byPeriod = [];
  const seen = new Set();
  for (const f of filings) {
    if (seen.has(f.reportDate)) continue;
    seen.add(f.reportDate);
    byPeriod.push(f);
  }

  return { name: data?.name || null, filings: byPeriod };
}

// Issuer names arrive XML-escaped — "WELLS FARGO &amp; CO NEW".
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const decodeEntities = (v) =>
  v.replace(/&(#\d+|#x[0-9a-fA-F]+|\w+);/g, (whole, code) => {
    if (ENTITIES[code]) return ENTITIES[code];
    if (code[0] === '#') {
      const n = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return isFinite(n) ? String.fromCharCode(n) : whole;
    }
    return whole;
  });

const tag = (xml, name) => {
  const m = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? decodeEntities(m[1].trim()) : null;
};

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return isFinite(n) ? n : null;
};

// The information table schema is flat and machine-generated, so a regex walk is
// enough. Adding an XML parser dependency for this one shape is not worth it.
export function parseInfoTable(xml) {
  const rows = [];
  for (const block of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)) {
    const body = block[1];
    const cusip = tag(body, 'cusip');
    if (!cusip) continue;
    rows.push({
      issuer: tag(body, 'nameOfIssuer') || '',
      titleOfClass: tag(body, 'titleOfClass') || '',
      cusip: cusip.toUpperCase(),
      value: num(tag(body, 'value')),
      shares: num(tag(body, 'sshPrnamt')),
      sharesType: tag(body, 'sshPrnamtType') || 'SH',
      putCall: tag(body, 'putCall'),
    });
  }
  return rows;
}

// Until 2023 the value column was reported in thousands; the SEC's amendments
// switched it to whole dollars for filings made from January 2023 onward. Miss
// this and every older portfolio renders a thousand times too small.
const REPORTS_WHOLE_DOLLARS_FROM = '2023-01-01';
const valueScale = (filingDate) => (filingDate && filingDate >= REPORTS_WHOLE_DOLLARS_FROM ? 1 : 1000);

// A filing has one row per (security, managing entity), so Berkshire's Q1 2026
// filing has 90 rows covering far fewer real positions. Collapsing by CUSIP is
// what turns rows into a portfolio.
function aggregate(rows, scale) {
  const byCusip = new Map();
  for (const row of rows) {
    // Options are a separate exposure from the underlying and are left out
    // rather than silently folded into the share count.
    const key = `${row.cusip}|${row.putCall || ''}`;
    const existing = byCusip.get(key);
    const value = row.value == null ? null : row.value * scale;
    if (existing) {
      existing.value = (existing.value ?? 0) + (value ?? 0);
      existing.shares = (existing.shares ?? 0) + (row.shares ?? 0);
    } else {
      byCusip.set(key, { ...row, value, shares: row.shares ?? 0 });
    }
  }
  return [...byCusip.values()].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

async function findInfoTableUrl(cik, accession) {
  const bare = accession.replace(/-/g, '');
  const dir = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}`;
  const index = await secFetchJson(`${dir}/index.json`);
  const items = index?.directory?.item || [];

  // The filename is not stable — form13fInfoTable.xml in 2016, 53405.xml in
  // 2026 — so it is identified by elimination rather than by name.
  const candidates = items
    .map((i) => i.name)
    .filter((n) => n && n.toLowerCase().endsWith('.xml') && !/primary_doc/i.test(n));

  if (!candidates.length) return null;
  const preferred = candidates.find((n) => /info|table/i.test(n)) || candidates[0];
  return `${dir}/${preferred}`;
}

export async function fetchHoldings(cik, accession, filingDate) {
  const cacheKey = `${cik}|${accession}`;
  if (holdingsCache.has(cacheKey)) return holdingsCache.get(cacheKey);

  const url = await findInfoTableUrl(cik, accession);
  if (!url) throw new Error('No information table in that filing');

  const xml = await secFetchText(url);
  const rows = parseInfoTable(xml);
  const positions = aggregate(rows, valueScale(filingDate));
  const totalValue = positions.reduce((sum, p) => sum + (p.value ?? 0), 0);

  const result = {
    positions: positions.map((p) => ({
      ...p,
      pctOfPortfolio: totalValue > 0 && p.value != null ? (p.value / totalValue) * 100 : null,
    })),
    totalValue,
    rawRows: rows.length,
  };

  if (holdingsCache.size >= HOLDINGS_MAX) {
    holdingsCache.delete(holdingsCache.keys().next().value);
  }
  holdingsCache.set(cacheKey, result);
  return result;
}

// Quarter-over-quarter, matched on CUSIP. This is the part of a 13F that
// actually says something.
export function diffHoldings(current, previous) {
  const prevBy = new Map(previous.map((p) => [`${p.cusip}|${p.putCall || ''}`, p]));
  const out = [];

  for (const pos of current) {
    const key = `${pos.cusip}|${pos.putCall || ''}`;
    const before = prevBy.get(key);
    prevBy.delete(key);

    if (!before) {
      out.push({ ...pos, status: 'new', deltaShares: pos.shares, deltaPct: null });
      continue;
    }
    const deltaShares = (pos.shares ?? 0) - (before.shares ?? 0);
    const deltaPct = before.shares > 0 ? (deltaShares / before.shares) * 100 : null;
    // Sub-0.5% share moves are rounding and restatement noise, not decisions.
    const moved = before.shares > 0 && Math.abs(deltaPct) >= 0.5;
    out.push({
      ...pos,
      status: !moved ? 'held' : deltaShares > 0 ? 'added' : 'trimmed',
      deltaShares,
      deltaPct,
      priorShares: before.shares,
      priorValue: before.value,
    });
  }

  // Whatever is left in the map was held last quarter and is gone this quarter.
  for (const gone of prevBy.values()) {
    out.push({
      ...gone,
      value: 0,
      shares: 0,
      pctOfPortfolio: 0,
      status: 'exited',
      deltaShares: -(gone.shares ?? 0),
      deltaPct: -100,
      priorShares: gone.shares,
      priorValue: gone.value,
    });
  }

  const rank = { new: 0, added: 1, trimmed: 2, exited: 3, held: 4 };
  return out.sort((a, b) => (rank[a.status] - rank[b.status])
    || Math.abs(b.value ?? b.priorValue ?? 0) - Math.abs(a.value ?? a.priorValue ?? 0));
}
