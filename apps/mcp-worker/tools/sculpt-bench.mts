// Run the sculpt loop against the real Jev from Node, through the same edge
// handler the browser talks to. The key comes from the environment or from
// apps/mcp-worker/.dev.vars (git-ignored); it is never printed.
//
//   TYPESAFE_API_KEY=... pnpm scan:sculpt:bench -- apple --calls=12
//   pnpm scan:sculpt:bench -- mug --profile=0.79,0.79,0.9,1.07,1.13,1.13,1.13,1.13,1.07,0.9,0.79,0.79
//   pnpm scan:sculpt:bench -- apple --start=cylinder --mode=nouls   (one Noul per move instead of a Choice)
//
// Prints one line per judgment (move, confidence, likeness, mismatch, ms),
// applies chosen moves the way the browser does, and ends with the shape.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMove, decideSculpt, describeGist, fitProportions, gistBody, gistProfile, latheFromProfile, outlineBodyProfile, outlineProfile, profileWords, type Gist, type OutlinePoint, type SculptMemory } from '@atlas/core/gist';
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
// `--outline=x,y;x,y;...` (image fractions) stands in for the vision call's traced silhouette.
const outlineArg = args.find((arg) => arg.startsWith('--outline='))?.slice('--outline='.length);
const outline: OutlinePoint[] | null = outlineArg
  ? outlineArg.split(';').map((pair) => pair.split(',').map(Number) as OutlinePoint).filter((point) => point.length === 2 && point.every(Number.isFinite))
  : null;
const photoProfile = outline ? outlineProfile(outline) : profileArg ? profileArg.split(',').map(Number).filter((value) => Number.isFinite(value)) : null;
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
const mode = args.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length) === 'nouls' ? 'nouls' : 'choice';
const startArg = args.find((arg) => arg.startsWith('--start='))?.slice('--start='.length);
const subjectArg = args.find((arg) => arg.startsWith('--subject='))?.slice('--subject='.length);
const BARE: Record<string, Gist['primitives'][number]> = {
  sphere: { kind: 'sphere', name: 'body', center: [0, 0, 0], size: [0.8, 0, 0], rotation: [0, 0, 0], blend: 0.1, subtract: false },
  cylinder: { kind: 'cylinder', name: 'body', center: [0, 0, 0], size: [0.5, 0.8, 0], rotation: [0, 0, 0], blend: 0.1, subtract: false },
  box: { kind: 'box', name: 'body', center: [0, 0, 0], size: [0.6, 0.6, 0.6], rotation: [0, 0, 0], blend: 0.1, subtract: false },
};
let gist: Gist = DEMO_GISTS[which] ?? DEMO_GISTS.apple;
// `--start=sphere` begins from a bare primitive so the loop has real work to do;
// `--start=lathe` with `--profile` begins from the profile revolved, as the page does for a revolved object.
if (startArg && BARE[startArg]) gist = { ...gist, primitives: [BARE[startArg]] };
if (startArg === 'lathe' && photoProfile) {
  const bodyProfile = outline ? outlineBodyProfile(outline) : photoProfile;
  gist = { ...gist, primitives: [latheFromProfile(bodyProfile ?? photoProfile)] };
}
const subject = subjectArg ?? gist.label;
console.log(`subject: ${subject} · mode ${mode}`);
console.log(`start:   ${describeGist(gist)}`);
if (photoProfile) {
  // The browser fits the aspect for free before asking Jev; so does the bench.
  const fitted = fitProportions(gist, photoProfile);
  if (fitted !== gist) {
    gist = fitted;
    console.log(`fitted:  ${describeGist(gist)}`);
  }
}
if (photoProfile) console.log(`photo:   ${profileWords(photoProfile)}`);
console.log(`shape:   ${profileWords(gistProfile(gist))}`);

let memory: SculptMemory = { lastMove: null, keeps: 0 };
const latencies: number[] = [];
for (let call = 1; call <= calls; call += 1) {
  const started = performance.now();
  const response = await handleScanSculpt(
    new Request('https://lupi.live/v1/scan/sculpt', { method: 'POST', body: JSON.stringify({ subject, gist, photoProfile: photoProfile ?? undefined, mode }) }),
    env,
  );
  const ms = Math.round(performance.now() - started);
  latencies.push(ms);
  const body = (await response.json()) as { configured: boolean; move?: { id: string; confidence: number }; likeness?: number; mismatch?: number | null; error?: string; model?: string };
  if (!body.configured || !body.move) {
    console.log(`#${call} ${response.status} ${body.error ?? 'no move'} (${ms} ms)`);
    continue;
  }
  const verdict = decideSculpt({ move: body.move, likeness: body.likeness ?? null, mismatch: body.mismatch ?? null }, memory);
  memory = verdict.memory;
  const context = photoProfile ? { photoProfile, bodyProfile: gistProfile({ ...gist, primitives: [gistBody(gist)] }) } : undefined;
  const next = verdict.apply ? applyMove(gist, verdict.apply, verdict.strength, context) : null;
  console.log(
    `#${call} ${body.move.id.padEnd(14)} conf ${body.move.confidence.toFixed(2)} likeness ${(body.likeness ?? 0).toFixed(2)}${body.mismatch != null ? ` mismatch ${body.mismatch.toFixed(3)}` : ''} ${ms} ms${next ? ` · applied${verdict.strength > 1 ? ' x2' : ''}` : body.move.id === 'keep' ? ' · kept' : ' · first vote'}`,
  );
  if (next) gist = next;
  if (verdict.satisfied) {
    console.log('satisfied');
    break;
  }
}
const sorted = [...latencies].sort((a, b) => a - b);
console.log(`latency p50 ${sorted[Math.floor(sorted.length / 2)] ?? '—'} ms · p95 ${sorted[Math.floor(sorted.length * 0.95)] ?? '—'} ms`);
console.log(`end:     ${describeGist(gist)}`);
console.log(`shape:   ${profileWords(gistProfile(gist))}`);
