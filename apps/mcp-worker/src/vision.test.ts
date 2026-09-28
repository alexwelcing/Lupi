import { describe, expect, it } from 'vitest';
import { handleScanGist } from './gist';
import { handleScanIdentify } from './scan';
import { ScanVisionError, VISION_MODEL_DEFAULT, callVision, extractJson, structuredOutputSchema } from './vision';

const IDENTIFICATION = {
  subject: 'A coffee mug',
  confidence: 0.9,
  guesses: [{ label: 'coffee mug', probability: 0.9 }],
  headline: 'Clay that learned to hold coffee.',
  materials: [{ name: 'Glaze', share: 0.2, summary: 'glass skin', molecules: [{ name: 'Silica', formula: 'SiO2', role: 'the glass', share: null }] }],
  elements: ['O', 'Si', 'Al'],
  nothingToScan: false,
};

function completion(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      model: 'Qwen/Qwen3.6-35B-A3B',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content }, ...extra }],
      usage: { prompt_tokens: 900, completion_tokens: 300 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function recorder(responses: Response[]) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next;
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const CALL = { system: 'sys', text: 'what is this?', schemaName: 'x', schema: { type: 'object', properties: { a: { type: 'string', maxLength: 3 } } }, maxTokens: 100, task: 'describe this photo' };

describe('vision over Hugging Face Inference Providers', () => {
  it('sends an OpenAI-compatible chat completion with the photo, the token, and a strict schema', async () => {
    const { calls, fetcher } = recorder([completion('{"a":"ok"}')]);
    const reply = await callVision({ HF_TOKEN: 'hf_test' }, { ...CALL, image: { mediaType: 'image/jpeg', data: 'QUJD' } }, { fetcher });
    expect(reply.json).toEqual({ a: 'ok' });
    expect(reply.usage).toEqual({ inputTokens: 900, outputTokens: 300 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://router.huggingface.co/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer hf_test');
    const body = calls[0].body;
    expect(body.model).toBe(VISION_MODEL_DEFAULT);
    expect(body.reasoning_effort).toBeUndefined();
    const format = body.response_format as { type: string; json_schema: { strict: boolean; schema: unknown } };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    expect(JSON.stringify(format.json_schema.schema)).not.toContain('maxLength');
    const user = (body.messages as Array<{ role: string; content: unknown }>)[1];
    expect(user.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
      { type: 'text', text: 'what is this?' },
    ]);
  });

  it('asks once more without reasoning_effort when a provider rejects it', async () => {
    const { calls, fetcher } = recorder([new Response('bad param', { status: 400 }), completion('{"a":"ok"}')]);
    await callVision({ HF_TOKEN: 'hf_test', HF_VISION_MODEL: 'some/vlm:cheapest', HF_VISION_REASONING: 'low' }, CALL, { fetcher });
    expect(calls).toHaveLength(2);
    expect(calls[0].body.reasoning_effort).toBe('low');
    expect(calls[1].body.reasoning_effort).toBeUndefined();
    expect(calls[1].body.model).toBe('some/vlm:cheapest');
    expect(calls[1].body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'what is this?' },
    ]);
  });

  it('does not retry a 400 when no reasoning_effort was sent', async () => {
    const { calls, fetcher } = recorder([new Response('bad request', { status: 400 })]);
    await expect(callVision({ HF_TOKEN: 'hf_test' }, CALL, { fetcher })).rejects.toMatchObject({ reason: 'http-400' });
    expect(calls).toHaveLength(1);
  });

  it('maps failures to scan reasons without leaking the upstream body', async () => {
    const rate = recorder([new Response('slow down', { status: 429 })]);
    await expect(callVision({ HF_TOKEN: 't' }, CALL, { fetcher: rate.fetcher })).rejects.toMatchObject({ reason: 'rate-limited', status: 429 });
    const down = recorder([new Response('account 123 secret', { status: 503 })]);
    const error = await callVision({ HF_TOKEN: 't' }, CALL, { fetcher: down.fetcher }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanVisionError);
    expect((error as ScanVisionError).status).toBe(502);
    expect((error as ScanVisionError).message).not.toContain('secret');
    const long = recorder([completion('{"a":', { finish_reason: 'length' })]);
    await expect(callVision({ HF_TOKEN: 't' }, CALL, { fetcher: long.fetcher })).rejects.toMatchObject({ reason: 'invalid-response' });
    const filtered = recorder([completion('', { finish_reason: 'content_filter' })]);
    await expect(callVision({ HF_TOKEN: 't' }, CALL, { fetcher: filtered.fetcher })).rejects.toMatchObject({ reason: 'declined', status: 422 });
    await expect(callVision({}, CALL)).rejects.toMatchObject({ reason: 'not-configured' });
  });

  it('pulls the JSON out of thinking, fences, and chatter', () => {
    expect(extractJson('<think>hmm, a mug</think>\n{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a":3} hope that helps')).toEqual({ a: 3 });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('strips bounds the providers do not all honour', () => {
    expect(structuredOutputSchema({ type: 'array', maxItems: 4, items: { type: 'number', minimum: 0 } })).toEqual({ type: 'array', items: { type: 'number' } });
  });
});

describe('scan routes on HF_TOKEN', () => {
  const photo = JSON.stringify({ image: { mediaType: 'image/jpeg', data: 'QUJD' }, candidates: [{ key: 'gallery:sio2', title: 'SiO₂ amorphous silica', formula: 'SiO2', source: 'gallery' }] });

  it('answers configured:false without the token', async () => {
    const identify = await handleScanIdentify(new Request('https://x/v1/scan/identify', { method: 'POST', body: photo }), {}, { cache: null });
    expect(await identify.json()).toEqual({ configured: false });
    const gist = await handleScanGist(new Request('https://x/v1/scan/gist', { method: 'POST', body: JSON.stringify({ text: 'candy' }) }), {}, { cache: null });
    expect(await gist.json()).toEqual({ configured: false });
  });

  it('identifies a photo through the router and matches the gallery', async () => {
    const { calls, fetcher } = recorder([completion(JSON.stringify(IDENTIFICATION))]);
    const response = await handleScanIdentify(new Request('https://x/v1/scan/identify', { method: 'POST', body: photo }), { HF_TOKEN: 'hf_test' }, { fetcher, cache: null });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean; model: { vision: string; jev: string | null }; identification: { subject: string }; matches: Array<{ key: string }>; jev: unknown };
    expect(body.configured).toBe(true);
    expect(body.model.vision).toBe('Qwen/Qwen3.6-35B-A3B');
    expect(body.identification.subject).toBe('A coffee mug');
    expect(body.matches.map((match) => match.key)).toEqual(['gallery:sio2']);
    expect(body.jev).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('sketches a gist from text alone', async () => {
    const sketch = {
      label: 'candy',
      confidence: 0.8,
      revolved: false,
      outline: [],
      palette: { main: '#ff3366', accent: '#ffffff' },
      primitives: [{ kind: 'sphere', name: 'body', center: { x: 0, y: 0, z: 0 }, size: { x: 0.6, y: 0.6, z: 0.6 }, rotation: { x: 0, y: 0, z: 0 }, blend: 0, subtract: false }],
    };
    const { calls, fetcher } = recorder([completion(JSON.stringify(sketch))]);
    const response = await handleScanGist(new Request('https://x/v1/scan/gist', { method: 'POST', body: JSON.stringify({ text: 'candy' }) }), { HF_TOKEN: 'hf_test' }, { fetcher, cache: null });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean; gist: { label: string; primitives: unknown[] } };
    expect(body.configured).toBe(true);
    expect(body.gist.label).toBe('candy');
    expect(body.gist.primitives).toHaveLength(1);
    expect(typeof (calls[0].body.messages as Array<{ content: unknown }>)[1].content).toBe('string');
  });
});
