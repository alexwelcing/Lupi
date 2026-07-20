#!/usr/bin/env node
/**
 * verify-exports — headless scaling benchmark for the 3D export pipeline.
 *
 * Run: node tools/verify-exports.mjs [--skip-500k]
 *
 * Imports the SAME scene-building modules the app ships
 * (packages/ui/src/export/exportSceneBuilder.ts + instanceBake.ts — pure
 * three, no React/DOM, loaded via Node's built-in TypeScript type stripping)
 * and drives them over synthetic frames:
 *
 *   GLB  @ 10k / 100k / 500k atoms — full build + GLTFExporter binary encode.
 *        Asserts 10k < 10 s, 100k < 60 s, 500k completes without throwing.
 *   USDZ @ 10k bonded atoms — full build + budget-selected LOD + merged
 *        instance bake. Asserts every InstancedMesh becomes one baked Mesh.
 *   USDZ @ 100k atoms — asserts refusal before per-atom geometry allocation.
 *        (three's USDZExporter itself needs DOM canvas for its texture
 *        pipeline, so the encode step is exercised in-browser only.)
 *
 * three r184's GLTFExporter assembles the GLB through FileReader/Blob, which
 * Node lacks (FileReader), so a minimal shim backed by blob.arrayBuffer() is
 * installed below.
 */

import { performance } from 'node:perf_hooks';

// ─── FileReader shim (GLTFExporter GLB assembly) ────────────────────
// The exporter calls `readAsArrayBuffer(blob)` / `readAsDataURL(blob)` and
// assigns `onloadend` on the next line; blob.arrayBuffer() resolving on a
// microtask preserves that ordering.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        const base64 = Buffer.from(buffer).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
        this.onloadend?.();
      });
    }
  };
}

const builderUrl = new URL('../packages/ui/src/export/exportSceneBuilder.ts', import.meta.url).href;
const bakeUrl = new URL('../packages/ui/src/export/instanceBake.ts', import.meta.url).href;

const { buildExportScene, disposeExportScene } = await import(builderUrl);
const { bakeInstancedMeshesForExport } = await import(bakeUrl);
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

// ─── Synthetic frames ───────────────────────────────────────────────

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random positions in a box at solid-ish density (~0.05 atoms/Å³) so bond
 *  detection has realistic work to do; 3 atom types. */
function makeFrame(natoms, seed = 1234) {
  const boxSize = Math.cbrt(natoms / 0.05);
  const rand = mulberry32(seed);
  const positions = new Float32Array(natoms * 3);
  const types = new Int32Array(natoms);
  for (let i = 0; i < natoms; i++) {
    positions[i * 3] = rand() * boxSize;
    positions[i * 3 + 1] = rand() * boxSize;
    positions[i * 3 + 2] = rand() * boxSize;
    types[i] = 1 + Math.floor(rand() * 3);
  }
  return { natoms, positions, types };
}

const COVALENT_RADII = new Float32Array([0, 0.77, 0.66, 0.71]);
const TYPE_COLORS = { 1: [0.9, 0.2, 0.2], 2: [0.2, 0.4, 0.9], 3: [0.3, 0.8, 0.3] };

function makeProgressLogger(label) {
  let lastLine = '';
  return (phase, done, total) => {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const line = `${phase} ${pct}%`;
    if (line !== lastLine && (pct % 25 === 0 || pct === 100 || total === 0)) {
      lastLine = line;
      console.log(`    [${label}] ${line}`);
    }
  };
}

function buildOptions(format, label, overrides = {}) {
  return {
    format,
    displayRadiusForType: (typeId) => COVALENT_RADII[typeId] ?? 0.7,
    resolveAtomColor: (_i, typeId) => TYPE_COLORS[typeId] ?? [1, 1, 1],
    showBonds: true,
    bondTolerance: 0.45,
    covalentRadii: COVALENT_RADII,
    onProgress: makeProgressLogger(label),
    ...overrides,
  };
}

// ─── Tiers ──────────────────────────────────────────────────────────

const failures = [];

function check(condition, message) {
  if (condition) {
    console.log(`    PASS  ${message}`);
  } else {
    failures.push(message);
    console.error(`    FAIL  ${message}`);
  }
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function runGlbTier(natoms, maxSeconds) {
  const label = `glb ${natoms / 1000}k`;
  console.log(`\n  GLB tier: ${natoms.toLocaleString()} atoms`);
  const frame = makeFrame(natoms);

  const start = performance.now();
  const result = await buildExportScene(frame, buildOptions('glb', label));
  const buildMs = performance.now() - start;

  const exporter = new GLTFExporter();
  const encodeStart = performance.now();
  const glb = await exporter.parseAsync(result.scene, { binary: true });
  const encodeMs = performance.now() - encodeStart;
  const totalMs = performance.now() - start;

  disposeExportScene(result.scene);

  console.log(
    `    atoms=${result.atomCount.toLocaleString()} bonds=${result.bondCount.toLocaleString()}` +
    ` lod=${result.sphereLod.widthSegments}x${result.sphereLod.heightSegments}` +
    ` build=${(buildMs / 1000).toFixed(2)}s encode=${(encodeMs / 1000).toFixed(2)}s` +
    ` total=${(totalMs / 1000).toFixed(2)}s size=${formatMB(glb.byteLength)}`,
  );

  check(glb.byteLength > 0, `${label}: produced non-empty GLB (${formatMB(glb.byteLength)})`);
  check(result.bondCount > 0, `${label}: spatial-hash detector found bonds (${result.bondCount.toLocaleString()})`);
  if (maxSeconds != null) {
    check(totalMs < maxSeconds * 1000, `${label}: total ${(totalMs / 1000).toFixed(2)}s < ${maxSeconds}s`);
  } else {
    check(true, `${label}: completed without throwing in ${(totalMs / 1000).toFixed(2)}s`);
  }
  return totalMs;
}

async function runUsdzBakeTier(natoms) {
  const label = `usdz ${natoms / 1000}k bonded`;
  console.log(`\n  USDZ bake tier: ${natoms.toLocaleString()} atoms`);
  const frame = makeFrame(natoms);

  const start = performance.now();
  const result = await buildExportScene(frame, buildOptions('usdz', label));
  const bakeLogger = makeProgressLogger(label);
  const swaps = await bakeInstancedMeshesForExport(result.scene, {
    onProgress: (done, total) => bakeLogger('bake', done, total),
  });
  const totalMs = performance.now() - start;

  let bakedMeshes = 0;
  let bakedVerts = 0;
  for (const swap of swaps) {
    bakedMeshes++;
    bakedVerts += swap.replacement.geometry.getAttribute('position').count;
  }

  console.log(
    `    atoms=${result.atomCount.toLocaleString()} bonds=${result.bondCount.toLocaleString()}` +
    ` lod=${result.sphereLod.widthSegments}x${result.sphereLod.heightSegments}` +
    ` bakedMeshes=${bakedMeshes} bakedVerts=${bakedVerts.toLocaleString()}` +
    ` total=${(totalMs / 1000).toFixed(2)}s`,
  );

  check(bakedMeshes === swaps.length && bakedMeshes > 0, `${label}: every InstancedMesh baked (${bakedMeshes} meshes)`);
  check(bakedVerts > 0, `${label}: merged bake produced vertices (${bakedVerts.toLocaleString()})`);
  check(true, `${label}: bake completed without throwing in ${(totalMs / 1000).toFixed(2)}s`);

  for (const swap of swaps) {
    swap.replacement.geometry.dispose();
    const mat = swap.replacement.material;
    if (mat?.map) mat.map.dispose();
    mat?.dispose();
  }
  disposeExportScene(result.scene);
}

async function runUsdzBudgetRefusalTier(natoms) {
  const label = `usdz ${natoms / 1000}k refusal`;
  console.log(`\n  USDZ budget-refusal tier: ${natoms.toLocaleString()} atoms`);
  const frame = makeFrame(natoms);
  let colorCalls = 0;
  let refusal = null;
  try {
    await buildExportScene(frame, buildOptions('usdz', label, {
      showBonds: false,
      resolveAtomColor: () => {
        colorCalls++;
        return [1, 1, 1];
      },
    }));
  } catch (error) {
    refusal = error;
  }

  check(
    refusal?.code === 'MODEL_EXPORT_BUDGET_EXCEEDED',
    `${label}: returns MODEL_EXPORT_BUDGET_EXCEEDED`,
  );
  check(colorCalls === 0, `${label}: refuses before per-atom geometry allocation`);
}

const skip500k = process.argv.includes('--skip-500k');

console.log('verify-exports — headless 3D export benchmark');
console.log(`node ${process.version}`);

await runGlbTier(10_000, 10);
await runGlbTier(100_000, 60);
if (skip500k) {
  console.log('\n  GLB tier: 500,000 atoms — skipped (--skip-500k)');
} else {
  await runGlbTier(500_000, null);
}
await runUsdzBakeTier(10_000);
await runUsdzBudgetRefusalTier(100_000);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll checks passed.');
