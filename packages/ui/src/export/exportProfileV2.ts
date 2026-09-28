/**
 * exportProfileV2.ts — renderer identity constants for V2 browser artifacts
 * (plan-final §5.14).
 *
 * The WebGPURenderer port changes which bytes a render produces, so browser
 * artifacts move to a V2 renderer id and execution classes. The request and
 * spec contracts (lupi.render-request.v1, lupi.render-artifact-spec.v1) are
 * unchanged, so specIds and edge validation are unaffected; the
 * rendererFingerprint and artifactKey change by construction.
 *
 * Seed (WP0) with the planned values; WP7 owns them and wires them into the
 * fingerprint, and WP6 reads them for the capture engine.
 */
export const BROWSER_RENDERER_ID_V2 = 'lupi-browser-webgpu.v2';

/** Execution class by WebGPURenderer backend. */
export const EXECUTION_CLASS_V2 = {
  webgpu: 'browser-webgpu-main-thread',
  webgl2: 'browser-webgpu-webgl2-main-thread',
} as const;

/** How a V2 raster is produced; every field is part of the renderer fingerprint. */
export const DETERMINISM_V2 = {
  pixelRatio: 1,
  readback: 'render-target-async',
  renderTarget: 'rgba16f-linear-premultiplied-samples0',
  pixelEncode: 'cpu-linear-unpremultiply-srgb-oetf-round.v1',
  rowOrder: 'top-left;destride-256;flip-webgl2',
  alpha: 'straight',
  rendererToneMapping: 'none',
  postprocessPipeline: 'raw-scene-bypassed',
  rasterEncoder: 'browser-canvas-native',
  axesOverlay: 'canvas-overlay-v1',
} as const;
