/**
 * renderTargetReadback.ts — the export capture engine (plan-final §5.13, D10).
 *
 * WebGPURenderer cannot keep its drawing buffer between frames, so exports and
 * thumbnails never copy the canvas. They render the scene into HalfFloat
 * linear render targets of their own (the canvas is not resized, so the live
 * view never flickers) and read the result back asynchronously.
 *
 * Supersampling (captureSupersamplePlan): the scene is rendered at `factor`
 * times the requested size on each side, 3 up to 1365 px and 2 above, in
 * equal tiles of at most 4096 texels a side (one tile up to 2048 px). Each
 * tile renders with a view offset of the capture camera into one reused
 * HalfFloat tile target; a GPU pass then box-averages every factor×factor
 * block of premultiplied linear texels (each clamped as the screen shows it,
 * summed in a fixed order in f32) into its rectangle of an output-sized
 * HalfFloat target, which is read back once. Atoms and bonds are ray-cast
 * impostors whose silhouettes no MSAA can smooth, so this is what
 * anti-aliases exported edges; averaging premultiplied colour keeps
 * transparent edges straight-alpha correct, and integer factors with a fixed
 * order keep it deterministic per execution class. A scene with a
 * screen-space transmission material (its refraction samples a buffer of the
 * whole view) is not tiled: one target, factor min(3, floor(4096 / longest
 * side)), so 1 above 2048 px.
 *
 *   tile = new THREE.RenderTarget(tw·f, th·f, { type: HalfFloatType, samples: 0 });
 *   out  = new THREE.RenderTarget(w, h, { type: HalfFloatType, depthBuffer: false });
 *   for each tile: camera.setViewOffset(w·f, h·f, x·f, y·f, tw·f, th·f);
 *     renderer.setRenderTarget(tile); renderer.render(scene, camera);
 *     renderer.setRenderTarget(out); downsample.render(renderer);  // its rectangle only
 *   restore the camera and renderer synchronously, then
 *   u16 = await renderer.readRenderTargetPixelsAsync(out, 0, 0, w, h);
 *
 * then decode on the CPU (lead probe L3):
 * - WebGPU rows are padded to 256 bytes (the last row is not) and top-left;
 *   WebGL2 rows are tight and bottom-left, so they are flipped.
 * - Pixels are premultiplied linear colour, so un-premultiply in linear, then
 *   sRGB-encode and round. One code path for opaque and transparent output.
 *
 * The render targets bypass the live post pipeline and the renderer's output
 * transform (DETERMINISM_V2: straight alpha, sRGB OETF on the CPU). With a
 * look (`look`, export/captureLook.ts; the viewer's configured AO, bloom,
 * depth of field, tone mapping and vignette) the tiles instead assemble HDR
 * colour, the nearest depth per output pixel and, when the look must leave
 * the background alone, content coverage (the live pipeline's lupiContent
 * MRT) into output-sized targets, and captureLookPass.ts runs the look once
 * over the whole assembled image before the readback. An empty look is the
 * raw path above, byte for byte. The Illustrate look's contour (`inkContour`)
 * takes the same assembly with no recipe: each texel clamped as the raw path
 * clamps it, the nearest depth, and coverage (an opaque capture's MRT, or a
 * transparent one's alpha), then the contour alone at the output resolution.
 *
 * Captures run inside the frame loop, in the `lupi-capture` phase after the
 * default render (never in `render`): ExportManager drives image exports, and
 * ViewerCaptureService runs queued tasks such as saved-view thumbnails.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import {
  Discard,
  Fn,
  If,
  clamp,
  float,
  int,
  ivec2,
  min,
  mrt,
  output,
  screenCoordinate,
  texture,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { CAPTURE_TEXEL_SCALE_KEY, LUPI_JOB, LUPI_PHASE, beginCaptureRender, runPrepareCapture } from '@atlas/scene';
import type { SavedViewThumbnail } from '../savedViews';
import { clearLiveViewOffset } from './renderCaptureState';
import type { LupiBackend } from '../viewer/createLupiRenderer';
import { LUPI_CONTENT_OUTPUT, contentCoverage } from '../postprocess/backgroundMask';
import { captureLookIsEmpty, captureLookRunsPass, captureLookTouchesBackground, type CaptureLook } from './captureLook';
import { renderCaptureLook } from './captureLookPass';

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
  /**
   * The viewer's look to apply (captureLook.ts). Null, absent or empty (no
   * recipe and no ink contour) renders the raw scene.
   */
  look?: CaptureLook | null;
}

/**
 * The HDR ceiling a look capture clamps each texel to before averaging
 * (premultiplied: colour ≤ alpha × ceiling). The raw path clamps to 1, as the
 * screen shows it; a look tone-maps afterwards, so highlights above 1 must
 * survive the average (a fixed ceiling keeps an infinite one out).
 */
export const CAPTURE_LOOK_HDR_CEILING = 64;

/** Largest supersampling factor (3×3 samples per output pixel). */
export const CAPTURE_SUPERSAMPLE_MAX_FACTOR = 3;
/**
 * Largest side of a capture's tile target, in texels: the largest raster an
 * export may request anyway (BROWSER_RENDER_CAPABILITY_V1), so supersampling
 * never allocates a bigger target than an un-supersampled 4096² export does.
 */
export const CAPTURE_TILE_MAX_SIDE = 4096;

/**
 * How a capture is supersampled: `factor` texels per output pixel on each
 * side, rendered as `columns` × `rows` equal tiles of `tileWidth` ×
 * `tileHeight` output pixels (the last column and row may run past the
 * image; what falls outside is never written).
 */
export interface CaptureSupersamplePlan {
  factor: number;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/**
 * The supersampling plan for a w×h capture. Tiled: factor 3 while one 4096
 * tile holds it (up to 1365 px), else 2, in as few equal tiles of at most 4096
 * texels a side as cover it (one up to 2048 px). Untiled (`tileable` false):
 * one target, factor min(3, floor(4096 / longest side)), at least 1.
 */
export function captureSupersamplePlan(width: number, height: number, tileable = true): CaptureSupersamplePlan {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const fit = Math.floor(CAPTURE_TILE_MAX_SIDE / Math.max(w, h));
  if (!tileable) {
    const factor = Math.max(1, Math.min(CAPTURE_SUPERSAMPLE_MAX_FACTOR, fit));
    return { factor, columns: 1, rows: 1, tileWidth: w, tileHeight: h };
  }
  const factor = fit >= CAPTURE_SUPERSAMPLE_MAX_FACTOR ? CAPTURE_SUPERSAMPLE_MAX_FACTOR : 2;
  const maxTile = Math.floor(CAPTURE_TILE_MAX_SIDE / factor);
  const columns = Math.ceil(w / maxTile);
  const rows = Math.ceil(h / maxTile);
  return { factor, columns, rows, tileWidth: Math.ceil(w / columns), tileHeight: Math.ceil(h / rows) };
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
 * Warm-up compiles still running. three r186's `compileAsync` creates its
 * pipelines one render object at a time between awaits, and reads the depth
 * format from the render context it shares with every capture target of the
 * same attachment state, i.e. from whichever target used it last. Disposing
 * that target while a compile is still running (a warm-up outlives its 3 s
 * timeout on a slow device) leaves the format undefined: "Async render
 * pipeline creation failed … GPUDepthStencilState format". Capture targets
 * therefore outlive every warm-up in flight when they are released.
 */
const warmups = new Set<Promise<void>>();

function releaseCaptureTarget(target: THREE.RenderTarget): void {
  if (warmups.size === 0) target.dispose();
  else void Promise.allSettled([...warmups]).then(() => target.dispose());
}

/**
 * Render `scene` with `camera`, supersampled (captureSupersamplePlan), and
 * read it back as straight-alpha w×h sRGB bytes (top-left origin). Every
 * render, and the restore of every renderer and camera setting it touches,
 * happens synchronously in the call, before the first await, so a caller in
 * the `lupi-capture` phase can swap scene state around the call and restore
 * it right after.
 */
export async function renderSceneToPixels(options: RenderSceneToPixelsOptions): Promise<RasterReadback> {
  const { renderer, scene, camera, width, height, transparent } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`renderSceneToPixels: invalid size ${width}x${height}.`);
  }
  if (options.look && captureLookRunsPass(options.look)) {
    return renderSceneToPixelsWithLook(options, options.look);
  }
  const backend = rendererBackendOf(renderer);
  const plan = captureSupersamplePlan(width, height, canTileCapture(scene, camera));
  const { factor, columns, rows, tileWidth, tileHeight } = plan;
  const tiled = columns > 1 || rows > 1;
  const tile = new THREE.RenderTarget(tileWidth * factor, tileHeight * factor, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthBuffer: true,
  });
  // Hairline layers (the simulation cell) keep their exported weight by it.
  (tile as unknown as Record<string, unknown>)[CAPTURE_TEXEL_SCALE_KEY] = factor;
  // factor 1 reads the tile itself (one tile, the requested size).
  const output = factor === 1
    ? tile
    : new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType, samples: 0, depthBuffer: false });
  const release = () => {
    releaseCaptureTarget(tile);
    if (output !== tile) releaseCaptureTarget(output);
  };

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
  const restoreCamera = tiled ? saveCameraView(camera as ViewOffsetCamera) : () => {};
  // Capture guards (display motion, …) hold toys at rest for exactly these
  // renders; their restores run LIFO first thing in the finally.
  let restoreGuards = () => {};

  try {
    renderer.setRenderTarget(tile);
    renderer.setMRT(null);
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = true;
    if (transparent) renderer.setClearColor(0x000000, 0);
    else renderer.setClearColor(options.clearColor ?? previousClearColor, 1);
    restoreGuards = beginCaptureRender();
    // Tiles in a fixed order, row by row; each is rendered, then reduced into
    // its rectangle of the output before the next one reuses the tile target.
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = column * tileWidth;
        const y = row * tileHeight;
        if (tiled) {
          (camera as ViewOffsetCamera).setViewOffset(
            width * factor,
            height * factor,
            x * factor,
            y * factor,
            tileWidth * factor,
            tileHeight * factor,
          );
        }
        if (row > 0 || column > 0) renderer.setRenderTarget(tile);
        renderer.autoClear = true;
        renderer.render(scene, camera);
        if (output === tile) continue;
        const reduce = captureDownsampler(factor, tile.texture);
        reduce.source.value = tile.texture;
        reduce.origin.value.set(x, y);
        reduce.extent.value.set(Math.min(tileWidth, width - x), Math.min(tileHeight, height - y));
        renderer.setRenderTarget(output);
        renderer.autoClear = false;
        reduce.quad.render(renderer);
      }
    }
  } catch (error) {
    release();
    throw error;
  } finally {
    restoreGuards();
    restoreCamera();
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.autoClearColor = previousAutoClearColor;
    renderer.autoClearDepth = previousAutoClearDepth;
    renderer.autoClearStencil = previousAutoClearStencil;
    renderer.setMRT(previousMrt);
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
  }

  try {
    const data = await renderer.readRenderTargetPixelsAsync(output, 0, 0, width, height);
    const rgba = decodeHalfFloatReadback(data, width, height, backend === 'webgl2');
    return { width, height, rgba, backend };
  } finally {
    release();
  }
}

/**
 * The look path of renderSceneToPixels: the same supersampled tiles, but
 * assembled into output-sized HDR colour (plus coverage) and nearest depth,
 * then styled once by captureLookPass.ts, then read back. Every render and
 * every restore happens synchronously, before the first await.
 */
async function renderSceneToPixelsWithLook(
  options: RenderSceneToPixelsOptions,
  look: CaptureLook,
): Promise<RasterReadback> {
  const { renderer, scene, camera, width, height, transparent } = options;
  const backend = rendererBackendOf(renderer);
  const plan = captureSupersamplePlan(width, height, canTileCapture(scene, camera));
  const { factor, columns, rows, tileWidth, tileHeight } = plan;
  const tiled = columns > 1 || rows > 1;
  // The ink contour finds the plate by coverage too (a transparent capture's alpha is its coverage).
  const coverage = !transparent && (captureLookTouchesBackground(look) || look.inkContour !== null);
  // Only a recipe tone-maps afterwards; the contour alone keeps the raw path's clamp.
  const ceiling = captureLookIsEmpty(look) ? 1 : CAPTURE_LOOK_HDR_CEILING;

  const tile = new THREE.RenderTarget(tileWidth * factor, tileHeight * factor, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthBuffer: true,
    count: coverage ? 2 : 1,
  });
  tile.depthTexture = captureDepthTexture(tile.width, tile.height);
  if (coverage) {
    tile.textures[0].name = 'output';
    tile.textures[1].name = LUPI_CONTENT_OUTPUT;
  }
  (tile as unknown as Record<string, unknown>)[CAPTURE_TEXEL_SCALE_KEY] = factor;
  const assembled = new THREE.RenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples: 0,
    depthBuffer: true,
  });
  assembled.depthTexture = captureDepthTexture(width, height);
  const styled = new THREE.RenderTarget(width, height, { type: THREE.HalfFloatType, samples: 0, depthBuffer: false });
  const release = () => {
    releaseCaptureTarget(tile);
    releaseCaptureTarget(assembled);
    releaseCaptureTarget(styled);
  };

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
  const restoreCamera = tiled ? saveCameraView(camera as ViewOffsetCamera) : () => {};
  let restoreGuards = () => {};
  const sceneMrt = coverage ? captureCoverageMrt() : null;

  try {
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = true;
    if (transparent) renderer.setClearColor(0x000000, 0);
    else renderer.setClearColor(options.clearColor ?? previousClearColor, 1);
    restoreGuards = beginCaptureRender();
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = column * tileWidth;
        const y = row * tileHeight;
        if (tiled) {
          (camera as ViewOffsetCamera).setViewOffset(
            width * factor,
            height * factor,
            x * factor,
            y * factor,
            tileWidth * factor,
            tileHeight * factor,
          );
        }
        renderer.setRenderTarget(tile);
        renderer.setMRT(sceneMrt);
        renderer.autoClear = true;
        renderer.render(scene, camera);
        const reduce = captureLookDownsampler(factor, coverage, ceiling, tile);
        reduce.source.value = tile.textures[0];
        reduce.depth.value = tile.depthTexture!;
        if (coverage) reduce.content.value = tile.textures[1];
        reduce.origin.value.set(x, y);
        reduce.extent.value.set(Math.min(tileWidth, width - x), Math.min(tileHeight, height - y));
        reduce.tileSize.value.set(tile.width, tile.height);
        renderer.setMRT(null);
        renderer.setRenderTarget(assembled);
        renderer.autoClear = false;
        reduce.quad.render(renderer);
      }
    }
    // The look sees the whole image through the capture's own projection.
    restoreCamera();
    renderCaptureLook({
      renderer,
      look,
      transparent,
      coverage,
      camera,
      color: assembled.texture,
      depth: assembled.depthTexture!,
      target: styled,
      width,
      height,
    });
  } catch (error) {
    release();
    throw error;
  } finally {
    restoreGuards();
    restoreCamera();
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.autoClearColor = previousAutoClearColor;
    renderer.autoClearDepth = previousAutoClearDepth;
    renderer.autoClearStencil = previousAutoClearStencil;
    renderer.setMRT(previousMrt);
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
  }

  try {
    const data = await renderer.readRenderTargetPixelsAsync(styled, 0, 0, width, height);
    const rgba = decodeHalfFloatReadback(data, width, height, backend === 'webgl2');
    return { width, height, rgba, backend };
  } finally {
    release();
  }
}

/** A 32-bit float depth attachment that later passes can sample. */
function captureDepthTexture(width: number, height: number): THREE.DepthTexture {
  const depth = new THREE.DepthTexture(width, height);
  depth.type = THREE.FloatType;
  return depth;
}

let coverageMrt: ReturnType<typeof mrt> | null = null;

/**
 * The capture scene pass's MRT for a background-preserving look: colour plus
 * the live pipeline's `lupiContent` coverage (backgroundMask.ts), blended
 * like the material and cleared to 0.
 */
function captureCoverageMrt(): ReturnType<typeof mrt> {
  if (coverageMrt) return coverageMrt;
  const node = mrt({ output, [LUPI_CONTENT_OUTPUT]: contentCoverage() });
  node.setBlendMode(LUPI_CONTENT_OUTPUT, new THREE.BlendMode(THREE.MaterialBlending));
  node.setClearColor(LUPI_CONTENT_OUTPUT, 0x000000, 0);
  coverageMrt = node;
  return node;
}

interface LookDownsampler {
  quad: THREE.QuadMesh;
  source: { value: THREE.Texture };
  depth: { value: THREE.Texture };
  content: { value: THREE.Texture };
  origin: { value: THREE.Vector2 };
  extent: { value: THREE.Vector2 };
  /** Tile target size in texels (for depth sampling). */
  tileSize: { value: THREE.Vector2 };
}

const lookDownsamplers = new Map<string, LookDownsampler>();

/**
 * The look capture's reduction for one factor: like captureDownsampler, but
 * each texel is clamped to `ceiling` × alpha (the HDR ceiling when the look
 * tone-maps afterwards, 1 for the ink contour alone), the alpha of an opaque
 * capture whose look needs coverage carries the averaged content coverage,
 * and the fragment depth is the nearest depth of the block (so the look's
 * AO, defocus and contour see the front surface at every pixel).
 */
function captureLookDownsampler(
  factor: number,
  coverage: boolean,
  ceiling: number,
  initial: THREE.RenderTarget,
): LookDownsampler {
  const key = `${factor}|${coverage ? 'coverage' : 'alpha'}|${ceiling}`;
  const cached = lookDownsamplers.get(key);
  if (cached) return cached;
  const source: any = texture(initial.textures[0]);
  const depth: any = texture(initial.depthTexture!);
  const content: any = texture(coverage ? initial.textures[1] : initial.textures[0]);
  const origin: any = uniform(new THREE.Vector2());
  const extent: any = uniform(new THREE.Vector2(1, 1));
  const tileSize: any = uniform(new THREE.Vector2(1, 1));
  const local = (): any => (screenCoordinate as any).xy.sub(origin);
  const material = new THREE.NodeMaterial();
  material.name = `lupi-capture-look-downsample-${factor}x${coverage ? '-coverage' : ''}-clamp${ceiling}`;
  material.fragmentNode = (Fn(() => {
    const at: any = local().toVar();
    If(
      at.x.lessThan(0).or(at.y.lessThan(0)).or(at.x.greaterThanEqual(extent.x)).or(at.y.greaterThanEqual(extent.y)),
      () => {
        Discard();
      },
    );
    const base: any = (ivec2(at) as any).mul(int(factor)).toVar();
    let sum: any = vec4(0);
    let covered: any = float(0);
    for (let dy = 0; dy < factor; dy += 1) {
      for (let dx = 0; dx < factor; dx += 1) {
        const coord: any = base.add(ivec2(dx, dy));
        const texel: any = (textureLoad(source, coord) as any).toVar();
        const alpha: any = clamp(texel.a, 0, 1);
        sum = sum.add(vec4(texel.rgb.max(vec3(0)).min(vec3(alpha.mul(ceiling))), alpha));
        if (coverage) covered = covered.add(clamp((textureLoad(content, coord) as any).r, 0, 1));
      }
    }
    const mean: any = sum.mul(1 / (factor * factor));
    return coverage ? vec4(mean.rgb, covered.mul(1 / (factor * factor))) : mean;
  }) as any)();
  material.depthNode = (Fn(() => {
    const base: any = (ivec2(local()) as any).mul(int(factor)).toVar();
    let nearest: any = float(1);
    for (let dy = 0; dy < factor; dy += 1) {
      for (let dx = 0; dx < factor; dx += 1) {
        const at: any = vec2(base.add(ivec2(dx, dy))).add(0.5).div(tileSize);
        nearest = min(nearest, (depth.sample(at) as any).r);
      }
    }
    return nearest;
  }) as any)();
  material.depthTest = true;
  material.depthWrite = true;
  material.depthFunc = THREE.AlwaysDepth;
  material.blending = THREE.NoBlending;
  material.fog = false;
  material.toneMapped = false;
  const downsampler: LookDownsampler = {
    quad: new THREE.QuadMesh(material),
    source,
    depth,
    content,
    origin,
    extent,
    tileSize,
  };
  lookDownsamplers.set(key, downsampler);
  return downsampler;
}

type ViewOffsetCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

/**
 * Whether a capture may be tiled: the camera takes a view offset (and has
 * none of its own), and nothing visible samples a screen-space buffer of the
 * whole view. drei's MeshTransmissionMaterial (the true-transmission atoms)
 * refracts a buffer rendered beside the scene, and physical transmission
 * reads the render's own opaque pass; under a tile's view offset either would
 * sample the wrong part of the picture.
 */
function canTileCapture(scene: THREE.Object3D, camera: THREE.Camera): boolean {
  const viewCamera = camera as Partial<ViewOffsetCamera>;
  if (!(camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera)) return false;
  if (viewCamera.view?.enabled) return false;
  let screenSpace = false;
  if (typeof scene.traverseVisible === 'function') {
    scene.traverseVisible((object) => {
      if (screenSpace) return;
      const material = (object as THREE.Mesh).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      screenSpace = materials.some((entry) => {
        const candidate = entry as THREE.Material & { isMeshTransmissionMaterial?: boolean; transmission?: number };
        return candidate.isMeshTransmissionMaterial === true || (candidate.transmission ?? 0) > 0;
      });
    });
  }
  return !screenSpace;
}

/** Saves the camera's view offset (and aspect); the returned restore puts both back. */
function saveCameraView(camera: ViewOffsetCamera): () => void {
  const view = camera.view ? { ...camera.view } : null;
  const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : null;
  return () => {
    camera.view = view;
    if (aspect !== null && camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };
}

interface CaptureDownsampler {
  quad: THREE.QuadMesh;
  source: { value: THREE.Texture };
  /** The tile's top-left output pixel. */
  origin: { value: THREE.Vector2 };
  /** Output pixels the tile covers inside the image. */
  extent: { value: THREE.Vector2 };
}

const downsamplers = new Map<number, CaptureDownsampler>();

/**
 * The GPU reduction for one factor: a full-target quad that keeps only the
 * tile's rectangle of the output and writes, per output pixel, the mean of
 * its factor×factor block of tile texels. Each texel is first clamped as the
 * screen would show it (alpha to 0..1, colour to 0..alpha), so an over-range
 * highlight cannot bleed into its neighbours; the sum runs in a fixed order
 * in f32 and is stored as HalfFloat, premultiplied and linear, for the CPU
 * decode. screenCoordinate and the tile texel rows are both top-left on
 * either backend (three flips them on WebGL2).
 */
function captureDownsampler(factor: number, initial: THREE.Texture): CaptureDownsampler {
  const cached = downsamplers.get(factor);
  if (cached) return cached;
  const source: any = texture(initial);
  const origin: any = uniform(new THREE.Vector2());
  const extent: any = uniform(new THREE.Vector2(1, 1));
  const material = new THREE.NodeMaterial();
  material.name = `lupi-capture-downsample-${factor}x`;
  material.fragmentNode = (Fn(() => {
    const local: any = (screenCoordinate as any).xy.sub(origin).toVar();
    If(
      local.x.lessThan(0).or(local.y.lessThan(0)).or(local.x.greaterThanEqual(extent.x)).or(local.y.greaterThanEqual(extent.y)),
      () => {
        Discard();
      },
    );
    const base: any = (ivec2(local) as any).mul(int(factor)).toVar();
    let sum: any = vec4(0);
    for (let dy = 0; dy < factor; dy += 1) {
      for (let dx = 0; dx < factor; dx += 1) {
        const texel: any = (textureLoad(source, base.add(ivec2(dx, dy))) as any).toVar();
        const alpha: any = clamp(texel.a, 0, 1);
        sum = sum.add(vec4(texel.rgb.max(vec3(0)).min(vec3(alpha)), alpha));
      }
    }
    return sum.mul(1 / (factor * factor));
  }) as any)();
  material.depthTest = false;
  material.depthWrite = false;
  material.blending = THREE.NoBlending;
  material.fog = false;
  material.toneMapped = false;
  const downsampler: CaptureDownsampler = { quad: new THREE.QuadMesh(material), source, origin, extent };
  downsamplers.set(factor, downsampler);
  return downsampler;
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
  const settled: Promise<void> = compiling.then(() => undefined, () => undefined);
  warmups.add(settled);
  void settled.then(() => {
    warmups.delete(settled);
    releaseCaptureTarget(target);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
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
  // A thumbnail shows the view, not the room the live view makes for a phone card.
  clearLiveViewOffset(copy);
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

/** A 320×200 JPEG of the current view (≤ 60,000 data-URL chars), via renderSceneToPixels, with `look` when given. */
export async function requestViewerThumbnail(look: CaptureLook | null = null): Promise<SavedViewThumbnail | null> {
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
      look,
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
