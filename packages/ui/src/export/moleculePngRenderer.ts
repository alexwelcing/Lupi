/**
 * moleculePngRenderer — molecule-only, transparent, print-on-demand PNG.
 *
 * The live viewer's transparent screenshot still bakes in the scene
 * background, the environment dome, and ground shadows, so it is not a clean
 * cutout. This renderer instead reuses the *exact* export scene the GLB/USDZ
 * path builds (real instanced spheres + bond cylinders, no background, no UI),
 * drops it into a dedicated offscreen WebGLRenderer, frames the camera tight
 * to the molecule's bounding sphere, and reads back a straight-alpha PNG at
 * print resolution.
 *
 * Print-on-demand requirements this satisfies:
 *   • Only the molecule — transparent everywhere else (clear alpha 0).
 *   • Clean anti-aliased edges — supersampled render + `premultipliedAlpha:
 *     false` so the cutout has no dark halo when composited on a shirt/poster.
 *   • High resolution — square print sizes at ~300 DPI.
 *   • Tight, centered framing — auto-fit to the molecule so nothing is clipped
 *     and there is no wasted transparent margin to trim.
 *
 * No React / no store: pure `(frame, style, framing) → PNG blob`, so it runs
 * from the live viewer (ExportManager), the MCP bridge, and a headless browser
 * identically.
 */

import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import {
  buildExportScene,
  disposeExportScene,
  type ExportProgress,
} from './exportSceneBuilder';
import type { ExportStyle } from './exportStyle';

/** Canonical three-quarter "hero" view used when no camera angle is supplied. */
export const DEFAULT_ISO_VIEW_DIRECTION: [number, number, number] = [1, 0.82, 1];

/** Hard ceiling on the offscreen drawing-buffer edge. 8192 is the safe max
 *  texture/renderbuffer size across desktop GPUs and the SwiftShader software
 *  rasterizer used in headless CI, so large targets fall to less supersample
 *  rather than failing to allocate. */
const MAX_RENDER_DIM = 8192;

export interface MoleculePngFraming {
  /** Output width in pixels (the final PNG). */
  width: number;
  /** Output height in pixels (the final PNG). */
  height: number;
  /** Transparent background (default true). When false, `background` fills it. */
  transparent?: boolean;
  /** Opaque background color, used only when `transparent` is false. */
  background?: string;
  /** Unit-ish view direction (camera → looks back at molecule). Auto-normalized.
   *  Defaults to the iso hero angle. */
  viewDirection?: [number, number, number];
  /** Perspective (default) or flat orthographic "sticker" projection. */
  projection?: 'perspective' | 'orthographic';
  /** Perspective vertical FOV in degrees (default 33 — a gentle, low-distortion lens). */
  fov?: number;
  /** Fraction of extra padding around the molecule's bounding sphere (default 0.06). */
  margin?: number;
  /** Supersample factor for edge quality (default 2). Clamped so the render
   *  buffer never exceeds MAX_RENDER_DIM. */
  supersample?: number;
  onProgress?: ExportProgress;
}

export interface MoleculePngResult {
  blob: Blob;
  width: number;
  height: number;
  atomCount: number;
  bondCount: number;
  bondsCapped: boolean;
  /** The render-buffer edge actually used (post supersample + clamp). */
  renderWidth: number;
  renderHeight: number;
}

/** Bounding sphere of the *visible* atoms, inflated by each atom's draw radius
 *  so the sphere fully contains the rendered geometry (no clipped edges). */
export function computeMoleculeViewBounds(
  frame: Pick<Frame, 'natoms' | 'positions' | 'types'>,
  style: Pick<ExportStyle, 'displayRadiusForType' | 'hiddenTypes'>,
): { center: [number, number, number]; radius: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let visible = 0;

  for (let i = 0; i < frame.natoms; i++) {
    const type = frame.types[i];
    if (style.hiddenTypes?.has(type)) continue;
    const r = style.displayRadiusForType(type);
    const x = frame.positions[i * 3];
    const y = frame.positions[i * 3 + 1];
    const z = frame.positions[i * 3 + 2];
    if (x - r < minX) minX = x - r;
    if (x + r > maxX) maxX = x + r;
    if (y - r < minY) minY = y - r;
    if (y + r > maxY) maxY = y + r;
    if (z - r < minZ) minZ = z - r;
    if (z + r > maxZ) maxZ = z + r;
    visible++;
  }

  if (visible === 0) return { center: [0, 0, 0], radius: 1 };

  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];

  // Exact enclosing-sphere radius: farthest atom surface from the box center.
  let radius = 0;
  for (let i = 0; i < frame.natoms; i++) {
    const type = frame.types[i];
    if (style.hiddenTypes?.has(type)) continue;
    const dx = frame.positions[i * 3] - center[0];
    const dy = frame.positions[i * 3 + 1] - center[1];
    const dz = frame.positions[i * 3 + 2] - center[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + style.displayRadiusForType(type);
    if (d > radius) radius = d;
  }

  return { center, radius: Math.max(radius, 1e-3) };
}

/** Normalize (cameraPosition − target) into a view direction, falling back to
 *  the iso hero angle when the two points coincide. */
export function deriveViewDirection(
  position: [number, number, number],
  target: [number, number, number],
): [number, number, number] {
  const dx = position[0] - target[0];
  const dy = position[1] - target[1];
  const dz = position[2] - target[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(len) || len < 1e-6) return [...DEFAULT_ISO_VIEW_DIRECTION];
  return [dx / len, dy / len, dz / len];
}

/** Studio three-point rig anchored to the *view* basis so shading looks the
 *  same from any angle the caller frames. Every light targets the origin,
 *  where the export scene is centered. */
function addStudioLights(scene: THREE.Scene, camDir: THREE.Vector3, dist: number): void {
  const up = Math.abs(camDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, camDir).normalize();
  const camUp = new THREE.Vector3().crossVectors(camDir, right).normalize();

  const place = (fwd: number, u: number, r: number) =>
    camDir.clone().multiplyScalar(fwd)
      .addScaledVector(camUp, u)
      .addScaledVector(right, r)
      .multiplyScalar(dist);

  // Intensities kept modest so bright (white carbon/hydrogen) atoms keep their
  // sphere shading gradient instead of clipping to a flat white blob — the
  // image-based lighting already supplies most of the fill.
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.copy(place(0.6, 0.9, -0.8));
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.copy(place(0.7, -0.3, 0.9));
  const rim = new THREE.DirectionalLight(0xffffff, 0.75);
  rim.position.copy(place(-0.8, 0.5, 0.2));
  const hemi = new THREE.HemisphereLight(0xe6ecf5, 0x1c2028, 0.45);

  scene.add(key, fill, rim, hemi);
}

/**
 * Render the molecule described by `frame` + `style` to a transparent PNG.
 * Builds a fresh offscreen WebGL context, renders once, reads back, and tears
 * everything down — safe to call ad hoc alongside the live viewer.
 */
export async function renderMoleculePngBlob(
  frame: Frame,
  style: ExportStyle,
  framing: MoleculePngFraming,
): Promise<MoleculePngResult> {
  if (typeof document === 'undefined') {
    throw new Error('renderMoleculePngBlob requires a DOM/WebGL environment.');
  }

  const width = Math.max(1, Math.round(framing.width));
  const height = Math.max(1, Math.round(framing.height));
  const transparent = framing.transparent ?? true;
  const margin = framing.margin ?? 0.06;
  const projection = framing.projection ?? 'perspective';
  const fov = framing.fov ?? 33;

  // Clamp supersample so the render buffer stays within GPU limits.
  const requestedSsaa = Math.max(1, framing.supersample ?? 2);
  const maxSsaa = Math.max(1, Math.floor(MAX_RENDER_DIM / Math.max(width, height)));
  const ssaa = Math.min(requestedSsaa, maxSsaa || 1);
  const renderWidth = Math.max(1, Math.round(width * ssaa));
  const renderHeight = Math.max(1, Math.round(height * ssaa));

  const bounds = computeMoleculeViewBounds(frame, style);

  // Molecule-only scene — identical geometry to the GLB export, centered at
  // the origin (center subtracted, no AR rescale).
  const built = await buildExportScene(frame, {
    format: 'glb',
    hiddenTypes: style.hiddenTypes,
    displayRadiusForType: style.displayRadiusForType,
    resolveAtomColor: style.resolveAtomColor,
    materialPreset: style.materialPreset,
    surfacePolish: style.surfacePolish,
    surfaceRoughness: style.surfaceRoughness,
    showBonds: style.showBonds,
    bondTolerance: style.bondTolerance,
    covalentRadii: style.covalentRadii,
    center: bounds.center,
    arScale: 1,
    onProgress: framing.onProgress,
  });
  const scene = built.scene;

  const canvas = document.createElement('canvas');
  canvas.width = renderWidth;
  canvas.height = renderHeight;

  let renderer: THREE.WebGLRenderer | null = null;
  let envRenderTarget: THREE.WebGLRenderTarget | null = null;
  let pmrem: THREE.PMREMGenerator | null = null;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      // Straight (non-premultiplied) alpha → clean cutout edges with no dark
      // fringe when the PNG is composited onto a light print surface.
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(renderWidth, renderHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral tone mapping keeps atom colors close to their true hues (truer
    // than ACES for a product asset) while still taming metallic highlights.
    renderer.toneMapping = (THREE as unknown as { NeutralToneMapping?: THREE.ToneMapping })
      .NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;

    if (transparent) {
      renderer.setClearColor(0x000000, 0);
    } else {
      renderer.setClearColor(new THREE.Color(framing.background ?? '#0b0e14'), 1);
    }

    // Image-based lighting for believable PBR shading. Optional — a plain
    // three-point rig already lights the scene, so a failed env import is not
    // fatal.
    try {
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new RoomEnvironment();
      envRenderTarget = pmrem.fromScene(envScene as unknown as THREE.Scene, 0.04);
      scene.environment = envRenderTarget.texture;
      // Dial the IBL back so it lifts the shadows without washing out bright
      // atoms — the analytic rig carries the key light and form.
      scene.traverse((obj) => {
        const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat && 'envMapIntensity' in mat) mat.envMapIntensity = 0.65;
      });
    } catch {
      // Fall back to the analytic lights only.
    }

    const dirVec = new THREE.Vector3(
      ...(framing.viewDirection ?? DEFAULT_ISO_VIEW_DIRECTION),
    );
    if (dirVec.lengthSq() < 1e-9) dirVec.set(...DEFAULT_ISO_VIEW_DIRECTION);
    dirVec.normalize();

    const aspect = width / height;
    const paddedRadius = bounds.radius * (1 + margin);

    let camera: THREE.Camera;
    let dist: number;
    if (projection === 'orthographic') {
      // Any distance beyond the sphere works for ortho; scale comes from the frustum.
      dist = paddedRadius * 4;
      let halfW: number;
      let halfH: number;
      if (aspect >= 1) {
        halfH = paddedRadius;
        halfW = paddedRadius * aspect;
      } else {
        halfW = paddedRadius;
        halfH = paddedRadius / aspect;
      }
      camera = new THREE.OrthographicCamera(
        -halfW, halfW, halfH, -halfH,
        0.01, dist + paddedRadius * 4,
      );
    } else {
      const halfV = (fov * Math.PI) / 180 / 2;
      const halfH = Math.atan(Math.tan(halfV) * aspect);
      const halfFit = Math.min(halfV, halfH);
      dist = paddedRadius / Math.sin(halfFit);
      camera = new THREE.PerspectiveCamera(
        fov, aspect,
        Math.max(dist - paddedRadius * 2, dist * 0.01),
        dist + paddedRadius * 4,
      );
    }
    camera.position.copy(dirVec.clone().multiplyScalar(dist));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
      camera.updateProjectionMatrix();
    }

    addStudioLights(scene, dirVec, dist);

    renderer.render(scene, camera);

    // Supersample down to the target with high-quality smoothing. Straight
    // alpha is preserved through the 2D canvas, then PNG-encoded.
    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire a 2D context for PNG downsample.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      outCanvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) throw new Error('PNG encoding returned an empty blob.');

    framing.onProgress?.('encode', 1, 1);

    return {
      blob,
      width,
      height,
      atomCount: built.atomCount,
      bondCount: built.bondCount,
      bondsCapped: built.bondsCapped,
      renderWidth,
      renderHeight,
    };
  } finally {
    scene.environment = null;
    envRenderTarget?.dispose();
    pmrem?.dispose();
    disposeExportScene(scene);
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}

/** Read a PNG blob as a base64 `data:` URL (used by the API/MCP path). */
export function blobToPngDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read PNG blob.'));
    reader.readAsDataURL(blob);
  });
}
