/**
 * render/tsl.ts — the one import site of @react-three/tsl (plan-final §5.4).
 *
 * @react-three/tsl is pinned to the fiber canary (10.0.0-canary.14007b4) and
 * still moves between canaries; routing every use through this file keeps a
 * bump to one place. Lint rejects @react-three/tsl anywhere else.
 */
import { useRenderPipeline } from '@react-three/tsl';

export {
  configureTSL,
  rebuildAllBuffers,
  rebuildAllNodes,
  rebuildAllStorage,
  rebuildAllUniforms,
  useBuffers,
  useLocalNodes,
  useNodes,
  useRenderPipeline,
  useUniform,
  useUniforms,
} from '@react-three/tsl';

export type {
  BuffersWithUtils,
  NodesWithUtils,
  TSLConfig,
  UniformValue,
  UniformsWithUtils,
} from '@react-three/tsl';

/** The main `useRenderPipeline` callback (builds `renderPipeline.outputNode`). */
export type RenderPipelineMainCallback = NonNullable<Parameters<typeof useRenderPipeline>[0]>;

/** The state a `useRenderPipeline` callback receives (`renderPipeline`, `passes.scenePass`, ...). */
export type RenderPipelineCallbackState = Parameters<RenderPipelineMainCallback>[0];
