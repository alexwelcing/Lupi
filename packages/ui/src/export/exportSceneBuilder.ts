/**
 * exportSceneBuilder — pure scene construction for 3D exports (GLB / USDZ).
 *
 * All the heavy lifting of `handle3DExport` lives here, with zero React /
 * store / DOM dependencies so the exact code path the app ships can also be
 * driven headless from Node (tools/verify-exports.mjs) and unit tests.
 *
 * Scaling decisions this module owns:
 *   Bonds     — spatial-hash detection via @atlas/scene's detectBondsCpu,
 *               run in x-sorted slabs so the main thread yields between
 *               chunks instead of freezing for the whole detection.
 *   LOD       — sphere segment tiers by atom count; USDZ additionally
 *               enforces a total-triangle budget because its bake path
 *               materializes vertices × atoms.
 *   Progress  — every phase reports through an ExportProgress callback and
 *               yields to the event loop so the UI stays responsive.
 */

import * as THREE from 'three';
import { detectBondsCpu } from '@atlas/scene/bondDetectCpu';

/** Matches ExportRequest.onProgress in the store. */
export type ExportProgress = (phase: string, done: number, total: number) => void;

/** Structural subset of @atlas/core's Frame — everything the builder reads. */
export interface ExportFrameData {
  natoms: number;
  positions: Float32Array;
  types: Int32Array;
}

export interface SphereLod {
  widthSegments: number;
  heightSegments: number;
}

/** Generous ceiling — beyond this the export truncates with a warning
 *  rather than building an unusable multi-gigabyte file. */
export const MAX_EXPORT_BONDS = 2_000_000;

/** USDZ bakes every sphere's vertices, so the real budget is triangles ×
 *  atoms. ~3M triangles keeps Quick Look loadable on phones. */
export const USDZ_TRIANGLE_BUDGET = 3_000_000;

/** Segment tiers, coarsest last. GLB picks purely by atom count (instancing
 *  means geometry is written once); USDZ walks down tiers until the merged
 *  bake fits the triangle budget. */
const SPHERE_LOD_TIERS: SphereLod[] = [
  { widthSegments: 16, heightSegments: 12 },
  { widthSegments: 10, heightSegments: 8 },
  { widthSegments: 6, heightSegments: 5 },
];
const USDZ_FALLBACK_LOD: SphereLod = { widthSegments: 5, heightSegments: 4 };

export function sphereTriangleCount(lod: SphereLod): number {
  // Pole rows are single-triangle fans; every other row is a quad strip.
  return 2 * lod.widthSegments * (lod.heightSegments - 1);
}

/**
 * Pick the sphere tessellation tier. For USDZ the merged bake pays per-atom
 * vertices, so tiers walk down until atoms fit the triangle budget —
 * `reservedTriangles` (bond cylinders, also vertex-baked) is subtracted
 * first, floored at a quarter of the budget so a bond-heavy system still
 * gets non-degenerate spheres.
 */
export function selectSphereLod(
  natoms: number,
  format: 'glb' | 'usdz',
  reservedTriangles = 0,
): SphereLod {
  const byCountIndex = natoms <= 50_000 ? 0 : natoms <= 250_000 ? 1 : 2;
  if (format !== 'usdz') return SPHERE_LOD_TIERS[byCountIndex];

  const budget = Math.max(USDZ_TRIANGLE_BUDGET - reservedTriangles, USDZ_TRIANGLE_BUDGET / 4);
  for (let i = byCountIndex; i < SPHERE_LOD_TIERS.length; i++) {
    if (natoms * sphereTriangleCount(SPHERE_LOD_TIERS[i]) <= budget) {
      return SPHERE_LOD_TIERS[i];
    }
  }
  return USDZ_FALLBACK_LOD;
}

/** Radial segments for bond cylinders (USDZ trims tiers by bond count). */
export function bondRadialSegments(format: 'glb' | 'usdz', bondCount: number): number {
  if (format !== 'usdz') return 8;
  return bondCount > 250_000 ? 5 : bondCount > 50_000 ? 6 : 8;
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Bond detection (chunked spatial hash) ─────────────────────────

export interface ExportBondOptions {
  /** Element-aware slack: cutoff = r_cov(A) + r_cov(B) + tolerance. */
  tolerance: number;
  /** Covalent radius (Å) indexed by type id. */
  covalentRadii: Float32Array;
  /** Hard ceiling on emitted bonds (default MAX_EXPORT_BONDS). */
  cap?: number;
  /** Atoms per detection slab before yielding (default 50k). */
  chunkAtoms?: number;
  onProgress?: ExportProgress;
}

export interface ExportBondResult {
  /** Canonical pairs [a0,b0, a1,b1, ...] with a < b, each at most once. */
  pairs: Int32Array;
  count: number;
  capped: boolean;
}

function maxCovalentRadius(frame: ExportFrameData, covalentRadii: Float32Array): number {
  let maxR = 0;
  for (let i = 0; i < frame.natoms; i++) {
    const r = covalentRadii[frame.types[i]] || 1.5;
    if (r > maxR) maxR = r;
  }
  return maxR;
}

/**
 * Detect bonds with detectBondsCpu, sliced into x-sorted slabs so the event
 * loop breathes between chunks. Each slab runs the detector over its core
 * atoms plus an upper halo one cutoff wide; a pair is owned by exactly the
 * slab whose core contains its lower-x endpoint, so slabs never double-count
 * and never miss cross-boundary pairs. Output is identical (as a set) to one
 * whole-frame detectBondsCpu call.
 */
export async function detectExportBonds(
  frame: ExportFrameData,
  opts: ExportBondOptions,
): Promise<ExportBondResult> {
  const { positions, types, natoms } = frame;
  const cap = opts.cap ?? MAX_EXPORT_BONDS;
  const chunkAtoms = opts.chunkAtoms ?? 50_000;
  const tolerance = opts.tolerance;
  const covalentRadii = opts.covalentRadii;
  const maxBondLength = Math.max(2 * maxCovalentRadius(frame, covalentRadii) + tolerance, 0.1);

  const finish = (pairs: Int32Array, count: number, capped: boolean): ExportBondResult => {
    if (capped) {
      console.warn(
        `[3D Export] Bond count hit the export cap (${cap.toLocaleString()}); ` +
        'remaining bonds were dropped.',
      );
      opts.onProgress?.(`bonds (capped at ${cap.toLocaleString()})`, cap, cap);
    } else {
      opts.onProgress?.('bonds', natoms, natoms);
    }
    return { pairs, count, capped };
  };

  if (natoms < 2) return finish(new Int32Array(0), 0, false);

  if (natoms <= chunkAtoms) {
    const out = detectBondsCpu({ positions, types, natoms, maxBondLength, covalentRadii, tolerance });
    const capped = out.count > cap;
    const count = Math.min(out.count, cap);
    return finish(out.bondPairs.subarray(0, count * 2).slice(), count, capped);
  }

  // Sort atom indices by x once; slabs are consecutive runs of the order.
  const order = new Uint32Array(natoms);
  for (let i = 0; i < natoms; i++) order[i] = i;
  order.sort((a, b) => positions[a * 3] - positions[b * 3]);
  await yieldToEventLoop();

  const chunks: Int32Array[] = [];
  let total = 0;
  let capped = false;
  let coreStart = 0;

  while (coreStart < natoms && !capped) {
    const coreEnd = Math.min(coreStart + chunkAtoms, natoms);
    const coreMaxX = positions[order[coreEnd - 1] * 3];

    // Upper halo: everything within one cutoff of the slab's max x. A pair's
    // lower-x endpoint in the core guarantees its partner is inside the halo.
    let haloEnd = coreEnd;
    while (haloEnd < natoms && positions[order[haloEnd] * 3] <= coreMaxX + maxBondLength) haloEnd++;

    const subsetN = haloEnd - coreStart;
    const subPositions = new Float32Array(subsetN * 3);
    const subTypes = new Int32Array(subsetN);
    for (let k = 0; k < subsetN; k++) {
      const g = order[coreStart + k];
      subPositions[k * 3] = positions[g * 3];
      subPositions[k * 3 + 1] = positions[g * 3 + 1];
      subPositions[k * 3 + 2] = positions[g * 3 + 2];
      subTypes[k] = types[g];
    }

    const out = detectBondsCpu({
      positions: subPositions,
      types: subTypes,
      natoms: subsetN,
      maxBondLength,
      covalentRadii,
      tolerance,
    });

    // Local indices follow the x-sorted subset order, and detectBondsCpu
    // emits canonical a < b, so `a` is always the lower-x endpoint —
    // ownership is simply "a inside the core".
    const coreCount = coreEnd - coreStart;
    const kept = new Int32Array(out.count * 2);
    let k = 0;
    for (let p = 0; p < out.count; p++) {
      const a = out.bondPairs[p * 2];
      if (a >= coreCount) continue;
      if (total + k >= cap) { capped = true; break; }
      const ga = order[coreStart + a];
      const gb = order[coreStart + out.bondPairs[p * 2 + 1]];
      kept[k * 2] = Math.min(ga, gb);
      kept[k * 2 + 1] = Math.max(ga, gb);
      k++;
    }
    if (k > 0) {
      chunks.push(kept.subarray(0, k * 2).slice());
      total += k;
    }

    opts.onProgress?.('bonds', coreEnd, natoms);
    await yieldToEventLoop();
    coreStart = coreEnd;
  }

  const pairs = new Int32Array(total * 2);
  let offset = 0;
  for (const chunk of chunks) {
    pairs.set(chunk, offset);
    offset += chunk.length;
  }
  return finish(pairs, total, capped);
}

// ─── Materials ─────────────────────────────────────────────────────

export type ExportMaterialPreset = 'default' | 'matte' | 'metallic' | 'glass' | 'plastic';

/**
 * Shared preset → PBR params mapping (was duplicated between the atom and
 * bond loops in ExportManager). Glass keeps transmission for GLB but falls
 * back to plain rough glass for USDZ, whose exporter drops physical props.
 */
export function createExportMaterial(
  preset: ExportMaterialPreset,
  surfacePolish: number,
  surfaceRoughness: number,
  isUsdZ: boolean,
): THREE.MeshStandardMaterial {
  let config: Record<string, unknown> = { metalness: 0.1, roughness: 0.5 };
  switch (preset) {
    case 'matte':
      config = { metalness: 0.05, roughness: 0.85 };
      break;
    case 'metallic':
      config = { metalness: 0.8, roughness: 0.2 };
      break;
    case 'glass':
      config = isUsdZ
        ? { metalness: 0.1, roughness: 0.2 }
        : { metalness: 0.1, roughness: 0.1, transmission: 0.8, transparent: true, opacity: 0.8, ior: 1.5 };
      break;
    case 'plastic':
      config = { metalness: 0.0, roughness: 0.4 };
      break;
  }

  config.metalness = Math.max(0.0, Math.min(1.0, (config.metalness as number) + surfacePolish));
  config.roughness = Math.max(0.0, Math.min(1.0, (config.roughness as number) + surfaceRoughness));

  const MaterialClass = preset === 'glass' && !isUsdZ ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  return new MaterialClass({ color: new THREE.Color(1, 1, 1), ...config });
}

// ─── USDZ framing ──────────────────────────────────────────────────

const TARGET_USDZ_EXTENT_METERS = 0.4;
const MIN_NUMERIC_RANGE = 1e-6;
const MIN_USDZ_SCALE = 0.0001;
const MAX_USDZ_SCALE = 2.0;

export interface UsdzFraming {
  center: [number, number, number];
  arScale: number;
}

/** Center visible atoms at the origin and scale to a table-top AR extent. */
export function computeUsdzFraming(
  frame: ExportFrameData,
  hiddenTypes?: ReadonlySet<number>,
): UsdzFraming {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let visibleAtoms = 0;
  for (let i = 0; i < frame.natoms; i++) {
    if (hiddenTypes?.has(frame.types[i])) continue;
    const x = frame.positions[i * 3];
    const y = frame.positions[i * 3 + 1];
    const z = frame.positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    visibleAtoms++;
  }
  if (visibleAtoms === 0) return { center: [0, 0, 0], arScale: 1 };

  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, MIN_NUMERIC_RANGE);
  return {
    center: [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5],
    arScale: Math.max(MIN_USDZ_SCALE, Math.min(MAX_USDZ_SCALE, TARGET_USDZ_EXTENT_METERS / extent)),
  };
}

// ─── Scene construction ────────────────────────────────────────────

export interface ExportSceneOptions {
  format: 'glb' | 'usdz';
  /** Sphere world radius (Å) per type — atom scale/type overrides applied by the caller. */
  displayRadiusForType: (typeId: number) => number;
  resolveAtomColor: (atomIndex: number, typeId: number) => [number, number, number];
  hiddenTypes?: ReadonlySet<number>;
  materialPreset?: ExportMaterialPreset;
  surfacePolish?: number;
  surfaceRoughness?: number;
  showBonds?: boolean;
  bondTolerance?: number;
  /** Covalent radius (Å) indexed by type id; required when showBonds. */
  covalentRadii?: Float32Array;
  bondCap?: number;
  center?: [number, number, number];
  arScale?: number;
  sphereLod?: SphereLod;
  onProgress?: ExportProgress;
  /** Atoms/bond-instances processed between event-loop yields (default 100k). */
  yieldEvery?: number;
  /** Atoms per bond-detection slab (default 50k). */
  bondChunkAtoms?: number;
}

export interface ExportSceneResult {
  scene: THREE.Scene;
  atomCount: number;
  bondCount: number;
  bondsCapped: boolean;
  sphereLod: SphereLod;
}

export async function buildExportScene(
  frame: ExportFrameData,
  opts: ExportSceneOptions,
): Promise<ExportSceneResult> {
  const isUsdZ = opts.format === 'usdz';
  const onProgress = opts.onProgress;
  const yieldEvery = opts.yieldEvery ?? 100_000;
  const preset = opts.materialPreset ?? 'default';
  const surfacePolish = opts.surfacePolish ?? 0;
  const surfaceRoughness = opts.surfaceRoughness ?? 0;
  const centerX = opts.center?.[0] ?? 0;
  const centerY = opts.center?.[1] ?? 0;
  const centerZ = opts.center?.[2] ?? 0;
  const arScale = opts.arScale ?? 1;

  const scene = new THREE.Scene();

  // Group atoms by type for instanced rendering efficiency in downstream tools
  const atomsByType = new Map<number, number[]>();
  let visibleAtoms = 0;
  for (let i = 0; i < frame.natoms; i++) {
    const typeId = frame.types[i];
    if (opts.hiddenTypes?.has(typeId)) continue;
    let bucket = atomsByType.get(typeId);
    if (!bucket) {
      bucket = [];
      atomsByType.set(typeId, bucket);
    }
    bucket.push(i);
    visibleAtoms++;
  }

  // ── Bonds first: detection is the long pole, so the progress stream
  //    runs bonds → geometry → encode in a stable order.
  let bonds: ExportBondResult = { pairs: new Int32Array(0), count: 0, capped: false };
  if (opts.showBonds && opts.covalentRadii) {
    bonds = await detectExportBonds(frame, {
      tolerance: opts.bondTolerance ?? 0.45,
      covalentRadii: opts.covalentRadii,
      cap: opts.bondCap ?? MAX_EXPORT_BONDS,
      chunkAtoms: opts.bondChunkAtoms,
      onProgress,
    });
  }

  const geometryTotal = visibleAtoms + bonds.count;
  let geometryDone = 0;
  let sinceYield = 0;
  const tickGeometry = async (n: number) => {
    geometryDone += n;
    sinceYield += n;
    if (sinceYield >= yieldEvery) {
      sinceYield = 0;
      onProgress?.('geometry', geometryDone, geometryTotal);
      await yieldToEventLoop();
    }
  };

  // ── Atom meshes: one InstancedMesh per type sharing a single LOD'd sphere.
  // Bond cylinders are vertex-baked in USDZ too, so their triangles come out
  // of the same budget before the sphere tier is chosen.
  const bondTriangles = bonds.count * bondRadialSegments(opts.format, bonds.count) * 4;
  const sphereLod = opts.sphereLod ?? selectSphereLod(visibleAtoms, opts.format, bondTriangles);
  const sphereGeo = new THREE.SphereGeometry(1, sphereLod.widthSegments, sphereLod.heightSegments);

  // Hoisted scratch — the previous per-atom `new Vector3/Quaternion` churn
  // was pure GC garbage at large atom counts.
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();
  const scratchMat = new THREE.Matrix4();
  const scratchColor = new THREE.Color();

  for (const [typeId, indices] of atomsByType) {
    const radius = opts.displayRadiusForType(typeId) * arScale;
    const material = createExportMaterial(preset, surfacePolish, surfaceRoughness, isUsdZ);
    const mesh = new THREE.InstancedMesh(sphereGeo, material, indices.length);
    mesh.name = `atoms-type-${typeId}`;

    scratchScale.set(radius, radius, radius);
    for (let j = 0; j < indices.length; j++) {
      const idx = indices[j];
      scratchPos.set(
        (frame.positions[idx * 3] - centerX) * arScale,
        (frame.positions[idx * 3 + 1] - centerY) * arScale,
        (frame.positions[idx * 3 + 2] - centerZ) * arScale,
      );
      const [r, g, b] = opts.resolveAtomColor(idx, typeId);
      scratchColor.setRGB(r, g, b);
      mesh.setColorAt(j, scratchColor);
      scratchMat.compose(scratchPos, scratchQuat, scratchScale);
      mesh.setMatrixAt(j, scratchMat);
      if ((j & 0x3fff) === 0x3fff) await tickGeometry(0x4000);
    }
    await tickGeometry(indices.length % 0x4000);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  // ── Bond cylinders ──
  if (bonds.count > 0) {
    const bondRadius = 0.12 * arScale;
    // USDZ bakes cylinder vertices per bond, so trim radial segments when the
    // bond count alone would blow the triangle budget.
    const radialSegments = bondRadialSegments(opts.format, bonds.count);
    const cylGeo = new THREE.CylinderGeometry(bondRadius, bondRadius, 1, radialSegments, 1);
    const bondMat = createExportMaterial(preset, surfacePolish, surfaceRoughness, isUsdZ);
    const bondMesh = new THREE.InstancedMesh(cylGeo, bondMat, bonds.count);
    bondMesh.name = 'bonds';

    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const colorA = new THREE.Color();
    const colorB = new THREE.Color();

    for (let b = 0; b < bonds.count; b++) {
      const ai = bonds.pairs[b * 2];
      const aj = bonds.pairs[b * 2 + 1];
      const ax = (frame.positions[ai * 3] - centerX) * arScale;
      const ay = (frame.positions[ai * 3 + 1] - centerY) * arScale;
      const az = (frame.positions[ai * 3 + 2] - centerZ) * arScale;
      const bx = (frame.positions[aj * 3] - centerX) * arScale;
      const by = (frame.positions[aj * 3 + 1] - centerY) * arScale;
      const bz = (frame.positions[aj * 3 + 2] - centerZ) * arScale;

      const length = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
      scratchPos.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      dir.set(bx - ax, by - ay, bz - az).normalize();
      scratchQuat.setFromUnitVectors(up, dir);
      scratchScale.set(1, length, 1);
      scratchMat.compose(scratchPos, scratchQuat, scratchScale);
      bondMesh.setMatrixAt(b, scratchMat);

      const [ar, ag, ab] = opts.resolveAtomColor(ai, frame.types[ai]);
      const [br, bg, bb] = opts.resolveAtomColor(aj, frame.types[aj]);
      colorA.setRGB(ar, ag, ab);
      colorB.setRGB(br, bg, bb);
      // Keep bond color visually tied to both connected atoms.
      scratchColor.copy(colorA).lerp(colorB, 0.5);
      bondMesh.setColorAt(b, scratchColor);
      if ((b & 0x3fff) === 0x3fff) await tickGeometry(0x4000);
    }
    await tickGeometry(bonds.count % 0x4000);
    bondMesh.instanceMatrix.needsUpdate = true;
    if (bondMesh.instanceColor) bondMesh.instanceColor.needsUpdate = true;
    scene.add(bondMesh);
  }

  onProgress?.('geometry', geometryTotal, geometryTotal);

  return {
    scene,
    atomCount: visibleAtoms,
    bondCount: bonds.count,
    bondsCapped: bonds.capped,
    sphereLod,
  };
}

/** Dispose everything buildExportScene allocated (geometries are shared
 *  across meshes, so dedupe before disposing). */
export function disposeExportScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m) materials.add(m);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) {
    const std = m as THREE.MeshStandardMaterial;
    if (std.map) std.map.dispose();
    m.dispose();
  }
}
