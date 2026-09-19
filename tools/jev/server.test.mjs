import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { startDemo } from './server.mjs';

test('demo HTTP boundary rejects cross-origin, oversized and malformed input; never serves arbitrary files', async t => {
  const origin = 'http://127.0.0.1:4397';let evaluations=0;
  const server=startDemo({port:4397,assets:{},evaluate:async text=>{evaluations++;return {text};}});
  if(!server.listening)await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const post=(body,headers={})=>fetch(origin+'/api/evaluate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body});
  assert.equal((await post('{"text":"hello"}',{Origin:'https://elsewhere.invalid'})).status,403);
  const badHostStatus=await new Promise((resolve,reject)=>{
    const request=httpRequest(origin+'/api/evaluate',{method:'POST',headers:{Host:'elsewhere.invalid'}},response=>{response.resume();resolve(response.statusCode);});
    request.on('error',reject);request.end();
  });
  assert.equal(badHostStatus,403);
  assert.equal((await post('invalid')).status,400);
  assert.equal((await post(JSON.stringify({text:'x'.repeat(700)}))).status,400);
  assert.equal((await post(JSON.stringify({text:'x'.repeat(5000)}))).status,413);
  assert.equal((await fetch(origin+'/client.mjs')).status,404);
  assert.equal((await fetch(origin+'/.env')).status,404);
  assert.equal(evaluations,0);
  const response=await post(JSON.stringify({text:'valid ✓'}));assert.deepEqual(await response.json(),{text:'valid ✓'});assert.equal(evaluations,1);
});
