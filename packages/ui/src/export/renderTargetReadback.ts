/**
 * renderTargetReadback.ts — the export capture engine (plan-final §5.13, D10).
 *
 * WebGPURenderer cannot keep its drawing buffer between frames, so exports and
 * thumbnails never copy the canvas. They render the scene into a HalfFloat
 * linear render target at the requested size (the canvas is not resized, so
 * the live view never flickers) and read it back asynchronously:
 *
 *   rt = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
 *   prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt);
 *   renderer.render(scene, camera); renderer.setRenderTarget(prev);   // synchronous restore
 *   u16 = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h); rt.dispose();
 *
 * then decode on the CPU (lead probe L3):
 * - WebGPU rows are padded to 256 bytes (the last row is not) and top-left;
 *   WebGL2 rows are tight and bottom-left, so they are flipped.
 * - Pixels are premultiplied linear colour, so un-premultiply in linear, then
 *   sRGB-encode and round. One code path for opaque and transparent output.
 *
 * The render target bypasses the post pipeline and the renderer's output
 * transform (DETERMINISM_V2: raw scene, straight alpha, sRGB OETF on the CPU).
 *
 * Captures run inside the frame loop, in the `lupi-capture` phase after the
 * default render (never in `render`): ExportManager drives image exports, and
 * ViewerCaptureService runs queued tasks such as saved-view thumbnails.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import { LUPI_JOB, LUPI_PHASE, beginCaptureRender, runPrepareCapture } from '@atlas/scene';
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
  /** Clear to (0,0,0,0) instead of an opaque clear colour. */
  transparent: boolean;
  /**
   * Opaque clear colour, shown where nothing (not even `scene.background`)
   * draws. Defaults to the renderer's clear colour, made opaque.
   */
  clearColor?: THREE.ColorRepresentation;
}

/** The viewer plate (dark sage), used when the page behind the canvas has no colour. */
export const VIEWER_PLATE_FALLBACK = '#101817';

export const THUMBNAIL_WIDTH = 320;
export const THUMBNAIL_HEIGHT = 200;
/** Firestore documents are capped at 1 MB and inline molecules already use
 *  some of it, so keep the preview small. */
export const THUMBNAIL_MAX_DATA_URL_LENGTH = 60_000;
const THUMBNAIL_JPEG_QUALITIES = [0.72, 0.55, 0.4] as const;

const HALF_ONE = 0x3c00;
const BYTES_PER_HALF_TEXEL = 8;
const ROW_ALIGNMENT = 256;

/**
 * Render `scene` with `camera` into a w×h HalfFloat render target and read it
 * back as straight-alpha sRGB bytes (top-left origin). The render and the
 * restore of every renderer setting it touches happen synchronously in the
 * call, before the first await, so a caller in the `lupi-capture` phase can
 * swap scene state around the call and restore it right after.
 */
export async function renderSceneToPixels(options: RenderSceneToPixelsOptions): Promise<RasterReadback> {
  const { renderer, scene, camera, width, height, transparent } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`renderSceneToPixels: invalid size ${width}x${height}.`);
  }
  const backend = rendererBackendOf(renderer);
  const target = new THREE.RenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthBuffer: true,
  });

  const previousTarget = renderer.getRenderTarget();
  const previousCubeFace = renderer.getActiveCubeFace();
  const previousMipmapLevel = renderer.getActiveMipmapLevel();
  const previousMrt = renderer.getMRT();
  const previousAutoClear = renderer.autoClear;
  const previousAutoClearColor = renderer.autoClearColor;
  const previousAutoClearDepth = renderer.autoClearDepth;
  const previousAutoClearStencil = renderer.autoClearStencil;
  const previousClearColor = renderer.getClearColor(new THREE.Color());
  const previousClearAlpha = renderer.getClearAlpha();
  // Capture guards (display motion, …) hold toys at rest for exactly this
  // render; their restores run LIFO first thing in the finally.
  let restoreGuards = () => {};

  try {
    renderer.setRenderTarget(target);
    renderer.setMRT(null);
    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = true;
    if (transparent) renderer.setClearColor(0x000000, 0);
    else renderer.setClearColor(options.clearColor ?? previousClearColor, 1);
    restoreGuards = beginCaptureRender();
    renderer.render(scene, camera);
  } catch (error) {
    target.dispose();
    throw error;
  } finally {
    restoreGuards();
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.autoClearColor = previousAutoClearColor;
    renderer.autoClearDepth = previousAutoClearDepth;
    renderer.autoClearStencil = previousAutoClearStencil;
    renderer.setMRT(previousMrt);
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
  }

  try {
    const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    const rgba = decodeHalfFloatReadback(data, width, height, backend === 'webgl2');
    return { width, height, rgba, backend };
  } finally {
    target.dispose();
  }
}

export interface CompileSceneForCaptureOptions {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  width: number;
  height: number;
  /** Resolve anyway after this long (a warm-up must never block a capture). */
  timeoutMs?: number;
}

/**
 * Warm up a capture: `renderer.compileAsync` with a render target of the
 * capture's format bound, so pipelines for that target are built before the
 * capture frame. The scene is walked synchronously in the call (swap scene
 * state around it as for renderSceneToPixels). Never rejects.
 */
export async function compileSceneForCapture(options: CompileSceneForCaptureOptions): Promise<void> {
  const { renderer, scene, camera, width, height, timeoutMs = 3_000 } = options;
  const target = new THREE.RenderTarget(Math.max(1, width), Math.max(1, height), {
    type: THREE.HalfFloatType,
    samples: 0,
    depthBuffer: true,
  });
  const previousTarget = renderer.getRenderTarget();
  const previousCubeFace = renderer.getActiveCubeFace();
  const previousMipmapLevel = renderer.getActiveMipmapLevel();
  let compiling: Promise<unknown>;
  try {
    renderer.setRenderTarget(target);
    compiling = renderer.compileAsync(scene, camera);
  } catch (error) {
    compiling = Promise.reject(error);
  } finally {
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      compiling.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    target.dispose();
  }
}

/**
 * Decode a HalfFloat RGBA readback: de-stride (a WebGPU buffer pads every row
 * but the last to 256 bytes), flip bottom-left rows (WebGL2), un-premultiply
 * in linear and sRGB-encode. Returns tight, top-left, straight-alpha bytes.
 */
export function decodeHalfFloatReadback(
  data: ArrayBufferView,
  width: number,
  height: number,
  flipY: boolean,
): Uint8ClampedArray {
  const rowBytes = width * BYTES_PER_HALF_TEXEL;
  const tightBytes = rowBytes * height;
  const stride = data.byteLength === tightBytes ? rowBytes : Math.ceil(rowBytes / ROW_ALIGNMENT) * ROW_ALIGNMENT;
  const expectedBytes = stride * (height - 1) + rowBytes;
  if (data.byteLength < expectedBytes || data.byteOffset % 2 !== 0) {
    throw new Error(
      `Render target readback is ${data.byteLength} bytes; ${width}x${height} RGBA16F needs ${expectedBytes} (stride ${stride}).`,
    );
  }
  const halves = new Uint16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  const strideHalves = stride / 2;
  const encodeOpaque = opaqueEncodeTable();
  const out = new Uint8ClampedArray(width * height * 4);

  for (let row = 0; row < height; row += 1) {
    const sourceRow = flipY ? height - 1 - row : row;
    let source = sourceRow * strideHalves;
    let target = row * width * 4;
    for (let x = 0; x < width; x += 1, source += 4, target += 4) {
      const alphaBits = halves[source + 3];
      if (alphaBits === HALF_ONE) {
        out[target] = encodeOpaque[halves[source]];
        out[target + 1] = encodeOpaque[halves[source + 1]];
        out[target + 2] = encodeOpaque[halves[source + 2]];
        out[target + 3] = 255;
        continue;
      }
      const alpha = clamp01(halfToFloat(alphaBits));
      if (alpha <= 0) {
        // out is zero-initialized: fully transparent black.
        continue;
      }
      out[target] = Math.round(srgbOETF(clamp01(halfToFloat(halves[source]) / alpha)) * 255);
      out[target + 1] = Math.round(srgbOETF(clamp01(halfToFloat(halves[source + 1]) / alpha)) * 255);
      out[target + 2] = Math.round(srgbOETF(clamp01(halfToFloat(halves[source + 2]) / alpha)) * 255);
      out[target + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/** The sRGB transfer function (linear 0..1 → encoded 0..1). Input is clamped. */
export function srgbOETF(x: number): number {
  const linear = clamp01(x);
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

/** IEEE 754 binary16 bits → number (subnormals, ±Infinity and NaN included). */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

let opaqueTable: Uint8Array | null = null;

/** Half bits → sRGB byte for alpha = 1 (exact per half value, built once). */
function opaqueEncodeTable(): Uint8Array {
  if (opaqueTable) return opaqueTable;
  const table = new Uint8Array(0x10000);
  for (let bits = 0; bits < 0x10000; bits += 1) {
    table[bits] = Math.round(srgbOETF(clamp01(halfToFloat(bits))) * 255);
  }
  opaqueTable = table;
  return table;
}

function clamp01(value: number): number {
  // NaN fails both comparisons and becomes 0.
  return value > 0 ? (value < 1 ? value : 1) : 0;
}

export function rendererBackendOf(renderer: THREE.WebGPURenderer): LupiBackend {
  return (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
}

/**
 * The colour the viewer shows where the canvas itself is transparent: the
 * first non-transparent background colour behind it, or the viewer plate.
 * Opaque exports clear to it, so the image matches what is on screen (O5).
 */
export function resolveViewerPlate(canvas: Element | null | undefined): THREE.Color {
  const plate = new THREE.Color(VIEWER_PLATE_FALLBACK);
  if (typeof window === 'undefined' || !canvas) return plate;
  for (let node: Element | null = canvas; node; node = node.parentElement) {
    const match = /^rgba?\(([^)]+)\)$/.exec(window.getComputedStyle(node).backgroundColor.trim());
    if (!match) continue;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) continue;
    const alpha = parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
    if (alpha <= 0) continue;
    return plate.setRGB(parts[0] / 255, parts[1] / 255, parts[2] / 255, THREE.SRGBColorSpace);
  }
  return plate;
}

/** A 2D canvas holding the readback (for overlays and the browser's encoders). */
export function readbackToCanvas(readback: RasterReadback): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = readback.width;
  canvas.height = readback.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a 2D canvas for the captured pixels.');
  // Copy into a buffer ImageData accepts (a plain ArrayBuffer-backed view).
  const pixels = new Uint8ClampedArray(readback.rgba);
  context.putImageData(new ImageData(pixels, readback.width, readback.height), 0, 0);
  return canvas;
}

/**
 * A copy of `camera` for a `targetAspect` capture that covers the same view as
 * a centred cover-crop of a `sourceAspect` viewport: a wider target keeps the
 * horizontal field of view, a narrower one keeps the vertical.
 */
export function coverCropCamera(camera: THREE.Camera, sourceAspect: number, targetAspect: number): THREE.Camera {
  const copy = camera.clone();
  if (copy instanceof THREE.PerspectiveCamera && camera instanceof THREE.PerspectiveCamera) {
    copy.aspect = targetAspect;
    if (Number.isFinite(sourceAspect) && sourceAspect > 0 && sourceAspect < targetAspect) {
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (sourceAspect / targetAspect);
      copy.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfHeight));
    }
    copy.updateProjectionMatrix();
  } else if (copy instanceof THREE.OrthographicCamera) {
    const centerX = (copy.left + copy.right) / 2;
    const halfHeight = (copy.top - copy.bottom) / 2;
    copy.left = centerX - halfHeight * targetAspect;
    copy.right = centerX + halfHeight * targetAspect;
    copy.updateProjectionMatrix();
  }
  copy.updateMatrixWorld(true);
  return copy;
}

// ─── Viewer capture service ─────────────────────────────────────────

export interface ViewerCaptureContext {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  /** The live camera; tasks render with a copy and never move it. */
  camera: THREE.Camera;
  /** Canvas size in CSS pixels. */
  size: { width: number; height: number };
  /** The opaque clear colour that matches the viewer (resolveViewerPlate). */
  plate: THREE.Color;
}

/**
 * A capture task. It runs inside the `lupi-capture` job; everything before its
 * first `await` (the render into the target) runs in that frame.
 */
export type ViewerCaptureTask<T> = (context: ViewerCaptureContext) => Promise<T>;

interface QueuedCapture {
  task: ViewerCaptureTask<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface CaptureService {
  enqueue<T>(task: ViewerCaptureTask<T>): Promise<T>;
}

let activeService: CaptureService | null = null;

/** Queue a capture on the mounted viewer; null when no viewer canvas is mounted. */
export function runViewerCapture<T>(task: ViewerCaptureTask<T>): Promise<T> | null {
  return activeService ? activeService.enqueue(task) : null;
}

/**
 * Mount inside a LupiCanvas to serve runViewerCapture/requestViewerThumbnail:
 * queued tasks run in the next frame's `lupi-capture` phase.
 */
export function ViewerCaptureService(): null {
  const invalidate = useThree((state) => state.invalidate);
  const queueRef = useRef<QueuedCapture[]>([]);

  useEffect(() => {
    const queue = queueRef.current;
    const service: CaptureService = {
      enqueue<T>(task: ViewerCaptureTask<T>) {
        return new Promise<T>((resolve, reject) => {
          queue.push({ task, resolve: resolve as (value: unknown) => void, reject });
          invalidate();
        });
      },
    };
    activeService = service;
    return () => {
      if (activeService === service) activeService = null;
      for (const pending of queue.splice(0)) pending.reject(new Error('The viewer canvas unmounted before the capture ran.'));
    };
  }, [invalidate]);

  useFrame(
    (state) => {
      const queue = queueRef.current;
      if (queue.length === 0) return;
      // Settle toys (a coasting camera re-levels) before any task reads the camera.
      runPrepareCapture();
      const context: ViewerCaptureContext = {
        renderer: state.renderer,
        scene: state.scene,
        camera: state.camera,
        size: { width: state.size.width, height: state.size.height },
        plate: resolveViewerPlate(state.renderer.domElement),
      };
      for (const pending of queue.splice(0)) {
        try {
          pending.task(context).then(pending.resolve, pending.reject);
        } catch (error) {
          pending.reject(error);
        }
      }
    },
    { phase: LUPI_PHASE.capture, id: LUPI_JOB.viewerCapture },
  );

  return null;
}

/** A 320×200 JPEG of the current view (≤ 60,000 data-URL chars), via renderSceneToPixels. */
export async function requestViewerThumbnail(): Promise<SavedViewThumbnail | null> {
  const pending = runViewerCapture(async ({ renderer, scene, camera, size, plate }) => {
    const captureCamera = coverCropCamera(camera, size.width / size.height, THUMBNAIL_WIDTH / THUMBNAIL_HEIGHT);
    const readback = await renderSceneToPixels({
      renderer,
      scene,
      camera: captureCamera,
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      transparent: false,
      clearColor: plate,
    });
    return encodeThumbnailJpeg(readback);
  });
  if (!pending) return null;
  try {
    return await pending;
  } catch {
    return null;
  }
}

/** JPEG data URL of an opaque readback, stepping quality down to fit the size cap. */
export function encodeThumbnailJpeg(readback: RasterReadback): SavedViewThumbnail | null {
  const canvas = readbackToCanvas(readback);
  for (const quality of THUMBNAIL_JPEG_QUALITIES) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (!dataUrl.startsWith('data:image/jpeg')) return null;
    if (dataUrl.length <= THUMBNAIL_MAX_DATA_URL_LENGTH) {
      return { dataUrl, width: readback.width, height: readback.height };
    }
  }
  return null;
}
