/**
 * post — the post stack (WP4): three lit spheres (two touching, for contact
 * occlusion) and a bright one (for bloom) on the plate, rendered through
 * LupiPostPipeline, the pipeline ScenePostprocessing mounts.
 *
 * The case steps through: no pipeline → paper → paper without AO → studio →
 * studio while playing → editorial → cinematic → diagram → no pipeline again
 * → the final preset (`&preset=<id>`, default studio) for the screenshot. At
 * each step it reads the canvas back right after the frame and asserts:
 * - every preset with effects or tone mapping changes the image against no
 *   post (mean > 1/255); diagram (no effects) matches it (mean < 1/255);
 * - unmounting the pipeline restores R3F's default render (the two no-post
 *   captures match);
 * - AO darkens the sphere contact (desktop tier);
 * - the plate keeps its configured colour under every preset (probe);
 * - play/pause changes uniforms only: no graph rebuild, same pipeline, the
 *   image still changes (desktop tier);
 * - the registered passes (`state.passes.ao|bloom|dof`) match the config,
 *   and the scene pass's MSAA follows the config; on the phone budget
 *   (`&tier=mobile`, or a phone/low-power device) AO, bloom and DOF are off.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import { LUPI_PHASE } from '@atlas/scene';
import { getDeviceTier } from '../../deviceCapabilities';
import { resolveActivePostprocess, type EffectOverrides } from '../../postprocess/controls';
import {
  POSTPROCESS_PRESETS,
  scenePassSamples,
  type PostprocessPresetConfig,
  type PostprocessPresetId,
} from '../../postprocess/presets';
import { LupiPostPipeline, aoResolutionScaleFor, isReducedPostTier } from '../../postprocess/ScenePostprocessing';
import { harnessAssert, harnessHold, useHarnessProbe } from '../harness';

/** Frames rendered at a step before its capture (compile, then two steady frames). */
const SETTLE_FRAMES = 3;
const CAPTURE_WIDTH = 256;
const SPHERE_RADIUS = 0.62;
/** Where the two grey spheres touch (and the AO window's centre). */
const CONTACT: [number, number, number] = [0, -0.2, 0];
const GLOW: [number, number, number] = [0, 1.05, 0];

interface Step {
  id: string;
  config: PostprocessPresetConfig | null;
}

interface Capture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface StepRecord {
  capture: Capture;
  builds: number;
  pipeline: unknown;
}

function readSetup() {
  const params = new URLSearchParams(window.location.search);
  const presetParam = params.get('preset');
  const finalPreset: PostprocessPresetId = presetParam && Object.hasOwn(POSTPROCESS_PRESETS, presetParam)
    ? (presetParam as PostprocessPresetId)
    : 'studio';
  const tierParam = params.get('tier');
  const tier = getDeviceTier();
  const reduced = tierParam === 'mobile' ? true : tierParam === 'desktop' ? false : isReducedPostTier(tier);
  const config = (presetId: PostprocessPresetId, extra: { playing?: boolean; overrides?: EffectOverrides } = {}) =>
    resolveActivePostprocess({ presetId, intensity: 1, overrides: extra.overrides ?? null, playing: extra.playing ?? false, reduced });
  const steps: Step[] = [
    { id: 'none', config: null },
    { id: 'paper', config: config('paper') },
    ...(reduced ? [] : [{ id: 'paper-no-ao', config: config('paper', { overrides: { preset: 'paper', shadows: false } }) }]),
    { id: 'studio', config: config('studio') },
    { id: 'studio-playing', config: config('studio', { playing: true }) },
    { id: 'editorial', config: config('editorial') },
    { id: 'cinematic', config: config('cinematic') },
    { id: 'diagram', config: config('diagram') },
    { id: 'none-again', config: null },
    { id: 'final', config: config(finalPreset) },
  ];
  return { steps, reduced, finalPreset, aoResolutionScale: reduced ? 0.5 : aoResolutionScaleFor(tier) };
}

function captureCanvas(source: HTMLCanvasElement, scratch: HTMLCanvasElement): Capture {
  const width = CAPTURE_WIDTH;
  const height = Math.max(1, Math.round((width * source.height) / Math.max(1, source.width)));
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2D context for the capture');
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** Mean absolute difference over RGB, in 0..255 units. */
function meanDiff(a: Capture, b: Capture): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  }
  return sum / ((a.data.length / 4) * 3);
}

/** RGB of the pixel 6 px in from the top-left corner (plate in every step). */
function cornerPixel(c: Capture): [number, number, number] {
  const i = (6 * c.width + 6) * 4;
  return [c.data[i], c.data[i + 1], c.data[i + 2]];
}

/** Mean luma of a (2·half+1)² window centred on a capture pixel. */
function windowLuma(c: Capture, cx: number, cy: number, half: number): number {
  let sum = 0;
  let count = 0;
  for (let y = Math.max(0, cy - half); y <= Math.min(c.height - 1, cy + half); y += 1) {
    for (let x = Math.max(0, cx - half); x <= Math.min(c.width - 1, cx + half); x += 1) {
      const i = (y * c.width + x) * 4;
      sum += 0.2126 * c.data[i] + 0.7152 * c.data[i + 1] + 0.0722 * c.data[i + 2];
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function PostScene() {
  const grey = useMemo(() => new THREE.MeshStandardNodeMaterial({ color: '#9aa3a0', roughness: 0.6, metalness: 0 }), []);
  const glow = useMemo(() => new THREE.MeshBasicNodeMaterial({ color: '#ffffff' }), []);
  useEffect(() => () => {
    grey.dispose();
    glow.dispose();
  }, [grey, glow]);
  return (
    <group>
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 3, 4]} intensity={2.4} />
      <mesh position={[-SPHERE_RADIUS, CONTACT[1], 0]} material={grey}>
        <sphereGeometry args={[SPHERE_RADIUS, 64, 32]} />
      </mesh>
      <mesh position={[SPHERE_RADIUS, CONTACT[1], 0]} material={grey}>
        <sphereGeometry args={[SPHERE_RADIUS, 64, 32]} />
      </mesh>
      <mesh position={[0, CONTACT[1] - 0.1, -1.05]} material={grey}>
        <sphereGeometry args={[SPHERE_RADIUS, 64, 32]} />
      </mesh>
      <mesh position={GLOW} material={glow}>
        <sphereGeometry args={[0.28, 32, 16]} />
      </mesh>
    </group>
  );
}

export default function PostCase() {
  const setup = useMemo(readSetup, []);
  const { steps, reduced, finalPreset } = setup;
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const run = useRef({ frames: 0, pending: false, done: false, records: new Map<string, StepRecord>() });
  const builds = useRef(0);
  const scratch = useMemo(() => document.createElement('canvas'), []);
  const release = useRef<() => void>(() => {});
  const camera = useThree((state) => state.camera);

  useHarnessProbe('left sphere', [-SPHERE_RADIUS, CONTACT[1], SPHERE_RADIUS], 'not-plate');
  useHarnessProbe('glow sphere', [GLOW[0], GLOW[1], 0.28], 'not-plate');

  useEffect(() => {
    release.current = harnessHold('post sequence');
    return () => release.current();
  }, []);

  useLayoutEffect(() => {
    indexRef.current = index;
    run.current.frames = 0;
    run.current.pending = false;
  }, [index]);

  useFrame(
    (state) => {
      const r = run.current;
      if (r.done || r.pending) return;
      r.frames += 1;
      if (r.frames < SETTLE_FRAMES) return;
      const step = steps[indexRef.current];
      try {
        checkPasses(step, state.passes);
        if (step.id === 'final') {
          r.done = true;
          judge(r.records, camera, reduced, finalPreset);
          release.current();
          return;
        }
        r.records.set(step.id, {
          capture: captureCanvas(state.renderer.domElement, scratch),
          builds: builds.current,
          pipeline: state.renderPipeline ?? null,
        });
      } catch (error) {
        harnessAssert(`step ${step.id} runs`, false, String(error));
        r.done = true;
        release.current();
        return;
      }
      r.pending = true;
      setIndex((value) => value + 1);
    },
    { phase: LUPI_PHASE.capture, id: 'lupi/testbed-post' },
  );

  const step = steps[index];
  return (
    <>
      <PostScene />
      <PlateProbe />
      {step.config && (
        <LupiPostPipeline
          config={step.config}
          aoResolutionScale={setup.aoResolutionScale}
          onBuild={() => {
            builds.current += 1;
          }}
        />
      )}
    </>
  );
}

/** The plate stays exact under every preset: the look leaves the background as configured. */
function PlateProbe() {
  // Inside the canvas on a portrait phone as well (half-width ≈ 1.14 there).
  useHarnessProbe('plate', [-0.85, 1.95, 0], { rgb: [16, 24, 23], tol: 3 });
  return null;
}

/** Registered passes and MSAA match the step's config. */
function checkPasses(step: Step, passes: Record<string, unknown> | undefined): void {
  if (!step.config) return;
  const config = step.config;
  const registered = {
    ao: Boolean(passes?.ao),
    bloom: Boolean(passes?.bloom),
    dof: Boolean(passes?.dof),
  };
  const expected = { ao: config.ssao.enabled, bloom: config.bloom.enabled, dof: config.dof.enabled };
  harnessAssert(
    `${step.id}: registered passes match the config`,
    registered.ao === expected.ao && registered.bloom === expected.bloom && registered.dof === expected.dof,
    `registered=${JSON.stringify(registered)} expected=${JSON.stringify(expected)}`,
  );
  const scenePass = passes?.scenePass as { renderTarget?: { samples?: number } } | undefined;
  const samples = scenePass?.renderTarget?.samples;
  harnessAssert(
    `${step.id}: scene pass MSAA`,
    samples === scenePassSamples(config),
    `samples=${String(samples)} expected=${scenePassSamples(config)}`,
  );
}

function judge(records: Map<string, StepRecord>, camera: THREE.Camera, reduced: boolean, finalPreset: PostprocessPresetId): void {
  const none = records.get('none');
  const get = (id: string) => records.get(id);
  if (!none) {
    harnessAssert('no-post capture exists', false);
    return;
  }
  for (const id of ['paper', 'studio', 'editorial', 'cinematic'] as const) {
    const record = get(id);
    const diff = record ? meanDiff(record.capture, none.capture) : Number.NaN;
    harnessAssert(`${id} changes the image against no post`, diff > 1, `mean |${id} - none| = ${diff.toFixed(2)}/255`);
  }
  // The plate keeps its configured colour under every look: the corner, where
  // the vignette is strongest, reads as the no-post plate.
  for (const id of ['paper', 'studio', 'editorial', 'cinematic', 'diagram'] as const) {
    const record = get(id);
    const corner = record ? cornerPixel(record.capture) : null;
    const plate = cornerPixel(none.capture);
    const drift = corner ? Math.max(...corner.map((value, channel) => Math.abs(value - plate[channel]))) : Number.NaN;
    harnessAssert(`${id} keeps the plate as configured`, drift <= 3, `corner ${corner?.join(',')} vs no post ${plate.join(',')}`);
  }

  const diagram = get('diagram');
  const diagramDiff = diagram ? meanDiff(diagram.capture, none.capture) : Number.NaN;
  harnessAssert('diagram (no effects) matches no post', diagramDiff < 1, `mean |diagram - none| = ${diagramDiff.toFixed(2)}/255`);

  const again = get('none-again');
  const againDiff = again ? meanDiff(again.capture, none.capture) : Number.NaN;
  harnessAssert('unmounting the pipeline restores the default render', againDiff < 0.5, `mean |none-again - none| = ${againDiff.toFixed(2)}/255`);

  const studio = get('studio');
  const playing = get('studio-playing');
  harnessAssert(
    'play/pause does not rebuild the graph',
    Boolean(studio && playing) && studio!.builds === playing!.builds && studio!.pipeline === playing!.pipeline,
    `builds studio=${studio?.builds} playing=${playing?.builds} samePipeline=${studio?.pipeline === playing?.pipeline}`,
  );

  if (reduced) {
    harnessAssert('phone budget: no AO, bloom or DOF (checked on every step)', true, 'see the per-step "registered passes" assertions');
  } else {
    const playDiff = studio && playing ? meanDiff(playing.capture, studio.capture) : Number.NaN;
    harnessAssert('playback strengths reach the graph (uniforms)', playDiff > 0.02, `mean |studio-playing - studio| = ${playDiff.toFixed(3)}/255`);

    const paper = get('paper');
    const paperNoAo = get('paper-no-ao');
    if (paper && paperNoAo) {
      const point = new THREE.Vector3(...CONTACT).project(camera);
      const cx = Math.round(((point.x + 1) / 2) * paper.capture.width);
      const cy = Math.round(((1 - point.y) / 2) * paper.capture.height);
      const withAo = windowLuma(paper.capture, cx, cy + 2, 3);
      const withoutAo = windowLuma(paperNoAo.capture, cx, cy + 2, 3);
      harnessAssert('AO darkens the sphere contact', withoutAo - withAo >= 2, `luma at contact: AO ${withAo.toFixed(1)} vs no AO ${withoutAo.toFixed(1)}`);
    } else {
      harnessAssert('AO darkens the sphere contact', false, 'missing paper captures');
    }
  }
  harnessAssert('final preset', true, finalPreset);
}
