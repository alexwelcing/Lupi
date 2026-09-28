/**
 * renderTargetReadback.ts — the export capture engine (plan-final §5.13, D10).
 *
 * WebGPURenderer cannot keep its drawing buffer between frames, so exports and
 * thumbnails no longer copy the canvas. They render the scene into a HalfFloat linear
 * render target and read it back asynchronously:
 *
 *   rt = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
 *   prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt);
 *   renderer.render(scene, camera); renderer.setRenderTarget(prev);   // synchronous restore
 *   u16 = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h); rt.dispose();
 *
 * then decode on the CPU (lead probe L3): WebGPU rows are padded to 256 bytes
 * and top-left; WebGL2 rows are tight and bottom-left (flip); pixels are
 * premultiplied linear, so un-premultiply in linear, sRGB-encode, round.
 *
 * Seed (WP0): signatures only; WP6 implements them.
 */
import type * as THREE from 'three/webgpu';
import type { SavedViewThumbnail } from '../savedViews';
import type { LupiBackend } from '../viewer/createLupiRenderer';

export interface RasterReadback {
  width: number;
  height: number;
  /** Straight-alpha sRGB bytes, tight rows, top-left origin. */
  rgba: Uint8ClampedArray;
  backend: LupiBackend;
}

export interface RenderSceneToPixelsOptions {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
  transparent: boolean;
}

function notImplemented(name: string): Error {
  return new Error(`${name}: not implemented (WP6)`);
}

export async function renderSceneToPixels(_options: RenderSceneToPixelsOptions): Promise<RasterReadback> {
  throw notImplemented('renderSceneToPixels');
}

/** A 320×200 JPEG of the current view (≤ 60,000 data-URL chars), via renderSceneToPixels. */
export async function requestViewerThumbnail(): Promise<SavedViewThumbnail | null> {
  throw notImplemented('requestViewerThumbnail');
}

/** The sRGB transfer function (linear 0..1 → encoded 0..1). */
export function srgbOETF(_x: number): number {
  throw notImplemented('srgbOETF');
}

/** IEEE 754 binary16 bits → number. */
export function halfToFloat(_h: number): number {
  throw notImplemented('halfToFloat');
}
