/**
 * <Bonds /> — High-performance bond rendering with off-thread detection
 *
 * Bond detection (spatial hash + neighbor query) runs in a Web Worker or a
 * WebGPU compute pipeline so it never blocks rendering. The component stays
 * mounted and uses visibility toggling instead of unmount/remount.
 *
 * Architecture:
 * - Bond detection → Web Worker / WebGPU (non-blocking); the molecular
 *   recipe instead draws the owner's synchronous `getPerceivedBonds` result
 *   (≤ 2,000 atoms), with dashed coordination and dotted ionic contacts
 * - Rendering → one ray-cast cylinder impostor per bond, a TSL node material
 *   (tsl/bondImpostorMaterial.ts) on the shared impostor kit: endpoints,
 *   radius and two endpoint colors per instance, frame interpolation on the
 *   GPU, exact depth, no radial segments; WGSL on WebGPU, GLSL on WebGL2
 * - GPU upload → endpoints gathered once per bond-set/frame change
 * - Toggle → instant visibility flip, no recomputation
 */

/// <reference path="./vite-env.d.ts" />
import { useRef, useMemo, useEffect, useLayoutEffect, useState, useCallback, useId } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Frame, ColormapName } from '@atlas/core/types';
import {
  framesShareAtomOrder,
  getElementSpec,
  hexToRgb,
  resolveAtomicNumber,
  resolveTypeColor,
} from '@atlas/core';
import { DEFAULT_TYPE_COLOR, COLORMAPS } from './constants';
import { useBondGpuPipeline } from './useBondGpuPipeline';
// Vite ?worker import: produces a real bundled .js worker module in prod.
// The plain `new URL('./bondWorker.ts', import.meta.url)` form does NOT
// emit a worker chunk during Vite's prod build, so it 404s at runtime.
// The triple-slash reference at the top of the file pulls in the ambient
// `?worker` module declaration from vite-env.d.ts so this resolves both
// in @atlas/scene's own tsc run and in any consumer (e.g. @atlas/ui).
import BondWorkerCtor from './bondWorker.ts?worker';
import {
  BOND_KIND_RADIUS_SCALE,
  BOND_KIND_STYLE_ALPHA,
  MOLECULAR_RECIPE_ID,
  filterPerceivedBonds,
  type BondRecipeId,
  type PerceivedBonds,
} from '@atlas/core/bonds';
import {
  bondsUpdateDetail,
  resolveBondTopologyMode,
  shouldUseGpuBondInference,
  type BondsUpdateDetail,
} from './bondTopology';
import { wrapDelta } from './interpolation';
import { bondMaterialParams, createBondBoxGeometry } from './bondImpostor';
import { markInstancedAttributeUpdateRange, resolveAtomQualityTier, type AtomQualityTier } from './AtomsOptimized';
import { LUPI_JOB, LUPI_PHASE } from './framePhases';
import {
  createLupiEnvBinding,
  createLupiLightUniforms,
  lightDirection,
  syncLupiEnvBinding,
} from './tsl/impostorKit';
import {
  BOND_ATTR,
  BOND_COLOR_STRIDE,
  createBondImpostorMaterial,
  createBondImpostorUniforms,
  writeBondColor,
  type BondImpostorUniforms,
} from './tsl/bondImpostorMaterial';
import { useLupiCommitFrames } from './frameDemand';

/**
 * Content-equality check for bond-pair Int32Arrays. Used by the bond-
 * stability skip in uploadBondAttributes — when the worker emits a fresh
 * array with identical contents (same atoms still bonded, just moving),
 * the attribute upload becomes a no-op.
 *
 * Walks both arrays with early exit. ~0.3ms for 27k bonds, far less than
 * the ~1-3ms attribute upload it skips.
 */
/** Min frame-to-frame max-atom displacement (Å) that triggers bond recompute.
 *  Below this, bond topology is guaranteed stable for any reasonable cutoff
 *  (covalent-shortest is ~0.6 Å) so we keep the cached bondPairs and skip
 *  the spatial-hash + neighbor scan entirely. Tuned conservatively so even
 *  fast-equilibrating MD won't drop a real bond change. */
const BOND_RECOMPUTE_DISP_THRESHOLD = 0.05;

/** Headroom over the bond criterion before a lagging inferred pair is hidden. */
const STALE_BOND_SLACK = 1.1;
/** Covalent radius assumed for a type with no element (the detectors' fallback). */
const STALE_BOND_UNKNOWN_RADIUS = 1.5;
const EMPTY_BOND_PAIRS = new Int32Array(0);
const EMPTY_BOND_DISTANCES = new Float32Array(0);

/** Returns the max |Δposition| between `curr` and `prev`, sampled at most
 *  1000 atoms to keep the check sub-millisecond on million-atom scenes.
 *  Both arrays are flat XYZ; equal length is required (caller checks). */
function subsampledMaxDisplacement(curr: Float32Array, prev: Float32Array): number {
  const natoms = curr.length / 3;
  const stride = Math.max(1, Math.floor(natoms / 1000));
  let maxSq = 0;
  for (let i = 0; i < natoms; i += stride) {
    const dx = curr[i * 3] - prev[i * 3];
    const dy = curr[i * 3 + 1] - prev[i * 3 + 1];
    const dz = curr[i * 3 + 2] - prev[i * 3 + 2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxSq) maxSq = d2;
  }
  return Math.sqrt(maxSq);
}

function bondPairsContentEqual(a: Int32Array, b: Int32Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function atomTypesContentEqual(a: Int32Array, b: Int32Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function filterHiddenTypeBonds(
  frame: Frame,
  pairs: Int32Array,
  distances: Float32Array,
  hiddenAtomTypes: ReadonlySet<number>,
): { pairs: Int32Array; distances: Float32Array } {
  if (hiddenAtomTypes.size === 0 || pairs.length === 0) return { pairs, distances };
  // Two passes over typed arrays: count, then compact. No per-bond JS
  // allocation, so hiding a type on a multi-million-bond scene stays cheap.
  const pairCount = pairs.length >> 1;
  const natoms = frame.natoms;
  const types = frame.types;
  const keep = new Uint8Array(pairCount);
  let kept = 0;
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    const atomA = pairs[pairIndex * 2];
    const atomB = pairs[pairIndex * 2 + 1];
    if (atomA < 0 || atomA >= natoms || atomB < 0 || atomB >= natoms) continue;
    if (hiddenAtomTypes.has(types[atomA]) || hiddenAtomTypes.has(types[atomB])) continue;
    keep[pairIndex] = 1;
    kept += 1;
  }
  if (kept === pairCount) return { pairs, distances };
  const keptPairs = new Int32Array(kept * 2);
  const keptDistances = new Float32Array(kept);
  let out = 0;
  for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
    if (!keep[pairIndex]) continue;
    keptPairs[out * 2] = pairs[pairIndex * 2];
    keptPairs[out * 2 + 1] = pairs[pairIndex * 2 + 1];
    keptDistances[out] = distances[pairIndex] ?? 0;
    out += 1;
  }
  return { pairs: keptPairs, distances: keptDistances };
}

/**
 * What one bond layer's node materials share: the uniform bag, the light
 * uniforms and the environment binding. The per-tier materials (static and
 * lerping) are built on first use and kept for the layer's life.
 */
export interface BondImpostorResources {
  uniforms: BondImpostorUniforms;
  lights: ReturnType<typeof createLupiLightUniforms>;
  env: ReturnType<typeof createLupiEnvBinding>;
  /** Keyed by tier plus `:lerp` for the interpolating program. */
  materials: Map<string, MeshBasicNodeMaterial>;
}

export function createBondImpostorResources(): BondImpostorResources {
  return {
    uniforms: createBondImpostorUniforms(),
    lights: createLupiLightUniforms(),
    env: createLupiEnvBinding(),
    materials: new Map(),
  };
}

/**
 * The layer's node material for one quality tier, static or interpolating
 * (built once each). An interpolating material needs a geometry whose target
 * endpoints are their own buffers (see tsl/bondImpostorMaterial.ts). A new
 * material inherits the transparency of the ones already built.
 */
export function bondMaterialForTier(
  resources: BondImpostorResources,
  tier: AtomQualityTier,
  interpolate = false,
): MeshBasicNodeMaterial {
  const key = `${tier}${interpolate ? ':lerp' : ''}`;
  let material = resources.materials.get(key);
  if (!material) {
    const transparent = resources.materials.values().next().value?.transparent ?? false;
    material = createBondImpostorMaterial({
      tier,
      interpolate,
      uniforms: resources.uniforms,
      lights: resources.lights,
      env: resources.env,
    });
    material.transparent = transparent;
    resources.materials.set(key, material);
  }
  return material;
}

/** Release every tier's material. The scene environment belongs to others. */
export function disposeBondImpostorResources(resources: BondImpostorResources): void {
  for (const material of resources.materials.values()) material.dispose();
}

interface BondsProps {
  frame: Frame;
  nextFrame?: Frame;
  interpolationFactor?: number;
  colormap?: ColormapName;
  colorMode?: 'type' | 'uniform' | 'property';
  colorProperty?: string;
  uniformColor?: string;
  elementColorOverrides?: Record<number, string>;
  propRange?: [number, number];
  maxBondLength?: number;
  /** Element-aware bonding tolerance (Å). Added to `r_cov(A) + r_cov(B)` per
   *  pair when deciding whether two atoms are bonded. The user-facing slider
   *  drives this. Default 0.45 mirrors the Cordero pair-radius slack. */
  tolerance?: number;
  typeCutoffs?: Map<string, number>;
  periodic?: boolean;
  cellBounds?: [number, number, number, number, number, number];
  radius?: number;
  opacity?: number;
  materialPreset?: 'default' | 'matte' | 'metallic' | 'glass' | 'plastic' | 'transmission';
  materialIntensity?: number;
  rimLightIntensity?: number;
  surfaceRoughness?: number;
  surfacePolish?: number;
  surfaceClearcoat?: number;
  fillLightColor?: string;
  rimLightColor?: string;
  keyLightAzimuth?: number;
  keyLightElevation?: number;
  fillLightAzimuth?: number;
  fillLightElevation?: number;
  rimLightAzimuth?: number;
  rimLightElevation?: number;
  visible?: boolean;
  /** Integer index of `frame` within its trajectory; with `liveStateRef` it
   *  drives display-rate GPU interpolation exactly like AtomsOptimized. */
  frameIndex?: number;
  liveStateRef?: { readonly current: { readonly effectiveFrame: number } | null };
  /** Fragment-shader tier (see AtomsOptimized); lowered further by atom count. */
  qualityTier?: AtomQualityTier;
  /** Bonds thinner than this many device pixels are culled in the vertex shader. */
  cullPixelRadius?: number;
  bondColorMode?: 'type' | 'length' | 'energy' | 'screening';
  /** Route bond detection through the WebGPU compute pipeline instead of
   *  the CPU worker. Falls back transparently if WebGPU init fails. */
  useGpu?: boolean;
  /** Precomputed by the owner scene to avoid rescanning large type buffers.
   * Source pairs still take precedence. */
  inferenceAllowed?: boolean;
  /** Source of per-type atom colors used as gradient endpoints. Should
   *  match the value passed to AtomsOptimized so bonds and atoms agree. */
  atomColorSource?: 'colormap' | 'element';
  /** Raw types hidden by the owner viewer. Bonds touching them are removed. */
  hiddenAtomTypes?: ReadonlySet<number>;
  /** Identity of the loaded source (the owner passes the file's trajectory
   *  object). Frames of one trajectory share it; a new value is a different
   *  molecule even when its atom count and types match the previous one. */
  sourceKey?: object | null;
  /** The frame's bond rule (the owner's resolveFrameRecipe). With the
   *  molecular recipe the layer draws `perceivedBonds` and never posts to the
   *  worker or the GPU. */
  recipe?: BondRecipeId | 'source' | null;
  /** The unfiltered molecular bond graph of `frame` (getPerceivedBonds). */
  perceivedBonds?: PerceivedBonds | null;
  /** Draw ionic contacts (store `showBondContacts`). */
  showBondContacts?: boolean;
  /** Telemetry hook — reports the bonds actually left after visibility
   *  filtering, not merely the raw inference result. `count` is covalent plus
   *  coordination (contacts are not bonds). Used by visual readiness, MCP
   *  and the dev HUD; safe to omit. */
  onBondsUpdate?: (info: { source: 'cpu' | 'gpu' | 'none'; count: number; detail?: BondsUpdateDetail }) => void;
  /** Telemetry hook — fires when the GPU pipeline's status changes. */
  onGpuStatusChange?: (status: 'idle' | 'ready' | 'unsupported') => void;
  /**
   * Radius of the atom balls at the bond ends (the smallest drawn, so no
   * visible stick darkens past its ball). With `junctionStrength` > 0 the
   * stick darkens where it enters the ball (the Contact look). 0 disables it.
   */
  junctionRadius?: number;
  junctionStrength?: number;
}

export function Bonds({
  frame,
  nextFrame,
  interpolationFactor,
  colormap = 'viridis',
  colorMode = 'type',
  colorProperty,
  uniformColor = '#1edce0',
  elementColorOverrides = {},
  propRange,
  maxBondLength = 3.2,
  tolerance = 0.45,
  typeCutoffs,
  periodic = false,
  cellBounds,
  radius = 0.12,
  opacity = 0.85,
  materialPreset = 'default',
  materialIntensity = 0.0,
  rimLightIntensity = 0.3,
  surfaceRoughness = 0.0,
  surfacePolish = 0.0,
  surfaceClearcoat = 0.0,
  junctionRadius = 0,
  junctionStrength = 0,
  fillLightColor = '#5577ff',
  rimLightColor = '#ff7755',
  keyLightAzimuth = 40,
  keyLightElevation = 45,
  fillLightAzimuth = -120,
  fillLightElevation = 10,
  rimLightAzimuth = 160,
  rimLightElevation = 30,
  visible = true,
  frameIndex,
  liveStateRef,
  qualityTier,
  cullPixelRadius = 0,
  bondColorMode = 'type',
  useGpu = false,
  inferenceAllowed: precomputedInferenceAllowed,
  atomColorSource = 'colormap',
  hiddenAtomTypes = new Set<number>(),
  sourceKey,
  recipe = null,
  perceivedBonds = null,
  showBondContacts = true,
  onBondsUpdate,
  onGpuStatusChange,
}: BondsProps) {
  // Imperative uniform/attribute writes on commit (and async results) get drawn.
  useLupiCommitFrames();
  const meshRef = useRef<THREE.Mesh>(null);
  const canInterpolateToNextFrame = useMemo(
    () => Boolean(nextFrame && framesShareAtomOrder(frame, nextFrame)),
    [frame, nextFrame],
  );
  const workerRef = useRef<Worker | null>(null);
  const workerBusyRef = useRef<boolean>(false);
  const pendingMsgRef = useRef<{ msg: Record<string, any>, transferList: ArrayBuffer[], requestId: number } | null>(null);
  const cpuDispatchGenRef = useRef(0);
  // Worker results are applied newest-first, not only when they match the
  // latest request: during playback the next frame's request is usually out
  // before the previous reply lands, and a slow main thread would otherwise
  // drop every reply and show no bonds until playback stops. Replies from
  // before a molecule, parameter or visibility change stay rejected.
  const cpuAcceptFromRef = useRef(1);
  const cpuAppliedRef = useRef(0);

  // Auto-force GPU for big systems regardless of the user's toggle: at
  // hundreds of thousands of atoms the CPU worker is unusable (60+ seconds
  // per detection, browser kills the tab) and a single CPU dispatch can
  // OOM the worker thread. The GPU pipeline scans them in milliseconds.
  // Threshold tuned to where CPU spatial-hash detection starts taking >1s.
  const FORCE_GPU_ATOM_THRESHOLD = 200_000;
  const topologyMode = resolveBondTopologyMode(frame, precomputedInferenceAllowed);
  const typeSemanticsKey = JSON.stringify(frame.typeSemantics ?? null);
  const hiddenAtomTypesKey = Array.from(hiddenAtomTypes).sort((a, b) => a - b).join(',');
  const hasSourceTopology = topologyMode === 'source';
  const inferenceAllowed = topologyMode === 'infer';
  // The molecular graph is computed for exactly this frame on the main thread.
  const molecular = inferenceAllowed && recipe === MOLECULAR_RECIPE_ID && perceivedBonds !== null;
  const forceGpu = !hasSourceTopology && inferenceAllowed && !molecular && (frame?.natoms ?? 0) > FORCE_GPU_ATOM_THRESHOLD;
  const wantGpu = inferenceAllowed && shouldUseGpuBondInference(
    frame?.natoms ?? 0,
    frame?.bonds,
    useGpu,
    FORCE_GPU_ATOM_THRESHOLD,
    molecular ? MOLECULAR_RECIPE_ID : recipe,
  );

  // GPU bond pipeline. Initializes lazily; falls back via `unsupported`.
  // Destructure so dep arrays aren't churned by the hook returning a fresh
  // object each render — `compute` is useCallback'd and stable.
  const { ready: gpuReady, unsupported: gpuUnsupported, compute: gpuCompute } = useBondGpuPipeline(wantGpu);
  // Effective GPU mode: requested AND not known-unsupported. When GPU init
  // fails, this drops to false and the worker takes over without a hiccup.
  // EXCEPT when forceGpu is true and gpu is unsupported — in that case we
  // simply skip bond detection entirely rather than crash the worker.
  const gpuActive = wantGpu && !gpuUnsupported;
  const skipDetection = (!hasSourceTopology && !inferenceAllowed) || (forceGpu && gpuUnsupported);

  // Telemetry: report status changes upward.
  useEffect(() => {
    if (!onGpuStatusChange) return;
    if (!useGpu) onGpuStatusChange('idle');
    else if (gpuUnsupported) onGpuStatusChange('unsupported');
    else if (gpuReady) onGpuStatusChange('ready');
    else onGpuStatusChange('idle');
  }, [useGpu, gpuReady, gpuUnsupported, onGpuStatusChange]);

  // Bond pair data from the worker
  const [detectedBondPairs, setBondPairs] = useState<Int32Array>(EMPTY_BOND_PAIRS);
  const [detectedBondDistances, setBondDistances] = useState<Float32Array>(EMPTY_BOND_DISTANCES);
  const [detectedBondSource, setDetectedBondSource] = useState<'cpu' | 'gpu' | 'none'>('none');
  // Molecular: the same filter as the atom card, MCP and exports.
  const drawnMolecular = useMemo(
    () => (molecular && perceivedBonds
      ? filterPerceivedBonds(perceivedBonds, { types: frame.types, hiddenTypes: hiddenAtomTypes, showContacts: showBondContacts })
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [molecular, perceivedBonds, frame.types, hiddenAtomTypesKey, showBondContacts],
  );
  const { pairs: bondPairs, distances: bondDistances } = useMemo(
    () => drawnMolecular ?? filterHiddenTypeBonds(frame, detectedBondPairs, detectedBondDistances, hiddenAtomTypes),
    // The key binds contents even if the store reuses its hidden-types array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawnMolecular, frame, detectedBondPairs, detectedBondDistances, hiddenAtomTypesKey],
  );
  const bondKinds = drawnMolecular?.kinds ?? null;
  const bondCount = bondPairs.length / 2;
  const bondSource: 'cpu' | 'gpu' | 'none' = drawnMolecular ? 'cpu' : detectedBondSource;
  const onBondsUpdateRef = useRef(onBondsUpdate);

  useEffect(() => {
    onBondsUpdateRef.current = onBondsUpdate;
  }, [onBondsUpdate]);

  useEffect(() => {
    if (drawnMolecular && perceivedBonds) {
      const detail = bondsUpdateDetail(MOLECULAR_RECIPE_ID, drawnMolecular.count, perceivedBonds.params.tolerance, {
        kinds: drawnMolecular.kinds,
        counts: perceivedBonds.counts,
      });
      onBondsUpdateRef.current?.({ source: 'cpu', count: detail.kinds.covalent + detail.kinds.coordination, detail });
      return;
    }
    const detail = bondSource === 'none' || recipe === null
      ? undefined
      : bondsUpdateDetail(recipe, bondCount, tolerance);
    onBondsUpdateRef.current?.({ source: bondSource, count: bondCount, detail });
  }, [bondCount, bondSource, drawnMolecular, perceivedBonds, recipe, tolerance]);

  const clearBondState = useCallback(() => {
    setBondPairs(prev => prev.length === 0 ? prev : EMPTY_BOND_PAIRS);
    setBondDistances(prev => prev.length === 0 ? prev : EMPTY_BOND_DISTANCES);
    setDetectedBondSource('none');
  }, []);

  // (Geometry and material live below the capacity ratchet.)

  // ─── Web Worker lifecycle ──────────────────────────────────────────
  useEffect(() => {
    const worker = new BondWorkerCtor();
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { requestId, bondPairs: pairs, distances } = e.data;
      const isFresh = typeof requestId === 'number'
        && requestId >= cpuAcceptFromRef.current
        && requestId > cpuAppliedRef.current;
      if (isFresh) {
        cpuAppliedRef.current = requestId;
        // pairs is Int32Array [a0,b0, a1,b1, ...]
        const nextPairs = pairs instanceof Int32Array ? pairs : pairs ? new Int32Array(pairs) : EMPTY_BOND_PAIRS;
        setBondPairs(nextPairs);
        setBondDistances(
          distances instanceof Float32Array
            ? distances
            : distances
              ? new Float32Array(distances)
              : EMPTY_BOND_DISTANCES
        );
        setDetectedBondSource('cpu');
      }

      workerBusyRef.current = false;
      if (pendingMsgRef.current) {
        const { msg, transferList } = pendingMsgRef.current;
        pendingMsgRef.current = null;
        workerBusyRef.current = true;
        worker.postMessage(msg, transferList);
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      workerBusyRef.current = false;
      pendingMsgRef.current = null;
    };
  }, []);

  // ─── Dispatch bond detection to worker (debounced) ─────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevFrameRef = useRef<Frame | null>(null);
  // Track natoms to detect molecule switches — when natoms changes, the
  // user loaded a completely different system. All cached dispatch state
  // must be invalidated to prevent stale bonds from persisting.
  const prevNatomsRef = useRef<number>(0);
  const prevSourceKeyRef = useRef<object | null | undefined>(undefined);
  // Snapshot of the positions array we last actually dispatched bond
  // detection on. Lets us skip dispatch when atoms have only jittered
  // (sub-threshold motion) — bond topology doesn't change for ~0.05 Å
  // moves, so we keep the cached bondPairs and avoid the recompute.
  const lastDispatchPositionsRef = useRef<Float32Array | null>(null);
  const lastDispatchTypesRef = useRef<Int32Array | null>(null);
  const lastDispatchTypeSemanticsKeyRef = useRef<string>('');
  // Motion/parameter caches are backend-owned. A GPU attempt can populate the
  // same frame snapshot before capability detection reports `unsupported`;
  // the CPU fallback must still dispatch that frame once.
  const lastDispatchBackendRef = useRef<'cpu' | 'gpu' | null>(null);
  // Snapshot of the tolerance + max-bond-length we last dispatched on. The
  // motion-skip path must NOT fire when the user has slid the tolerance
  // knob; topology changes immediately even if atoms haven't moved.
  const lastDispatchToleranceRef = useRef<number>(NaN);
  const lastDispatchMaxBondLengthRef = useRef<number>(NaN);

  useEffect(() => {
    if (gpuActive) {
      cpuDispatchGenRef.current += 1;
      cpuAcceptFromRef.current = cpuDispatchGenRef.current + 1;
      pendingMsgRef.current = null;
      return; // GPU effect below owns dispatch in this mode.
    }
    if (molecular) {
      // Drawn from the synchronous molecular graph; nothing to detect. Forget
      // the last dispatch so a switch back to distance detects afresh.
      cpuDispatchGenRef.current += 1;
      cpuAcceptFromRef.current = cpuDispatchGenRef.current + 1;
      pendingMsgRef.current = null;
      clearBondState();
      lastDispatchPositionsRef.current = null;
      lastDispatchBackendRef.current = null;
      lastDispatchToleranceRef.current = NaN;
      lastDispatchMaxBondLengthRef.current = NaN;
      lastDispatchTypesRef.current = null;
      prevFrameRef.current = frame;
      prevNatomsRef.current = frame.natoms;
      prevSourceKeyRef.current = sourceKey;
      return;
    }
    // Skip CPU dispatch when bonds are hidden — running spatial-hash + neighbor
    // scan on a 1M-atom system produces tens of MB of bond pairs that are
    // never rendered. The user explicitly toggled bonds off; respect it.
    if (!visible) {
      cpuDispatchGenRef.current += 1;
      cpuAcceptFromRef.current = cpuDispatchGenRef.current + 1;
      pendingMsgRef.current = null;
      clearBondState();
      lastDispatchPositionsRef.current = null;
      lastDispatchBackendRef.current = null;
      lastDispatchToleranceRef.current = NaN;
      lastDispatchMaxBondLengthRef.current = NaN;
      prevFrameRef.current = frame;
      return;
    }
    if (skipDetection) {
      // Forced-GPU but GPU unavailable. Don't blow up the worker on a
      // huge system; just leave bonds empty until the user lowers the cutoff
      // or the system. (Telemetry: gpuStatus already reads 'unsupported'.)
      cpuDispatchGenRef.current += 1;
      cpuAcceptFromRef.current = cpuDispatchGenRef.current + 1;
      pendingMsgRef.current = null;
      clearBondState();
      lastDispatchPositionsRef.current = null;
      lastDispatchBackendRef.current = null;
      lastDispatchToleranceRef.current = NaN;
      lastDispatchMaxBondLengthRef.current = NaN;
      prevFrameRef.current = frame;
      return;
    }
    if (!workerRef.current || !frame || frame.natoms < 2) {
      cpuDispatchGenRef.current += 1;
      cpuAcceptFromRef.current = cpuDispatchGenRef.current + 1;
      pendingMsgRef.current = null;
      clearBondState();
      lastDispatchPositionsRef.current = null;
      lastDispatchBackendRef.current = null;
      lastDispatchToleranceRef.current = NaN;
      lastDispatchMaxBondLengthRef.current = NaN;
      prevFrameRef.current = frame;
      return;
    }

    const isFrameChange = frame !== prevFrameRef.current;
    prevFrameRef.current = frame;

    // Detect a molecule switch: a new source (a same-size molecule with the
    // same types still arrives with a new trajectory), a different atom count,
    // or different type content or semantics. Frames of one trajectory keep
    // the same source, so playback steps are not switches.
    const typeInterpretationChanged = lastDispatchTypesRef.current !== null && (
      !atomTypesContentEqual(frame.types, lastDispatchTypesRef.current) ||
      typeSemanticsKey !== lastDispatchTypeSemanticsKeyRef.current
    );
    const sourceChanged = sourceKey !== prevSourceKeyRef.current;
    prevSourceKeyRef.current = sourceKey;
    const isMoleculeSwitch = frame.natoms !== prevNatomsRef.current || typeInterpretationChanged || sourceChanged;
    prevNatomsRef.current = frame.natoms;
    if (isMoleculeSwitch) {
      // The previous molecule's pairs index atoms of a different structure.
      clearBondState();
      lastDispatchPositionsRef.current = null;
      lastDispatchBackendRef.current = null;
      lastDispatchToleranceRef.current = NaN;
      lastDispatchMaxBondLengthRef.current = NaN;
      lastDispatchTypesRef.current = null;
      lastDispatchTypeSemanticsKeyRef.current = '';
    }

    // Motion polish: if this is a frame change but atoms have barely moved
    // (max displacement < threshold), skip dispatch entirely and keep the
    // previously computed bondPairs. Bond topology does not change for
    // sub-threshold jitter (covalent bonds are ≥0.6 Å, threshold is 0.05 Å).
    // Subsamples up to 1000 atoms for the displacement check so the gate
    // itself stays cheap on million-atom scenes.
    const cpuParamsUnchanged =
      lastDispatchBackendRef.current === 'cpu' &&
      lastDispatchToleranceRef.current === tolerance &&
      lastDispatchMaxBondLengthRef.current === maxBondLength;
    if (!hasSourceTopology && !isMoleculeSwitch && isFrameChange && cpuParamsUnchanged && lastDispatchPositionsRef.current && frame.positions.length === lastDispatchPositionsRef.current.length) {
      const maxDisp = subsampledMaxDisplacement(frame.positions, lastDispatchPositionsRef.current);
      if (maxDisp < BOND_RECOMPUTE_DISP_THRESHOLD) {
        return;
      }
    }

    // Debounce cutoff changes — 150ms delay so slider doesn't spam
    // Frame changes (playback) should dispatch instantly (0ms) to prevent flickering
    const delay = isFrameChange ? 0 : 150;
    const requestId = cpuDispatchGenRef.current + 1;
    cpuDispatchGenRef.current = requestId;
    // A playback step may show the previous frame's bonds until its own reply
    // lands; anything else must wait for this request.
    if (!isFrameChange || isMoleculeSwitch) cpuAcceptFromRef.current = requestId;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;

      // Send data to worker — positions and types are transferred (zero-copy)
      // We make copies since the originals are shared with the renderer
      const posCopy = new Float32Array(frame.positions);
      const typesCopy = new Int32Array(frame.natoms);
      const sourceBondCopy = hasSourceTopology ? new Int32Array(frame.bonds) : null;

      // Build per-type covalent radii lookup from ELEMENT_DATA
      // This enables scientific bond detection: d(A,B) < r_cov(A) + r_cov(B) + tolerance
      const covalentRadii = hasSourceTopology ? new Float32Array(0) : new Float32Array(119);
      if (hasSourceTopology) {
        typesCopy.set(frame.types);
      } else {
        for (let atomIndex = 0; atomIndex < frame.natoms; atomIndex += 1) {
          const atomicNumber = resolveAtomicNumber(frame, frame.types[atomIndex]);
          if (atomicNumber === undefined) return;
          typesCopy[atomIndex] = atomicNumber;
          covalentRadii[atomicNumber] = getElementSpec(atomicNumber).radius;
        }
      }

      const transferList: ArrayBuffer[] = [posCopy.buffer, typesCopy.buffer];
      if (sourceBondCopy) transferList.push(sourceBondCopy.buffer);
      const msg: Record<string, any> = {
        requestId,
        positions: posCopy,
        types: typesCopy,
        natoms: frame.natoms,
        maxBondLength,
        covalentRadii,
        tolerance,
        bonds: sourceBondCopy,
        computeStats: !isFrameChange, // Skip expensive stats/sorting during rapid playback
      };

      // Cache the positions we're about to detect on, so the next frame
      // change can compare against them for motion-skip. Make our own copy
      // because posCopy is about to be transferred and detached.
      lastDispatchPositionsRef.current = new Float32Array(frame.positions);
      lastDispatchTypesRef.current = new Int32Array(frame.types);
      lastDispatchTypeSemanticsKeyRef.current = typeSemanticsKey;
      lastDispatchBackendRef.current = 'cpu';
      lastDispatchToleranceRef.current = tolerance;
      lastDispatchMaxBondLengthRef.current = maxBondLength;

      if (workerBusyRef.current) {
        pendingMsgRef.current = { msg, transferList, requestId };
      } else {
        workerBusyRef.current = true;
        worker.postMessage(msg, transferList);
      }
    }, delay);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [frame, maxBondLength, tolerance, gpuActive, molecular, visible, skipDetection, clearBondState, hasSourceTopology, typeSemanticsKey, sourceKey]);

  // ─── GPU dispatch ──────────────────────────────────────────────────
  // Runs only when gpuActive is true. Mirrors the worker effect's contract:
  // updates bondPairs / bondDistances state when the GPU readback resolves.
  // `gpuDispatchGenRef` is a monotonically increasing generation counter that
  // replaces the old `cancelled` boolean for staleness detection. The boolean
  // approach raced with React's synchronous effect cleanup, causing valid
  // readbacks to be discarded during molecule switches.
  const lastDispatchedFrameRef = useRef<Frame | null>(null);
  const gpuDispatchGenRef = useRef(0);

  useEffect(() => {
    if (!gpuActive) {
      gpuDispatchGenRef.current += 1;
      return;
    }
    // Same visibility-respect as the worker effect — no point computing
    // millions of bonds the user hid.
    if (!visible) {
      gpuDispatchGenRef.current += 1;
      clearBondState();
      lastDispatchPositionsRef.current = null;
      lastDispatchBackendRef.current = null;
      lastDispatchToleranceRef.current = NaN;
      lastDispatchMaxBondLengthRef.current = NaN;
      return;
    }
    if (!frame || frame.natoms < 2) {
      gpuDispatchGenRef.current += 1;
      clearBondState();
      lastDispatchPositionsRef.current = null;
      lastDispatchBackendRef.current = null;
      lastDispatchToleranceRef.current = NaN;
      lastDispatchMaxBondLengthRef.current = NaN;
      return;
    }

    // Detect molecule switch in GPU mode too — natoms change OR a different
    // positions buffer means a new system was loaded.
    const gpuTypeInterpretationChanged = lastDispatchTypesRef.current !== null && (
      !atomTypesContentEqual(frame.types, lastDispatchTypesRef.current) ||
      typeSemanticsKey !== lastDispatchTypeSemanticsKeyRef.current
    );
    const gpuMoleculeSwitch = frame.natoms !== prevNatomsRef.current || gpuTypeInterpretationChanged;
    prevNatomsRef.current = frame.natoms;
    if (gpuMoleculeSwitch) {
      lastDispatchPositionsRef.current = null;
      lastDispatchBackendRef.current = null;
      lastDispatchToleranceRef.current = NaN;
      lastDispatchMaxBondLengthRef.current = NaN;
      lastDispatchTypesRef.current = null;
      lastDispatchTypeSemanticsKeyRef.current = '';
    }

    // Motion polish — same skip rule as the CPU path. Atoms that haven't
    // meaningfully moved keep their cached bondPairs; we don't even
    // dispatch the GPU compute. Saves a queue submit + readback per frame
    // during equilibrated playback. Tolerance changes also need a fresh
    // dispatch (the user is dragging the slider — bonds should re-compute
    // as cutoffs widen/narrow), so the skip only fires when tolerance and
    // maxBondLength match the last dispatch as well.
    const paramsUnchanged =
      lastDispatchBackendRef.current === 'gpu' &&
      lastDispatchToleranceRef.current === tolerance &&
      lastDispatchMaxBondLengthRef.current === maxBondLength;
    if (!gpuMoleculeSwitch && paramsUnchanged && lastDispatchPositionsRef.current && frame.positions.length === lastDispatchPositionsRef.current.length) {
      const maxDisp = subsampledMaxDisplacement(frame.positions, lastDispatchPositionsRef.current);
      if (maxDisp < BOND_RECOMPUTE_DISP_THRESHOLD) {
        return;
      }
    }
    lastDispatchPositionsRef.current = new Float32Array(frame.positions);
    lastDispatchTypesRef.current = new Int32Array(frame.types);
    lastDispatchTypeSemanticsKeyRef.current = typeSemanticsKey;
    lastDispatchBackendRef.current = 'gpu';
    lastDispatchToleranceRef.current = tolerance;
    lastDispatchMaxBondLengthRef.current = maxBondLength;

    // Build covalent radii table sized for the largest type seen.
    const typesArray = new Int32Array(frame.natoms);
    const covalentRadii = new Float32Array(119);
    for (let atomIndex = 0; atomIndex < frame.natoms; atomIndex += 1) {
      const atomicNumber = resolveAtomicNumber(frame, frame.types[atomIndex]);
      if (atomicNumber === undefined) return;
      typesArray[atomIndex] = atomicNumber;
      covalentRadii[atomicNumber] = getElementSpec(atomicNumber).radius;
    }

    // Sim-box extent — used to coarsen the GPU spatial grid for sparse systems.
    let boxExtent = 0;
    if (frame.boxBounds) {
      const dx = frame.boxBounds[1] - frame.boxBounds[0];
      const dy = frame.boxBounds[3] - frame.boxBounds[2];
      const dz = frame.boxBounds[5] - frame.boxBounds[4];
      boxExtent = Math.max(dx, dy, dz);
    }

    // Increment the dispatch generation. The async readback uses this to
    // check freshness — if a newer dispatch has been initiated by the time
    // the readback lands, the result is stale and gets discarded. This is
    // strictly superior to a `cancelled` boolean set from useEffect cleanup,
    // because React's cleanup fires synchronously during re-render, which
    // can race with the async GPU readback and discard valid results from
    // the most-recent dispatch.
    gpuDispatchGenRef.current += 1;
    const thisGeneration = gpuDispatchGenRef.current;

    lastDispatchedFrameRef.current = frame;

    void gpuCompute({
      positions: frame.positions,
      types: typesArray,
      natoms: frame.natoms,
      covalentRadii,
      tolerance,
      maxBondLength,
      boxExtent,
    }).then((readback) => {
      if (!readback) return;
      // Discard if a newer dispatch was initiated after this one.
      if (gpuDispatchGenRef.current !== thisGeneration) return;
      // readBondsAsync returns freshly-allocated arrays — no need to clone.
      setBondPairs(readback.pairs);
      setBondDistances(readback.distances);
      setDetectedBondSource('gpu');
    }).catch((err) => {
      console.warn('[Bonds] GPU compute failed, falling back to worker:', err);
    });

    // No cleanup needed — staleness is tracked via gpuDispatchGenRef, not a
    // boolean that races with React's synchronous effect teardown.
  }, [gpuActive, frame, maxBondLength, tolerance, gpuCompute, visible, clearBondState, typeSemanticsKey]);

  // ─── Capacity management ───────────────────────────────────────────
  // Grow on demand (with headroom), shrink when sustainably under-utilized.
  // The instanced geometry is capacity-keyed so its per-bond attributes are
  // reallocated whenever the ratchet moves.
  const MIN_BOND_CAPACITY = 20000;
  const SHRINK_THRESHOLD = 0.5;
  const SHRINK_IDLE_RENDERS = 60;
  const SHRINK_MIN_GAIN = 0.7;

  const capacityRef = useRef(MIN_BOND_CAPACITY);
  const idleRendersRef = useRef(0);

  if (bondCount > capacityRef.current) {
    capacityRef.current = Math.max(Math.ceil(capacityRef.current * 1.5), Math.ceil(bondCount * 1.2));
    idleRendersRef.current = 0;
  } else if (
    bondCount > 0 &&
    bondCount < capacityRef.current * SHRINK_THRESHOLD &&
    capacityRef.current > MIN_BOND_CAPACITY
  ) {
    idleRendersRef.current += 1;
    if (idleRendersRef.current >= SHRINK_IDLE_RENDERS) {
      const target = Math.max(MIN_BOND_CAPACITY, Math.ceil(bondCount * 1.5));
      if (target < capacityRef.current * SHRINK_MIN_GAIN) {
        capacityRef.current = target;
      }
      idleRendersRef.current = 0;
    }
  } else {
    idleRendersRef.current = 0;
  }
  const capacity = capacityRef.current;

  // ─── Geometry: one box per bond, ray-cast cylinder in the fragment ────
  const geometry = useMemo(() => {
    const geo = createBondBoxGeometry();
    const startAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    startAttr.setUsage(THREE.DynamicDrawUsage);
    const endAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    endAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(BOND_ATTR.start, startAttr);
    geo.setAttribute(BOND_ATTR.end, endAttr);
    // Static frames alias the interpolation targets (the static program never
    // reads them); trajectories allocate their own target buffers on first
    // use (see ensureTargetAttributes).
    geo.setAttribute(BOND_ATTR.startTarget, startAttr);
    geo.setAttribute(BOND_ATTR.endTarget, endAttr);
    const radiusAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    radiusAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(BOND_ATTR.radius, radiusAttr);
    // Display-sRGB endpoint colours, one normalized Uint8×4 word each (D4).
    const colorStart = new THREE.InstancedBufferAttribute(new Uint8Array(capacity * BOND_COLOR_STRIDE), BOND_COLOR_STRIDE, true);
    colorStart.setUsage(THREE.DynamicDrawUsage);
    const colorEnd = new THREE.InstancedBufferAttribute(new Uint8Array(capacity * BOND_COLOR_STRIDE), BOND_COLOR_STRIDE, true);
    colorEnd.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(BOND_ATTR.colorStart, colorStart);
    geo.setAttribute(BOND_ATTR.colorEnd, colorEnd);
    geo.instanceCount = 0;
    // Bonds live inside the atom cloud; the atom mesh already frustum-culls
    // the same volume, so fail open here.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Number.POSITIVE_INFINITY);
    return geo;
  }, [capacity]);

  const ensureTargetAttributes = useCallback((geo: THREE.InstancedBufferGeometry) => {
    const startAttr = geo.attributes[BOND_ATTR.start] as THREE.InstancedBufferAttribute;
    const endAttr = geo.attributes[BOND_ATTR.end] as THREE.InstancedBufferAttribute;
    let startTarget = geo.attributes[BOND_ATTR.startTarget] as THREE.InstancedBufferAttribute;
    let endTarget = geo.attributes[BOND_ATTR.endTarget] as THREE.InstancedBufferAttribute;
    if (startTarget === startAttr) {
      startTarget = new THREE.InstancedBufferAttribute(new Float32Array(startAttr.array.length), 3);
      startTarget.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(BOND_ATTR.startTarget, startTarget);
    }
    if (endTarget === endAttr) {
      endTarget = new THREE.InstancedBufferAttribute(new Float32Array(endAttr.array.length), 3);
      endTarget.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(BOND_ATTR.endTarget, endTarget);
    }
    return { startTarget, endTarget };
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  // ─── Material: node material per quality tier ─────────────────────
  // The uniform bag, lights and environment binding are shared by the tiers,
  // so a tier switch swaps only the (cached) material. An interpolating frame
  // pair uses the lerping program; the endpoint upload below gives its
  // geometry separate target buffers in the same commit.
  const scene = useThree((state) => state.scene);
  const uniformsJobId = `${LUPI_JOB.bondsUniforms}:${useId()}`;
  const resources = useMemo(() => createBondImpostorResources(), []);
  const effectiveQualityTier = resolveAtomQualityTier(qualityTier, frame.natoms);
  const material = useMemo(
    () => bondMaterialForTier(resources, effectiveQualityTier, canInterpolateToNextFrame),
    [resources, effectiveQualityTier, canInterpolateToNextFrame],
  );
  useEffect(() => () => disposeBondImpostorResources(resources), [resources]);

  // Look uniforms and transparency, applied in the commit phase so an export
  // capture scheduled by the same store update sees them.
  useLayoutEffect(() => {
    const u = resources.uniforms;
    const lights = resources.lights;
    const params = bondMaterialParams(materialPreset);
    u.uMetalness.value = params.metalness;
    u.uRoughness.value = params.roughness;
    resources.env.intensity.value = params.envIntensity;
    u.uSurfaceRoughness.value = surfaceRoughness;
    u.uSurfacePolish.value = surfacePolish;
    u.uSurfaceClearcoat.value = surfaceClearcoat;
    lights.fillLightColor.value.set(fillLightColor);
    lights.rimLightColor.value.set(rimLightColor);
    lights.rimLight.value = rimLightIntensity;
    u.uOpacity.value = Math.max(0, Math.min(1, opacity));
    u.uCullPixelRadius.value = Number.isFinite(cullPixelRadius) ? Math.max(0, cullPixelRadius) : 0;
    u.uJunctionRadius.value = Number.isFinite(junctionRadius) ? Math.max(0, junctionRadius) : 0;
    u.uJunctionStrength.value = Number.isFinite(junctionStrength) ? Math.max(0, junctionStrength) : 0;
    const wantsTransparent = opacity < 1;
    for (const tierMaterial of resources.materials.values()) {
      if (tierMaterial.transparent !== wantsTransparent) {
        tierMaterial.transparent = wantsTransparent;
        tierMaterial.needsUpdate = true;
      }
    }
  }, [resources, material, materialPreset, surfaceRoughness, surfacePolish, surfaceClearcoat, fillLightColor, rimLightColor, rimLightIntensity, opacity, cullPixelRadius, junctionRadius, junctionStrength]);

  // Lights: world-space directions; the node graph converts them to view
  // space with whichever camera renders.
  useLayoutEffect(() => {
    const lights = resources.lights;
    lights.lightDir.value.copy(lightDirection(keyLightAzimuth, keyLightElevation));
    lights.fillLightDir.value.copy(lightDirection(fillLightAzimuth, fillLightElevation));
    lights.rimLightDir.value.copy(lightDirection(rimLightAzimuth, rimLightElevation));
  }, [resources, keyLightAzimuth, keyLightElevation, fillLightAzimuth, fillLightElevation, rimLightAzimuth, rimLightElevation]);

  // ─── Per-frame uniforms (phase lupi-uniforms) ─────────────────────
  useFrame(() => {
    syncLupiEnvBinding(resources.env, scene);
    // Same progress as AtomsOptimized, so bond ends stay inside their atoms
    // while a trajectory interpolates.
    const live = liveStateRef?.current;
    const prog = canInterpolateToNextFrame && live && frameIndex != null
      ? live.effectiveFrame - frameIndex
      : canInterpolateToNextFrame
        ? (interpolationFactor ?? 0)
        : 0;
    resources.uniforms.uProgress.value = prog < 0 ? 0 : prog > 1 ? 1 : prog;
  }, { phase: LUPI_PHASE.uniforms, id: uniformsJobId });

  // ─── Property data ─────────────────────────────────────────────────
  const isPropMode = colorMode === 'property' && colorProperty;
  const propData = isPropMode && frame.properties ? frame.properties.get(colorProperty) : null;

  // ─── Endpoint upload — runs on bond-set or source-frame change ────────
  // Per bond: gather two atom positions (and PBC-unwrapped targets for the
  // next frame). No matrices, no basis construction; the vertex shader
  // orients the box. Interpolation substeps never touch the CPU.
  useLayoutEffect(() => {
    const drawCount = Math.min(bondCount, capacity);
    geometry.instanceCount = drawCount;
    if (drawCount === 0) return;

    const positions = frame.positions;
    const nextPos = canInterpolateToNextFrame && nextFrame && nextFrame.positions.length >= positions.length
      ? nextFrame.positions
      : null;
    const pbcBox = frame.boxBounds ?? cellBounds;
    const box = frame.boxBounds;
    const bsx = box ? box[1] - box[0] : 0;
    const bsy = box ? box[3] - box[2] : 0;
    const bsz = box ? box[5] - box[4] : 0;
    const lx = pbcBox ? pbcBox[1] - pbcBox[0] : 0;
    const ly = pbcBox ? pbcBox[3] - pbcBox[2] : 0;
    const lz = pbcBox ? pbcBox[5] - pbcBox[4] : 0;
    const minimumImage = periodic && !!pbcBox;

    // Inferred pairs come from an earlier frame while a trajectory plays (the
    // detection reply lands a frame or more later). A pair whose atoms no
    // longer meet the bond criterion in the frame on screen collapses to
    // nothing instead of drawing a stretched bond; the next detection
    // catches up. Source topology is always drawn.
    const radiusByType = topologyMode === 'infer' ? new Map<number, number>() : null;
    const covalentRadiusOf = (type: number): number => {
      let r = radiusByType!.get(type);
      if (r === undefined) {
        const atomicNumber = resolveAtomicNumber(frame, type);
        r = atomicNumber === undefined ? STALE_BOND_UNKNOWN_RADIUS : getElementSpec(atomicNumber).radius;
        radiusByType!.set(type, r);
      }
      return r;
    };

    const startAttr = geometry.attributes[BOND_ATTR.start] as THREE.InstancedBufferAttribute;
    const endAttr = geometry.attributes[BOND_ATTR.end] as THREE.InstancedBufferAttribute;
    const startArr = startAttr.array as Float32Array;
    const endArr = endAttr.array as Float32Array;
    let startTargetArr: Float32Array | null = null;
    let endTargetArr: Float32Array | null = null;
    let startTarget: THREE.InstancedBufferAttribute | null = null;
    let endTarget: THREE.InstancedBufferAttribute | null = null;
    // The lerping program (canInterpolateToNextFrame) must never draw an
    // aliased target, even while the next frame is still short of atoms.
    const hasOwnTargets = geometry.attributes[BOND_ATTR.startTarget] !== startAttr;
    if (canInterpolateToNextFrame || hasOwnTargets) {
      const targets = ensureTargetAttributes(geometry);
      startTarget = targets.startTarget;
      endTarget = targets.endTarget;
      startTargetArr = startTarget.array as Float32Array;
      endTargetArr = endTarget.array as Float32Array;
    }

    for (let i = 0; i < drawCount; i++) {
      const a = bondPairs[i * 2];
      const b = bondPairs[i * 2 + 1];
      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
      let bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
      if (minimumImage) {
        let dx = bx - ax, dy = by - ay, dz = bz - az;
        if (Math.abs(dx) > lx * 0.5) dx -= Math.sign(dx) * lx;
        if (Math.abs(dy) > ly * 0.5) dy -= Math.sign(dy) * ly;
        if (Math.abs(dz) > lz * 0.5) dz -= Math.sign(dz) * lz;
        bx = ax + dx; by = ay + dy; bz = az + dz;
      }
      let stale = false;
      // Coordination and contacts exceed the covalent criterion by design.
      if (radiusByType && (!bondKinds || bondKinds[i] === 0)) {
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const limit = (covalentRadiusOf(frame.types[a]) + covalentRadiusOf(frame.types[b]) + tolerance) * STALE_BOND_SLACK;
        if (dx * dx + dy * dy + dz * dz > limit * limit) {
          stale = true;
          bx = ax; by = ay; bz = az;
        }
      }
      const o = i * 3;
      startArr[o] = ax; startArr[o + 1] = ay; startArr[o + 2] = az;
      endArr[o] = bx; endArr[o + 1] = by; endArr[o + 2] = bz;
      if (startTargetArr && endTargetArr) {
        if (nextPos && !stale) {
          const nax = ax + wrapDelta(nextPos[a * 3] - ax, bsx);
          const nay = ay + wrapDelta(nextPos[a * 3 + 1] - ay, bsy);
          const naz = az + wrapDelta(nextPos[a * 3 + 2] - az, bsz);
          const nbx = bx + wrapDelta(nextPos[b * 3] - bx, bsx);
          const nby = by + wrapDelta(nextPos[b * 3 + 1] - by, bsy);
          const nbz = bz + wrapDelta(nextPos[b * 3 + 2] - bz, bsz);
          startTargetArr[o] = nax; startTargetArr[o + 1] = nay; startTargetArr[o + 2] = naz;
          endTargetArr[o] = nbx; endTargetArr[o + 1] = nby; endTargetArr[o + 2] = nbz;
        } else {
          startTargetArr[o] = ax; startTargetArr[o + 1] = ay; startTargetArr[o + 2] = az;
          endTargetArr[o] = bx; endTargetArr[o + 1] = by; endTargetArr[o + 2] = bz;
        }
      }
    }
    markInstancedAttributeUpdateRange(startAttr, drawCount * 3);
    markInstancedAttributeUpdateRange(endAttr, drawCount * 3);
    if (startTarget && endTarget) {
      markInstancedAttributeUpdateRange(startTarget, drawCount * 3);
      markInstancedAttributeUpdateRange(endTarget, drawCount * 3);
    }
  }, [bondPairs, bondKinds, bondCount, capacity, geometry, frame, nextFrame, canInterpolateToNextFrame, periodic, cellBounds, ensureTargetAttributes, topologyMode, tolerance]);

  // ─── Color + radius upload — runs on bond-set or scheme changes ───────
  // Bond-stability cache: a fresh Int32Array with identical contents (same
  // atoms still bonded, just moving) in a static color mode skips the pass.
  const lastAttrBondPairsRef = useRef<Int32Array | null>(null);
  const lastAttrGeometryRef = useRef<THREE.InstancedBufferGeometry | null>(null);
  const lastAttrTypesRef = useRef<Int32Array | null>(null);
  const lastAttrKeyRef = useRef<string>('');

  useLayoutEffect(() => {
    const drawCount = Math.min(bondCount, capacity);
    if (drawCount === 0) return;

    const isFrameDepColors =
      isPropMode ||
      bondColorMode === 'length' ||
      bondColorMode === 'energy' ||
      bondColorMode === 'screening';

    const attrCacheKey = [
      colorMode,
      colorProperty ?? '',
      colormap,
      atomColorSource,
      bondColorMode,
      radius,
      propRange?.[0] ?? 'auto',
      propRange?.[1] ?? 'auto',
      uniformColor,
      JSON.stringify(elementColorOverrides),
      JSON.stringify(frame.typeSemantics ?? null),
      capacity,
      bondKinds ? MOLECULAR_RECIPE_ID : 'plain',
    ].join('|');

    if (
      !isFrameDepColors &&
      lastAttrGeometryRef.current === geometry &&
      lastAttrTypesRef.current === frame.types &&
      lastAttrKeyRef.current === attrCacheKey &&
      lastAttrBondPairsRef.current !== null &&
      bondPairsContentEqual(bondPairs, lastAttrBondPairsRef.current)
    ) {
      return;
    }

    const radiusAttr = geometry.attributes[BOND_ATTR.radius] as THREE.InstancedBufferAttribute;
    const colorStartAttr = geometry.attributes[BOND_ATTR.colorStart] as THREE.InstancedBufferAttribute;
    const colorEndAttr = geometry.attributes[BOND_ATTR.colorEnd] as THREE.InstancedBufferAttribute;
    const radiusArr = radiusAttr.array as Float32Array;
    const colorStartArr = colorStartAttr.array as Uint8Array;
    const colorEndArr = colorEndAttr.array as Uint8Array;

    const t = canInterpolateToNextFrame ? (interpolationFactor ?? 0) : 0;
    const hasPropInterpolation = isPropMode && canInterpolateToNextFrame && nextFrame && t > 0 && nextFrame.properties && nextFrame.properties.has(colorProperty!);
    const nextPropData = hasPropInterpolation ? nextFrame.properties!.get(colorProperty!) : null;
    const mapFn = COLORMAPS[colormap] || COLORMAPS.viridis;

    // Type rank normalization mirrors AtomsOptimized's colormap palette.
    const typeSet = new Set<number>();
    for (let i = 0; i < frame.natoms; i++) typeSet.add(frame.types[i]);
    const sortedTypes = Array.from(typeSet).sort((a, b) => a - b);
    const typeToNorm = new Map<number, number>();
    for (let j = 0; j < sortedTypes.length; j++) {
      typeToNorm.set(sortedTypes[j], sortedTypes.length > 1 ? j / (sortedTypes.length - 1) : 0.5);
    }
    // Per-type display colors are constant across the bond set; resolve each
    // raw type once instead of once per bond endpoint.
    const typeColorCache = new Map<number, [number, number, number]>();
    const colorForType = (typeId: number): [number, number, number] => {
      let color = typeColorCache.get(typeId);
      if (!color) {
        color = atomColorSource === 'element'
          ? hexToRgb(elementColorOverrides[typeId] ?? resolveTypeColor(frame, typeId))
          : mapFn(typeToNorm.get(typeId) ?? 0.5);
        typeColorCache.set(typeId, color);
      }
      return color;
    };
    const uniformRgb = hexToRgb(uniformColor);

    let pMin = propRange?.[0] ?? 0;
    let pMax = propRange?.[1] ?? 1;
    if (isPropMode && propData && !propRange) {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < frame.natoms; i++) {
        if (propData[i] < min) min = propData[i];
        if (propData[i] > max) max = propData[i];
      }
      pMin = min;
      pMax = max;
    }

    let distMin = 0, distRange = 1;
    if (bondColorMode === 'length' && bondDistances.length >= bondCount) {
      let distMax = -Infinity;
      distMin = Infinity;
      for (let k = 0; k < bondCount; k++) {
        if (bondDistances[k] < distMin) distMin = bondDistances[k];
        if (bondDistances[k] > distMax) distMax = bondDistances[k];
      }
      distRange = distMax - distMin || 1;
    }

    for (let i = 0; i < drawCount; i++) {
      const a = bondPairs[i * 2];
      const b = bondPairs[i * 2 + 1];
      // Kind: thinner, and a style code in the colour's alpha byte (dashes, dots).
      const kind = bondKinds ? bondKinds[i] : 0;
      const kindScale = BOND_KIND_RADIUS_SCALE[kind] ?? 1;
      const style = BOND_KIND_STYLE_ALPHA[kind] ?? 255;

      let normA = 0.5, normB = 0.5;
      if (isPropMode && propData) {
        let valA = propData[a];
        if (nextPropData && nextPropData.length > a) valA += (nextPropData[a] - valA) * t;
        normA = pMax > pMin ? (valA - pMin) / (pMax - pMin) : 0.5;
        let valB = propData[b];
        if (nextPropData && nextPropData.length > b) valB += (nextPropData[b] - valB) * t;
        normB = pMax > pMin ? (valB - pMin) / (pMax - pMin) : 0.5;
      }
      // Property mode scales the tube by the mean of both endpoints.
      radiusArr[i] = (isPropMode ? radius * (0.2 + 1.8 * 0.5 * (normA + normB)) : radius) * kindScale;

      if (bondColorMode === 'length' && bondDistances.length > i) {
        const rgb = mapFn((bondDistances[i] - distMin) / distRange);
        writeBondColor(colorStartArr, i, rgb, style);
        writeBondColor(colorEndArr, i, rgb, style);
      } else if (isPropMode && propData) {
        writeBondColor(colorStartArr, i, mapFn(normA), style);
        writeBondColor(colorEndArr, i, mapFn(normB), style);
      } else if (colorMode === 'uniform') {
        writeBondColor(colorStartArr, i, uniformRgb, style);
        writeBondColor(colorEndArr, i, uniformRgb, style);
      } else {
        writeBondColor(colorStartArr, i, frame.types ? colorForType(frame.types[a]) : DEFAULT_TYPE_COLOR, style);
        writeBondColor(colorEndArr, i, frame.types ? colorForType(frame.types[b]) : DEFAULT_TYPE_COLOR, style);
      }
    }

    markInstancedAttributeUpdateRange(radiusAttr, drawCount);
    markInstancedAttributeUpdateRange(colorStartAttr, drawCount * BOND_COLOR_STRIDE);
    markInstancedAttributeUpdateRange(colorEndAttr, drawCount * BOND_COLOR_STRIDE);

    lastAttrBondPairsRef.current = bondPairs;
    lastAttrGeometryRef.current = geometry;
    lastAttrTypesRef.current = frame.types;
    lastAttrKeyRef.current = attrCacheKey;
    // Deps: NO frame.positions — those drive endpoints, not colors. In
    // property mode `propData` (a per-frame Float32Array) is a dep, so colors
    // do refresh per frame for property coloring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bondPairs, bondKinds, bondDistances, bondCount, capacity, geometry, frame.types, frame.typeSemantics, frame.natoms, colormap, colorMode, uniformColor, elementColorOverrides, isPropMode, propData, propRange, radius, atomColorSource, bondColorMode, nextFrame, canInterpolateToNextFrame, interpolationFactor, colorProperty]);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      visible={visible && bondCount > 0}
    />
  );
}

/** Predefined bond cutoffs for common elements (Angstroms) */
export const DEFAULT_CUTOFFS: Map<string, number> = new Map([
  ['Cu-Cu', 2.8], ['Cu-O', 2.0],
  ['O-O', 1.6],   ['O-H', 1.2],
  ['C-C', 1.8],   ['C-H', 1.1],
  ['Si-O', 1.7],  ['Al-O', 1.9],
  ['Fe-O', 2.1],  ['Fe-Fe', 2.5],
]);

/** Build type cutoff map from element symbols */
export function buildTypeCutoffs(
  typeToElement: Map<number, string>,
  cutoffs: Map<string, number> = DEFAULT_CUTOFFS
): Map<string, number> {
  const result = new Map<string, number>();

  for (const [type1, elem1] of typeToElement) {
    for (const [type2, elem2] of typeToElement) {
      const key1 = `${elem1}-${elem2}`;
      const key2 = `${elem2}-${elem1}`;
      const cutoff = cutoffs.get(key1) ?? cutoffs.get(key2);
      if (cutoff) {
        result.set(`${type1}-${type2}`, cutoff);
      }
    }
  }

  return result;
}
