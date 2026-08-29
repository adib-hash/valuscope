// Write-once artifact store for AI extractions, on Vercel Blob.
//
// Only ever holds derived artifacts keyed by immutable inputs —
// kpi/{cik}/{accession}.json — never user data. Without a
// BLOB_READ_WRITE_TOKEN the store degrades: to an in-memory map in local dev
// (so the feature is testable), and to plain unavailability on Vercel (the
// panel just doesn't render).

import { put, head, list } from '@vercel/blob';

const hasToken = () => !!process.env.BLOB_READ_WRITE_TOKEN;
const isVercel = () => !!process.env.VERCEL;

// Local-dev fallback so extraction can be exercised without a store.
const memory = new Map();

export function storeAvailable() {
  return hasToken() || !isVercel();
}

export function storeEphemeral() {
  return !hasToken();
}

export async function putJson(key, data) {
  if (!hasToken()) {
    if (isVercel()) throw new Error('Blob store not configured');
    memory.set(key, data);
    return;
  }
  await put(key, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export async function getJson(key) {
  if (!hasToken()) return memory.get(key) ?? null;
  try {
    const meta = await head(key);
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // head() throws on not-found
  }
}

export async function listKeys(prefix) {
  if (!hasToken()) return [...memory.keys()].filter((k) => k.startsWith(prefix));
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}
