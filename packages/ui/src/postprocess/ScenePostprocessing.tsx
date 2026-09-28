/**
 * ScenePostprocessing — the post stack host (plan-final §5.12).
 *
 * The postprocessing / @react-three/postprocessing EffectComposer (N8AO,
 * bloom, depth of field, tone mapping, vignette) was removed with the move to
 * WebGPURenderer. WP4 rebuilds the stack on the TSL render pipeline
 * (`useRenderPipeline` from render/tsl.ts), driven by the same store preset,
 * intensity and playback/mobile reductions (presets.ts, controls.ts).
 *
 * Contract:
 * - at most one `useRenderPipeline` in the app, here;
 * - tone mapping only in the pipeline's `renderOutput`; `renderer.toneMapping`
 *   stays NoToneMapping (configureViewerRenderer);
 * - export capture does not go through the pipeline.
 *
 * Seed (WP0): no post-processing; the default render draws the scene.
 */
export function ScenePostprocessing(): null {
  return null;
}
