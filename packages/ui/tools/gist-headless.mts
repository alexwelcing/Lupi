// Render the scanner's gist stage without a browser: settle a demo gist on
// vgpu's software renderer, apply one sculpting move, and write frames plus
// particle statistics. Needs the portable renderer once:
//
//   pnpm --filter @atlas/ui exec vgpu install-software-renderer
//   pnpm scan:gist:headless -- apple --particles=60000 [--photo=mug]   (or screw, mug, vase, banana; photo kinds: disc, tree, mug, table, tv, cat)
//
// Frames land in .verify-artifacts/gist-<name>-<stage>.png.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas } from 'canvas';
import { init, target } from 'vgpu/node';
import { createGistEngine, GIST_PARTICLE_COUNT, PARTICLE_FLOATS } from '../src/scan/gist/gistEngine';
import { DEMO_GISTS, FATNESS } from '../src/scan/gist/gistClient';
import { DEFAULT_TOLERANCE, stageFromPhoto } from '../src/scan/gist/volumeStage';
import { SYNTHETIC_KINDS, syntheticPhoto, type SyntheticKind } from './synthetic-photos.mts';
import { alignPointsToMask, applyMove, applicableMoves, describeGist, packPoints, parseGlb, sampleMeshPoints, unpackPoints, type DepthModel } from '@atlas/core/gist';

// The shaders have no imports, so their text is already complete WGSL.
const step = { wgsl: readFileSync(fileURLToPath(new URL('../src/scan/gist/gist-step.wgsl', import.meta.url)), 'utf8') };
const points = { wgsl: readFileSync(fileURLToPath(new URL('../src/scan/gist/gist-points.wgsl', import.meta.url)), 'utf8') };

const which = process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? 'apple';
// With a photo, the output name is the photo kind, so frames do not overwrite a demo's.
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
// `--photo=<kind>` seeds the particles from a synthetic picture (see
// synthetic-photos.mts: disc, tree, mug, table, tv, cat). The photo's own
// silhouette then becomes the shape, exactly as on the page: mask, clean,
// measure, frame, inflate.
const photoArg = process.argv.find((arg) => arg.startsWith('--photo'));
const withPhoto = Boolean(photoArg);
const photoKind = (photoArg?.includes('=') ? photoArg.slice(photoArg.indexOf('=') + 1) : 'disc') as SyntheticKind;
if (withPhoto && !SYNTHETIC_KINDS.includes(photoKind)) {
  console.error(`Unknown photo kind "${photoKind}"; try ${SYNTHETIC_KINDS.join(', ')}.`);
  process.exit(2);
}
const pixels = withPhoto ? syntheticPhoto(photoKind) : null;
// `--depth=inflate|extrude|revolve` and `--fatness=thin|medium|round` render a
// photo with the recipe Jev would have chosen, without calling Jev.
const depthArg = process.argv.find((arg) => arg.startsWith('--depth='))?.slice('--depth='.length) as DepthModel | undefined;
const fatnessArg = process.argv.find((arg) => arg.startsWith('--fatness='))?.slice('--fatness='.length) as keyof typeof FATNESS | undefined;
const gridArg = process.argv.find((arg) => arg.startsWith('--grid='));
const stage = pixels ? stageFromPhoto(pixels, DEFAULT_TOLERANCE, depthArg ?? 'inflate', FATNESS[fatnessArg ?? 'round'], gridArg ? Number(gridArg.slice('--grid='.length)) : undefined) : null;
if (stage) console.log(`stage: masked ${stage.masked} · grid ${stage.volume.n}³ · ${stage.volume.depth} · fatness ${stage.volume.fatness} · cut at ${stage.candidate.tolerance} · fill ${(stage.candidate.features.fill * 100).toFixed(0)}% · ${stage.candidate.features.components} pieces · ${stage.volume.filled} cells · frame zoom ${stage.photo.frame?.zoom.toFixed(2)}`);
const photo = stage?.photo ?? null;
// A photo run holds the camera at the front so the reassembled face is what gets checked.
const engine = createGistEngine({ gpu, target: colorTarget, shaders: { step: step.wgsl, points: points.wgsl }, aspect: () => width / height, random, count, photo, spin: withPhoto ? 0 : 0.35 });
if (stage) engine.setPalette(stage.palette[0], stage.palette[1]);

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
  writeFileSync(new URL(`../../../.verify-artifacts/gist-${withPhoto ? `photo-${photoKind}${depthArg ? `-${depthArg}` : ''}` : which}-${name}.png`, import.meta.url), canvas.toBuffer('image/png'));
  return lit / (width * height);
}

async function glowStats() {
  const raw = new Float32Array(await engine.particles.read());
  let glow = 0;
  let radius = 0;
  let homed = 0;
  let drift = 0;
  let strayed = 0;
  let behind = 0;
  for (let i = 0; i < count; i += 1) {
    const base = i * PARTICLE_FLOATS;
    glow += raw[base + 7];
    radius += Math.hypot(raw[base], raw[base + 1], raw[base + 2]);
    if (raw[base + 15] > 0.5) {
      // How far a homed particle sits from its own pixel's column, and whether it is on the far side.
      homed += 1;
      const away = Math.hypot(raw[base] - raw[base + 12], raw[base + 1] - raw[base + 13]);
      drift += away;
      if (away > 0.06) strayed += 1;
      if (raw[base + 2] < -0.02) behind += 1;
    }
  }
  const stats: Record<string, number> = { meanGlow: glow / count, meanRadius: radius / count };
  if (homed) Object.assign(stats, { homed, meanDrift: drift / homed, strayedShare: strayed / homed, behindShare: behind / homed });
  if (homed && process.argv.includes('--drift')) {
    // Where the strays' homes are (by row of the sheet) and where the strays actually sit.
    const bins = 8;
    const rows = Array.from({ length: bins }, () => ({ homed: 0, strayed: 0, dx: 0, dy: 0, dz: 0, z: 0 }));
    for (let i = 0; i < count; i += 1) {
      const base = i * PARTICLE_FLOATS;
      if (raw[base + 15] < 0.5) continue;
      const bin = Math.max(0, Math.min(bins - 1, Math.floor(((raw[base + 13] + 1.5) / 3) * bins)));
      rows[bin].homed += 1;
      const away = Math.hypot(raw[base] - raw[base + 12], raw[base + 1] - raw[base + 13]);
      if (away <= 0.06) continue;
      rows[bin].strayed += 1;
      rows[bin].dx += raw[base] - raw[base + 12];
      rows[bin].dy += raw[base + 1] - raw[base + 13];
      rows[bin].z += raw[base + 2];
    }
    for (const [bin, row] of rows.entries()) {
      if (!row.homed) continue;
      const y = ((bin + 0.5) / bins) * 3 - 1.5;
      console.log(`  home y≈${y.toFixed(2).padStart(5)}: ${String(row.homed).padStart(6)} homed, ${String(row.strayed).padStart(5)} strayed${row.strayed ? ` · strays sit dx ${(row.dx / row.strayed).toFixed(2)} dy ${(row.dy / row.strayed).toFixed(2)} at z ${(row.z / row.strayed).toFixed(2)}` : ''}`);
    }
  }
  return stats;
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

if (stage?.masked) {
  // The photo's own silhouette is the shape; the demo gist is not used.
  engine.setVolume(stage.volume);
} else {
  engine.setGist(gist);
}
engine.setAttract(1);
engine.setEnergy(0.15);
advance(240);
console.log('settled: lit fraction', (await snapshot('settled')).toFixed(3), await glowStats());

// `--glb=<file>` assembles a reconstructed object (a SAM 3D Objects GLB, say)
// on top of the settled photo: every particle flies to a sampled point of the
// mesh, bottom up, then the camera turns to show it is round.
const glbArg = process.argv.find((arg) => arg.startsWith('--glb='))?.slice('--glb='.length);
if (glbArg) {
  const mesh = parseGlb(readFileSync(glbArg).buffer as ArrayBuffer);
  const orientArg = process.argv.find((arg) => arg.startsWith('--orient='))?.slice('--orient='.length);
  const orient = orientArg ? (orientArg.split(',').map(Number) as [number, number, number]) : undefined;
  const cloud = sampleMeshPoints(mesh, count, { random, orient });
  const packed = packPoints(cloud);
  console.log(`glb: ${mesh.vertexCount} vertices, ${mesh.indices ? mesh.indices.length / 3 : 0} triangles, ${mesh.colors ? 'coloured' : 'uncoloured'} → ${cloud.count} points, ${(packed.byteLength / 1024).toFixed(0)} kB packed · bounds ${cloud.min.map((v) => v.toFixed(2)).join(',')} .. ${cloud.max.map((v) => v.toFixed(2)).join(',')}`);
  let homes = unpackPoints(packed);
  if (stage?.masked && !process.argv.includes('--no-align')) {
    // Turn the reconstruction to face the way the photo saw it.
    const aligned = alignPointsToMask(homes, stage.candidate.mask);
    homes = aligned.points;
    const runnersUp = aligned.alignment.tried
      .slice()
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3)
      .map((entry) => `${Math.round((entry.yaw * 180) / Math.PI)}°${entry.mirrored ? ' mirrored' : ''} ${entry.overlap.toFixed(2)}`)
      .join(' · ');
    console.log(`aligned: yaw ${Math.round((aligned.alignment.yaw * 180) / Math.PI)}°${aligned.alignment.mirrored ? ' mirrored' : ''} · overlap ${aligned.alignment.overlap.toFixed(2)} · best three ${runnersUp}`);
  }
  engine.setHomes(homes);
  advance(60);
  console.log('assembling: lit fraction', (await snapshot('assembling')).toFixed(3));
  advance(200);
  console.log('assembled: lit fraction', (await snapshot('assembled')).toFixed(3), await glowStats());
  engine.setSpin(1.2);
  advance(60);
  console.log('turned: lit fraction', (await snapshot('turned')).toFixed(3));
}

const moved = stage?.masked ? null : applyMove(gist, applicableMoves(gist)[0].id);
if (moved) {
  engine.setGist(moved);
  advance(120);
  console.log('after move', applicableMoves(gist)[0].id, ': lit fraction', (await snapshot('moved')).toFixed(3), await glowStats());
}

engine.dispose();
gpu.dispose();
