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
 * - The scene renders into HalfFloat linear render targets with no MSAA,
 *   read back asynchronously; the canvas is never read.
 * - It is supersampled: `factor` times the requested size on each side, 3 up
 *   to 1365 px and 2 above, in equal view-offset tiles of at most 4096 texels
 *   a side. A GPU pass box-averages each factor×factor block of premultiplied
 *   linear texels, each clamped as the screen shows it, in a fixed order (f32
 *   sums, stored as HalfFloat) into an output-sized target. That is what
 *   anti-aliases impostor silhouettes, which MSAA cannot. A scene with a
 *   screen-space transmission material is not tiled: one target, factor
 *   min(3, floor(4096 / longest side)).
 * - The CPU then un-premultiplies in linear light, applies the sRGB OETF and
 *   rounds, so flat regions match the canvas and transparent output is
 *   straight alpha.
 * - The browser encoder receives the pixels through a 2D canvas, which stores
 *   them premultiplied in 8 bits: low-alpha colour quantizes there. That is
 *   deterministic and accepted (plan-final R18).
 * - The interactive post pipeline (useRenderPipeline, with its canvas-sized
 *   targets and FXAA) is not used, and the renderer applies no tone mapping.
 *   Instead the capture applies the viewer's look itself (owner decision:
 *   exports use the view as configured), recorded in the spec's
 *   `view.postprocess` ('viewer-look', or 'raw-scene' when the look is
 *   empty, which is the raw path byte for byte). With a look, each texel is
 *   clamped to alpha × 64 instead of alpha (highlights survive to the tone
 *   map), the tiles assemble output-sized HDR colour, the nearest depth of
 *   each block and, when tone mapping or the vignette would restyle the
 *   background, the averaged lupiContent coverage (in alpha). The look then
 *   runs once over the whole assembled image at the output resolution:
 *   GTAO (16 samples, depth-reconstructed normals, denoised with a seeded
 *   noise texture) → bloom → depth of field → tone mapping → vignette, with
 *   the background given back where the look touched it. One pass over the
 *   whole image is the tile-seam rule: no stage ever sees a tile edge.
 *   Transparent output applies AO and tone mapping only (on un-premultiplied
 *   colour), never bloom, depth of field or a vignette.
 * - Opaque artifact captures draw the spec's gradient as `scene.background`,
 *   which covers every pixel, so the clear colour never reaches the bytes.
 */
export const DETERMINISM_V2 = {
  pixelRatio: 1,
  readback: 'render-target-async',
  renderTarget: 'rgba16f-linear-premultiplied-samples0',
  supersample: 'ssaa-box-premultiplied-clamped.v2;factor=max(w,h)<=1365?3:2;tiles=view-offset<=4096;gpu-f32-sum-rgba16f;untiled-transmission=min(3,floor(4096/max(w,h)));look-clamp=alpha*64;look-depth=block-min-f32;look-coverage=lupiContent-mean',
  pixelEncode: 'cpu-linear-unpremultiply-srgb-oetf-round.v1',
  rowOrder: 'top-left;destride-256;flip-webgl2',
  alpha: 'straight',
  rasterAlphaStorage: 'canvas2d-premultiplied-rgba8',
  outputColorSpace: 'srgb',
  rendererToneMapping: 'none',
  postprocessPipeline: 'viewer-look-output-resolution.v1;raw-scene-when-empty;gtao16-denoise-seed-0x4c757069;bloom-radius-0.4;transparent=ao+tonemap-unpremultiplied',
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
