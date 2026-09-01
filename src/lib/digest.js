// Runs a day's earnings digest: one summary per call, then one read across
// them. Lives outside the component so the work survives a re-render and so
// the pacing rules are in one place.
//
// The pacing is the point. Gemini's free tier allows a handful of requests a
// minute, and a busy day has thirty S&P 500 calls. Two at a time, with a
// pause and retry on a rate-limit answer, reads a heavy day in a few minutes
// without ever tripping into a wall of failures. Every finished summary is
// stored server-side, so a second run of the same day — after a failure, or
// tomorrow — only pays for what is still missing.

import { fetchSummary, synthesizeDigest } from './api';

const CONCURRENCY = 2;
const RATE_LIMIT_WAIT_MS = 20_000;
const RATE_LIMIT_RETRIES = 4;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

async function summariseWithBackoff(event, signal) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fetchSummary(event.symbol, event.transcript.year, event.transcript.quarter);
    } catch (err) {
      const rateLimited = err.status === 429;
      if (!rateLimited || attempt >= RATE_LIMIT_RETRIES) throw err;
      await sleep(RATE_LIMIT_WAIT_MS, signal);
    }
  }
}

/**
 * @param {string} date                YYYY-MM-DD
 * @param {Array} events               calendar events with a transcript
 * @param {object} opts
 * @param {(state) => void} opts.onUpdate   called with the full state on every change
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<state>}
 */
export async function runDigest(date, events, { onUpdate, signal } = {}) {
  const calls = events
    .filter((e) => e.transcript)
    .map((e) => ({ event: e, status: 'queued', result: null, error: '' }));

  const state = { date, calls, synthesis: { status: 'idle', result: null, error: '' } };
  const emit = () => onUpdate?.({ ...state, calls: state.calls.map((c) => ({ ...c })) });
  emit();

  // A tiny worker pool: each worker takes the next queued call until none
  // are left. Order is the calendar's order, largest company first, so the
  // names most people came for are read first.
  let cursor = 0;
  const worker = async () => {
    while (cursor < calls.length) {
      if (signal?.aborted) return;
      const call = calls[cursor++];
      call.status = 'reading';
      emit();
      try {
        call.result = await summariseWithBackoff(call.event, signal);
        call.status = 'done';
      } catch (err) {
        if (err.name === 'AbortError') return;
        call.status = 'failed';
        call.error = err.message || 'Could not summarise this call.';
      }
      emit();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, calls.length) }, worker));
  if (signal?.aborted) return state;

  const done = calls.filter((c) => c.status === 'done');
  if (!done.length) {
    state.synthesis = { status: 'skipped', result: null, error: '' };
    emit();
    return state;
  }

  // One call is a summary, not a digest; the cross-call read only earns its
  // place with something to compare.
  if (done.length < 2) {
    state.synthesis = { status: 'skipped', result: null, error: '' };
    emit();
    return state;
  }

  state.synthesis = { status: 'running', result: null, error: '' };
  emit();
  try {
    const payload = done.map((c) => ({
      symbol: c.event.symbol,
      name: c.event.name,
      year: c.result.year,
      quarter: c.result.quarter,
      summary: c.result.summary,
    }));
    let result;
    for (let attempt = 0; ; attempt++) {
      try {
        result = await synthesizeDigest(date, payload);
        break;
      } catch (err) {
        if (err.status !== 429 || attempt >= RATE_LIMIT_RETRIES) throw err;
        await sleep(RATE_LIMIT_WAIT_MS, signal);
      }
    }
    state.synthesis = { status: 'done', result, error: '' };
  } catch (err) {
    if (err.name === 'AbortError') return state;
    state.synthesis = { status: 'failed', result: null, error: err.message || 'Could not write the digest.' };
  }
  emit();
  return state;
}

// A finished digest is kept for the session, keyed by day and by the set of
// calls it covered, so flipping between days does not re-run anything. The
// server-side store makes a re-run cheap anyway; this makes it instant.
const finished = new Map();

export const digestCacheKey = (date, events) =>
  `${date}|${events.filter((e) => e.transcript).map((e) => `${e.symbol}:${e.transcript.year}:${e.transcript.quarter}`).sort().join(',')}`;

export const getFinishedDigest = (key) => finished.get(key) || null;
export const setFinishedDigest = (key, state) => { finished.set(key, state); };
