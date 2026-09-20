import { describe, expect, it } from 'vitest';
import {
  JEV_MODEL_PINNED,
  JevError,
  encodeRequest,
  systemOne,
  validChoice,
  validateAnswers,
  warmConnection,
  type JevRequest,
} from './client';

const criteria = { yes: 'Yes', no: 'No' };
const request: JevRequest = { state: 'sample', questions: { decision: { type: 'choice', instructions: 'Decide', criteria } } };
const answer = () => ({ type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1, no: 0 } });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = () => reply({ model: JEV_MODEL_PINNED, answers: { decision: answer() } });

async function failure(config: Parameters<typeof systemOne>[0], req = request): Promise<JevError> {
  try {
    await systemOne(config, req);
  } catch (error) {
    if (error instanceof JevError) return error;
    throw error;
  }
  throw new Error('expected systemOne to throw');
}

describe('systemOne', () => {
  it('never calls the provider without a key', async () => {
    let calls = 0;
    const error = await failure({ apiKey: undefined, fetch: async () => { calls += 1; return ok(); } });
    expect(error.reason).toBe('not-configured');
    expect(error.status).toBe(503);
    expect(calls).toBe(0);
  });

  it('encodes the model, state, and questions only', () => {
    const body = JSON.parse(encodeRequest({ model: 'jev-1.13.0' }, request));
    expect(Object.keys(body)).toEqual(['model', 'state', 'questions']);
    expect(body.model).toBe('jev-1.13.0');
    expect(JSON.parse(encodeRequest({}, request)).model).toBe('jev-latest');
  });

  it('sends the bearer key to the configured base and returns validated answers', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const result = await systemOne(
      { apiKey: 'k', baseUrl: 'https://gateway.test/', fetch: async (url, init) => { seen.push({ url: String(url), init: init ?? {} }); return ok(); } },
      request,
    );
    expect(result.answers.decision).toMatchObject({ type: 'choice', choice: 'yes' });
    expect(seen[0].url).toBe('https://gateway.test/v1/systemone');
    expect(new Headers(seen[0].init.headers).get('authorization')).toBe('Bearer k');
  });

  it('bounds the deadline even when the transport ignores abort', async () => {
    let finish: ((value: Response) => void) | undefined;
    const error = await failure({ apiKey: 'k', timeoutMs: 10, fetch: () => new Promise<Response>((resolve) => { finish = resolve; }) });
    expect(error.reason).toBe('timeout');
    expect(error.status).toBe(504);
    finish?.(ok());
  });

  it('does not retry timeouts, and retries 429 only when asked', async () => {
    let calls = 0;
    const limited = async () => { calls += 1; return new Response('private upstream details', { status: 429, headers: { 'retry-after': '3' } }); };
    const first = await failure({ apiKey: 'k', fetch: limited });
    expect(first.reason).toBe('rate-limited');
    expect(first.retryAfterSeconds).toBe(3);
    expect(first.message).not.toContain('private');
    expect(calls).toBe(1);
    calls = 0;
    const second = await failure({ apiKey: 'k', fetch: limited, retries: 1, retryDelayMs: 0 });
    expect(second.status).toBe(429);
    expect(calls).toBe(2);
  });

  it('maps other HTTP failures without leaking the body', async () => {
    const error = await failure({ apiKey: 'k', fetch: async () => new Response('secret', { status: 401 }) });
    expect(error.reason).toBe('http-401');
    expect(error.status).toBe(401);
    expect(error.message).not.toContain('secret');
  });

  it('fails closed on malformed, incomplete, or wrong-model responses', async () => {
    const bad = [
      { model: JEV_MODEL_PINNED, answers: {} },
      { model: JEV_MODEL_PINNED, answers: { decision: { type: 'choice', choice: 'yes' } } },
      { model: JEV_MODEL_PINNED, answers: { decision: answer(), extra: answer() } },
      { answers: { decision: answer() } },
    ];
    for (const body of bad) {
      const error = await failure({ apiKey: 'k', fetch: async () => reply(body) });
      expect(error.reason).toBe('invalid-response');
    }
    const wrongModel = await failure({ apiKey: 'k', model: 'jev-1.12.0', fetch: async () => ok() });
    expect(wrongModel.reason).toBe('invalid-response');
    const alias = await systemOne({ apiKey: 'k', model: 'jev-latest', fetch: async () => ok() }, request);
    expect(alias.model).toBe(JEV_MODEL_PINNED);
  });

  it('validates noul and score answers by declared type', () => {
    const questions: JevRequest['questions'] = {
      fit: { type: 'noul', instructions: 'fits' },
      grade: { type: 'score', instructions: 'grade', criteria: ['low', 'high'] },
    };
    expect(validateAnswers(questions, { model: 'm', answers: { fit: { type: 'noul', noul: 0.4 }, grade: { type: 'score', score: 1, confidence: 0.8, probabilities: { low: 0.2, high: 0.8 } } } })).toBe(true);
    expect(validateAnswers(questions, { model: 'm', answers: { fit: { type: 'noul', noul: 1.4 }, grade: { type: 'score', score: 1, confidence: 0.8, probabilities: { low: 0.2, high: 0.8 } } } })).toBe(false);
    expect(validateAnswers(questions, { model: 'm', answers: { fit: { type: 'choice', choice: 'x' }, grade: { type: 'score', score: 1, confidence: 0.8, probabilities: { low: 0.2, high: 0.8 } } } })).toBe(false);
  });
});

describe('validChoice', () => {
  it('rejects unknown labels, invalid probabilities, and false winners', () => {
    const good = answer();
    expect(validChoice(good, criteria)).toBe(true);
    for (const bad of [
      { ...good, choice: 'delete' },
      { ...good, confidence: Number.NaN },
      { ...good, probabilities: { yes: 0.1, no: 0.9 } },
      { ...good, probabilities: { yes: 1 } },
      { ...good, probabilities: { yes: Number.POSITIVE_INFINITY, no: 0 } },
    ]) {
      expect(validChoice(bad, criteria)).toBe(false);
    }
  });
});

describe('warmConnection', () => {
  it('is false without a key and true on a 2xx models listing', async () => {
    expect(await warmConnection({ apiKey: '' })).toBe(false);
    expect(await warmConnection({ apiKey: 'k', fetch: async () => new Response('[]', { status: 200 }) })).toBe(true);
    expect(await warmConnection({ apiKey: 'k', fetch: async () => { throw new Error('down'); } })).toBe(false);
  });
});
