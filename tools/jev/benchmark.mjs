import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createClient, MODEL } from './client.mjs';
import { buildRequest, resolveDecision } from './interpreter.mjs';

const cases=JSON.parse(await readFile(new URL('./cases.json',import.meta.url),'utf8'));
const replay=process.argv.includes('--replay');
if(!replay && !process.env.TYPESAFE_API_KEY)throw new Error('Set TYPESAFE_API_KEY or use --replay.');
const evaluate=createClient({apiKey:process.env.TYPESAFE_API_KEY,timeoutMs:15000,cacheTtlMs:0});
const recorded=replay?JSON.parse(await readFile(new URL('./results/2026-09-19.json',import.meta.url),'utf8')).runs.flatMap(run=>run.results):[];
const results=[];
for(const item of cases){
  const request=buildRequest(item.text),original=recorded.find(row=>row.id===item.id);
  const result=replay?original:await evaluate(request);
  if(!result)throw new Error(`Missing receipt ${item.id}`);
  const decision=resolveDecision(result.response);
  const row={id:item.id,split:item.split,text:item.text,expected:item.expected,requestSha256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),...result,decision,passed:decision.action===item.expected};
  results.push(row);console.log(JSON.stringify({id:row.id,expected:row.expected,action:decision.action,reason:decision.reason,ms:row.elapsedMs,passed:row.passed}));
}
const positives=results.filter(row=>row.expected!==null),accepted=positives.filter(row=>row.decision.action!==null),wrong=results.filter(row=>row.decision.action!==null&&row.decision.action!==row.expected);
console.log(JSON.stringify({replay,model:MODEL,cases:results.length,validCommands:positives.length,acceptedValid:accepted.length,wrongActions:wrong.length}));
if(!replay)await writeFile(new URL('./results/latest.json',import.meta.url),JSON.stringify({recordedAt:new Date().toISOString(),model:MODEL,results},null,2)+'\n');
