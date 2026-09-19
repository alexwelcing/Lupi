import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, MODEL, validChoice } from './client.mjs';
const criteria = { yes: 'Yes', no: 'No' };
const request = { model: MODEL, state: 'sample', questions: { decision: { type: 'choice', instructions: 'Decide', criteria } } };
const response = () => ({ model: MODEL, answers: { decision: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1, no: 0 } } } });
const ok = () => new Response(JSON.stringify(response()), { status: 200 });

test('missing key never calls the provider', async () => {
  let calls = 0; const evaluate = createClient({ fetchImpl: async () => { calls++; return ok(); } });
  assert.equal((await evaluate(request)).reason, 'not-configured'); assert.equal(calls, 0);
});
test('timeout is bounded even if a transport ignores abort; late answers are not cached', async () => {
  let finish, calls = 0; const evaluate = createClient({ apiKey: 'test', timeoutMs: 10,
    fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  assert.equal((await evaluate(request)).reason, 'timeout'); finish(ok());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await evaluate(request)).reason, 'timeout'); assert.equal(calls, 2); finish(ok());
});
for (const status of [401,429,529]) test(`HTTP ${status} falls back with no automatic retry`, async () => {
  let calls = 0; const evaluate = createClient({ apiKey: 'test', fetchImpl: async () => { calls++; return new Response('private upstream details', { status }); } });
  assert.equal((await evaluate(request)).reason, `http-${status}`); assert.equal(calls, 1);
});
test('malformed, missing, and wrong-model responses fail closed', async () => {
  for (const value of [{ model: MODEL, answers: {} }, { ...response(), model: 'different' }, { model: MODEL, answers: { decision: { type: 'choice', choice: 'yes' } } }]) {
    const evaluate = createClient({ apiKey: 'test', fetchImpl: async () => new Response(JSON.stringify(value)) });
    assert.equal((await evaluate(request)).reason, 'invalid-response');
  }
});
test('cache includes state and rubric; callers cannot mutate the stored answer', async () => {
  let calls = 0; const evaluate = createClient({ apiKey: 'test', fetchImpl: async () => { calls++; return ok(); } });
  const first = await evaluate(request); first.response.answers.decision.choice = 'no';
  const second = await evaluate(request); assert.equal(second.source, 'cache'); assert.equal(second.response.answers.decision.choice, 'yes');
  await evaluate({ ...request, state: 'changed' });
  await evaluate({ ...request, questions: { decision: { ...request.questions.decision, instructions: 'Different rubric' } } });
  assert.equal(calls, 3);
});
test('duplicate inflight requests share one provider call', async () => {
  let calls = 0; const evaluate = createClient({ apiKey: 'test', fetchImpl: async () => { calls++; await new Promise(resolve => setTimeout(resolve,5)); return ok(); } });
  const results = await Promise.all([evaluate(request), evaluate(request)]);
  assert.equal(calls, 1); assert.equal(results.length, 2);
});
test('choice validator rejects unknown keys, invalid probabilities and false winning labels', () => {
  const answer = response().answers.decision; assert.ok(validChoice(answer,criteria));
  for (const bad of [{...answer, choice:'delete'}, {...answer, confidence:NaN}, {...answer, probabilities:{yes:0.1,no:0.9}}, {...answer,probabilities:{yes:1}}, {...answer, probabilities:{yes:Infinity,no:0}}]) assert.equal(validChoice(bad,criteria),false);
});
