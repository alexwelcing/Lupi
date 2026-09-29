import * as THREE from 'three';
import {
  RENDER_FORMAT_RULES_V1,
  type RenderRasterFormatV1,
} from '@atlas/core';

export const LUPI_EXPORT_LAYER_KEY = 'lupiExportLayer';
export const LUPI_EXPORT_BACKGROUND_LAYER = 'background';

export type ImageCaptureTransactionOptions = {
  scene: THREE.Scene;
  /** The live camera. The capture renders with a copy; this one never moves. */
  camera: THREE.Camera;
  targetWidth: number;
  targetHeight: number;
  transparent: boolean;
  appliedCamera?: {
    position: readonly [number, number, number];
    target: readonly [number, number, number];
    fov: number;
    near: number;
    far: number;
  };
  appliedBackground?: {
    texture: THREE.Texture;
    fogColor: THREE.ColorRepresentation;
    fogDensity: number;
  };
};

export interface PreparedImageCaptureTransaction {
  /**
   * The camera the capture renders with: a copy of the live camera at the
   * target aspect, with the finalized artifact camera applied. Rendering
   * with a copy keeps the on-screen view (and OrbitControls) untouched.
   */
  readonly camera: THREE.Camera;
  /** Re-sync the capture camera from the live camera and the finalized camera (`lupi-canonical`). */
  applyCanonicalState(): void;
  /**
   * Run a synchronous render with the capture's scene state: backgrounds
   * suppressed for transparent output, or the finalized background for
   * opaque output. The live scene state is restored before this returns,
   * also when `render` throws, so the next default render never sees it.
   */
  withCaptureScene<T>(render: () => T): T;
  /** End the transaction. Idempotent; later apply/withCaptureScene calls throw. */
  restore(): void;
}

export interface FiberFrameCaptureBarrier {
  readonly requestedRevision: number;
  /** `lupi-canonical` applied the canonical state for this revision. */
  appliedRevision: number;
  /** `lupi-capture` started the warm-up (renderer.compileAsync). */
  warmupRevision: number;
  /** The warm-up finished. */
  warmedRevision: number;
  capturedRevision: number;
}

/**
 * A tiny explicit handshake across Fiber frame phases (no numeric
 * priorities). `lupi-canonical` applies the canonical camera after controls
 * and before uniform jobs. The first `lupi-capture` pass (after the default
 * render) kicks `renderer.compileAsync` for the capture, replacing v9's
 * owned warm-up frame. A later `lupi-capture` pass captures that revision
 * exactly once, after every uniform job has observed the canonical state.
 */
export function createFiberFrameCaptureBarrier(revision: number): FiberFrameCaptureBarrier {
  return {
    requestedRevision: revision,
    appliedRevision: 0,
    warmupRevision: 0,
    warmedRevision: 0,
    capturedRevision: 0,
  };
}

export function markFiberFrameCaptureApplied(
  barrier: FiberFrameCaptureBarrier,
  revision: number,
): void {
  if (revision === barrier.requestedRevision) barrier.appliedRevision = revision;
}

/** True once per revision, after it was applied: start the warm-up now. */
export function claimFiberFrameWarmup(
  barrier: FiberFrameCaptureBarrier,
  revision: number,
): boolean {
  if (
    revision !== barrier.requestedRevision
    || barrier.appliedRevision !== revision
    || barrier.warmupRevision === revision
  ) {
    return false;
  }
  barrier.warmupRevision = revision;
  return true;
}

/** The warm-up started for `revision` has finished (resolved or failed). */
export function markFiberFrameCaptureWarmed(
  barrier: FiberFrameCaptureBarrier,
  revision: number,
): void {
  if (revision === barrier.requestedRevision && barrier.warmupRevision === revision) {
    barrier.warmedRevision = revision;
  }
}

export function claimFiberFrameCapture(
  barrier: FiberFrameCaptureBarrier,
  revision: number,
): boolean {
  if (
    revision !== barrier.requestedRevision
    || barrier.appliedRevision !== revision
    || barrier.warmedRevision !== revision
    || barrier.capturedRevision === revision
  ) {
    return false;
  }
  barrier.capturedRevision = revision;
  return true;
}

/**
 * Apply the shared artifact contract's format/alpha rule at the browser seam.
 * In particular, JPEG must fail instead of silently flattening a request that
 * explicitly asked for transparency.
 */
export function assertBrowserImageExportIntent(
  format: RenderRasterFormatV1,
  transparent: boolean,
): void {
  const alphaMode = transparent ? 'transparent' : 'opaque';
  const supportedModes = RENDER_FORMAT_RULES_V1[format].alphaModes as readonly string[];
  if (!supportedModes.includes(alphaMode)) {
    throw new Error(
      `${format.toUpperCase()} export does not support transparent output. `
      + 'Choose PNG or WebP, or disable transparency.',
    );
  }
}

/**
 * Remove every background contribution from one synchronous image render.
 * Clearing only the renderer alpha is insufficient because Lupi can also draw
 * a scene background, fog, panorama mesh, or procedural background group.
 */
export function suppressBackgroundForTransparentCapture(scene: THREE.Scene): () => void {
  const originalBackground = scene.background;
  const originalFog = scene.fog;
  const hidden: THREE.Object3D[] = [];

  scene.background = null;
  scene.fog = null;
  scene.traverse((object) => {
    if (
      object.visible
      && object.userData?.[LUPI_EXPORT_LAYER_KEY] === LUPI_EXPORT_BACKGROUND_LAYER
    ) {
      object.visible = false;
      hidden.push(object);
    }
  });

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    scene.background = originalBackground;
    scene.fog = originalFog;
    for (const object of hidden) object.visible = true;
  };
}

/**
 * Replace the live background with the finalized artifact-spec background for
 * one opaque capture. This prevents a just-issued background change from being
 * identified as the new spec while stale React/texture state supplies pixels.
 */
export function applyBackgroundForOpaqueCapture(
  scene: THREE.Scene,
  texture: THREE.Texture,
  fogColor: THREE.ColorRepresentation,
  fogDensity: number,
): () => void {
  const originalBackground = scene.background;
  const originalFog = scene.fog;
  const hidden: THREE.Object3D[] = [];

  scene.traverse((object) => {
    if (
      object.visible
      && object.userData?.[LUPI_EXPORT_LAYER_KEY] === LUPI_EXPORT_BACKGROUND_LAYER
    ) {
      object.visible = false;
      hidden.push(object);
    }
  });
  scene.background = texture;
  scene.fog = new THREE.FogExp2(fogColor, fogDensity);

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    scene.background = originalBackground;
    scene.fog = originalFog;
    for (const object of hidden) object.visible = true;
  };
}

/**
 * Stage an image capture. Nothing on the renderer, the live camera or the
 * scene changes until `withCaptureScene`, and that restores synchronously:
 * captures render into their own target (renderTargetReadback), so the
 * canvas keeps its size and the on-screen view never flickers.
 */
export function beginImageCaptureTransaction(
  {
    scene,
    camera,
    targetWidth,
    targetHeight,
    transparent,
    appliedCamera,
    appliedBackground,
  }: ImageCaptureTransactionOptions,
): PreparedImageCaptureTransaction {
  // A bare instance of the live camera's class; syncCaptureCamera copies it
  // without children.
  const captureCamera = new (camera.constructor as new () => THREE.Camera)();
  const targetAspect = targetWidth / targetHeight;
  let restored = false;

  const applyCanonicalState = () => {
    if (restored) {
      throw new Error('Cannot apply a restored image capture transaction.');
    }
    syncCaptureCamera(captureCamera, camera, targetAspect, appliedCamera);
  };

  applyCanonicalState();

  return {
    camera: captureCamera,
    applyCanonicalState,
    withCaptureScene<T>(render: () => T): T {
      if (restored) throw new Error('Cannot render a restored image capture transaction.');
      const restoreBackground = transparent
        ? suppressBackgroundForTransparentCapture(scene)
        : appliedBackground
          ? applyBackgroundForOpaqueCapture(
            scene,
            appliedBackground.texture,
            appliedBackground.fogColor,
            appliedBackground.fogDensity,
          )
          : () => {};
      try {
        return render();
      } finally {
        restoreBackground();
      }
    },
    restore() {
      restored = true;
    },
  };
}

/**
 * Copy the live camera (world transform, projection) into `target` for a
 * capture of `aspect`, then apply the finalized artifact camera. A
 * perspective camera keeps its vertical field of view, as the v9 export did.
 */
function syncCaptureCamera(
  target: THREE.Camera,
  live: THREE.Camera,
  aspect: number,
  appliedCamera: ImageCaptureTransactionOptions['appliedCamera'],
): void {
  target.copy(live, false);
  // Captures are always level: whatever a live toy did to `up`, the artifact
  // camera looks at its target with world +Y up.
  target.up.set(0, 1, 0);
  live.updateMatrixWorld();
  live.matrixWorld.decompose(target.position, target.quaternion, target.scale);
  if (target instanceof THREE.PerspectiveCamera) {
    target.aspect = aspect;
    if (appliedCamera) {
      target.fov = appliedCamera.fov;
      target.near = appliedCamera.near;
      target.far = appliedCamera.far;
    }
    target.updateProjectionMatrix();
  } else if (target instanceof THREE.OrthographicCamera) {
    const centerX = (target.left + target.right) / 2;
    const halfHeight = (target.top - target.bottom) / 2;
    target.left = centerX - halfHeight * aspect;
    target.right = centerX + halfHeight * aspect;
    target.updateProjectionMatrix();
  }
  if (appliedCamera) {
    target.position.fromArray(appliedCamera.position);
    target.lookAt(new THREE.Vector3().fromArray(appliedCamera.target));
  }
  target.updateMatrixWorld(true);
}

/**
 * Draw the export-visible orientation indicator into the captured raster.
 * The on-screen gizmo is a DOM/SVG overlay (AxesGizmo), which a render of
 * the scene cannot capture. Reconstructing the small axis projection here
 * keeps the artifact contract honest and deterministic.
 */
export function drawExportAxesOverlayV1(
  context: CanvasRenderingContext2D,
  camera: THREE.Camera,
  width: number,
  height: number,
): void {
  const radius = Math.max(18, Math.min(42, Math.min(width, height) * 0.11));
  const margin = radius + 18;
  const originX = Math.min(margin, width - radius - 4);
  const originY = Math.max(radius + 4, height - margin);
  const inverseCamera = camera.quaternion.clone().invert();
  const axes = [
    { label: 'X', color: '#ff4060', direction: new THREE.Vector3(1, 0, 0) },
    { label: 'Y', color: '#40ff80', direction: new THREE.Vector3(0, 1, 0) },
    { label: 'Z', color: '#4080ff', direction: new THREE.Vector3(0, 0, 1) },
  ].map((axis) => ({
    ...axis,
    projected: axis.direction.applyQuaternion(inverseCamera),
  })).sort((left, right) => left.projected.z - right.projected.z);

  context.save();
  context.beginPath();
  context.arc(originX, originY, radius + 7, 0, Math.PI * 2);
  context.fillStyle = 'rgba(8, 13, 24, 0.68)';
  context.fill();

  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `700 ${Math.max(10, Math.round(radius * 0.34))}px ui-sans-serif, sans-serif`;

  for (const axis of axes) {
    const endX = originX + axis.projected.x * radius;
    const endY = originY - axis.projected.y * radius;
    context.beginPath();
    context.moveTo(originX, originY);
    context.lineTo(endX, endY);
    context.strokeStyle = axis.color;
    context.lineWidth = Math.max(2, radius * 0.08);
    context.stroke();
    context.beginPath();
    context.arc(endX, endY, Math.max(3, radius * 0.12), 0, Math.PI * 2);
    context.fillStyle = axis.color;
    context.fill();
    context.fillStyle = '#ffffff';
    context.fillText(axis.label, endX, endY);
  }

  context.restore();
}

/** Run an async encoder callback without allowing delivery errors to strand the store request. */
export function completeImageCaptureCallback(
  deliver: () => void,
  cleanup: () => void,
  reportError: (error: unknown) => void,
): void {
  try {
    deliver();
  } catch (error) {
    reportError(error);
  } finally {
    cleanup();
  }
}
