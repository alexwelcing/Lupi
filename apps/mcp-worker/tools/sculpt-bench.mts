// Run the sculpt loop against the real Jev from Node, through the same edge
// handler the browser talks to. The key comes from the environment or from
// apps/mcp-worker/.dev.vars (git-ignored); it is never printed.
//
//   TYPESAFE_API_KEY=... pnpm scan:sculpt:bench -- apple --calls=12
//   pnpm scan:sculpt:bench -- mug --profile=0.79,0.79,0.9,1.07,1.13,1.13,1.13,1.13,1.07,0.9,0.79,0.79
//
// Prints one line per judgment (move, confidence, likeness, mismatch, ms),
// applies chosen moves the way the browser does, and ends with the shape.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMove, describeGist, gistProfile, profileWords, type Gist } from '@atlas/core/gist';
import { DEMO_GISTS } from '../../../packages/ui/src/scan/gist/gistClient';
import { handleScanSculpt } from '../src/gist';

function devVars(): Record<string, string> {
  try {
    const text = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    return Object.fromEntries(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
    );
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
const which = args.find((arg) => !arg.startsWith('-')) ?? 'apple';
const calls = Number(args.find((arg) => arg.startsWith('--calls='))?.slice('--calls='.length) ?? 12);
const profileArg = args.find((arg) => arg.startsWith('--profile='))?.slice('--profile='.length);
const photoProfile = profileArg ? profileArg.split(',').map(Number).filter((value) => Number.isFinite(value)) : null;
const vars = devVars();
const env = {
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY ?? vars.TYPESAFE_API_KEY,
  TYPESAFE_API_BASE: process.env.TYPESAFE_API_BASE ?? vars.TYPESAFE_API_BASE,
  TYPESAFE_MODEL: process.env.TYPESAFE_MODEL ?? vars.TYPESAFE_MODEL,
};
if (!env.TYPESAFE_API_KEY) {
  console.error('No TYPESAFE_API_KEY in the environment or apps/mcp-worker/.dev.vars.');
  process.exit(2);
}
let gist: Gist = DEMO_GISTS[which] ?? DEMO_GISTS.apple;
const subject = gist.label;
console.log(`subject: ${subject}`);
console.log(`start:   ${describeGist(gist)}`);
if (photoProfile) console.log(`photo:   ${profileWords(photoProfile)}`);
console.log(`shape:   ${profileWords(gistProfile(gist))}`);

let keeps = 0;
const latencies: number[] = [];
for (let call = 1; call <= calls; call += 1) {
  const started = performance.now();
  const response = await handleScanSculpt(
    new Request('https://lupi.live/v1/scan/sculpt', { method: 'POST', body: JSON.stringify({ subject, gist, photoProfile: photoProfile ?? undefined }) }),
    env,
  );
  const ms = Math.round(performance.now() - started);
  latencies.push(ms);
  const body = (await response.json()) as { configured: boolean; move?: { id: string; confidence: number }; likeness?: number; mismatch?: number | null; error?: string; model?: string };
  if (!body.configured || !body.move) {
    console.log(`#${call} ${response.status} ${body.error ?? 'no move'} (${ms} ms)`);
    continue;
  }
  const next = body.move.id === 'keep' || body.move.confidence < 0.45 ? null : applyMove(gist, body.move.id);
  console.log(
    `#${call} ${body.move.id.padEnd(14)} conf ${body.move.confidence.toFixed(2)} likeness ${(body.likeness ?? 0).toFixed(2)}${body.mismatch != null ? ` mismatch ${body.mismatch.toFixed(3)}` : ''} ${ms} ms${next ? ' · applied' : body.move.id === 'keep' ? ' · kept' : ' · below gate'}`,
  );
  if (next) {
    gist = next;
    keeps = 0;
  } else if (body.move.id === 'keep') {
    keeps += 1;
    if (keeps >= 2 && body.move.confidence >= 0.6) {
      console.log('satisfied: two keeps in a row');
      break;
    }
  }
}
const sorted = [...latencies].sort((a, b) => a - b);
console.log(`latency p50 ${sorted[Math.floor(sorted.length / 2)] ?? '—'} ms · p95 ${sorted[Math.floor(sorted.length * 0.95)] ?? '—'} ms`);
console.log(`end:     ${describeGist(gist)}`);
console.log(`shape:   ${profileWords(gistProfile(gist))}`);
