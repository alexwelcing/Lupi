// Render the scanner's gist stage without a browser: settle a demo gist on
// vgpu's software renderer, apply one sculpting move, and write frames plus
// particle statistics. Needs the portable renderer once:
//
//   pnpm --filter @atlas/ui exec vgpu install-software-renderer
//   pnpm scan:gist:headless -- apple --particles=60000 [--photo]   (or screw, mug, vase, banana)
//
// Frames land in .verify-artifacts/gist-<name>-<stage>.png.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas } from 'canvas';
import { init, target } from 'vgpu/node';
import { createGistEngine, GIST_PARTICLE_COUNT, PARTICLE_FLOATS } from '../src/scan/gist/gistEngine';
import { DEMO_GISTS } from '../src/scan/gist/gistClient';
import { applyMove, applicableMoves, describeGist } from '@atlas/core/gist';

// The shaders have no imports, so their text is already complete WGSL.
const step = { wgsl: readFileSync(fileURLToPath(new URL('../src/scan/gist/gist-step.wgsl', import.meta.url)), 'utf8') };
const points = { wgsl: readFileSync(fileURLToPath(new URL('../src/scan/gist/gist-points.wgsl', import.meta.url)), 'utf8') };

const which = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? 'apple';
const countArg = process.argv.slice(2).find((arg) => arg.startsWith('--particles='));
const count = countArg ? Number(countArg.slice('--particles='.length)) : GIST_PARTICLE_COUNT;
const width = 640;
const height = 480;
const gpu = await init({ requiredLimits: { maxStorageBuffersInVertexStage: 1 } });
const colorTarget = target(gpu, { size: [width, height], clearColor: [0, 0, 0, 0] });
let seed = 12345;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
// `--photo` seeds the particles from a synthetic picture (a warm disc on a
// cool ground) so the dissolve-into-shape look can be checked without a camera.
const withPhoto = process.argv.includes('--photo');
const photo = withPhoto
  ? (() => {
      const pw = 160;
      const ph = 120;
      const data = new Uint8ClampedArray(pw * ph * 4);
      const mask = new Uint8Array(pw * ph);
      for (let y = 0; y < ph; y += 1) {
        for (let x = 0; x < pw; x += 1) {
          const i = (y * pw + x) * 4;
          const dx = (x - pw * 0.5) / (pw * 0.28);
          const dy = (y - ph * 0.55) / (ph * 0.38);
          const inside = dx * dx + dy * dy < 1;
          const shade = inside ? 0.6 + 0.4 * (1 - Math.hypot(dx + 0.3, dy + 0.3) / 1.6) : 0.2 + 0.15 * (y / ph);
          data[i] = Math.round((inside ? 220 : 70) * shade);
          data[i + 1] = Math.round((inside ? 70 : 90) * shade);
          data[i + 2] = Math.round((inside ? 50 : 120) * shade);
          data[i + 3] = 255;
          mask[y * pw + x] = inside ? 1 : 0;
        }
      }
      return { width: pw, height: ph, data, mask };
    })()
  : null;
const engine = createGistEngine({ gpu, target: colorTarget, shaders: { step: step.wgsl, points: points.wgsl }, aspect: () => width / height, random, count, photo });

const gist = DEMO_GISTS[which];
console.log('gist:', describeGist(gist));
console.log('moves:', applicableMoves(gist).map((m) => m.id).join(', '));

async function snapshot(name: string) {
  const pixels = await colorTarget.read();
  let lit = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) lit += 1;
  // Composite the premultiplied frame over the page's dark stage colour.
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const bg = [6, 8, 13];
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] / 255;
    image.data[i] = Math.min(255, pixels[i] + bg[0] * (1 - a));
    image.data[i + 1] = Math.min(255, pixels[i + 1] + bg[1] * (1 - a));
    image.data[i + 2] = Math.min(255, pixels[i + 2] + bg[2] * (1 - a));
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  writeFileSync(new URL(`../../../.verify-artifacts/gist-${which}-${name}.png`, import.meta.url), canvas.toBuffer('image/png'));
  return lit / (width * height);
}

async function glowStats() {
  const raw = new Float32Array(await engine.particles.read());
  let glow = 0;
  let radius = 0;
  for (let i = 0; i < count; i += 1) {
    const base = i * PARTICLE_FLOATS;
    glow += raw[base + 7];
    radius += Math.hypot(raw[base], raw[base + 1], raw[base + 2]);
  }
  return { meanGlow: glow / count, meanRadius: radius / count };
}

let now = 0;
const advance = (frames: number) => {
  for (let i = 0; i < frames; i += 1) {
    now += 1000 / 60;
    engine.tick(now);
  }
};

engine.setFade(1);
if (withPhoto) {
  // The photo sheet, before the swirl takes it apart.
  advance(2);
  console.log('photo: lit fraction', (await snapshot('photo')).toFixed(3));
}
engine.setEnergy(1);
advance(90);
console.log('swirl: lit fraction', (await snapshot('swirl')).toFixed(3), await glowStats());

engine.setGist(gist);
engine.setAttract(1);
engine.setEnergy(0.15);
advance(240);
console.log('settled: lit fraction', (await snapshot('settled')).toFixed(3), await glowStats());

const moved = applyMove(gist, applicableMoves(gist)[0].id);
if (moved) {
  engine.setGist(moved);
  advance(120);
  console.log('after move', applicableMoves(gist)[0].id, ': lit fraction', (await snapshot('moved')).toFixed(3), await glowStats());
}

engine.dispose();
gpu.dispose();
