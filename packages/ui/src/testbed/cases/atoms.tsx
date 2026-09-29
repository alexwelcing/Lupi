/**
 * atoms — the atom impostor layer (WP1a + WP1b) in isolation: the real
 * `AtomsOptimized` on synthetic frames, over the fixed testbed plate.
 *
 * - Three rows of C, O, N, H, S at quality tiers 2, 1 and 0: each centre is
 *   judged by CPK family, and a point 1.15 radii off each centre (inside the
 *   1.3-radius quad, outside the sphere) must be plate — square quads or a
 *   missing discard fail here (trap G1).
 * - Depth: two interpenetrating spheres (O left, N right) at the same depth
 *   must split at their intersection, and a flat quad that cuts a sphere's
 *   cap must hide the ring of sphere behind it. Both fail with the quad's own
 *   depth instead of the ray-cast hit.
 * - Trajectory lerp: one atom interpolated 35% of the way to the next frame
 *   by `uProgress` shows there and not at its start.
 * - Image-based lighting: `scene.environment` switched from none to an
 *   equirect sky must change the tier 1/2 atoms (two render-target
 *   readbacks); the probes then run with the environment on.
 * - The scene graph carries no itemSize-1 8/16-bit attribute (D4).
 *
 * Manual params: `&ortho=1` (orthographic camera, same framing),
 * `&progress=<0..1>` (default 0.35), `&env=0` (skip the environment).
 */
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import type { Frame } from '@atlas/core/types';
import { AtomsOptimized } from '@atlas/scene/AtomsOptimized';
import { harnessAssert, harnessHold, useHarnessProbe, type HarnessFamily } from '../harness';

type Vec3 = [number, number, number];

const PARAMS = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
const ORTHO = PARAMS.get('ortho') === '1';
const PROGRESS = clamp01(Number(PARAMS.get('progress') ?? 0.35));
const WITH_ENV = PARAMS.get('env') !== '0';

/** The neutral display radius frames without Ångström semantics get. */
const NEUTRAL_RADIUS = 0.5;
/** Half the visible height at z = 0 for the router's camera (z 5, fov 50). */
const HALF_HEIGHT = 5 * Math.tan((25 * Math.PI) / 180);

const ELEMENTS: ReadonlyArray<{ family: HarnessFamily; z: number }> = [
  { family: 'C', z: 6 },
  { family: 'O', z: 8 },
  { family: 'N', z: 7 },
  { family: 'H', z: 1 },
  { family: 'S', z: 16 },
];
const ROW_X = [-0.76, -0.38, 0, 0.38, 0.76];
const ROW_RADIUS = 0.15;
const TIER_ROWS: ReadonlyArray<{ tier: 0 | 1 | 2; y: number }> = [
  { tier: 2, y: 1.75 },
  { tier: 1, y: 1.3 },
  { tier: 0, y: 0.85 },
];

const PAIR_RADIUS = 0.35;
const PAIR_Y = 0.1;
const PAIR_OFFSET = 0.22;

const SLICE_RADIUS = 0.45;
const SLICE_Y = -0.75;
const SLICE_PLANE_Z = 0.3;
const SLICE_COLOR = '#2f8f4f';

const MOVER_RADIUS = 0.2;
const MOVER_Y = -1.75;
const MOVER_FROM: Vec3 = [-0.7, MOVER_Y, 0];
const MOVER_TO: Vec3 = [0.9, MOVER_Y, 0];

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.35;
}

/** A frame of known elements (atomic-number types) at the given positions. */
function makeFrame(atoms: ReadonlyArray<{ z: number; p: Vec3 }>, timestep = 0): Frame {
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
    bonds: new Int32Array(),
    properties: new Map(),
  };
}

/** Front-surface point of a sphere at screen offset (dx, dy) from its centre. */
function onSphere(center: Vec3, radius: number, dx: number, dy = 0): Vec3 {
  return [center[0] + dx, center[1] + dy, center[2] + Math.sqrt(Math.max(0, radius * radius - dx * dx - dy * dy))];
}

function RowProbes({ tier, y }: { tier: number; y: number }) {
  return (
    <>
      {ELEMENTS.map((element, index) => (
        <ElementProbes key={element.family} tier={tier} family={element.family} center={[ROW_X[index], y, 0]} />
      ))}
    </>
  );
}

function ElementProbes({ tier, family, center }: { tier: number; family: HarnessFamily; center: Vec3 }) {
  useHarnessProbe(`t${tier} ${family} centre`, onSphere(center, ROW_RADIUS, 0), { family });
  useHarnessProbe(`t${tier} ${family} 1.15R is plate`, [center[0] - 1.15 * ROW_RADIUS, center[1], center[2]], 'plate');
  return null;
}

/** The mover's start position, once the lerp has carried it clear. */
function StartIsPlate() {
  useHarnessProbe(`progress ${PROGRESS}: start position is plate`, MOVER_FROM, 'plate');
  return null;
}

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

/** A 64×32 equirect sky: warm zenith, cool horizon, dark ground. */
function makeSkyEquirect(): THREE.DataTexture {
  const width = 64;
  const height = 32;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1); // 0 = bottom row
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const sky = v > 0.5;
      data[i] = sky ? 255 : 40;
      data[i + 1] = sky ? Math.round(150 + 80 * (v - 0.5) * 2) : 50;
      data[i + 2] = sky ? 90 : 70;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
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

/**
 * Mean absolute difference over the pixels that are not background in either
 * image. WebGPU readback rows are padded to 256 bytes (the last row may not
 * be), WebGL2 rows are tight; only the first `width` pixels of a row count.
 */
function meanAtomDifference(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  width: number,
  height: number,
): { mean: number; pixels: number; background: string } {
  const tight = width * 4;
  const rowBytes = a.length === tight * height ? tight : Math.ceil(tight / 256) * 256;
  const bg = [a[0], a[1], a[2]];
  let sum = 0;
  let pixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * rowBytes + x * 4;
      const aBg = a[i] === bg[0] && a[i + 1] === bg[1] && a[i + 2] === bg[2];
      const bBg = b[i] === bg[0] && b[i + 1] === bg[1] && b[i + 2] === bg[2];
      if (aBg && bBg) continue;
      pixels += 1;
      sum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    }
  }
  return { mean: pixels > 0 ? sum / pixels : 0, pixels, background: bg.join(',') };
}

/** Env off vs on through two render-target readbacks, then leaves it on. */
function EnvironmentCheck() {
  const renderer = useThree((state) => state.renderer);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const release = harnessHold('ibl');
    const sky = makeSkyEquirect();
    const target = new THREE.RenderTarget(160, 160);
    let live = true;
    const capture = async (): Promise<ArrayLike<number>> => {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
      return (await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height)) as ArrayLike<number>;
    };
    (async () => {
      scene.environment = null;
      await nextFrames(4);
      const off = await capture();
      if (!live) return;
      scene.environment = sky;
      await nextFrames(6);
      const on = await capture();
      if (!live) return;
      const { mean, pixels, background } = meanAtomDifference(off, on, target.width, target.height);
      harnessAssert(
        'scene.environment changes the lit atoms (IBL)',
        pixels > 200 && mean > 2,
        `mean |on-off| over ${pixels} atom pixels = ${mean.toFixed(2)}/255 (background ${background})`,
      );
    })().catch((error: unknown) => {
      harnessAssert('scene.environment changes the lit atoms (IBL)', false, String(error));
    }).finally(() => {
      if (live) release();
    });
    return () => {
      live = false;
      release();
      if (scene.environment === sky) scene.environment = null;
      target.dispose();
      sky.dispose();
    };
  }, [renderer, scene, camera]);

  return null;
}

/** No itemSize-1 u8/u16 attribute anywhere in the scene (D4, K22). */
function AttributeAudit() {
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const narrow: string[] = [];
      let atomData = 0;
      scene.traverse((object: THREE.Object3D) => {
        const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (!geometry?.attributes) return;
        for (const [name, attribute] of Object.entries(geometry.attributes)) {
          const array = attribute.array;
          const narrowType = array instanceof Uint8Array || array instanceof Int8Array
            || array instanceof Uint16Array || array instanceof Int16Array;
          if (attribute.itemSize === 1 && narrowType) narrow.push(`${object.name || object.type}.${name}`);
          if (name === 'instanceAtomData' && array instanceof Uint8Array && attribute.itemSize === 4 && attribute.normalized) atomData += 1;
        }
      });
      harnessAssert(
        'atom attributes: one normalized Uint8x4 word, no itemSize-1 u8/u16',
        narrow.length === 0 && atomData >= 1,
        `narrow=[${narrow.join(', ')}] instanceAtomData meshes=${atomData}`,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [scene]);
  return null;
}

export default function AtomsCase() {
  const rows = useMemo(
    () => TIER_ROWS.map((row) => ({
      ...row,
      frame: makeFrame(ELEMENTS.map((element, index) => ({ z: element.z, p: [ROW_X[index], row.y, 0] as Vec3 }))),
    })),
    [],
  );
  const pairFrame = useMemo(() => makeFrame([
    { z: 8, p: [-PAIR_OFFSET, PAIR_Y, 0] },
    { z: 7, p: [PAIR_OFFSET, PAIR_Y, 0] },
  ]), []);
  const sliceFrame = useMemo(() => makeFrame([{ z: 6, p: [0, SLICE_Y, 0] }]), []);
  const moverFrames = useMemo(() => [
    makeFrame([{ z: 16, p: MOVER_FROM }], 0),
    makeFrame([{ z: 16, p: MOVER_TO }], 1),
  ], []);
  const sliceMaterial = useMemo(() => new THREE.MeshBasicNodeMaterial({ color: SLICE_COLOR }), []);
  useEffect(() => () => sliceMaterial.dispose(), [sliceMaterial]);

  // Interpenetrating pair: each side of the intersection shows its own sphere.
  useHarnessProbe('depth: pair left of the seam is O', onSphere([-PAIR_OFFSET, PAIR_Y, 0], PAIR_RADIUS, 0.15), { family: 'O' });
  useHarnessProbe('depth: pair right of the seam is N', onSphere([PAIR_OFFSET, PAIR_Y, 0], PAIR_RADIUS, -0.15), { family: 'N' });
  // Sliced sphere: the cap in front of the quad, the quad over the rest.
  const sliceRgb: [number, number, number] = [0x2f, 0x8f, 0x4f];
  useHarnessProbe('depth: cap in front of the slice quad is C', onSphere([0, SLICE_Y, 0], SLICE_RADIUS, 0), { family: 'C' });
  useHarnessProbe('depth: slice quad hides the sphere ring', [0.39, SLICE_Y, SLICE_PLANE_Z], { rgb: sliceRgb, tol: 4 });
  useHarnessProbe('depth: slice quad beside the sphere', [0.6, SLICE_Y, SLICE_PLANE_Z], { rgb: sliceRgb, tol: 4 });
  // Trajectory lerp by uProgress.
  const moverAt: Vec3 = [
    MOVER_FROM[0] + (MOVER_TO[0] - MOVER_FROM[0]) * PROGRESS,
    MOVER_Y,
    0,
  ];
  useHarnessProbe(`progress ${PROGRESS}: atom is at the lerp`, onSphere(moverAt, MOVER_RADIUS, 0), { family: 'S' });
  const moverLeftStart = Math.abs(moverAt[0] - MOVER_FROM[0]) > 1.3 * MOVER_RADIUS;

  return (
    <>
      {ORTHO && <OrthoCamera />}
      {rows.map((row) => (
        <group key={row.tier}>
          <AtomsOptimized
            frame={row.frame}
            atomColorSource="element"
            scale={ROW_RADIUS / NEUTRAL_RADIUS}
            qualityTier={row.tier}
          />
          <RowProbes tier={row.tier} y={row.y} />
        </group>
      ))}
      <AtomsOptimized frame={pairFrame} atomColorSource="element" scale={PAIR_RADIUS / NEUTRAL_RADIUS} />
      <AtomsOptimized frame={sliceFrame} atomColorSource="element" scale={SLICE_RADIUS / NEUTRAL_RADIUS} />
      <mesh material={sliceMaterial} position={[0, SLICE_Y, SLICE_PLANE_Z]}>
        <planeGeometry args={[1.5, 1.0]} />
      </mesh>
      <AtomsOptimized
        frame={moverFrames[0]}
        nextFrame={moverFrames[1]}
        interpolationFactor={PROGRESS}
        atomColorSource="element"
        scale={MOVER_RADIUS / NEUTRAL_RADIUS}
      />
      {moverLeftStart && <StartIsPlate />}
      <AttributeAudit />
      {WITH_ENV && <EnvironmentCheck />}
    </>
  );
}
