/**
 * ScenePostprocessing — the post stack host (plan-final §5.12).
 *
 * Reads the active preset from the store, scales it by the user's intensity,
 * cheapens it during playback and bounds it on phones (controls.ts), and
 * renders it as one TSL render pipeline (`useRenderPipeline` from
 * render/tsl.ts; the graph is postPipeline.ts).
 *
 * Contract:
 * - at most one `useRenderPipeline` in the app, here;
 * - tone mapping only in the pipeline's `renderOutput`; `renderer.toneMapping`
 *   stays NoToneMapping (configureViewerRenderer); the chain's own sRGB encode
 *   (before FXAA) is the single encode, so the pipeline's output transform is
 *   off;
 * - export capture does not go through the pipeline (it renders the scene
 *   directly);
 * - the graph is rebuilt only when the SET of effects (or the tone-mapping
 *   mode) changes. Strengths are uniforms, so the intensity knob and
 *   play/pause never rebuild; playback only drops the scene pass's MSAA.
 * - the Illustrate look's ink contour is in the graph while the drawing
 *   shows: the look is on, or the live drawing is still fading out or
 *   handing over (Ink-to-Light). It fades with the drawing (a uniform).
 *   `?contour=0` leaves it out (a debug switch, inkContour.ts).
 * - the recipe follows the drawing: at rest in ink it steps aside (the ink
 *   recipe's cheaper graph); while the look changes (a fade, a Light Fuse,
 *   Ink-to-Light) the lit recipe's graph stays, and every stage rests pixel
 *   by pixel where the ink is (`inkFade`), so the part the front has not
 *   reached keeps its look.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useStore as useFiberStore } from '@react-three/fiber/webgpu';
import { INK_FUSE, INK_LOOK, LUPI_JOB, LUPI_PHASE } from '@atlas/scene';
import type { Node, PassNode, Vector3 } from 'three/webgpu';
import { useStore } from '../store';
import { getDeviceTier, type DeviceTier } from '../deviceCapabilities';
import { glidesAnimate } from '../motion/comfort';
import { useRenderPipeline } from '../render/tsl';
import { inkPhase, resolveActivePostprocess, type InkPhase } from './controls';
import { postStructure, postStructureKey, scenePassSamples, type PostprocessPresetConfig } from './presets';
import { applyPostParams, autofocus, buildPostChain, type PostChain } from './postPipeline';
import { inkContourSwitchedOn } from './inkContour';

/**
 * Changes each time this module is (re)evaluated in dev. Under Vite HMR an
 * edit here or in postPipeline.ts re-runs this module, and the pipeline
 * callback does not re-run on its own, so the token is part of the rebuild
 * key. Empty in production builds.
 */
const HMR_TOKEN = import.meta.env.DEV ? `|dev${Date.now()}` : '';

/** Tiers that get the phone budget (no AO, bloom, DOF or MSAA; FXAA stays). */
export function isReducedPostTier(tier: DeviceTier): boolean {
  return tier === 'mobile' || tier === 'low';
}

/** AO resolution: half on phones and low-power devices (when full effects force it on). */
export function aoResolutionScaleFor(tier: DeviceTier): number {
  return isReducedPostTier(tier) ? 0.5 : 1;
}

/**
 * True while the Illustrate look is drawn: the look is on, or the live
 * drawing (`uInkMix`) has not yet faded out, or is handing over to the light
 * (Ink-to-Light). Checked on drawn frames after the ink driver's uniforms.
 */
function useInkDrawn(ink: boolean): boolean {
  const [drawn, setDrawn] = useState(() => ink || INK_LOOK.uInkMix.value > 0);
  const latest = useRef(drawn);
  useFrame(
    () => {
      const next = ink || INK_LOOK.uInkMix.value > 0;
      if (next === latest.current) return;
      latest.current = next;
      setDrawn(next);
    },
    { phase: LUPI_PHASE.overlays },
  );
  return ink || drawn;
}

/**
 * Where the Illustrate look stands for the recipe (controls.ts `inkPhase`),
 * read from the live drawing on drawn frames, after the ink driver's
 * uniforms. A look chosen in the store counts as changing from the render
 * that brings it (the driver starts its fade or fuse just after), so the
 * recipe never switches ahead of the drawing; Still cuts, so there the new
 * look is at rest at once.
 */
function useInkPhase(ink: boolean): InkPhase {
  const [phase, setPhase] = useState<InkPhase>(() => (ink ? 'ink' : 'lit'));
  const latest = useRef(phase);
  useFrame(
    () => {
      const next = inkPhase(ink, INK_LOOK.uInkMix.value, INK_FUSE.uFuseActive.value > 0);
      if (next === latest.current) return;
      latest.current = next;
      setPhase(next);
    },
    { phase: LUPI_PHASE.overlays },
  );
  const settled: InkPhase = ink ? 'ink' : 'lit';
  if (phase === 'changing' || phase === settled) return phase;
  return glidesAnimate() ? 'changing' : settled;
}

export function ScenePostprocessing() {
  const presetId = useStore((s) => s.postprocessPreset);
  const intensity = useStore((s) => s.postprocessIntensity);
  const playing = useStore((s) => s.playing);
  const overrides = useStore((s) => s.effectOverrides);
  const fullEffects = useStore((s) => s.fullSceneEffects);
  const ink = useStore((s) => s.inkStyle !== 'off');
  const deviceTier = useMemo(getDeviceTier, []);
  const contour = useInkDrawn(ink) && inkContourSwitchedOn();
  const phase = useInkPhase(ink);
  const inkAtRest = phase === 'ink';

  const config = useMemo(
    () => resolveActivePostprocess({
      presetId,
      intensity,
      overrides,
      playing,
      reduced: !fullEffects && isReducedPostTier(deviceTier),
      ink: inkAtRest,
    }),
    [presetId, intensity, overrides, playing, fullEffects, deviceTier, inkAtRest],
  );

  return (
    <LupiPostPipeline
      config={config}
      contour={contour}
      inkFade={phase === 'changing'}
      aoResolutionScale={aoResolutionScaleFor(deviceTier)}
    />
  );
}

export interface LupiPostPipelineProps {
  /** The resolved recipe (resolveActivePostprocess). */
  config: PostprocessPresetConfig;
  /** Ink the Illustrate look's contour (inkContour.ts). */
  contour?: boolean;
  /** The look is changing between lit and ink: rest each stage where the pixel is inked (PostStructure.inkFade). */
  inkFade?: boolean;
  /** GTAO resolution scale (1 = full). */
  aoResolutionScale?: number;
  /** Called after each graph build (tests count rebuilds). */
  onBuild?: (chain: PostChain) => void;
}

/**
 * The render pipeline for one resolved config. Mounting it routes R3F's
 * default render through the pipeline; unmounting it restores the default
 * render (`reset()`).
 */
export function LupiPostPipeline({ config, contour = false, inkFade = false, aoResolutionScale = 1, onBuild }: LupiPostPipelineProps) {
  const store = useFiberStore();
  const structure = postStructure(config, contour, inkFade);
  const key = `${postStructureKey(structure)}|ao×${aoResolutionScale}${HMR_TOKEN}`;
  const samples = scenePassSamples(config, contour);

  // Latest inputs for the pipeline callback. Written in a layout effect that
  // runs before useRenderPipeline's own (effects run in declaration order).
  const latest = useRef({ config, structure, key, samples, aoResolutionScale, onBuild });
  useLayoutEffect(() => {
    latest.current = { config, structure, key, samples, aoResolutionScale, onBuild };
  });

  const chainRef = useRef<PostChain | null>(null);
  const builtKey = useRef<string | null>(null);

  const { rebuild, reset, passes } = useRenderPipeline((state) => {
    const input = latest.current;
    chainRef.current?.dispose();
    chainRef.current = null;
    const scenePass = state.passes.scenePass;
    setScenePassSamples(scenePass, input.samples);
    const chain = buildPostChain(scenePass, state.camera, input.structure, { aoResolutionScale: input.aoResolutionScale });
    applyPostParams(chain, input.config);
    chainRef.current = chain;
    builtKey.current = input.key;
    // The chain ends display-referred (its own sRGB encode, then FXAA).
    state.renderPipeline.outputColorTransform = false;
    state.renderPipeline.outputNode = chain.output;
    input.onBuild?.(chain);
    // `undefined` entries clear a disabled effect from state.passes (the hook
    // merges this record over the previous one); its type omits undefined.
    return chain.passes as Record<string, Node>;
  });

  // A new set of effects: rebuild the graph (the only rebuild path).
  useLayoutEffect(() => {
    if (builtKey.current !== null && builtKey.current !== key) rebuild();
  }, [key, rebuild]);

  // Strengths, focus and vignette: uniforms only.
  useLayoutEffect(() => {
    if (chainRef.current) applyPostParams(chainRef.current, config);
  }, [config]);

  // MSAA follows play/pause without a rebuild (only for graphs that do not read depth).
  const scenePass = passes.scenePass;
  useLayoutEffect(() => {
    if (scenePass) setScenePassSamples(scenePass, samples);
  }, [scenePass, samples]);

  // Unmount: back to R3F's default render.
  useLayoutEffect(
    () => () => {
      chainRef.current?.dispose();
      chainRef.current = null;
      builtKey.current = null;
      store.getState().renderPipeline?.dispose();
      reset();
    },
    [reset, store],
  );

  useFrame(
    (state) => {
      const chain = chainRef.current;
      const active = latest.current.config;
      if (!chain?.dof || !active.dof.auto) return;
      const target = (state.controls as { target?: Vector3 } | null)?.target;
      if (!target) {
        applyPostParams(chain, active);
        return;
      }
      autofocus(chain, active, state.camera.position.distanceTo(target));
    },
    { phase: LUPI_PHASE.uniforms, id: LUPI_JOB.dofFocus },
  );

  return null;
}

function setScenePassSamples(scenePass: PassNode, samples: number): void {
  scenePass.options.samples = samples;
  scenePass.renderTarget.samples = samples;
}
