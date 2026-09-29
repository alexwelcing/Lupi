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
 *   stays NoToneMapping (configureViewerRenderer), and the pipeline's output
 *   transform is the single sRGB encode;
 * - export capture does not go through the pipeline (it renders the scene
 *   directly);
 * - the graph is rebuilt only when the SET of effects (or the tone-mapping
 *   mode) changes. Strengths are uniforms, so the intensity knob and
 *   play/pause never rebuild; playback only drops the scene pass's MSAA.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useStore as useFiberStore } from '@react-three/fiber/webgpu';
import { LUPI_JOB, LUPI_PHASE } from '@atlas/scene';
import type { Node, PassNode, Vector3 } from 'three/webgpu';
import { useStore } from '../store';
import { getDeviceTier, type DeviceTier } from '../deviceCapabilities';
import { useRenderPipeline } from '../render/tsl';
import { resolveActivePostprocess } from './controls';
import { postStructure, postStructureKey, scenePassSamples, type PostprocessPresetConfig } from './presets';
import { applyPostParams, autofocus, buildPostChain, type PostChain } from './postPipeline';

/**
 * Changes each time this module is (re)evaluated in dev. Under Vite HMR an
 * edit here or in postPipeline.ts re-runs this module, and the pipeline
 * callback does not re-run on its own, so the token is part of the rebuild
 * key. Empty in production builds.
 */
const HMR_TOKEN = import.meta.env.DEV ? `|dev${Date.now()}` : '';

/** Tiers that get the phone budget (no AO, bloom or DOF; MSAA ≤ 2). */
export function isReducedPostTier(tier: DeviceTier): boolean {
  return tier === 'mobile' || tier === 'low';
}

/** AO resolution: half on phones and low-power devices (when full effects force it on). */
export function aoResolutionScaleFor(tier: DeviceTier): number {
  return isReducedPostTier(tier) ? 0.5 : 1;
}

export function ScenePostprocessing() {
  const presetId = useStore((s) => s.postprocessPreset);
  const intensity = useStore((s) => s.postprocessIntensity);
  const playing = useStore((s) => s.playing);
  const overrides = useStore((s) => s.effectOverrides);
  const fullEffects = useStore((s) => s.fullSceneEffects);
  const deviceTier = useMemo(getDeviceTier, []);

  const config = useMemo(
    () => resolveActivePostprocess({
      presetId,
      intensity,
      overrides,
      playing,
      reduced: !fullEffects && isReducedPostTier(deviceTier),
    }),
    [presetId, intensity, overrides, playing, fullEffects, deviceTier],
  );

  return <LupiPostPipeline config={config} aoResolutionScale={aoResolutionScaleFor(deviceTier)} />;
}

export interface LupiPostPipelineProps {
  /** The resolved recipe (resolveActivePostprocess). */
  config: PostprocessPresetConfig;
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
export function LupiPostPipeline({ config, aoResolutionScale = 1, onBuild }: LupiPostPipelineProps) {
  const store = useFiberStore();
  const structure = postStructure(config);
  const key = `${postStructureKey(structure)}|ao×${aoResolutionScale}${HMR_TOKEN}`;
  const samples = scenePassSamples(config);

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
    state.renderPipeline.outputColorTransform = true;
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
