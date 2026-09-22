// Ask the live Jev for the recipe of a few silhouettes, through the same edge
// handler the browser uses. Key from the environment or .dev.vars.
//
//   pnpm scan:recipe:bench                      five synthetic masks
//   pnpm scan:recipe:bench -- --photos          the synthetic photos (mug, table, tv, cat, …), cut
//                                               at every flood tolerance and judged in parallel,
//                                               exactly as the page does it
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fillSmallHoles, largestComponent, maskFeatures } from '@atlas/core/gist';
import { handleScanRecipe } from '../src/recipe';
import { cutMask, MASK_TOLERANCES } from '../../../packages/ui/src/scan/gist/volumeStage';
import { SYNTHETIC_KINDS, SYNTHETIC_SUBJECTS, syntheticPhoto } from '../../../packages/ui/tools/synthetic-photos.mts';

function devVars(): Record<string, string> {
  try {
    const text = readFileSync(fileURLToPath(new URL('../.dev.vars', import.meta.url)), 'utf8');
    return Object.fromEntries(text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
  } catch {
    return {};
  }
}
const vars = devVars();
const env = { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY ?? vars.TYPESAFE_API_KEY };
if (!env.TYPESAFE_API_KEY) {
  console.error('No TYPESAFE_API_KEY.');
  process.exit(2);
}

type Reply = { reads?: number; depth?: { choice: string; confidence: number }; fatness?: { choice: string; confidence: number }; error?: string };
const describe = (body: Reply) => `reads ${body.reads?.toFixed(2) ?? '—'} · ${body.depth?.choice ?? body.error} ${body.depth ? `(${body.depth.confidence.toFixed(2)})` : ''} · ${body.fatness?.choice ?? ''} ${body.fatness ? `(${body.fatness.confidence.toFixed(2)})` : ''}`;
async function judge(subject: string, features: object): Promise<{ body: Reply; ms: number }> {
  const started = performance.now();
  const response = await handleScanRecipe(new Request('https://lupi.live/v1/scan/recipe', { method: 'POST', body: JSON.stringify({ subject, features }) }), env);
  return { body: (await response.json()) as Reply, ms: Math.round(performance.now() - started) };
}

if (process.argv.includes('--photos')) {
  const only = process.argv.find((arg) => arg.startsWith('--photos='))?.slice('--photos='.length).split(',');
  const kinds = SYNTHETIC_KINDS.filter((kind) => !only || only.includes(kind));
  await Promise.all(
    kinds.map(async (kind) => {
      const photo = syntheticPhoto(kind);
      const subject = SYNTHETIC_SUBJECTS[kind];
      const candidates = MASK_TOLERANCES.map((tolerance) => cutMask(photo, tolerance)).filter((c) => c.features.fill >= 0.02 && c.features.fill <= 0.92);
      const judged = await Promise.all(candidates.map(async (candidate) => ({ candidate, ...(await judge(subject, { ...candidate.features, tolerance: candidate.tolerance })) })));
      judged.sort((a, b) => (b.body.reads ?? 0) - (a.body.reads ?? 0));
      console.log(`${kind.padEnd(6)} as "${subject}":`);
      for (const entry of judged) console.log(`  t${String(entry.candidate.tolerance).padEnd(3)} fill ${(entry.candidate.features.fill * 100).toFixed(0).padStart(2)}% · ${describe(entry.body)} · ${entry.ms} ms`);
    }),
  );
  process.exit(0);
}

const w = 128;
const h = 128;
function shape(name: string): Uint8Array {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let on = false;
      if (name === 'tree') {
        const dx = (x - 64) / 40;
        const dy = (y - 46) / 30;
        on = dx * dx + dy * dy < 1 + Math.sin(x * 0.35) * 0.12 || (Math.abs(x - 64) < 5 && y > 60 && y < 112);
      } else if (name === 'bottle') {
        on = (Math.abs(x - 64) < 9 && y > 10 && y < 45) || (Math.abs(x - 64) < 22 && y >= 45 && y < 118);
      } else if (name === 'book') {
        on = x > 24 && x < 104 && y > 14 && y < 114;
      } else if (name === 'apple') {
        const dx = (x - 64) / 42;
        const dy = (y - 66) / 38;
        on = dx * dx + dy * dy < 1 || (Math.abs(x - 66) < 3 && y > 20 && y < 32);
      } else if (name === 'fragment') {
        on = x > 100 && y > 100;
      }
      if (on) data[y * w + x] = 1;
    }
  }
  return data;
}

const cases: Array<[string, string]> = [['tree', 'oak tree'], ['bottle', 'wine bottle'], ['book', 'hardback book'], ['apple', 'apple'], ['fragment', 'oak tree']];
await Promise.all(
  cases.map(async ([name, subject]) => {
    const { mask, components } = largestComponent({ width: w, height: h, data: shape(name) });
    const features = maskFeatures(fillSmallHoles(mask), components);
    const { body, ms } = await judge(subject, features);
    console.log(`${name.padEnd(9)} as "${subject}": ${describe(body)} · ${ms} ms`);
  }),
);
