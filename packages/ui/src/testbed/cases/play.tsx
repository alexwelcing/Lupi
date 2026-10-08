/**
 * play — WP5's testbed case: display motion (arrival, ripple) on the real
 * `AtomsOptimized` and `Bonds`, with the shared uniforms set directly and the
 * motion clock frozen (the "Trajectory lerp" pattern of cases/bonds.tsx).
 *
 * A ring of six O atoms (red) with blue source bonds faces the camera. For a
 * frozen mid-condense and a frozen mid-ripple state the CPU twin
 * (displayMotionTwin.ts) says where every atom and bond end must be; a
 * live-motion readback then has to show, per backend:
 * - red at each displaced atom centre: the GPU's position-bit seeds and PCG
 *   hash equal the twin's (the WebGL2 floatBitsToUint risk), and the poked
 *   atom (r = 0) is not a NaN hole;
 * - blue along each displaced bond and plate where atoms and bonds were
 *   at rest: the bonds follow their atoms;
 * - a `renderSceneToPixels` readback with the motion live (the export path,
 *   with its capture guard) byte-identical to the readback at rest;
 * - a synthetic click during an armed arrival lands it (weight 0 before the
 *   pick) and picks the atom under the cursor at its rest position.
 *
 * The final frame stays frozen mid-condense; its on-screen probes repeat the
 * displaced-atom and displaced-bond checks on the canvas itself.
 *
 * The ripple here uses 1 unit of amplitude and a 0.5 bound (not the viewer's
 * 0.3 Å) so a bond that did not follow would miss by more than its radius.
 * Stretched that far, a bond's tension glow (lime, Bonds) would wash its blue
 * toward white, so the case draws without the glow: it checks where the
 * bonds are, not how they glow.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import { MOTION } from '@atlas/core/motion';
import type { Frame } from '@atlas/core/types';
import {
  ARRIVAL_MODE,
  ATOM_GLOW,
  DISPLAY_MOTION,
  DISPLAY_MOTION_TUNING,
  SpatialHash3D,
  registerCaptureGuard,
  resetLupiDisplayMotion,
  rippleSlotUniforms,
} from '@atlas/scene';
import { AtomsOptimized } from '@atlas/scene/AtomsOptimized';
import { Bonds } from '@atlas/scene/Bonds';
import { AtomPicker } from '@atlas/scene/AtomPicker';
import { displayOffsetTwin, readTwinState, type TwinVec3 } from '@atlas/scene/tsl/displayMotionTwin';
import {
  ViewerCaptureService,
  renderSceneToPixels,
  runViewerCapture,
  type RasterReadback,
} from '../../export/renderTargetReadback';
import { installArrivalCancel } from '../../play/PlayLayer';
import { harnessAssert, harnessHold, useHarnessProbe, type HarnessExpect } from '../harness';

const M = DISPLAY_MOTION;
const NEUTRAL_RADIUS = 0.5;
const ATOM_R = 0.13;
const BOND_R = 0.05;
/** Inside the phone profile's ±1.07 visible half-width at z = 0. */
const RING_R = 0.8;
/** The arrival radius: the mist (1.6 R) stays on screen on a phone. */
const MIST_R = 0.6;
const BLUE = '#2040ff';
const SIZE = 400;
const PLATE: [number, number, number] = [16, 24, 23];

const RING: TwinVec3[] = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2 + 0.3;
  return [Math.fround(RING_R * Math.cos(a)), Math.fround(RING_R * Math.sin(a)), 0];
});
const BONDS: Array<[number, number]> = RING.map((_, i) => [i, (i + 1) % RING.length]);
const PICK_ATOM = 3;

function ringFrame(): Frame {
  return {
    timestep: 0,
    natoms: RING.length,
    boxBounds: new Float64Array([-10, 10, -10, 10, -10, 10]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    identity: { kind: 'source-id', unique: true },
    ids: Int32Array.from(RING, (_, i) => i + 1),
    types: Int32Array.from(RING, () => 8),
    typeSemantics: { kind: 'atomic-number', provenance: 'procedural-symbol' },
    positions: Float32Array.from(RING.flat()),
    bonds: Int32Array.from(BONDS.flat()),
    properties: new Map(),
  };
}

// ─── Frozen states ─────────────────────────────────────────────────────

function setCondense(elapsed: number): void {
  resetLupiDisplayMotion();
  M.uArrivalMode.value = ARRIVAL_MODE.condense;
  M.uArrivalWeight.value = 1;
  M.uArrivalT0.value = 10;
  M.uMotionNow.value = 10 + elapsed;
  M.uArrivalDuration.value = 0.6;
  M.uArrivalCenter.value.set(0, 0, 0);
  M.uArrivalRadius.value = MIST_R;
  M.uArrivalUp.value.set(0, 1, 0);
  M.uArrivalViewDir.value.set(0, 0, 1);
  M.uArrivalSeed.value = 777;
  M.uArrivalOmega.value = 2 / MOTION.land.smoothTime;
  M.uArrivalZeta.value = MOTION.land.dampingRatio;
  M.uArrivalDelayScale.value = 1;
  M.uMotionWeight.value = 1;
}

function setRipple(): void {
  resetLupiDisplayMotion();
  const T = DISPLAY_MOTION_TUNING;
  const { a, b } = rippleSlotUniforms(0);
  a.value.set(RING[0][0], RING[0][1], RING[0][2], 0);
  b.value.set(1, T.rippleSpeed, T.rippleOmega, T.rippleZeta);
  M.uMaxRipple.value = 0.5;
  M.uMotionNow.value = 0.076;
  M.uRippleWeight.value = 1;
  M.uMotionWeight.value = 1;
}

// ─── Geometry of the expected image ────────────────────────────────────

interface Expected {
  atoms: TwinVec3[];
  mids: TwinVec3[];
  vacated: TwinVec3[];
}

function displaced(): TwinVec3[] {
  const state = readTwinState();
  return RING.map((p) => {
    const o = displayOffsetTwin(state, p, p);
    return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  });
}

/** Points to check, skipping any that a foreign atom or bond would cover. */
function expectedPoints(camera: THREE.Camera): Expected {
  const moved = displaced();
  const px = (p: TwinVec3) => {
    const v = new THREE.Vector3(...p).project(camera);
    const depth = -new THREE.Vector3(...p).applyMatrix4(camera.matrixWorldInverse).z;
    const perspective = camera as THREE.PerspectiveCamera;
    // Pixels per unit; the square readback stretches the wider axis.
    const vertical = SIZE / 2 / (Math.tan((perspective.fov * Math.PI) / 360) * depth);
    const scale = vertical * Math.max(1, 1 / Math.max(1e-3, perspective.aspect));
    return { x: ((v.x + 1) / 2) * SIZE, y: ((1 - v.y) / 2) * SIZE, depth, scale, onScreen: Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 };
  };
  const atomsPx = moved.map(px);
  type Px = ReturnType<typeof px>;
  const onSegment = (q: Px, a: Px, b: Px) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    return { distance: Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy), depth: a.depth + t * (b.depth - a.depth) };
  };
  // Something covers q when it overlaps q on screen and (for a point that
  // should be visible, `front` set) its surface is nearer than q's.
  const nearAtom = (q: Px, skip: number, margin: number, front?: number) =>
    atomsPx.some((a, i) => i !== skip
      && Math.hypot(q.x - a.x, q.y - a.y) < ATOM_R * 1.05 * a.scale + margin
      && (front === undefined || a.depth - ATOM_R < front + 0.02));
  const nearBond = (q: Px, skipAtom: number, margin: number, front?: number) =>
    BONDS.some(([i, j]) => {
      if (i === skipAtom || j === skipAtom) return false;
      const hit = onSegment(q, atomsPx[i], atomsPx[j]);
      return hit.distance < BOND_R * 1.05 * Math.max(atomsPx[i].scale, atomsPx[j].scale) + margin
        && (front === undefined || hit.depth - BOND_R < front + 0.02);
    });

  const atoms = moved.filter((_, i) => {
    const q = atomsPx[i];
    return q.onScreen && !nearBond(q, i, 3, q.depth - ATOM_R) && !nearAtom(q, i, 3, q.depth - ATOM_R);
  });
  // Points along each displaced bond (a crossing bond is blue too).
  const mids: TwinVec3[] = [];
  for (const [i, j] of BONDS) {
    for (const t of [0.3, 0.5, 0.7]) {
      const at: TwinVec3 = [0, 1, 2].map((k) => moved[i][k] + (moved[j][k] - moved[i][k]) * t) as TwinVec3;
      const q = px(at);
      if (q.onScreen && !nearAtom(q, -1, 3, q.depth - BOND_R)) mids.push(at);
    }
  }
  const restPoints: TwinVec3[] = [
    ...RING,
    ...BONDS.map(([i, j]) => [(RING[i][0] + RING[j][0]) / 2, (RING[i][1] + RING[j][1]) / 2, 0] as TwinVec3),
  ];
  const vacated = restPoints.filter((p) => {
    const q = px(p);
    return q.onScreen && !nearAtom(q, -1, 6) && !nearBond(q, -1, 6);
  });
  return { atoms, mids, vacated };
}

type Kind = 'atom' | 'bond' | 'plate';

function classify(readback: RasterReadback, camera: THREE.Camera, p: TwinVec3): { kind: Kind | 'other'; rgb: number[] } {
  const v = new THREE.Vector3(...p).project(camera);
  const x = Math.min(SIZE - 1, Math.max(0, Math.round(((v.x + 1) / 2) * SIZE - 0.5)));
  const y = Math.min(SIZE - 1, Math.max(0, Math.round(((1 - v.y) / 2) * SIZE - 0.5)));
  const i = (y * readback.width + x) * 4;
  const [r, g, b] = [readback.rgba[i], readback.rgba[i + 1], readback.rgba[i + 2]];
  const kind: Kind | 'other' = Math.abs(r - PLATE[0]) <= 8 && Math.abs(g - PLATE[1]) <= 8 && Math.abs(b - PLATE[2]) <= 8
    ? 'plate'
    : r > g + 40 && r > b + 40
      ? 'atom'
      : b > r + 40 && b > g + 20
        ? 'bond'
        : 'other';
  return { kind, rgb: [r, g, b] };
}

function checkPoints(label: string, readback: RasterReadback, camera: THREE.Camera, points: TwinVec3[], kind: Kind, min: number): void {
  const misses: string[] = [];
  for (const p of points) {
    const got = classify(readback, camera, p);
    if (got.kind !== kind) misses.push(`(${p.map((c) => c.toFixed(2)).join(',')})=${got.kind}[${got.rgb.join(',')}]`);
  }
  harnessAssert(label, points.length >= min && misses.length === 0, `${points.length - misses.length}/${points.length} (min ${min}) ${misses.join(' ')}`);
}

// ─── Captures ──────────────────────────────────────────────────────────

/** While set, a later capture guard re-applies the live weight: a readback of what the screen shows. */
let liveWeight: number | null = null;

function capture(live: boolean): Promise<RasterReadback> {
  const pending = runViewerCapture(async (context) => {
    liveWeight = live ? M.uMotionWeight.value : null;
    try {
      return await renderSceneToPixels({
        renderer: context.renderer,
        scene: context.scene,
        camera: context.camera,
        width: SIZE,
        height: SIZE,
        transparent: false,
        clearColor: context.plate,
      });
    } finally {
      liveWeight = null;
    }
  });
  if (!pending) throw new Error('no viewer capture service is mounted');
  return pending;
}

function identical(a: RasterReadback, b: RasterReadback): number {
  let diff = 0;
  for (let i = 0; i < a.rgba.length; i += 1) if (a.rgba[i] !== b.rgba[i]) diff += 1;
  return a.rgba.length === b.rgba.length ? diff : -1;
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  });
}

function FinalProbes({ points, onDeclared }: { points: Expected; onDeclared: () => void }) {
  return (
    <>
      {points.atoms.map((p, i) => <Probe key={`a${i}`} name={`final mid-condense: displaced atom ${i} is O`} at={p} expect={{ family: 'O' }} />)}
      {points.mids.map((p, i) => <Probe key={`b${i}`} name={`final mid-condense: displaced bond point ${i} is blue`} at={p} expect={{ family: 'N' }} />)}
      {points.vacated.map((p, i) => <Probe key={`v${i}`} name={`final mid-condense: vacated rest point ${i} is plate`} at={p} expect="plate" />)}
      <Declared onDeclared={onDeclared} />
    </>
  );
}

function Probe({ name, at, expect }: { name: string; at: TwinVec3; expect: HarnessExpect }) {
  useHarnessProbe(name, at, expect);
  return null;
}

function Declared({ onDeclared }: { onDeclared: () => void }) {
  useEffect(() => onDeclared(), [onDeclared]);
  return null;
}

export default function PlayCase() {
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.renderer);
  const frame = useMemo(ringFrame, []);
  const spatialHash = useMemo(() => {
    const hash = new SpatialHash3D(1.0);
    hash.build(frame.positions, frame.natoms);
    return hash;
  }, [frame]);
  const [bondsReady, setBondsReady] = useState(false);
  const [final, setFinal] = useState<Expected | null>(null);
  const selectedRef = useRef<number[] | null>(null);
  const releaseRef = useRef<() => void>(() => {});

  useEffect(
    () => registerCaptureGuard({
      begin: () => {
        if (liveWeight === null) return () => {};
        const saved = M.uMotionWeight.value;
        M.uMotionWeight.value = liveWeight;
        return () => {
          M.uMotionWeight.value = saved;
        };
      },
    }),
    [],
  );

  useEffect(() => {
    releaseRef.current = harnessHold('play');
    const glow = ATOM_GLOW.uGlowColor.value.clone();
    ATOM_GLOW.uGlowColor.value.setRGB(0, 0, 0);
    return () => {
      releaseRef.current();
      resetLupiDisplayMotion();
      M.uMaxRipple.value = DISPLAY_MOTION_TUNING.rippleAmplitude;
      ATOM_GLOW.uGlowColor.value.copy(glow);
    };
  }, []);

  useEffect(() => {
    if (!bondsReady) return undefined;
    let live = true;
    const run = async () => {
      await nextFrames(4);
      resetLupiDisplayMotion();
      await nextFrames(2);
      const rest = await capture(false);
      checkPoints('rest: every atom centre is O', rest, camera, RING, 'atom', 6);

      // Mid-condense: most atoms still in the mist, the bottom ones landing.
      setCondense(0.08);
      await nextFrames(2);
      const condense = expectedPoints(camera);
      const condenseLive = await capture(true);
      checkPoints('mid-condense: atoms sit where the CPU twin puts them (GPU seeds = twin)', condenseLive, camera, condense.atoms, 'atom', 3);
      checkPoints('mid-condense: bonds follow their atoms', condenseLive, camera, condense.mids, 'bond', 2);
      checkPoints('mid-condense: rest positions are vacated', condenseLive, camera, condense.vacated, 'plate', 2);
      const condenseGuarded = await capture(false);
      const d1 = identical(condenseGuarded, rest);
      harnessAssert('mid-condense: the export readback is byte-identical to rest', d1 === 0, `${d1} differing bytes`);

      // Mid-ripple: the wave has reached the poked atom's neighbours.
      setRipple();
      await nextFrames(2);
      const ripple = expectedPoints(camera);
      const rippleLive = await capture(true);
      checkPoints('mid-ripple: the poked atom is drawn (no NaN hole)', rippleLive, camera, [RING[0]], 'atom', 1);
      checkPoints('mid-ripple: displaced atoms at the twin positions', rippleLive, camera, ripple.atoms, 'atom', 3);
      checkPoints('mid-ripple: bonds follow their atoms', rippleLive, camera, ripple.mids, 'bond', 3);
      checkPoints('mid-ripple: vacated rest points are plate', rippleLive, camera, ripple.vacated, 'plate', 1);
      const rippleGuarded = await capture(false);
      const d2 = identical(rippleGuarded, rest);
      harnessAssert('mid-ripple: the export readback is byte-identical to rest', d2 === 0, `${d2} differing bytes`);
      M.uMaxRipple.value = DISPLAY_MOTION_TUNING.rippleAmplitude;

      // An armed arrival (everything in the mist) and a click at a rest atom.
      setCondense(0);
      await nextFrames(2);
      const uninstall = installArrivalCancel();
      try {
        const canvas = renderer.domElement as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const v = new THREE.Vector3(...RING[PICK_ATOM]).project(camera);
        const clientX = rect.left + ((v.x + 1) / 2) * rect.width;
        const clientY = rect.top + ((1 - v.y) / 2) * rect.height;
        selectedRef.current = null;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, bubbles: true }));
        const landed = M.uArrivalWeight.value === 0 && M.uMotionWeight.value === 0;
        canvas.dispatchEvent(new MouseEvent('click', { clientX, clientY, bubbles: true }));
        await nextFrames(3);
        const selected = selectedRef.current as number[] | null;
        harnessAssert(
          'a click during an armed arrival lands it first and picks the atom under the cursor',
          landed && selected?.length === 1 && selected[0] === PICK_ATOM,
          `landed=${landed} selected=${JSON.stringify(selected)}`,
        );
        const after = await capture(true);
        checkPoints('after the click every atom is at rest', after, camera, RING, 'atom', 6);
      } finally {
        uninstall();
      }

      // The final frame stays mid-condense for the on-screen probes.
      setCondense(0.08);
      await nextFrames(2);
      if (live) setFinal(expectedPoints(camera));
    };
    run().catch((error: unknown) => {
      harnessAssert('play flow completes', false, error instanceof Error ? error.message : String(error));
      releaseRef.current();
    });
    return () => {
      live = false;
    };
    // Once per mount, after the bonds arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bondsReady]);

  return (
    <>
      <ViewerCaptureService />
      <AtomsOptimized frame={frame} atomColorSource="element" scale={ATOM_R / NEUTRAL_RADIUS} qualityTier={1} />
      <Bonds
        frame={frame}
        colorMode="uniform"
        uniformColor={BLUE}
        radius={BOND_R}
        opacity={1}
        qualityTier={1}
        onBondsUpdate={(info) => {
          if (info.count > 0) setBondsReady(true);
        }}
      />
      <AtomPicker
        frame={frame}
        spatialHash={spatialHash}
        radius={0.2}
        onSelect={(indices) => {
          selectedRef.current = indices;
        }}
      />
      {final && <FinalProbes points={final} onDeclared={() => releaseRef.current()} />}
    </>
  );
}
