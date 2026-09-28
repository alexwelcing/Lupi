/**
 * bonds — the bond impostor layer (WP2) in isolation: the real `Bonds` (and,
 * where bonds meet atoms, the real `AtomsOptimized`) on synthetic frames with
 * source bond topology, over the fixed testbed plate.
 *
 * - Chain C–O–N with the atoms hidden (tier 2): each bond is split at its
 *   midpoint into its two atoms' CPK colours; 1.4 radii off the axis is plate.
 * - Depth (the viewer's transparent 0.85 opacity): blue bonds through two O
 *   atoms. The atom centre stays the atom colour; near the atom's silhouette
 *   the bond's front is in front of the sphere; just off the bond axis the
 *   sphere is in front of the cylinder but behind the bounding box's face, so
 *   that probe fails if the bond writes the box's depth instead of the
 *   ray-cast hit's.
 * - Trajectory lerp (tier 1): atoms and bonds interpolated 35% of the way to
 *   the next frame by `uProgress` show there together, not at the start.
 * - End-on bond along the view axis (tier 0): the near cap shows the near
 *   atom's colour, and a point inside the box's square face but outside the
 *   cap disk is plate (square boxes fail here, trap G1).
 * - Fade: moving a layer's fade window over the bond thins it (two
 *   render-target readbacks), and a window in front of it removes it.
 * - The scene graph carries Uint8×4 normalized bond colours and no itemSize-1
 *   8/16-bit attribute (D4).
 *
 * Manual params: `&ortho=1` (orthographic camera, same framing),
 * `&progress=<0..1>` (default 0.35).
 */
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import type { Frame } from '@atlas/core/types';
import { AtomsOptimized } from '@atlas/scene/AtomsOptimized';
import { Bonds } from '@atlas/scene/Bonds';
import { harnessAssert, harnessHold, useHarnessProbe, type HarnessFamily } from '../harness';

type Vec3 = [number, number, number];

const PARAMS = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
const ORTHO = PARAMS.get('ortho') === '1';
const PROGRESS = clamp01(Number(PARAMS.get('progress') ?? 0.35));

/** The neutral display radius frames without Ångström semantics get. */
const NEUTRAL_RADIUS = 0.5;
/** Half the visible height at z = 0 for the router's camera (z 5, fov 50). */
const HALF_HEIGHT = 5 * Math.tan((25 * Math.PI) / 180);
const BLUE = '#2040ff';
const Z = { C: 6, N: 7, O: 8, S: 16 } as const;

const CHAIN_Y = 1.55;
const CHAIN_RADIUS = 0.15;
const CHAIN: ReadonlyArray<{ z: number; x: number; family: HarnessFamily }> = [
  { z: Z.C, x: -0.9, family: 'C' },
  { z: Z.O, x: 0, family: 'O' },
  { z: Z.N, x: 0.9, family: 'N' },
];

const DEPTH_Y = 0.65;
const DEPTH_ATOM_X = 0.5;
const DEPTH_ATOM_RADIUS = 0.35;
const DEPTH_BOND_RADIUS = 0.2;

const LERP_Y = -0.3;
const LERP_ATOM_RADIUS = 0.12;
const LERP_BOND_RADIUS = 0.08;
const LERP_FROM: [Vec3, Vec3] = [[-0.9, LERP_Y, 0], [-0.5, LERP_Y, 0]];
const LERP_TO: [Vec3, Vec3] = [[0.5, LERP_Y, 0], [0.9, LERP_Y, 0]];

const END_Y = -1.2;
const END_X = 0.5;
const END_RADIUS = 0.2;
const END_HALF = 0.15;

const FADE_Y = -1.2;
const FADE_FROM = -0.9;
const FADE_TO = -0.1;
const FADE_RADIUS = 0.15;
const FADE_GROUP = 'testbed-fade-bonds';

/** Bond layers that must report bonds before the case may be ready. */
const LAYERS = ['chain', 'depth', 'lerp', 'end', 'fade'] as const;
type Layer = (typeof LAYERS)[number];

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.35;
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A frame of known elements (atomic-number types) with source bond pairs. */
function makeFrame(atoms: ReadonlyArray<{ z: number; p: Vec3 }>, bonds: number[], timestep = 0): Frame {
  return {
    timestep,
    natoms: atoms.length,
    boxBounds: new Float64Array([-10, 10, -10, 10, -10, 10]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    identity: { kind: 'source-id', unique: true },
    ids: Int32Array.from(atoms, (_, index) => index + 1),
    types: Int32Array.from(atoms, (atom) => atom.z),
    typeSemantics: { kind: 'atomic-number', provenance: 'procedural-symbol' },
    positions: Float32Array.from(atoms.flatMap((atom) => atom.p)),
    bonds: Int32Array.from(bonds),
    properties: new Map(),
  };
}

// ─── Readiness: every bond layer has bonds ─────────────────────────────

const arrived = new Set<Layer>();
let releaseArrival: (() => void) | null = null;
let arrivalWaiters: Array<() => void> = [];

function reportBonds(layer: Layer, count: number): void {
  if (count <= 0 || arrived.has(layer)) return;
  arrived.add(layer);
  if (arrived.size === LAYERS.length) {
    releaseArrival?.();
    releaseArrival = null;
    for (const resolve of arrivalWaiters) resolve();
    arrivalWaiters = [];
  }
}

function allBondsArrived(): Promise<void> {
  if (arrived.size === LAYERS.length) return Promise.resolve();
  return new Promise((resolve) => arrivalWaiters.push(resolve));
}

function BondArrival() {
  useEffect(() => {
    arrived.clear();
    releaseArrival = harnessHold('bonds');
    const timer = setTimeout(() => {
      harnessAssert('every bond layer received its bonds', arrived.size === LAYERS.length, `arrived=[${[...arrived].join(', ')}]`);
      releaseArrival?.();
      releaseArrival = null;
    }, 20_000);
    allBondsArrived().then(() => {
      clearTimeout(timer);
      harnessAssert('every bond layer received its bonds', true, `arrived=[${[...arrived].join(', ')}]`);
    });
    return () => {
      clearTimeout(timer);
      releaseArrival?.();
      releaseArrival = null;
    };
  }, []);
  return null;
}

// ─── Probes ────────────────────────────────────────────────────────────

function ChainProbes() {
  const [c, o, n] = CHAIN;
  // Front of the cylinder (z = radius) a quarter of the way in from each end.
  useHarnessProbe('chain: C half of C–O is C', [c.x + (o.x - c.x) * 0.25, CHAIN_Y, CHAIN_RADIUS], { family: c.family });
  useHarnessProbe('chain: O half of C–O is O', [c.x + (o.x - c.x) * 0.75, CHAIN_Y, CHAIN_RADIUS], { family: o.family });
  useHarnessProbe('chain: O half of O–N is O', [o.x + (n.x - o.x) * 0.25, CHAIN_Y, CHAIN_RADIUS], { family: o.family });
  useHarnessProbe('chain: N half of O–N is N', [o.x + (n.x - o.x) * 0.75, CHAIN_Y, CHAIN_RADIUS], { family: n.family });
  useHarnessProbe('chain: 1.4R off the axis is plate', [(c.x + o.x) / 2, CHAIN_Y + 1.4 * CHAIN_RADIUS, 0], 'plate');
  return null;
}

function DepthProbes() {
  const left = -DEPTH_ATOM_X;
  const R = DEPTH_ATOM_RADIUS;
  const r = DEPTH_BOND_RADIUS;
  useHarnessProbe('depth: bond between the atoms is the bond colour', [0, DEPTH_Y, r], { family: 'N' });
  useHarnessProbe('depth: atom centre hides the bond inside it', [left, DEPTH_Y, R], { family: 'O' });
  // On the axis near the silhouette the sphere surface (z≈0.14) is behind the
  // bond's front (z = 0.2).
  useHarnessProbe('depth: bond front is in front of the sphere rim', [left + 0.32, DEPTH_Y, r], { family: 'N' });
  // 0.16 off the axis the ray hits the sphere (z≈0.17) in front of the
  // cylinder (z≈0.12) but behind the box's front face (z = 0.21).
  const d = 0.258;
  const l = 0.16;
  const sphereZ = Math.sqrt(R * R - d * d - l * l);
  useHarnessProbe('depth: sphere in front of the cylinder, behind its box', [left + d, DEPTH_Y + l, sphereZ], { family: 'O' });
  return null;
}

function LerpProbes() {
  const a = lerp(LERP_FROM[0], LERP_TO[0], PROGRESS);
  const b = lerp(LERP_FROM[1], LERP_TO[1], PROGRESS);
  const mid = lerp(a, b, 0.5);
  const startMid = lerp(LERP_FROM[0], LERP_FROM[1], 0.5);
  useHarnessProbe(`lerp ${PROGRESS}: atom is at the lerp`, [a[0], a[1], LERP_ATOM_RADIUS], { family: 'S' });
  useHarnessProbe(`lerp ${PROGRESS}: bond is at the lerp`, [mid[0], mid[1], LERP_BOND_RADIUS], { family: 'N' });
  // Only meaningful once the lerp carried the pair clear of its start.
  const clear = Math.abs(a[0] - startMid[0]) > 2 * LERP_ATOM_RADIUS;
  return clear ? <LerpStartProbe at={startMid} /> : null;
}

function LerpStartProbe({ at }: { at: Vec3 }) {
  useHarnessProbe(`lerp ${PROGRESS}: start bond position is plate`, at, 'plate');
  return null;
}

function EndOnProbes() {
  const near = END_HALF;
  useHarnessProbe('end-on: near cap is the near atom colour (N)', [END_X, END_Y, near], { family: 'N' });
  // Outward from the view centre, inside the box's ±1.05R square face.
  const off = 0.9 * END_RADIUS;
  useHarnessProbe('end-on: box corner outside the cap is plate', [END_X + off, END_Y - off, near], 'plate');
  return null;
}

function FadeProbes() {
  useHarnessProbe('fade: a window in front of the bond removes it', [(FADE_FROM + FADE_TO) / 2, FADE_Y, FADE_RADIUS], 'plate');
  return null;
}

// ─── Camera, fade and attribute checks ─────────────────────────────────

/** Orthographic camera with the router camera's framing at z = 0. */
function OrthoCamera() {
  const set = useThree((state) => state.set);
  const size = useThree((state) => state.size);
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const camera = new THREE.OrthographicCamera(
      -HALF_HEIGHT * aspect, HALF_HEIGHT * aspect, HALF_HEIGHT, -HALF_HEIGHT, 0.1, 100,
    );
    (camera as THREE.OrthographicCamera & { manual?: boolean }).manual = true;
    camera.position.set(0, 0, 5);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    set({ camera });
  }, [set, size.width, size.height]);
  return null;
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Pixels whose colour moved by more than `threshold` (WebGPU rows are 256-byte padded). */
function changedPixels(a: ArrayLike<number>, b: ArrayLike<number>, width: number, height: number, threshold: number): number {
  const tight = width * 4;
  const rowBytes = a.length === tight * height ? tight : Math.ceil(tight / 256) * 256;
  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * rowBytes + x * 4;
      const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (delta > threshold) changed += 1;
    }
  }
  return changed;
}

/** The fade layer's uniform bag, found through its group. */
function fadeUniforms(scene: THREE.Scene): Record<string, { value: number }> | null {
  const group = scene.getObjectByName(FADE_GROUP);
  let bag: Record<string, { value: number }> | null = null;
  group?.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | undefined;
    const candidate = material?.userData?.lupiUniforms as Record<string, { value: number }> | undefined;
    if (candidate?.uBondFadeStart) bag = candidate;
  });
  return bag;
}

/** Fade window over the bond (alpha) vs the default, then in front of it (gone). */
function FadeCheck() {
  const renderer = useThree((state) => state.renderer);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const release = harnessHold('fade');
    const target = new THREE.RenderTarget(256, 256);
    let live = true;
    const capture = async (): Promise<ArrayLike<number>> => {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      return (await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height)) as ArrayLike<number>;
    };
    const name = 'fade: a fade window over the bond thins it';
    (async () => {
      await allBondsArrived();
      await nextFrames(4);
      const bag = fadeUniforms(scene);
      if (!bag) throw new Error('fade layer material bag not found');
      const full = await capture();
      if (!live) return;
      // The camera is ~5 units from the row: half faded.
      bag.uBondFadeStart.value = 4.5;
      bag.uBondFadeEnd.value = 5.5;
      const half = await capture();
      if (!live) return;
      const changed = changedPixels(full, half, target.width, target.height, 15);
      harnessAssert(name, changed > 100, `${changed} pixels changed by more than 15/255 at half fade`);
      bag.uBondFadeStart.value = 0.5;
      bag.uBondFadeEnd.value = 1.0;
      await nextFrames(2);
    })().catch((error: unknown) => {
      harnessAssert(name, false, String(error));
    }).finally(() => {
      if (live) release();
    });
    return () => {
      live = false;
      release();
      target.dispose();
    };
  }, [renderer, scene, camera]);

  return null;
}

/** Bond colours are normalized Uint8×4; no itemSize-1 u8/u16 anywhere (D4, K22). */
function AttributeAudit() {
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    let cancelled = false;
    allBondsArrived().then(() => {
      if (cancelled) return;
      const narrow: string[] = [];
      const wrongColors: string[] = [];
      let bondMeshes = 0;
      scene.traverse((object) => {
        const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!geometry?.attributes) return;
        for (const [name, attribute] of Object.entries(geometry.attributes)) {
          const array = attribute.array;
          const narrowType = array instanceof Uint8Array || array instanceof Int8Array
            || array instanceof Uint16Array || array instanceof Int16Array;
          if (attribute.itemSize === 1 && narrowType) narrow.push(`${object.name || object.type}.${name}`);
          if (name === 'instanceColorStart' || name === 'instanceColorEnd') {
            if (name === 'instanceColorStart') bondMeshes += 1;
            if (!(array instanceof Uint8Array) || attribute.itemSize !== 4 || !attribute.normalized) wrongColors.push(name);
          }
        }
      });
      harnessAssert(
        'bond colours: normalized Uint8x4, no itemSize-1 u8/u16',
        narrow.length === 0 && wrongColors.length === 0 && bondMeshes >= LAYERS.length,
        `narrow=[${narrow.join(', ')}] wrong=[${wrongColors.join(', ')}] bond meshes=${bondMeshes}`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [scene]);
  return null;
}

// ─── Case ──────────────────────────────────────────────────────────────

export default function BondsCase() {
  const chainFrame = useMemo(
    () => makeFrame(CHAIN.map((atom) => ({ z: atom.z, p: [atom.x, CHAIN_Y, 0] as Vec3 })), [0, 1, 1, 2]),
    [],
  );
  const depthFrame = useMemo(() => makeFrame([
    { z: Z.O, p: [-DEPTH_ATOM_X, DEPTH_Y, 0] },
    { z: Z.O, p: [DEPTH_ATOM_X, DEPTH_Y, 0] },
  ], [0, 1]), []);
  const lerpFrames = useMemo(() => [
    makeFrame(LERP_FROM.map((p) => ({ z: Z.S, p })), [0, 1], 0),
    makeFrame(LERP_TO.map((p) => ({ z: Z.S, p })), [0, 1], 1),
  ], []);
  const endFrame = useMemo(() => makeFrame([
    { z: Z.O, p: [END_X, END_Y, -END_HALF] },
    { z: Z.N, p: [END_X, END_Y, END_HALF] },
  ], [0, 1]), []);
  const fadeFrame = useMemo(() => makeFrame([
    { z: Z.C, p: [FADE_FROM, FADE_Y, 0] },
    { z: Z.C, p: [FADE_TO, FADE_Y, 0] },
  ], [0, 1]), []);

  return (
    <>
      {ORTHO && <OrthoCamera />}
      <BondArrival />

      <Bonds
        frame={chainFrame}
        atomColorSource="element"
        radius={CHAIN_RADIUS}
        opacity={1}
        qualityTier={2}
        onBondsUpdate={(info) => reportBonds('chain', info.count)}
      />
      <ChainProbes />

      <AtomsOptimized frame={depthFrame} atomColorSource="element" scale={DEPTH_ATOM_RADIUS / NEUTRAL_RADIUS} />
      <Bonds
        frame={depthFrame}
        colorMode="uniform"
        uniformColor={BLUE}
        radius={DEPTH_BOND_RADIUS}
        opacity={0.85}
        onBondsUpdate={(info) => reportBonds('depth', info.count)}
      />
      <DepthProbes />

      <AtomsOptimized
        frame={lerpFrames[0]}
        nextFrame={lerpFrames[1]}
        interpolationFactor={PROGRESS}
        atomColorSource="element"
        scale={LERP_ATOM_RADIUS / NEUTRAL_RADIUS}
        qualityTier={1}
      />
      <Bonds
        frame={lerpFrames[0]}
        nextFrame={lerpFrames[1]}
        interpolationFactor={PROGRESS}
        colorMode="uniform"
        uniformColor={BLUE}
        radius={LERP_BOND_RADIUS}
        opacity={1}
        qualityTier={1}
        onBondsUpdate={(info) => reportBonds('lerp', info.count)}
      />
      <LerpProbes />

      <Bonds
        frame={endFrame}
        atomColorSource="element"
        radius={END_RADIUS}
        opacity={1}
        qualityTier={0}
        onBondsUpdate={(info) => reportBonds('end', info.count)}
      />
      <EndOnProbes />

      <group name={FADE_GROUP}>
        <Bonds
          frame={fadeFrame}
          atomColorSource="element"
          radius={FADE_RADIUS}
          opacity={0.99}
          onBondsUpdate={(info) => reportBonds('fade', info.count)}
        />
      </group>
      <FadeProbes />
      <FadeCheck />
      <AttributeAudit />
    </>
  );
}
