/**
 * backgrounds — WP3b's testbed case: backgrounds, environment lighting, the
 * filter shell, the contact shadow, ghost atoms and trails on the WebGPU
 * backend and its WebGL2 fallback.
 *
 * `?testbed&case=backgrounds` (what the smoke harness runs) walks every layer
 * in turn and judges each one from an in-page render-target readback:
 * - gradient (scene.background), pattern (grid dome), equirect (a panorama
 *   image on the dome) and sky (procedural) each render and differ pairwise;
 * - the sky animates (unless the page prefers reduced motion);
 * - the filter shell changes pixels when its opacity changes;
 * - every environment preset installs a CubeUV PMREM with a real atlas as
 *   scene.environment and changes a metal sphere against "none";
 * - the contact shadow is darker than the plate by ≥ 6/255 under the atoms,
 *   and plate at the x and z mirror points (so it is not flipped);
 * - ghost atoms and an atom trail draw.
 * It then leaves a still composite (env-lit sphere in a fresnel shell over a
 * contact shadow) with probes for the screenshot.
 *
 * `&kind=gradient|pattern|equirect|sky|shell|environment|shadow|ghost|trails` shows one
 * layer full-screen instead (manual look; `&env=<preset>` picks the
 * environment).
 */
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import type { Frame } from '@atlas/core/types';
import { AppBackground, DEFAULT_BACKGROUND_ADJUSTMENTS } from '../../app/AppBackground';
import { AtomTrails } from '../../AtomTrails';
import { GhostAtoms } from '../../GhostAtoms';
import type { BgMedia } from '../../backgroundPresets';
import { LupiContactShadow } from '../../LupiContactShadow';
import { MoleculeFilterShell } from '../../MoleculeFilterShell';
import { SceneLighting } from '../../SceneLighting';
import { LUPI_ENVIRONMENT_IDENTITY_KEY, type SceneEnvironmentPreset } from '../../sceneEnvironment';
import { useStore } from '../../store';
import { harnessAssert, harnessHold, useHarnessProbe } from '../harness';

type Kind = 'gradient' | 'pattern' | 'equirect' | 'sky' | 'shell' | 'environment' | 'shadow' | 'ghost' | 'trails';
const KINDS: readonly Kind[] = ['gradient', 'pattern', 'equirect', 'sky', 'shell', 'environment', 'shadow', 'ghost', 'trails'];
const ENV_PRESETS: readonly SceneEnvironmentPreset[] = ['softbox', 'studio', 'city', 'dawn', 'night', 'warehouse', 'forest', 'park'];

const TOP = '#1d3f66';
const BOTTOM = '#05080d';
const GRADIENT: BgMedia = { kind: 'gradient', projection: 'equirectangular' };
const PANORAMA: BgMedia = { kind: 'image', src: '/backgrounds/bg_aurora_teal.jpg', projection: 'equirectangular' };

const CAMERA_POSITION = new THREE.Vector3(0, 2.2, 4.2);
const CAMERA_TARGET = new THREE.Vector3(0, -0.2, 0);
const SPHERE_CENTER: [number, number, number] = [0, 1.1, 0];
const SHELL_RADIUS = 0.75;
const PLANE_Y = -1;
/** Atoms sit off-centre (+x, -z) so a flipped shadow would show. */
const SHADOW_AT: [number, number, number] = [0.5, PLANE_Y, -0.4];
const SHADOW_OPACITY = 0.85;
const PLATE: [number, number, number] = [16, 24, 23];

const SHOT_W = 128;
const SHOT_H = 64; // 128 px × 4 B = 512 B rows: no WebGPU row padding.

interface Shot {
  rgba: Uint8Array;
}

const NO_HIDDEN_TYPES: ReadonlySet<number> = new Set();

function frameOf(points: ReadonlyArray<readonly [number, number, number]>): Frame {
  const n = points.length;
  return {
    timestep: 0,
    natoms: n,
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: Int32Array.from({ length: n }, (_, i) => i + 1),
    identity: { kind: 'source-id', unique: true },
    types: new Int32Array(n).fill(1),
    positions: Float32Array.from(points.flat()),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

function shadowFrame(): Frame {
  const r = 0.5; // neutral display radius
  return frameOf([
    [SHADOW_AT[0], PLANE_Y + r, SHADOW_AT[2]],
    [SHADOW_AT[0] + 0.35, PLANE_Y + r + 0.1, SHADOW_AT[2] + 0.1],
    [SHADOW_AT[0] - 0.2, PLANE_Y + r + 0.3, SHADOW_AT[2] - 0.25],
  ]);
}

/** Ghost atoms and the trail circle sit where the shell is in the composite. */
const GHOST_AT: [number, number, number] = [0, 0.4, 0];
const TRAIL_STEPS = 12;
const TRAIL_RADIUS = 0.8;

function trailPoint(step: number): [number, number, number] {
  const a = (step / TRAIL_STEPS) * Math.PI * 1.5;
  return [GHOST_AT[0] + TRAIL_RADIUS * Math.cos(a), GHOST_AT[1] + TRAIL_RADIUS * Math.sin(a), GHOST_AT[2]];
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function until(label: string, predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await nextFrame();
  }
}

function isWebGPU(renderer: THREE.WebGPURenderer): boolean {
  return Boolean((renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend);
}

/** Render the scene into a small sRGB target and read it back, rows top-first. */
async function capture(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<Shot> {
  const target = new THREE.RenderTarget(SHOT_W, SHOT_H, { samples: 0 });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(previous);
  }
  const raw = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SHOT_W, SHOT_H);
  target.dispose();
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const row = SHOT_W * 4;
  const stride = Math.floor(bytes.length / SHOT_H); // tight here; padded to 256 B on WebGPU in general
  const rgba = new Uint8Array(SHOT_W * SHOT_H * 4);
  const flip = !isWebGPU(renderer); // WebGL2 reads bottom-up
  for (let y = 0; y < SHOT_H; y += 1) {
    const from = (flip ? SHOT_H - 1 - y : y) * stride;
    rgba.set(bytes.subarray(from, from + row), y * row);
  }
  return { rgba };
}

/** Mean absolute channel difference, 0..255. */
function meanDiff(a: Shot, b: Shot): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    for (let c = 0; c < 3; c += 1) sum += Math.abs(a.rgba[i + c] - b.rgba[i + c]);
    count += 3;
  }
  return sum / count;
}

/** Mean RGB of a small patch around the projection of a world point. */
function patchAt(shot: Shot, camera: THREE.Camera, world: readonly [number, number, number], half = 1): [number, number, number] {
  const ndc = new THREE.Vector3(...world).project(camera);
  const cx = Math.round(((ndc.x + 1) / 2) * SHOT_W - 0.5);
  const cy = Math.round(((1 - ndc.y) / 2) * SHOT_H - 0.5);
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      if (x < 0 || y < 0 || x >= SHOT_W || y >= SHOT_H) continue;
      const i = (y * SHOT_W + x) * 4;
      for (let c = 0; c < 3; c += 1) sum[c] += shot.rgba[i + c];
      count += 1;
    }
  }
  return sum.map((v) => (count ? v / count : NaN)) as [number, number, number];
}

const fmt = (rgb: readonly number[]) => rgb.map((v) => v.toFixed(1)).join(',');

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function findMaterial(scene: THREE.Scene, name: string): THREE.Material | null {
  let found: THREE.Material | null = null;
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | undefined;
    if (!found && material && !Array.isArray(material) && material.name === name) found = material;
  });
  return found;
}

function uniformValue<T>(material: THREE.Material | null, name: string): T | undefined {
  return (material?.userData.lupiUniforms as Record<string, { value: T }> | undefined)?.[name]?.value;
}

function environmentReady(scene: THREE.Scene, preset: SceneEnvironmentPreset): boolean {
  const env = scene.environment;
  if (preset === 'none') return env === null;
  const identity = env?.userData[LUPI_ENVIRONMENT_IDENTITY_KEY] as { preset?: string } | undefined;
  return identity?.preset === preset;
}

// ─── Layers ──────────────────────────────────────────────────────────────

interface StageProps {
  kind: Kind;
  shellOpacity: number;
  skySpeed: number;
}

function EnvSphere() {
  const material = useMemo(() => new THREE.MeshStandardNodeMaterial({ color: '#ffffff', metalness: 1, roughness: 0.3 }), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh position={SPHERE_CENTER} material={material}>
      <sphereGeometry args={[0.45, 48, 24]} />
    </mesh>
  );
}

function Shadow() {
  const frame = useMemo(shadowFrame, []);
  return (
    <LupiContactShadow
      position={[0, PLANE_Y, 0]}
      scale={3.2}
      blur={2.4}
      far={2}
      opacity={SHADOW_OPACITY}
      resolution={512}
      frames={1}
      color="#000000"
      frame={frame}
      hiddenAtomTypes={NO_HIDDEN_TYPES}
    />
  );
}

function Shell({ opacity }: { opacity: number }) {
  return (
    <MoleculeFilterShell
      center={SPHERE_CENTER}
      radius={SHELL_RADIUS}
      shape="sphere"
      preset="prism"
      opacity={opacity}
      radiusScale={1}
    />
  );
}

function Ghosts() {
  const frame = useMemo(() => frameOf([GHOST_AT, [GHOST_AT[0] + 0.5, GHOST_AT[1], GHOST_AT[2]], [GHOST_AT[0] - 0.5, GHOST_AT[1], GHOST_AT[2]]]), []);
  return <GhostAtoms frame={frame} scale={0.3} />;
}

/** Steps one atom around a circle, one frame key per animation frame. */
function Trails() {
  const [step, setStep] = useState(0);
  const history = useMemo(() => ({}), []);
  useEffect(() => {
    if (step >= TRAIL_STEPS) return;
    const id = requestAnimationFrame(() => setStep((value) => value + 1));
    return () => cancelAnimationFrame(id);
  }, [step]);
  const frame = useMemo(() => frameOf([trailPoint(step)]), [step]);
  const atoms = useMemo(() => [0], []);
  return <AtomTrails frame={frame} frameKey={step} historyKey={history} atomIndices={atoms} />;
}

function Stage({ kind, shellOpacity, skySpeed }: StageProps) {
  switch (kind) {
    case 'gradient':
      return <AppBackground top={TOP} bottom={BOTTOM} media={GRADIENT} />;
    case 'pattern':
      return <AppBackground top={TOP} bottom={BOTTOM} media={GRADIENT} backdropPattern="grid" />;
    case 'equirect':
      return <AppBackground top={TOP} bottom={BOTTOM} media={PANORAMA} />;
    case 'sky':
      return (
        <AppBackground
          top={TOP}
          bottom={BOTTOM}
          media={GRADIENT}
          procedural="hopf-current"
          distance={4}
          adjustments={{ ...DEFAULT_BACKGROUND_ADJUSTMENTS, motionPaused: reducedMotion(), motionSpeed: skySpeed }}
        />
      );
    case 'shell':
      return <Shell opacity={shellOpacity} />;
    case 'environment':
      return (
        <>
          <Suspense fallback={null}><SceneLighting /></Suspense>
          <EnvSphere />
        </>
      );
    case 'shadow':
      return <Shadow />;
    case 'ghost':
      return <Ghosts />;
    case 'trails':
      return <Trails />;
  }
}

/** The still frame the smoke harness screenshots and probes. */
function Composite() {
  useHarnessProbe('env sphere', SPHERE_CENTER, 'not-plate');
  useHarnessProbe('shell rim', [SPHERE_CENTER[0] + SHELL_RADIUS * 0.96, SPHERE_CENTER[1], SPHERE_CENTER[2]], 'not-plate');
  useHarnessProbe('contact shadow', SHADOW_AT, 'not-plate');
  useHarnessProbe('shadow z-mirror is plate', [SHADOW_AT[0], PLANE_Y, -SHADOW_AT[2] + 0.1], 'plate');
  useHarnessProbe('empty plate', [-0.9, 0.1, 0], 'plate');
  return (
    <>
      <Suspense fallback={null}><SceneLighting /></Suspense>
      <EnvSphere />
      <Shell opacity={0.65} />
      <Shadow />
    </>
  );
}

// ─── Sequence ────────────────────────────────────────────────────────────

function useCaseCamera() {
  const camera = useThree((state) => state.camera);
  useMemo(() => {
    camera.position.copy(CAMERA_POSITION);
    camera.lookAt(CAMERA_TARGET);
    // The viewer's far plane (≥ 10 000) keeps the 5 000-unit panorama dome
    // and the 500-unit sky inside the frustum; the router's 100 would clip them.
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      (camera as THREE.PerspectiveCamera).far = 10_000;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }, [camera]);
  return camera;
}

function AllKinds() {
  const renderer = useThree((state) => state.renderer);
  const scene = useThree((state) => state.scene);
  const camera = useCaseCamera();
  const [stage, setStage] = useState<StageProps | 'composite' | null>(null);

  useEffect(() => {
    let live = true;
    const release = harnessHold('backgrounds sequence');
    const plate = new THREE.Color().setRGB(PLATE[0] / 255, PLATE[1] / 255, PLATE[2] / 255, THREE.SRGBColorSpace);
    const show = async (next: StageProps | null) => {
      setStage(next);
      await nextFrame();
      await nextFrame();
    };
    const resetBackground = () => {
      if (!(scene.background as THREE.Color | null)?.isColor) scene.background = plate.clone();
    };

    const run = async () => {
      const base: StageProps = { kind: 'gradient', shellOpacity: 0.24, skySpeed: 10 };
      const shots = new Map<string, Shot>();
      const at = (name: string) => shots.get(name)!;

      // Backgrounds.
      await show({ ...base, kind: 'gradient' });
      await until('the gradient background', () => (scene.background as THREE.Texture | null)?.isTexture === true);
      shots.set('gradient', await capture(renderer, scene, camera));

      await show({ ...base, kind: 'pattern' });
      await until('the grid dome', () => findMaterial(scene, 'lupi-panorama-dome') !== null);
      shots.set('pattern', await capture(renderer, scene, camera));

      await show({ ...base, kind: 'equirect' });
      await until('the panorama image', () => {
        const image = uniformValue<THREE.Texture>(findMaterial(scene, 'lupi-panorama-dome'), 'map')?.image as
          | { width?: number } | undefined;
        return Boolean(image && !(image instanceof HTMLCanvasElement) && (image.width ?? 0) > 0);
      }, 45_000);
      shots.set('equirect', await capture(renderer, scene, camera));

      await show({ ...base, kind: 'sky' });
      await until('the sky', () => findMaterial(scene, 'lupi-sky-hopf-current') !== null);
      const sky = findMaterial(scene, 'lupi-sky-hopf-current');
      shots.set('sky', await capture(renderer, scene, camera));
      const t0 = uniformValue<number>(sky, 'uTime') ?? 0;
      if (!reducedMotion()) await until('sky time to advance 1 s', () => (uniformValue<number>(sky, 'uTime') ?? 0) >= t0 + 1);
      else for (let i = 0; i < 4; i += 1) await nextFrame();
      shots.set('sky+1s', await capture(renderer, scene, camera));
      const t1 = uniformValue<number>(sky, 'uTime') ?? 0;
      await show(null);
      resetBackground();

      const kinds = ['gradient', 'pattern', 'equirect', 'sky'];
      for (let i = 0; i < kinds.length; i += 1) {
        for (let j = i + 1; j < kinds.length; j += 1) {
          const d = meanDiff(at(kinds[i]), at(kinds[j]));
          harnessAssert(`${kinds[i]} differs from ${kinds[j]}`, d > 1, `mean |Δ| ${d.toFixed(2)}/255`);
        }
      }
      const skyDiff = meanDiff(at('sky'), at('sky+1s'));
      if (reducedMotion()) {
        harnessAssert('sky holds still under reduced motion', skyDiff < 0.5 && t1 === t0, `Δt ${(t1 - t0).toFixed(2)} s, mean |Δ| ${skyDiff.toFixed(2)}`);
      } else {
        harnessAssert('sky animates over 1 s', skyDiff > 0.2 && t1 >= t0 + 1, `Δt ${(t1 - t0).toFixed(2)} s, mean |Δ| ${skyDiff.toFixed(3)}/255`);
      }
      const equirectMean = patchAt(at('equirect'), camera, CAMERA_TARGET.toArray(), 20);
      harnessAssert('equirect panorama is not the plate', Math.max(...equirectMean.map((v, c) => Math.abs(v - PLATE[c]))) > 6, fmt(equirectMean));

      // Filter shell.
      await show({ ...base, kind: 'shell', shellOpacity: 0.24 });
      await until('the filter shell', () => findMaterial(scene, 'lupi-filter-shell') !== null);
      const shellLow = await capture(renderer, scene, camera);
      await show({ ...base, kind: 'shell', shellOpacity: 0.65 });
      const shellHigh = await capture(renderer, scene, camera);
      const shellMaterial = findMaterial(scene, 'lupi-filter-shell');
      const shellDiff = meanDiff(shellLow, shellHigh);
      harnessAssert('shell opacity changes pixels', shellDiff > 0.3, `mean |Δ| ${shellDiff.toFixed(3)}/255`);
      harnessAssert(
        'shell bag and tag',
        uniformValue<number>(shellMaterial, 'uOpacity') === 0.65 && shellMaterial?.userData.lupiShader === 'fresnel',
        `uOpacity=${uniformValue<number>(shellMaterial, 'uOpacity')} lupiShader=${String(shellMaterial?.userData.lupiShader)}`,
      );

      // Environment presets.
      useStore.setState({ environmentPreset: 'none' });
      await show({ ...base, kind: 'environment' });
      await until('no environment', () => environmentReady(scene, 'none'));
      const envNone = await capture(renderer, scene, camera);
      const noneRgb = patchAt(envNone, camera, SPHERE_CENTER, 2);
      for (const preset of ENV_PRESETS) {
        useStore.setState({ environmentPreset: preset });
        try {
          await until(`environment ${preset}`, () => environmentReady(scene, preset), 30_000);
        } catch (error) {
          harnessAssert(`environment ${preset} loads`, false, String(error));
          continue;
        }
        const env = scene.environment!;
        const atlas = env.image as { width?: number; height?: number };
        const shot = await capture(renderer, scene, camera);
        const rgb = patchAt(shot, camera, SPHERE_CENTER, 2);
        const delta = Math.max(...rgb.map((v, c) => Math.abs(v - noneRgb[c])));
        harnessAssert(
          `environment ${preset} loads`,
          env.mapping === THREE.CubeUVReflectionMapping && (atlas.width ?? 0) > 1 && (atlas.height ?? 0) > 1,
          `mapping=${env.mapping} atlas=${atlas.width}x${atlas.height}`,
        );
        harnessAssert(`environment ${preset} lights the sphere`, delta > 2, `sphere ${fmt(rgb)} vs none ${fmt(noneRgb)}`);
      }
      useStore.setState({ environmentPreset: 'softbox' });

      // Contact shadow.
      await show({ ...base, kind: 'shadow' });
      resetBackground();
      await nextFrame();
      await nextFrame();
      const shadow = await capture(renderer, scene, camera);
      const under = patchAt(shadow, camera, SHADOW_AT);
      const mirrorZ = patchAt(shadow, camera, [SHADOW_AT[0], PLANE_Y, -SHADOW_AT[2] + 0.1]);
      const mirrorX = patchAt(shadow, camera, [-SHADOW_AT[0] - 0.1, PLANE_Y, SHADOW_AT[2]]);
      const nearPlate = (rgb: number[]) => rgb.every((v, c) => Math.abs(v - PLATE[c]) <= 3);
      harnessAssert('shadow is darker than the plate by ≥ 6/255', under.every((v, c) => PLATE[c] - v >= 6), fmt(under));
      harnessAssert('shadow is not mirrored in z', nearPlate(mirrorZ), fmt(mirrorZ));
      harnessAssert('shadow is not mirrored in x', nearPlate(mirrorX), fmt(mirrorX));

      // Ghost atoms and a trail.
      await show({ ...base, kind: 'ghost' });
      const ghost = await capture(renderer, scene, camera);
      const ghostRgb = patchAt(ghost, camera, GHOST_AT);
      harnessAssert('ghost atoms render', ghostRgb.some((v, c) => Math.abs(v - PLATE[c]) > 6), fmt(ghostRgb));
      await show({ ...base, kind: 'trails' });
      let trailLine: THREE.Line | null = null;
      await until('the trail to grow', () => {
        scene.traverse((object) => {
          const line = object as THREE.Line;
          if (line.isLine && !(line as THREE.LineSegments).isLineSegments && line.visible && line.geometry.drawRange.count >= TRAIL_STEPS - 2) trailLine = line;
        });
        return trailLine !== null;
      });
      const trail = await capture(renderer, scene, camera);
      let lit = 0;
      for (let i = 0; i < trail.rgba.length; i += 4) {
        if ([0, 1, 2].some((c) => Math.abs(trail.rgba[i + c] - PLATE[c]) > 20)) lit += 1;
      }
      harnessAssert(
        'trail renders behind the moving atom',
        lit >= 8,
        `points=${(trailLine as THREE.Line | null)?.geometry.drawRange.count} lit px=${lit}`,
      );
    };

    run()
      .catch((error: unknown) => harnessAssert('backgrounds sequence completes', false, String(error)))
      .finally(async () => {
        if (!live) return;
        resetBackground();
        setStage('composite');
        await until('the environment for the composite', () => environmentReady(scene, 'softbox'), 30_000).catch(() => {});
        await nextFrame();
        await nextFrame();
        release();
      });
    return () => {
      live = false;
      release();
    };
  }, [camera, renderer, scene]);

  if (stage === 'composite') return <Composite />;
  return stage ? <Stage {...stage} /> : null;
}

function OneKind({ kind }: { kind: Kind }) {
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  useCaseCamera();
  const env = (new URLSearchParams(window.location.search).get('env') ?? 'softbox') as SceneEnvironmentPreset;
  const gradientTexture = useRef<THREE.Texture | null>(null);

  // The router re-renders the canvas once ready, and its plate colour
  // background then replaces the gradient texture; put it back for the look.
  useEffect(() => {
    if (kind !== 'gradient' || !gradientTexture.current) return;
    if (scene.background !== gradientTexture.current) {
      scene.background = gradientTexture.current;
      invalidate();
    }
  });

  useEffect(() => {
    if (kind === 'environment') useStore.setState({ environmentPreset: env });
    const release = harnessHold(`kind ${kind}`);
    let live = true;
    const ready = (): boolean => {
      switch (kind) {
        case 'gradient': {
          const background = scene.background as THREE.Texture | null;
          if (background?.isTexture) gradientTexture.current = background;
          return Boolean(background?.isTexture);
        }
        case 'pattern': return findMaterial(scene, 'lupi-panorama-dome') !== null;
        case 'equirect': {
          const image = uniformValue<THREE.Texture>(findMaterial(scene, 'lupi-panorama-dome'), 'map')?.image;
          return Boolean(image && !(image instanceof HTMLCanvasElement));
        }
        case 'sky': return findMaterial(scene, 'lupi-sky-hopf-current') !== null;
        case 'shell': return findMaterial(scene, 'lupi-filter-shell') !== null;
        case 'environment': return environmentReady(scene, env);
        case 'shadow':
        case 'ghost':
        case 'trails': return true;
      }
    };
    until(`kind ${kind}`, ready, 45_000)
      .then(() => harnessAssert(`${kind} is ready`, true))
      .catch((error: unknown) => harnessAssert(`${kind} is ready`, false, String(error)))
      .finally(() => {
        if (live) release();
      });
    return () => {
      live = false;
      release();
    };
  }, [env, kind, scene]);
  return (
    <>
      <Stage kind={kind} shellOpacity={0.65} skySpeed={1} />
      {kind === 'shell' && (
        <>
          <Suspense fallback={null}><SceneLighting /></Suspense>
          <EnvSphere />
        </>
      )}
    </>
  );
}

function requestedKind(): Kind | null {
  const kind = new URLSearchParams(window.location.search).get('kind');
  return KINDS.includes(kind as Kind) ? (kind as Kind) : null;
}

export default function BackgroundsCase(): ReactNode {
  const [kind] = useState(requestedKind);
  return kind ? <OneKind kind={kind} /> : <AllKinds />;
}
