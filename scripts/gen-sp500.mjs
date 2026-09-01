import fs from 'node:fs';
// Regenerates api/_lib/sp500.js from the datasets/s-and-p-500-companies CSV.
//   node scripts/gen-sp500.mjs [constituents.csv] [out.js]
// With no arguments the CSV is downloaded.
const CSV_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';
const csv = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : await (await fetch(CSV_URL)).text();
const OUT = process.argv[3] || new URL('../api/_lib/sp500.js', import.meta.url).pathname;
// Minimal RFC-4180 parse: quoted fields may hold commas.
function parseLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const lines = csv.trim().split(/\r?\n/);
const header = parseLine(lines[0]);
const iSym = header.indexOf('Symbol'), iName = header.indexOf('Security'), iSec = header.indexOf('GICS Sector');
const rows = lines.slice(1).map(parseLine).map((r) => ({
  symbol: r[iSym].trim().replace(/\./g, '-'), name: r[iName].trim(), sector: r[iSec].trim(),
})).sort((a, b) => a.symbol.localeCompare(b.symbol));
const seen = new Set();
for (const r of rows) { if (seen.has(r.symbol)) throw new Error('dup ' + r.symbol); seen.add(r.symbol); }
const today = new Date().toISOString().slice(0, 10);
const body = rows.map((r) => `  [${JSON.stringify(r.symbol)}, ${JSON.stringify(r.name)}, ${JSON.stringify(r.sector)}],`).join('\n');
const src = `// S&P 500 constituents, as a bundled snapshot.
//
// Generated from the datasets/s-and-p-500-companies CSV on GitHub (itself
// maintained from the Wikipedia constituents table), so it is free, keyless
// and refreshed by its maintainers within days of an index change. The
// runtime fetch in getSp500() picks those changes up without a redeploy; this
// snapshot is what serves when that fetch fails, so the calendar never goes
// dark because of a GitHub blip. Regenerate with:
//
//   node scripts/gen-sp500.mjs
//
// Class shares use Yahoo's dash form (BRK-B), which is also how the defeatbeta
// transcript dataset spells them.

export const SP500_AS_OF = '${today}';

// [symbol, company, GICS sector]
export const SP500_SNAPSHOT = [
${body}
];

const CSV_URL =
  'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';
const REFRESH_MS = 24 * 60 * 60 * 1000;

const toRows = (list) => list.map(([symbol, name, sector]) => ({ symbol, name, sector }));

// Quoted fields may hold commas ("Foo, Inc."), so a split on commas is not enough.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseConstituentsCsv(csv) {
  const lines = csv.trim().split(/\\r?\\n/);
  const header = parseCsvLine(lines[0]);
  const iSym = header.indexOf('Symbol');
  const iName = header.indexOf('Security');
  const iSector = header.indexOf('GICS Sector');
  if (iSym < 0 || iName < 0) throw new Error('Unexpected constituents CSV header');
  const seen = new Set();
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const symbol = (cells[iSym] || '').trim().replace(/\\./g, '-');
    if (!/^[A-Z][A-Z0-9-]{0,6}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    rows.push({ symbol, name: (cells[iName] || '').trim(), sector: (cells[iSector] || '').trim() });
  }
  return rows;
}

let live = null; // { rows, fetchedAt }

// The live list when it can be had, the snapshot otherwise. A list that came
// back implausibly short (a truncated download, a format change) is rejected
// rather than trusted, because a 200-company "S&P 500" would silently hide
// most of the calendar.
export async function getSp500() {
  if (live && Date.now() - live.fetchedAt < REFRESH_MS) return live.rows;
  try {
    const res = await fetch(CSV_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const rows = parseConstituentsCsv(await res.text());
    if (rows.length < 480) throw new Error(\`only \${rows.length} rows\`);
    live = { rows, fetchedAt: Date.now() };
    return rows;
  } catch (err) {
    console.warn(\`S&P 500 list fetch failed, using snapshot (\${SP500_AS_OF}): \${err.message}\`);
    return toRows(SP500_SNAPSHOT);
  }
}
`;
fs.writeFileSync(OUT, src);
console.log('rows', rows.length, 'sample', rows.slice(0, 3), rows.filter(r => r.symbol.includes('-')));
