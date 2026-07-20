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
  /** Authoritative source topology as flat atom-index pairs, when supplied. */
  bonds?: Int32Array;
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
export const USDZ_BAKE_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;
export const GLB_INSTANCE_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;

export type ModelExportDeliveryMode = 'blob' | 'inline-base64';

export interface ModelExportDeliveryBudget {
  mode: ModelExportDeliveryMode;
  /** Binary payload ceiling. It deliberately excludes base64 expansion. */
  maxInlineBytes?: number;
}

/** Segment tiers, coarsest last. GLB picks purely by atom count (instancing
 *  means geometry is written once); USDZ walks down tiers until the merged
 *  bake fits the triangle budget. */
const SPHERE_LOD_TIERS: SphereLod[] = [
  { widthSegments: 16, heightSegments: 12 },
  { widthSegments: 10, heightSegments: 8 },
  { widthSegments: 6, heightSegments: 5 },
];
const USDZ_FALLBACK_LOD: SphereLod = { widthSegments: 5, heightSegments: 4 };

export interface ModelExportBudgetEstimate {
  format: 'glb' | 'usdz';
  atomCount: number;
  bondCount: number;
  sphereLod: SphereLod;
  deliveryMode: ModelExportDeliveryMode;
  estimatedTriangles: number;
  estimatedSceneBytes: number;
  estimatedEncoderOutputBytes: number;
  estimatedDeliveryBytes: number;
  /** Conservative simultaneous peak across scene, encoder, Blob/base64 delivery. */
  estimatedAllocationBytes: number;
  triangleBudget?: number;
  allocationBudgetBytes: number;
  maxInlineBytes?: number;
}

export class ModelExportBudgetError extends Error {
  readonly code = 'MODEL_EXPORT_BUDGET_EXCEEDED';
  readonly estimate: ModelExportBudgetEstimate;

  constructor(estimate: ModelExportBudgetEstimate) {
    const triangleFailure = estimate.triangleBudget !== undefined
      && estimate.estimatedTriangles > estimate.triangleBudget;
    const memoryFailure = estimate.estimatedAllocationBytes > estimate.allocationBudgetBytes;
    const inlinePayloadFailure = estimate.deliveryMode === 'inline-base64'
      && estimate.maxInlineBytes !== undefined
      && estimate.estimatedEncoderOutputBytes > estimate.maxInlineBytes;
    const reasons = [
      ...(triangleFailure
        ? [`${estimate.estimatedTriangles.toLocaleString()} triangles exceeds ${estimate.triangleBudget!.toLocaleString()}`]
        : []),
      ...(memoryFailure
        ? [`${estimate.estimatedAllocationBytes.toLocaleString()} estimated bytes exceeds ${estimate.allocationBudgetBytes.toLocaleString()}`]
        : []),
      ...(inlinePayloadFailure
        ? [`${estimate.estimatedEncoderOutputBytes.toLocaleString()} estimated output bytes exceeds inline limit ${estimate.maxInlineBytes!.toLocaleString()}`]
        : []),
    ];
    const recovery = estimate.format === 'usdz'
      ? 'Reduce visible atoms/bonds or use GLB for instanced large-model delivery.'
      : estimate.deliveryMode === 'inline-base64'
        ? 'Reduce visible atoms/bonds, raise the bounded inline limit, or use file/blob delivery.'
        : 'Reduce visible atoms/bonds before retrying the GLB export.';
    super(
      `${estimate.format.toUpperCase()} export exceeds its pre-allocation resource budget: ${reasons.join('; ')}. `
      + recovery,
    );
    this.name = 'ModelExportBudgetError';
    this.estimate = estimate;
  }
}

export function sphereTriangleCount(lod: SphereLod): number {
  // Pole rows are single-triangle fans; every other row is a quad strip.
  return 2 * lod.widthSegments * (lod.heightSegments - 1);
}

export function sphereVertexCount(lod: SphereLod): number {
  return (lod.widthSegments + 1) * (lod.heightSegments + 1);
}

/**
 * Estimate the simultaneous browser peak made by scene construction, encoder
 * output, and the selected delivery path. USDZ's bake materializes position +
 * normal + UV + 32-bit indices per instance. GLB preserves instancing. Inline
 * MCP delivery additionally keeps the Blob and UTF-16 base64 string resident;
 * an ordinary file/blob export does not pay that base64 cost. These are
 * conservative bounds so oversized work is rejected before scene allocation.
 */
export function estimateModelExportBudget(
  format: 'glb' | 'usdz',
  atomCount: number,
  bondCount: number,
  sphereLod: SphereLod,
  delivery: ModelExportDeliveryBudget = { mode: 'blob' },
): ModelExportBudgetEstimate {
  const radialSegments = bondRadialSegments(format, bondCount);
  const sphereTriangles = sphereTriangleCount(sphereLod);
  const bondTrianglesPerInstance = radialSegments * 4;
  const estimatedTriangles = atomCount * sphereTriangles + bondCount * bondTrianglesPerInstance;

  let estimatedSceneBytes: number;
  let estimatedEncoderOutputBytes: number;
  let estimatedGeometryWorkingBytes = 0;
  let allocationBudgetBytes: number;
  if (format === 'usdz') {
    const sphereVertices = sphereVertexCount(sphereLod);
    const sphereIndices = sphereTriangles * 3;
    // CylinderGeometry(radialSegments, heightSegments=1, closed): torso plus
    // two caps. This is the exact topology emitted by Three for our builder.
    const cylinderVertices = radialSegments * 6 + 4;
    const cylinderIndices = bondTrianglesPerInstance * 3;
    const bakedSphereBytes = sphereVertices * (12 + 12 + 8) + sphereIndices * 4 + 16;
    const bakedBondBytes = cylinderVertices * (12 + 12 + 8) + cylinderIndices * 4 + 16;
    const bakedBytes = atomCount * bakedSphereBytes + bondCount * bakedBondBytes;
    estimatedGeometryWorkingBytes = bakedBytes;
    // The live instanced scene remains resident while its merged bake exists.
    estimatedSceneBytes = (atomCount + bondCount) * (16 * 4 + 3 * 4) + 1024 * 1024;
    // USDZExporter builds ASCII USDA and then a ZIP ArrayBuffer. Use twice the
    // binary bake as a conservative output/working-set approximation.
    estimatedEncoderOutputBytes = bakedBytes * 2;
    allocationBudgetBytes = USDZ_BAKE_MEMORY_BUDGET_BYTES;
  } else {
    // InstancedMesh uploads one mat4 and one RGB color per instance. Include a
    // small shared-geometry/material reserve without pretending GLB expands it.
    estimatedSceneBytes = (atomCount + bondCount) * (16 * 4 + 3 * 4) + 1024 * 1024;
    // EXT_mesh_gpu_instancing writes translation/quaternion/scale/color data,
    // plus shared geometry and container overhead.
    estimatedEncoderOutputBytes = (atomCount + bondCount) * (13 * 4) + 2 * 1024 * 1024;
    allocationBudgetBytes = GLB_INSTANCE_MEMORY_BUDGET_BYTES;
  }

  // Both paths conservatively include a final Blob/ArrayBuffer alongside the
  // encoder output. Inline MCP delivery additionally materializes a base64
  // string whose UTF-16 storage is ~8/3 the binary byte length.
  const estimatedDeliveryBytes = delivery.mode === 'inline-base64'
    ? estimatedEncoderOutputBytes * (1 + 8 / 3)
    : estimatedEncoderOutputBytes;
  const estimatedAllocationBytes = estimatedSceneBytes
    + estimatedGeometryWorkingBytes
    + estimatedEncoderOutputBytes
    + estimatedDeliveryBytes;

  return {
    format,
    atomCount,
    bondCount,
    sphereLod,
    deliveryMode: delivery.mode,
    estimatedTriangles,
    estimatedSceneBytes,
    estimatedEncoderOutputBytes,
    estimatedDeliveryBytes,
    estimatedAllocationBytes,
    ...(format === 'usdz' ? { triangleBudget: USDZ_TRIANGLE_BUDGET } : {}),
    allocationBudgetBytes,
    ...(delivery.mode === 'inline-base64' && delivery.maxInlineBytes !== undefined
      ? { maxInlineBytes: delivery.maxInlineBytes }
      : {}),
  };
}

export function modelExportBudgetFits(estimate: ModelExportBudgetEstimate): boolean {
  return !(
    (estimate.triangleBudget !== undefined && estimate.estimatedTriangles > estimate.triangleBudget)
    || estimate.estimatedAllocationBytes > estimate.allocationBudgetBytes
    || (
      estimate.deliveryMode === 'inline-base64'
      && estimate.maxInlineBytes !== undefined
      && estimate.estimatedEncoderOutputBytes > estimate.maxInlineBytes
    )
  );
}

export function assertModelExportBudget(estimate: ModelExportBudgetEstimate): void {
  if (!modelExportBudgetFits(estimate)) {
    throw new ModelExportBudgetError(estimate);
  }
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

  const budget = Math.max(0, USDZ_TRIANGLE_BUDGET - reservedTriangles);
  for (let i = byCountIndex; i < SPHERE_LOD_TIERS.length; i++) {
    if (natoms * sphereTriangleCount(SPHERE_LOD_TIERS[i]) <= budget) {
      return SPHERE_LOD_TIERS[i];
    }
  }
  return USDZ_FALLBACK_LOD;
}

/**
 * Choose the highest-detail count tier that satisfies both USDZ's topology
 * ceiling and the selected browser delivery allocation budget. Triangle-only
 * selection can reject a model even when the next coarser sphere is safe.
 * Explicit caller LODs remain fail-closed in `buildExportScene`.
 */
export function selectBudgetedSphereLod(
  natoms: number,
  format: 'glb' | 'usdz',
  bondCount: number,
  delivery: ModelExportDeliveryBudget = { mode: 'blob' },
): SphereLod {
  if (format === 'glb') return selectSphereLod(natoms, format);

  const byCountIndex = natoms <= 50_000 ? 0 : natoms <= 250_000 ? 1 : 2;
  const candidates = [
    ...SPHERE_LOD_TIERS.slice(byCountIndex),
    USDZ_FALLBACK_LOD,
  ];
  for (const lod of candidates) {
    if (modelExportBudgetFits(
      estimateModelExportBudget(format, natoms, bondCount, lod, delivery),
    )) {
      return lod;
    }
  }

  // Return the cheapest topology so the shared assertion emits the complete,
  // structured refusal estimate without allocating geometry.
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
  /** Source-order pairs, or canonical inferred pairs with a < b. */
  pairs: Int32Array;
  count: number;
  capped: boolean;
  topology: 'none' | 'source' | 'inferred';
}

export class ModelExportLayerIncompleteError extends Error {
  readonly code = 'ARTIFACT_LAYER_INCOMPLETE';
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(message: string, details: Readonly<Record<string, string | number | boolean>>) {
    super(message);
    this.name = 'ModelExportLayerIncompleteError';
    this.details = details;
  }
}

/** The immutable artifact profile never treats bond truncation as success. */
export function assertCompleteExportBondLayer(
  result: Pick<ExportBondResult, 'capped' | 'topology'>,
  limit = MAX_EXPORT_BONDS,
): void {
  if (!result.capped) return;
  throw new ModelExportLayerIncompleteError(
    `The requested bonds layer exceeds the complete-export limit of ${limit.toLocaleString()} bonds.`,
    {
      layer: 'bonds',
      topology: result.topology,
      limit,
      reason: 'topology-truncated',
    },
  );
}

export interface ModelExportSourceTopologyDetails {
  natoms: number;
  sourceValueCount: number;
  pairIndex?: number;
  atomA?: number;
  atomB?: number;
  cap?: number;
}

/** Source topology is an input claim, so invalid/truncated pairs fail closed. */
export class ModelExportSourceTopologyError extends Error {
  readonly code = 'MODEL_EXPORT_SOURCE_TOPOLOGY_INVALID';
  readonly details: ModelExportSourceTopologyDetails;

  constructor(message: string, details: ModelExportSourceTopologyDetails) {
    super(message);
    this.name = 'ModelExportSourceTopologyError';
    this.details = details;
  }
}

export function validateSourceExportBonds(
  frame: ExportFrameData,
  cap = MAX_EXPORT_BONDS,
): ExportBondResult | null {
  const pairs = frame.bonds;
  if (!pairs || pairs.length === 0) return null;
  const baseDetails = { natoms: frame.natoms, sourceValueCount: pairs.length };
  if (pairs.length % 2 !== 0) {
    throw new ModelExportSourceTopologyError(
      'Source bond topology must contain complete atom-index pairs.',
      baseDetails,
    );
  }
  const count = pairs.length / 2;
  if (count > cap) {
    throw new ModelExportSourceTopologyError(
      `Source bond topology contains ${count.toLocaleString()} bonds, exceeding the exact export cap of ${cap.toLocaleString()}.`,
      { ...baseDetails, cap },
    );
  }
  for (let pairIndex = 0; pairIndex < count; pairIndex += 1) {
    const atomA = pairs[pairIndex * 2];
    const atomB = pairs[pairIndex * 2 + 1];
    if (atomA < 0 || atomA >= frame.natoms || atomB < 0 || atomB >= frame.natoms || atomA === atomB) {
      throw new ModelExportSourceTopologyError(
        `Source bond ${pairIndex} contains invalid atom indices (${atomA}, ${atomB}) for ${frame.natoms} atoms.`,
        { ...baseDetails, pairIndex, atomA, atomB },
      );
    }
  }
  return { pairs, count, capped: false, topology: 'source' };
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
    return { pairs, count, capped, topology: 'inferred' };
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
  /** Blob/download by default; agent responses must opt into base64 accounting. */
  delivery?: ModelExportDeliveryBudget;
  /** Sphere world radius (Å) per type — atom scale/type overrides applied by the caller. */
  displayRadiusForType: (typeId: number) => number;
  /** Display-sRGB tuple; the builder linearizes it for Three/glTF vertex colors. */
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
  bondTopology: ExportBondResult['topology'];
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

  // Reject atom-only cases that cannot possibly fit before allocating grouping
  // arrays, bond buffers, InstancedMesh attributes, or USDZ bake geometry.
  let visibleAtoms = 0;
  for (let i = 0; i < frame.natoms; i++) {
    const typeId = frame.types[i];
    if (opts.hiddenTypes?.has(typeId)) continue;
    visibleAtoms++;
  }
  const atomOnlyLod = opts.sphereLod ?? selectBudgetedSphereLod(
    visibleAtoms,
    opts.format,
    0,
    opts.delivery,
  );
  assertModelExportBudget(estimateModelExportBudget(
    opts.format,
    visibleAtoms,
    0,
    atomOnlyLod,
    opts.delivery,
  ));

  // Group atoms by type for instanced rendering efficiency in downstream tools
  const atomsByType = new Map<number, number[]>();
  for (let i = 0; i < frame.natoms; i++) {
    const typeId = frame.types[i];
    if (opts.hiddenTypes?.has(typeId)) continue;
    let bucket = atomsByType.get(typeId);
    if (!bucket) {
      bucket = [];
      atomsByType.set(typeId, bucket);
    }
    bucket.push(i);
  }

  // ── Bonds first: detection is the long pole, so the progress stream
  //    runs bonds → geometry → encode in a stable order.
  let bonds: ExportBondResult = {
    pairs: new Int32Array(0),
    count: 0,
    capped: false,
    topology: 'none',
  };
  if (opts.showBonds) {
    const sourceBonds = validateSourceExportBonds(frame, opts.bondCap ?? MAX_EXPORT_BONDS);
    if (sourceBonds) {
      bonds = sourceBonds;
      onProgress?.('bonds (source)', bonds.count, bonds.count);
    } else if (opts.covalentRadii) {
      bonds = await detectExportBonds(frame, {
        tolerance: opts.bondTolerance ?? 0.45,
        covalentRadii: opts.covalentRadii,
        cap: opts.bondCap ?? MAX_EXPORT_BONDS,
        chunkAtoms: opts.bondChunkAtoms,
        onProgress,
      });
    } else {
      throw new ModelExportSourceTopologyError(
        'Bond export requires authoritative source pairs or covalent radii for explicit inference.',
        { natoms: frame.natoms, sourceValueCount: 0 },
      );
    }
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
  const sphereLod = opts.sphereLod ?? selectBudgetedSphereLod(
    visibleAtoms,
    opts.format,
    bonds.count,
    opts.delivery,
  );
  assertModelExportBudget(
    estimateModelExportBudget(opts.format, visibleAtoms, bonds.count, sphereLod, opts.delivery),
  );
  const scene = new THREE.Scene();
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();

  try {
    const sphereGeo = new THREE.SphereGeometry(1, sphereLod.widthSegments, sphereLod.heightSegments);
    ownedGeometries.add(sphereGeo);

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
    ownedMaterials.add(material);
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
      scratchColor.setRGB(r, g, b, THREE.SRGBColorSpace);
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
    ownedGeometries.add(cylGeo);
    const bondMat = createExportMaterial(preset, surfacePolish, surfaceRoughness, isUsdZ);
    ownedMaterials.add(bondMat);
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
      colorA.setRGB(ar, ag, ab, THREE.SRGBColorSpace);
      colorB.setRGB(br, bg, bb, THREE.SRGBColorSpace);
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
      bondTopology: bonds.topology,
      sphereLod,
    };
  } catch (error) {
    // Until this function returns, no caller can reach the partially built
    // scene. Dispose every resource at the construction boundary, including
    // geometries/materials that were allocated before their mesh was added.
    disposeExportResources(ownedGeometries, ownedMaterials);
    throw error;
  }
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
  disposeExportResources(geometries, materials);
}

function disposeExportResources(
  geometries: ReadonlySet<THREE.BufferGeometry>,
  materials: ReadonlySet<THREE.Material>,
) {
  for (const g of geometries) g.dispose();
  for (const m of materials) {
    const std = m as THREE.MeshStandardMaterial;
    if (std.map) std.map.dispose();
    m.dispose();
  }
}
