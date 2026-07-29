// Gemini-backed summary of an earnings call.
//
// Explicitly user-triggered: nothing here runs unless someone presses the
// button, both because the call costs a few seconds and because an unrequested
// AI summary is not something a valuation tool should be pushing at you.
//
// The API key stays server-side. Summaries are derived from a transcript that
// never changes once published, so a given ticker/quarter is generated once and
// then served from the edge cache.

import { getTranscript } from './_lib/transcripts.js';

const MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Guardrails matter here more than usual: this is financial content, and the
// summary sits next to real valuation numbers. Keep it strictly extractive.
const SYSTEM_INSTRUCTION = `You summarise earnings call transcripts for an investor's own research notes.

Rules:
- Ground every statement strictly in the supplied transcript. Never add outside knowledge and never speculate.
- Never give investment advice, a price view, or any recommendation to buy, sell or hold.
- Attribute forward-looking statements to management ("management expects…") rather than asserting them as fact.
- Quote the specific figures management gave, with units.
- Keep each bullet to one tight sentence.
- If a section has nothing in the transcript to support it, return an empty list for it rather than inventing content.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    keyTakeaways: { type: 'array', items: { type: 'string' } },
    financialHighlights: { type: 'array', items: { type: 'string' } },
    guidance: { type: 'array', items: { type: 'string' } },
    analystFocus: { type: 'array', items: { type: 'string' } },
    risksMentioned: { type: 'array', items: { type: 'string' } },
  },
  required: ['overview', 'keyTakeaways', 'financialHighlights', 'guidance', 'analystFocus', 'risksMentioned'],
};

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(501).json({ error: 'Summaries are not configured on this deployment.' });
  }

  const { ticker, year, quarter } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker parameter' });

  const symbol = String(ticker).toUpperCase().trim();
  if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid ticker' });
  }
  const fiscalYear = year ? Number(year) : null;
  const fiscalQuarter = quarter ? Number(quarter) : null;
  if ((year && !Number.isInteger(fiscalYear)) || (quarter && !Number.isInteger(fiscalQuarter))) {
    return res.status(400).json({ error: 'Invalid year or quarter' });
  }

  try {
    const transcript = await getTranscript(symbol, fiscalYear, fiscalQuarter);
    if (!transcript?.paragraphs?.length) {
      return res.status(404).json({ error: `No transcript available for ${symbol}.` });
    }

    const text = transcript.paragraphs
      .map((p) => `${p.speaker}: ${p.content}`)
      .join('\n\n');

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{
          role: 'user',
          parts: [{
            text: `Summarise this ${symbol} earnings call (fiscal Q${transcript.quarter} ${transcript.year}).\n\n`
              + `<transcript>\n${text}\n</transcript>`,
          }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`Gemini ${response.status} for ${symbol}: ${detail.slice(0, 300)}`);
      // 429 is the free tier's rate limit, which is worth saying plainly rather
      // than surfacing as a generic failure.
      if (response.status === 429) {
        return res.status(429).json({
          error: 'Summary limit reached for now. Try again in a few minutes.',
        });
      }
      return res.status(502).json({ error: 'The summary service is unavailable right now.' });
    }

    const payload = await response.json();
    const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';

    let summary;
    try {
      summary = JSON.parse(raw);
    } catch {
      console.error(`Gemini returned unparseable JSON for ${symbol}`);
      return res.status(502).json({ error: 'The summary came back malformed. Try again.' });
    }

    // Same transcript in, same summary out — cache hard, refresh in background.
    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000');
    return res.status(200).json({
      symbol,
      year: transcript.year,
      quarter: transcript.quarter,
      reportDate: transcript.reportDate,
      summary,
      model: MODEL,
      generatedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Summarize error:', err);
    res.setHeader('Cache-Control', 's-maxage=60');
    return res.status(500).json({ error: `Failed to summarise: ${err.message}` });
  }
}
