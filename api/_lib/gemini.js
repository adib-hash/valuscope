// The one Gemini call. Structured output only: every caller passes a response
// schema, so what comes back is parsed JSON in a known shape or an error with
// an HTTP status the handler can map (429 is the free tier's rate limit).

export const GEMINI_MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Latency knob. Flash models reason before answering by default, and on a
// long structured extraction that reasoning is most of the wall time. Set
// GEMINI_THINKING_LEVEL (e.g. "low") to pass a thinkingConfig; unset, nothing
// is sent, so a model that does not accept the field is never sent it.
const thinkingConfig = () => {
  const level = process.env.GEMINI_THINKING_LEVEL;
  return level ? { thinkingConfig: { thinkingLevel: level } } : {};
};

export async function callGemini(apiKey, systemText, userText, schema, temperature = 0.2) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature, ...thinkingConfig() },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Gemini ${response.status}: ${detail.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }
  const payload = await response.json();
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Gemini returned unparseable JSON');
    err.status = 502;
    throw err;
  }
}

// Binds the key once so the pipeline modules take a plain function — which is
// also what lets the tests hand in a stub.
export const geminiFor = (apiKey) => (system, user, schema, temperature) =>
  callGemini(apiKey, system, user, schema, temperature);
