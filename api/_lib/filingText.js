// EDGAR HTML → structured text blocks.
//
// Primary documents are inline-XBRL HTML running 5-15MB — over Vercel's
// response cap and unsafe to inject raw. A SAX walk (htmlparser2) reduces them
// to typed blocks: { t:'h', level, text } | { t:'p', text } | { t:'table',
// rows }. That one representation solves size, XSS, theming, in-doc search,
// and gives the AI ops clean text. The converter is expected to be imperfect
// on old or odd filings — the reader always links the EDGAR original.

import { Parser } from 'htmlparser2';

const SKIP_TAGS = new Set(['script', 'style', 'head', 'title']);
// ix:header (and its ix:hidden payload) is XBRL bookkeeping, not prose.
const DROP_PREFIXED = ['ix:header', 'ix:hidden'];
const BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'tr']);
const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3, h4: 3, h5: 4, h6: 4 };

const MAX_BLOCKS = 20000;
const MAX_TOTAL_CHARS = 3_500_000;

const clean = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// Page-number lines and horizontal-rule junk between pages.
const isArtifact = (text) =>
  /^\d{1,3}$/.test(text) ||
  (/^(table of contents|index)$/i.test(text) && text.length < 20) ||
  // Running page footers: "Apple Inc. | 2025 Form 10-K | 20" — repeated on
  // every page of the filed document.
  (text.length < 90 && /\|\s*\d{1,3}$/.test(text) && /form\s+\d+-[KQ]/i.test(text));

export function htmlToBlocks(html) {
  // Pre-2001 filings are plain text wrapped in <SEC-DOCUMENT> headers, not
  // HTML. If there's no real markup, fall back to blank-line paragraphs.
  if (!/<(p|div|table|html|body)[\s>]/i.test(html)) {
    const blocks = html
      .split(/\n\s*\n/)
      .map((chunk) => clean(chunk))
      .filter(Boolean)
      .slice(0, MAX_BLOCKS)
      .map((text) => ({ t: 'p', text }));
    return { blocks, truncated: false };
  }

  const blocks = [];
  let totalChars = 0;
  let truncated = false;

  let skipDepth = 0;   // inside script/style/ix:header
  let boldDepth = 0;
  // Modern filings (Apple's among them) bold their headings with inline
  // font-weight styles rather than b/strong tags — track those too. The stack
  // remembers whether each open tag matched so the close can decrement.
  const styleBoldStack = [];
  let headingTag = null;

  let buffer = '';
  let bufferAllBold = true;
  let bufferHasText = false;

  // Table state. Nested tables are flattened into the outermost one — layout
  // tables inside financial tables are a presentation detail, not structure.
  let tableDepth = 0;
  let rows = null;
  let row = null;
  let cell = '';

  const push = (block) => {
    if (blocks.length >= MAX_BLOCKS || totalChars >= MAX_TOTAL_CHARS) {
      truncated = true;
      return false;
    }
    blocks.push(block);
    totalChars += block.t === 'table'
      ? block.rows.reduce((n, r) => n + r.join(' ').length, 0)
      : block.text.length;
    return true;
  };

  const flush = () => {
    const text = clean(buffer);
    buffer = '';
    const allBold = bufferAllBold;
    bufferAllBold = true;
    bufferHasText = false;
    if (!text || isArtifact(text)) return;
    if (headingTag) {
      push({ t: 'h', level: HEADING_LEVEL[headingTag] ?? 3, text });
    } else if (allBold && text.length < 120) {
      // Most filings mark section heads with bold paragraphs, not h-tags.
      push({ t: 'h', level: 3, text });
    } else {
      push({ t: 'p', text });
    }
  };

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (SKIP_TAGS.has(name) || DROP_PREFIXED.includes(name)) { skipDepth++; return; }
        if (skipDepth) return;
        const styleBold = /font-weight\s*:\s*(bold|[7-9]00)/i.test(attribs?.style || '');
        styleBoldStack.push(styleBold);
        if (name === 'b' || name === 'strong' || styleBold) boldDepth++;
        if (name === 'table') {
          if (tableDepth === 0) { flush(); rows = []; row = null; cell = ''; }
          tableDepth++;
          return;
        }
        if (tableDepth > 0) {
          if (name === 'tr' && tableDepth === 1) { if (row?.length) rows.push(row); row = []; }
          if ((name === 'td' || name === 'th') && tableDepth === 1) cell = '';
          return;
        }
        if (HEADING_LEVEL[name]) { flush(); headingTag = name; return; }
        if (BLOCK_TAGS.has(name)) flush();
      },
      ontext(text) {
        if (skipDepth) return;
        if (tableDepth > 0) { cell += text; return; }
        if (text.trim()) {
          bufferHasText = true;
          if (boldDepth === 0) bufferAllBold = false;
        }
        buffer += text;
      },
      onclosetag(name) {
        if (SKIP_TAGS.has(name) || DROP_PREFIXED.includes(name)) { skipDepth = Math.max(0, skipDepth - 1); return; }
        if (skipDepth) return;
        const wasStyleBold = styleBoldStack.pop();
        if (name === 'b' || name === 'strong' || wasStyleBold) boldDepth = Math.max(0, boldDepth - 1);
        if (name === 'table') {
          tableDepth = Math.max(0, tableDepth - 1);
          if (tableDepth === 0 && rows) {
            if (row?.length) rows.push(row);
            const cleaned = rows
              .map((r) => r.map(clean))
              .filter((r) => r.some(Boolean));
            // Page footers are usually one-row layout tables, not data.
            const degenerate =
              cleaned.length === 1 && isArtifact(cleaned[0].filter(Boolean).join(' | '));
            if (cleaned.length && !degenerate) push({ t: 'table', rows: cleaned });
            rows = null; row = null; cell = '';
          }
          return;
        }
        if (tableDepth > 0) {
          if ((name === 'td' || name === 'th') && tableDepth === 1 && row) { row.push(cell); cell = ''; }
          if (name === 'tr' && tableDepth === 1 && row) { rows.push(row); row = null; }
          return;
        }
        if (HEADING_LEVEL[name]) { flush(); headingTag = null; return; }
        if (BLOCK_TAGS.has(name)) flush();
      },
      onend() { flush(); },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );

  parser.write(html);
  parser.end();

  return { blocks, truncated };
}

// Item 1 / 1A / 7 / 7A / 8… jump navigation, best effort. A table of contents
// lists every item early in the document; the body repeats them later — for a
// duplicated item number, the later occurrence wins. Empty result = no nav.
const ITEM_RE = /^item\s+(\d{1,2}[A-C]?)[.:—\-\s]/i;

export function detectSections(blocks) {
  const byItem = new Map();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t !== 'h' && !(b.t === 'p' && b.text.length < 150)) continue;
    const m = ITEM_RE.exec(b.text);
    if (!m) continue;
    const item = m[1].toUpperCase();
    byItem.set(item, { item, title: b.text.slice(0, 120), blockIndex: i });
  }
  return [...byItem.values()].sort((a, b) => a.blockIndex - b.blockIndex);
}

// Plain text for the AI ops. Optional [fromItem, toItem) window over the
// detected sections.
export function blocksToText(blocks, { sections, fromItem, toItem, maxChars = Infinity } = {}) {
  let start = 0;
  let end = blocks.length;
  if (sections?.length && fromItem) {
    const from = sections.find((s) => s.item === fromItem);
    if (from) start = from.blockIndex;
    if (toItem) {
      const to = sections.find((s) => s.item === toItem);
      if (to && to.blockIndex > start) end = to.blockIndex;
    }
  }
  const out = [];
  let n = 0;
  for (let i = start; i < end && n < maxChars; i++) {
    const b = blocks[i];
    const text = b.t === 'table' ? b.rows.map((r) => r.join(' | ')).join('\n') : b.text;
    out.push(b.t === 'h' ? `\n## ${text}` : text);
    n += text.length;
  }
  return out.join('\n');
}
