// The one Claude call, for earnings call summaries and the daily digest.
// Same contract as gemini.js: structured output only, so what comes back is
// parsed JSON in the schema's shape or an error carrying an HTTP status the
// handler can map.
//
// Sonnet 5.5 at low effort won the October 2026 bake-off on the summary
// pipeline (LLM-BAKEOFF-REPORT.html): 7.7 out of 10 against 5.2 for Gemini
// 3.6 Flash, a slowest stage of 37 seconds, about 25 cents a summary. Low
// effort is what was measured; higher effort writes longer and slower.

export const CLAUDE_MODEL = 'claude-sonnet-5-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Claude's structured outputs need every object closed to extra keys; the
// schemas in this codebase are written for Gemini, which rejects the keyword.
function closeSchema(s) {
  if (s?.type === 'object') {
    const properties = Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, closeSchema(v)]));
    return { ...s, properties, additionalProperties: false };
  }
  if (s?.type === 'array') return { ...s, items: closeSchema(s.items) };
  return s;
}

// `temperature` is accepted for the shared call signature and ignored:
// Sonnet 5.5 rejects non-default sampling parameters.
export async function callClaude(apiKey, systemText, userText, schema) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: systemText,
      messages: [{ role: 'user', content: userText }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: closeSchema(schema) } },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Claude ${response.status}: ${detail.slice(0, 300)}`);
    // 529 is Anthropic's "overloaded"; to the caller it is a rate limit.
    err.status = response.status === 529 ? 429 : response.status;
    throw err;
  }
  const payload = await response.json();
  if (payload.stop_reason === 'refusal' || payload.stop_reason === 'max_tokens') {
    const err = new Error(`Claude stopped early: ${payload.stop_reason}`);
    err.status = 502;
    throw err;
  }
  const raw = (payload.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Claude returned unparseable JSON');
    err.status = 502;
    throw err;
  }
}

export const claudeFor = (apiKey) => (system, user, schema) => callClaude(apiKey, system, user, schema);
