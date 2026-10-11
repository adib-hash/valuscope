// Insider transactions (SEC Forms 3, 4 and 5) for one issuer.
//
// Source: EDGAR's per-issuer ownership table (cgi-bin/own-disp). It lists
// every reported transaction — who, when, what kind, how many shares, and what
// they held afterwards — eighty rows a page, newest first, with a link to the
// filing behind each row. Pulling the Form 4 XML for every row instead would
// mean one request per filing: 299 filings for Meta over eighteen months,
// half a minute at SEC's ten-per-second limit.
//
// The table has no prices. Dollar amounts are estimated as shares × that
// day's closing price and labelled as estimates; open-market trades happen
// within the day's range, so the error is usually a few percent (Javier
// Olivan's 5 Oct 2026 sale: $728.08 actual, $741.90 close). The exact price
// and whether the trade was under a Rule 10b5-1 plan come from the filing
// itself, fetched one at a time on demand (filingDetail below).

const UA = 'ValueScope/1.0 (adib@ihsan.build)';
const PAGE = 80;
const MAX_PAGES = 30; // 2,400 rows: a very busy insider calendar over 18 months

async function secText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.text();
    // SEC answers bursts with 429 / 403; back off and retry.
    if (res.status !== 429 && res.status !== 403 && res.status < 500) throw new Error(`SEC responded ${res.status}`);
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw new Error('SEC is rate-limiting requests');
}

const decode = (s) => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

const cells = (row) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);

// Transaction codes (SEC Form 4, General Instructions 8). Only P and S are
// open-market trades — the ones that say something about what an insider
// thinks of the price. The rest are mechanics of compensation and estates.
export const CODE_LABELS = {
  P: 'Open-market purchase',
  S: 'Open-market sale',
  A: 'Grant or award',
  M: 'Option or RSU exercise',
  X: 'Option exercise',
  F: 'Shares withheld for tax',
  G: 'Gift',
  C: 'Conversion',
  D: 'Returned to company',
  J: 'Other',
  W: 'Inheritance',
  I: 'Discretionary',
  K: 'Equity swap',
};

// Title-case EDGAR's "SURNAME GIVEN" names, which arrive as "Olivan Javier".
function displayName(edgarName) {
  const parts = edgarName.split(' ').filter(Boolean);
  if (parts.length < 2) return edgarName;
  // EDGAR stores surname first; show "Javier Olivan".
  const [last, ...rest] = parts;
  // A generational suffix stays at the end: "Russell Frederick L. Jr." is
  // Frederick L. Russell Jr., not Frederick L. Jr. Russell.
  const suffix = /^(jr|sr|ii|iii|iv)\.?$/i.test(rest.at(-1) || '') ? rest.pop() : null;
  const name = [...rest, last, ...(suffix ? [suffix] : [])].join(' ');
  // Some filers come through in capitals ("LI SUSAN J"); others are mixed
  // case already and are left alone ("McCaffrey", "de Mello").
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

function parseRole(type) {
  // "officer: Chief Legal Officer", "director", "10 percent owner", or several
  // separated by commas.
  const t = decode(type);
  const officer = t.match(/officer:\s*([^,]+)/i)?.[1]?.trim();
  const roles = [];
  if (officer) roles.push(officer);
  if (/director/i.test(t)) roles.push('Director');
  if (/10 percent owner/i.test(t)) roles.push('10% owner');
  if (!roles.length && t) roles.push(t.replace(/^other:\s*/i, ''));
  return roles.join(' · ');
}

function parsePage(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const owners = new Map();
  const rows = [];
  for (const table of tables) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const header = cells(trs[0] || '').map(decode);
    if (header[0] === 'Owner' && header.includes('Type of Owner')) {
      for (const tr of trs.slice(1)) {
        const c = cells(tr);
        const cik = decode(c[1]);
        owners.set(decode(c[0]), { cik, role: parseRole(c[3]) });
      }
    } else if (header.includes('Transaction Type') && header.includes('Number of Securities Transacted')) {
      for (const tr of trs.slice(1)) {
        const c = cells(tr);
        if (c.length < 12) continue;
        const href = c[4].match(/href="([^"]+)"/i)?.[1] || '';
        const type = decode(c[5]);
        rows.push({
          ad: decode(c[0]),
          date: decode(c[1]),
          owner: decode(c[3]),
          form: decode(c[4]),
          filing: href ? `https://www.sec.gov${href}` : null,
          accession: href.match(/(\d{10}-\d{2}-\d{6})-index/)?.[1] || null,
          code: type.split('-')[0].trim(),
          direct: /D$/.test(decode(c[6])),
          shares: Number(decode(c[7]).replace(/,/g, '')) || 0,
          ownedAfter: Number(decode(c[8]).replace(/,/g, '')) || 0,
          line: Number(decode(c[9])) || 0,
          security: decode(c[11]),
        });
      }
    }
  }
  return { owners, rows };
}

// Common stock, by any of the names issuers use for it; options, units and
// other derivative lines are excluded from the money totals.
const isCommon = (security) => /common|ordinary|class [abc] (stock|shares)/i.test(security)
  && !/option|unit|warrant|right|preferred|note|debenture/i.test(security);

/**
 * Every reported transaction since `since` (YYYY-MM-DD), newest first, with
 * the owners' roles. Pages are fetched until one reaches past `since`.
 */
export async function fetchInsiderTransactions(cik, since) {
  const owners = new Map();
  const rows = [];
  const pageUrl = (page) => `https://www.sec.gov/cgi-bin/own-disp?action=getissuer&CIK=${cik}&type=&dateb=&owner=include&start=${page * PAGE}`;
  // The page count isn't known up front, so pages go out four at a time —
  // well inside SEC's ten requests a second — until one reaches past `since`.
  // Meta's eighteen months is sixteen pages: about five seconds this way,
  // nineteen one at a time.
  const BATCH = 4;
  for (let first = 0; first < MAX_PAGES; first += BATCH) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(BATCH, MAX_PAGES - first) }, (_, i) => secText(pageUrl(first + i)).then(parsePage)),
    );
    let done = false;
    for (const parsed of batch) {
      if (done) break;
      for (const [k, v] of parsed.owners) if (!owners.has(k)) owners.set(k, v);
      rows.push(...parsed.rows);
      const oldest = parsed.rows.at(-1)?.date;
      if (parsed.rows.length < PAGE || (oldest && oldest < since)) done = true;
    }
    if (done) break;
  }
  const seen = new Set();
  const transactions = rows
    .filter((r) => r.date >= since && r.shares > 0)
    // An amended filing repeats its original's lines.
    .filter((r) => {
      const key = `${r.accession}|${r.line}|${r.owner}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({
      ...r,
      name: displayName(r.owner),
      role: owners.get(r.owner)?.role || '',
      ownerCik: owners.get(r.owner)?.cik || null,
      common: isCommon(r.security),
      label: CODE_LABELS[r.code] || r.code,
    }));
  return transactions;
}

// ── Filing detail, on demand ────────────────────────────────────────────────

const tag = (xml, name) => xml.match(new RegExp(`<${name}>\\s*(?:<value>)?\\s*([^<]*)`, 'i'))?.[1]?.trim() ?? null;

/**
 * The exact prices, the Rule 10b5-1 flag and the footnotes for one filing.
 */
export async function filingDetail(cik, accession) {
  const folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}`;
  const index = JSON.parse(await secText(`${folder}/index.json`));
  const xmlName = (index.directory?.item || []).map((i) => i.name).find((n) => /\.xml$/i.test(n) && !/^primary_doc|FilingSummary/i.test(n))
    || (index.directory?.item || []).map((i) => i.name).find((n) => /\.xml$/i.test(n));
  if (!xmlName) throw new Error('No ownership document in that filing');
  const xml = await secText(`${folder}/${xmlName}`);

  const lines = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)].map((m) => {
    const t = m[1];
    return {
      date: tag(t, 'transactionDate'),
      code: tag(t, 'transactionCode'),
      shares: Number(tag(t, 'transactionShares')) || 0,
      price: Number(tag(t, 'transactionPricePerShare')) || null,
      ad: tag(t, 'transactionAcquiredDisposedCode'),
      ownedAfter: Number(tag(t, 'sharesOwnedFollowingTransaction')) || null,
      direct: tag(t, 'directOrIndirectOwnership') === 'D',
      nature: tag(t, 'natureOfOwnership'),
    };
  });
  // Forms filed since April 2023 carry an explicit checkbox; older ones only
  // say so in a footnote.
  const box = tag(xml, 'aff10b5One');
  const footnotes = [...xml.matchAll(/<footnote id="[^"]*">([\s\S]*?)<\/footnote>/gi)].map((m) => decode(m[1]));
  const plan = box === '1' || box === 'true'
    ? true
    : footnotes.some((f) => /10b5-1/i.test(f)) ? true : box === '0' || box === 'false' ? false : null;
  const totalShares = lines.reduce((a, l) => a + l.shares, 0);
  const totalValue = lines.reduce((a, l) => a + (l.price ? l.price * l.shares : 0), 0);
  return {
    accession,
    filing: `${folder}/${accession}-index.htm`,
    lines,
    plan,
    footnotes,
    averagePrice: totalShares && totalValue ? totalValue / totalShares : null,
  };
}
