import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, buildRequest, resolveDecision, interpret, localAction } from './interpreter.mjs';
import { MODEL } from './client.mjs';
const answer = (choice, criteria) => ({ type: 'choice', choice, confidence:1, probabilities:Object.fromEntries(Object.keys(criteria).map(key=>[key,key===choice?1:0])) });
const response = (action,scope='single') => {
  const request=buildRequest('sample');
  return {model:MODEL,answers:{action:answer(action,request.questions.action.criteria),scope:answer(scope,request.questions.scope.criteria)}};
};
test('all local commands avoid network and map to owned typed values', async () => {
  for (const [text,expected] of [['pause','pause'],['top view','top'],['hide bonds','hide_bonds'],['show axes','show_axes']]) {
    const result=await interpret(text,()=>{throw new Error('network must not run');});
    assert.equal(result.source,'local');assert.equal(result.action,expected);assert.deepEqual(result.command,ACTIONS[expected]);
  }
});
test('local matching is whole-input only, so negation and compounds do not become commands',()=>{
  for(const text of ['do not pause','pause and play','explain hide bonds','pause; delete',''])assert.equal(localAction(text),null);
});
test('unsupported, compounds, and low-confidence results never produce executable commands',()=>{
  assert.equal(resolveDecision(response('unsupported')).action,null);
  assert.equal(resolveDecision(response('pause','other')).action,null);
  const low=response('pause');low.answers.action.confidence=0.4;assert.equal(resolveDecision(low).action,null);
  const unknown=response('pause');unknown.answers.action.choice='lupi.delete_all';assert.equal(resolveDecision(unknown).action,null);
});
test('model cannot supply arbitrary arguments',()=>{
  const malicious=response('top');malicious.answers.action.arguments={url:'https://untrusted.invalid'};
  assert.deepEqual(resolveDecision(malicious).command,{tool:'lupi.set_camera_preset',arguments:{preset:'top'}});
});
test('inference failure is a no-op and invalid input cannot reach the provider',async()=>{
  assert.equal((await interpret('Look from above',async()=>({source:'fallback',reason:'timeout'}))).action,null);
  for(const bad of [null,'','x'.repeat(601)])await assert.rejects(()=>interpret(bad,()=>{throw new Error('should not call');}));
});
