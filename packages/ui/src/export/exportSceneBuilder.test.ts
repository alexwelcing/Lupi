import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { detectBondsCpu } from '@atlas/scene/bondDetectCpu';
import {
  selectSphereLod,
  sphereTriangleCount,
  detectExportBonds,
  buildExportScene,
  computeUsdzFraming,
  disposeExportScene,
  USDZ_TRIANGLE_BUDGET,
  type ExportFrameData,
} from './exportSceneBuilder';
import { bakeInstancedMeshesForExport } from './instanceBake';
import { restoreInstancedMeshes } from './USDZExportPipeline';

// Deterministic PRNG so the chunked-vs-whole bond comparison never flakes.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRandomFrame(natoms: number, boxSize: number, ntypes = 3, seed = 42): ExportFrameData {
  const rand = mulberry32(seed);
  const positions = new Float32Array(natoms * 3);
  const types = new Int32Array(natoms);
  for (let i = 0; i < natoms; i++) {
    positions[i * 3] = rand() * boxSize;
    positions[i * 3 + 1] = rand() * boxSize;
    positions[i * 3 + 2] = rand() * boxSize;
    types[i] = 1 + Math.floor(rand() * ntypes);
  }
  return { natoms, positions, types };
}

const COVALENT_RADII = new Float32Array([0, 0.7, 0.7, 0.7]);

describe('selectSphereLod', () => {
  it('picks GLB tiers purely by atom count', () => {
    expect(selectSphereLod(1_000, 'glb')).toEqual({ widthSegments: 16, heightSegments: 12 });
    expect(selectSphereLod(50_000, 'glb')).toEqual({ widthSegments: 16, heightSegments: 12 });
    expect(selectSphereLod(50_001, 'glb')).toEqual({ widthSegments: 10, heightSegments: 8 });
    expect(selectSphereLod(250_000, 'glb')).toEqual({ widthSegments: 10, heightSegments: 8 });
    expect(selectSphereLod(250_001, 'glb')).toEqual({ widthSegments: 6, heightSegments: 5 });
    expect(selectSphereLod(1_000_000, 'glb')).toEqual({ widthSegments: 6, heightSegments: 5 });
  });

  it('drops USDZ tiers until the merged bake fits the triangle budget', () => {
    // 5k × 352 tris = 1.76M ≤ 3M — the count tier already fits.
    expect(selectSphereLod(5_000, 'usdz')).toEqual({ widthSegments: 16, heightSegments: 12 });
    // 10k × 352 = 3.52M > 3M → next tier (140 tris → 1.4M).
    expect(selectSphereLod(10_000, 'usdz')).toEqual({ widthSegments: 10, heightSegments: 8 });
    // 50k × 140 = 7M > 3M → coarsest tier (48 tris → 2.4M).
    expect(selectSphereLod(50_000, 'usdz')).toEqual({ widthSegments: 6, heightSegments: 5 });
    // 100k × 48 = 4.8M > 3M → final fallback (5, 4).
    expect(selectSphereLod(100_000, 'usdz')).toEqual({ widthSegments: 5, heightSegments: 4 });
    expect(selectSphereLod(1_000_000, 'usdz')).toEqual({ widthSegments: 5, heightSegments: 4 });
  });

  it('never exceeds the budget when a tier can satisfy it', () => {
    const lod = selectSphereLod(60_000, 'usdz');
    expect(60_000 * sphereTriangleCount(lod)).toBeLessThanOrEqual(USDZ_TRIANGLE_BUDGET);
  });

  it('sphereTriangleCount matches real SphereGeometry topology', () => {
    for (const lod of [
      { widthSegments: 16, heightSegments: 12 },
      { widthSegments: 6, heightSegments: 5 },
      { widthSegments: 5, heightSegments: 4 },
    ]) {
      const geo = new THREE.SphereGeometry(1, lod.widthSegments, lod.heightSegments);
      expect(sphereTriangleCount(lod)).toBe(geo.getIndex()!.count / 3);
      geo.dispose();
    }
  });
});

describe('detectExportBonds', () => {
  it('chunked detection matches a whole-frame detectBondsCpu run exactly', async () => {
    const frame = makeRandomFrame(3_000, 28);
    const tolerance = 0.45;
    const maxBondLength = 2 * 0.7 + tolerance;

    const reference = detectBondsCpu({
      positions: frame.positions,
      types: frame.types,
      natoms: frame.natoms,
      maxBondLength,
      covalentRadii: COVALENT_RADII,
      tolerance,
    });
    const referenceKeys = new Set<number>();
    for (let i = 0; i < reference.count; i++) {
      referenceKeys.add(reference.bondPairs[i * 2] * frame.natoms + reference.bondPairs[i * 2 + 1]);
    }
    expect(reference.count).toBeGreaterThan(100); // sanity: the fixture actually bonds

    // Small chunk size forces many slabs + halo handling.
    const chunked = await detectExportBonds(frame, {
      tolerance,
      covalentRadii: COVALENT_RADII,
      chunkAtoms: 250,
    });

    expect(chunked.capped).toBe(false);
    expect(chunked.count).toBe(reference.count);
    for (let i = 0; i < chunked.count; i++) {
      const a = chunked.pairs[i * 2];
      const b = chunked.pairs[i * 2 + 1];
      expect(a).toBeLessThan(b);
      expect(referenceKeys.has(a * frame.natoms + b)).toBe(true);
    }
  });

  it('truncates at the cap, flags it, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frame = makeRandomFrame(2_000, 24);
    const progressPhases: string[] = [];

    const result = await detectExportBonds(frame, {
      tolerance: 0.45,
      covalentRadii: COVALENT_RADII,
      chunkAtoms: 250,
      cap: 7,
      onProgress: (phase) => progressPhases.push(phase),
    });

    expect(result.capped).toBe(true);
    expect(result.count).toBe(7);
    expect(result.pairs).toHaveLength(14);
    expect(warn).toHaveBeenCalledOnce();
    expect(progressPhases.at(-1)).toContain('capped');
    warn.mockRestore();
  });

  it('applies the cap on the single-slab (small frame) path too', async () => {
    const frame = makeRandomFrame(500, 12);
    const result = await detectExportBonds(frame, {
      tolerance: 0.45,
      covalentRadii: COVALENT_RADII,
      cap: 3,
    });
    expect(result.capped).toBe(true);
    expect(result.count).toBe(3);
  });
});

describe('buildExportScene', () => {
  // Two bonded pairs of types 1/2, one far-away type-3 atom that is hidden.
  const tinyFrame: ExportFrameData = {
    natoms: 5,
    positions: new Float32Array([
      0, 0, 0,
      1.2, 0, 0,
      10, 0, 0,
      11.2, 0, 0,
      50, 50, 50,
    ]),
    types: new Int32Array([1, 2, 1, 2, 3]),
  };

  const typeColors: Record<number, [number, number, number]> = {
    1: [1, 0, 0],
    2: [0, 0, 1],
    3: [0, 1, 0],
  };

  const baseOptions = {
    format: 'glb' as const,
    displayRadiusForType: (typeId: number) => typeId * 0.5,
    resolveAtomColor: (_i: number, typeId: number) => typeColors[typeId],
    hiddenTypes: new Set([3]),
    showBonds: true,
    bondTolerance: 0.45,
    covalentRadii: COVALENT_RADII,
  };

  it('creates one InstancedMesh per visible type with correct counts and colors', async () => {
    const result = await buildExportScene(tinyFrame, baseOptions);

    expect(result.atomCount).toBe(4);
    const type1 = result.scene.getObjectByName('atoms-type-1') as THREE.InstancedMesh;
    const type2 = result.scene.getObjectByName('atoms-type-2') as THREE.InstancedMesh;
    expect(type1.count).toBe(2);
    expect(type2.count).toBe(2);
    expect(result.scene.getObjectByName('atoms-type-3')).toBeUndefined();

    const color = new THREE.Color();
    type1.getColorAt(0, color);
    expect([color.r, color.g, color.b]).toEqual([1, 0, 0]);
    type2.getColorAt(1, color);
    expect([color.r, color.g, color.b]).toEqual([0, 0, 1]);

    // Instance matrix carries position + per-type radius scale.
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    type2.getMatrixAt(0, matrix);
    matrix.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(1.2);
    expect(scale.x).toBeCloseTo(1.0); // type 2 → radius 2 * 0.5

    disposeExportScene(result.scene);
  });

  it('builds bonds from the spatial-hash detector with midpoint colors', async () => {
    const result = await buildExportScene(tinyFrame, baseOptions);

    // Atoms 0-1 and 2-3 are 1.2 Å apart (cutoff 1.85); the hidden type-3 atom
    // is isolated. Bond detection intentionally covers hidden atoms too
    // (parity with the previous export behavior and the live viewer).
    expect(result.bondCount).toBe(2);
    const bondMesh = result.scene.getObjectByName('bonds') as THREE.InstancedMesh;
    expect(bondMesh.count).toBe(2);

    const color = new THREE.Color();
    bondMesh.getColorAt(0, color);
    expect(color.r).toBeCloseTo(0.5);
    expect(color.g).toBeCloseTo(0);
    expect(color.b).toBeCloseTo(0.5);

    disposeExportScene(result.scene);
  });

  it('skips bonds when showBonds is off and reports phases in order', async () => {
    const phases: string[] = [];
    const result = await buildExportScene(tinyFrame, {
      ...baseOptions,
      showBonds: false,
      onProgress: (phase) => phases.push(phase),
    });

    expect(result.bondCount).toBe(0);
    expect(result.scene.getObjectByName('bonds')).toBeUndefined();
    expect(phases).toContain('geometry');
    expect(phases).not.toContain('bonds');

    disposeExportScene(result.scene);
  });

  it('centers and scales for USDZ framing', async () => {
    const framing = computeUsdzFraming(tinyFrame, new Set([3]));
    // Visible extent is 11.2 Å along x → arScale = 0.4 / 11.2.
    expect(framing.arScale).toBeCloseTo(0.4 / 11.2);
    expect(framing.center[0]).toBeCloseTo(5.6);

    const result = await buildExportScene(tinyFrame, {
      ...baseOptions,
      format: 'usdz',
      center: framing.center,
      arScale: framing.arScale,
    });
    const type1 = result.scene.getObjectByName('atoms-type-1') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    type1.getMatrixAt(0, matrix);
    pos.setFromMatrixPosition(matrix);
    expect(pos.x).toBeCloseTo(-5.6 * framing.arScale);

    disposeExportScene(result.scene);
  });
});

describe('bakeInstancedMeshesForExport', () => {
  it('replaces every InstancedMesh with one merged palette-textured Mesh', async () => {
    const scene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(1, 6, 4);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 2);
    mesh.name = 'atoms-type-1';
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-1, 0, 0));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1, 0, 0));
    mesh.setColorAt(0, new THREE.Color(1, 0, 0));
    mesh.setColorAt(1, new THREE.Color(0, 0, 1));
    scene.add(mesh);

    const progress: Array<[number, number]> = [];
    const swaps = await bakeInstancedMeshesForExport(scene, {
      onProgress: (done, total) => progress.push([done, total]),
      stepEvery: 1,
    });

    expect(swaps).toHaveLength(1);
    const baked = swaps[0].replacement as THREE.Mesh;
    expect((baked as unknown as { isMesh: boolean }).isMesh).toBe(true);
    expect(scene.getObjectByName('atoms-type-1_baked')).toBe(baked);

    // One merged geometry: verts = base verts × instances.
    const baseVerts = geo.getAttribute('position').count;
    expect(baked.geometry.getAttribute('position').count).toBe(baseVerts * 2);

    // Per-instance color preserved through the palette texture + UVs.
    const mat = baked.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeTruthy();
    expect((mat.map!.image as { width: number }).width).toBe(2); // two unique colors
    expect(mat.vertexColors).toBe(false);

    expect(progress.at(-1)).toEqual([2, 2]);

    restoreInstancedMeshes(swaps);
    expect(scene.getObjectByName('atoms-type-1')).toBe(mesh);
    expect(scene.getObjectByName('atoms-type-1_baked')).toBeUndefined();
    geo.dispose();
  });
});
