/**
 * exportProfileV2.ts — renderer identity for V2 browser artifacts
 * (plan-final §5.14).
 *
 * The WebGPURenderer port changes which bytes a render produces, so browser
 * artifacts move to a V2 renderer id and one execution class per backend. The
 * request and spec contracts (lupi.render-request.v1,
 * lupi.render-artifact-spec.v1) are unchanged, so a specId and the edge
 * validation are unaffected; the rendererFingerprint, and with it the
 * artifactKey, change by construction.
 *
 * The WebGPU backend and the WebGL2 fallback are two execution classes. Their
 * bytes may differ, so the same spec gets a different artifactKey on each,
 * and bytes are never compared across them.
 */
import { REVISION as THREE_REVISION } from 'three';
import type { LupiBackend } from '../viewer/createLupiRenderer';

export const BROWSER_RENDERER_ID_V2 = 'lupi-browser-webgpu.v2';

/**
 * The fiber build the viewer runs on. Pinned for the whole port (plan-final
 * D15); renderArtifactAdapter.test.ts checks it against packages/ui.
 */
export const FIBER_VERSION_V2 = '10.0.0-canary.14007b4';

/** Execution class by WebGPURenderer backend. */
export const EXECUTION_CLASS_V2 = {
  webgpu: 'browser-webgpu-main-thread',
  webgl2: 'browser-webgpu-webgl2-main-thread',
} as const satisfies Record<LupiBackend, string>;

export type ExecutionClassV2 = (typeof EXECUTION_CLASS_V2)[LupiBackend];

/**
 * How a V2 raster is produced (the capture engine in renderTargetReadback.ts
 * and ExportManager). Every field is part of the renderer fingerprint.
 *
 * - The scene renders into a HalfFloat linear render target with no MSAA,
 *   read back asynchronously; the canvas is never read.
 * - The CPU un-premultiplies in linear light, applies the sRGB OETF and
 *   rounds, so opaque pixels match the canvas and transparent output is
 *   straight alpha.
 * - The browser encoder receives the pixels through a 2D canvas, which stores
 *   them premultiplied in 8 bits: low-alpha colour quantizes there. That is
 *   deterministic and accepted (plan-final R18).
 * - The interactive post pipeline (useRenderPipeline) is bypassed and the
 *   renderer applies no tone mapping: exports show the raw scene with the
 *   viewer's configured background (owner override O5). The spec records the
 *   same fact in `view.postprocess`.
 * - Opaque artifact captures draw the spec's gradient as `scene.background`,
 *   which covers every pixel, so the clear colour never reaches the bytes.
 */
export const DETERMINISM_V2 = {
  pixelRatio: 1,
  readback: 'render-target-async',
  renderTarget: 'rgba16f-linear-premultiplied-samples0',
  pixelEncode: 'cpu-linear-unpremultiply-srgb-oetf-round.v1',
  rowOrder: 'top-left;destride-256;flip-webgl2',
  alpha: 'straight',
  rasterAlphaStorage: 'canvas2d-premultiplied-rgba8',
  outputColorSpace: 'srgb',
  rendererToneMapping: 'none',
  postprocessPipeline: 'raw-scene-bypassed',
  opaqueBackground: 'spec-gradient-scene-background',
  rasterEncoder: 'browser-canvas-native',
  axesOverlay: 'canvas-overlay-v1',
} as const;

/** CPU model encoders (GLB); they do not depend on the backend. */
export const MODEL_ENCODER_V2 = `three-exporters-r${THREE_REVISION}`;

export function executionClassV2(backend: LupiBackend): ExecutionClassV2 {
  return EXECUTION_CLASS_V2[backend];
}

/** `three-r186;fiber-10.0.0-canary.14007b4;bridge-<bridge version>` */
export function rendererVersionV2(bridgeVersion: string, threeRevision: string = THREE_REVISION): string {
  return `three-r${threeRevision};fiber-${FIBER_VERSION_V2};bridge-${bridgeVersion}`;
}
