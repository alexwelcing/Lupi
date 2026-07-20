import * as THREE from 'three';
import {
  RENDER_FORMAT_RULES_V1,
  type RenderRasterFormatV1,
} from '@atlas/core';

export const LUPI_EXPORT_LAYER_KEY = 'lupiExportLayer';
export const LUPI_EXPORT_BACKGROUND_LAYER = 'background';

type ImageCaptureRenderer<TRenderTarget> = {
  getPixelRatio(): number;
  setPixelRatio(value: number): void;
  getClearColor(target: THREE.Color): THREE.Color;
  getClearAlpha(): number;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  getRenderTarget(): TRenderTarget | null;
  setRenderTarget(target: TRenderTarget | null): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  getViewport(target: THREE.Vector4): THREE.Vector4;
  setViewport(x: number | THREE.Vector4, y?: number, width?: number, height?: number): void;
  getScissor(target: THREE.Vector4): THREE.Vector4;
  setScissor(x: number | THREE.Vector4, y?: number, width?: number, height?: number): void;
  getScissorTest(): boolean;
  setScissorTest(enabled: boolean): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
};

export type ImageCaptureTransactionOptions<TRenderTarget> = {
  renderer: ImageCaptureRenderer<TRenderTarget>;
  scene: THREE.Scene;
  camera: THREE.Camera;
  viewportWidth: number;
  viewportHeight: number;
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
  /** Re-assert the finalized camera/renderer state inside a Fiber frame. */
  applyCanonicalState(): void;
  /** Select and clear the default framebuffer immediately before readback. */
  clear(): void;
  /** Restore the exact live renderer, camera, and scene state. Idempotent. */
  restore(): void;
}

export interface FiberFrameCaptureBarrier {
  readonly requestedRevision: number;
  appliedRevision: number;
  warmedRevision: number;
  capturedRevision: number;
}

/**
 * A tiny explicit handshake between the early and late phases of one Fiber
 * frame. The early phase applies the canonical camera. The first late phase
 * renders one owned warm-up frame so newly committed ShaderMaterial programs
 * and DataTextures reach WebGL. A later Fiber frame may then capture that
 * revision once, after the scene's ordinary `useFrame` hooks have synchronized
 * camera-space uniforms again.
 */
export function createFiberFrameCaptureBarrier(revision: number): FiberFrameCaptureBarrier {
  return {
    requestedRevision: revision,
    appliedRevision: 0,
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

export function claimFiberFrameWarmup(
  barrier: FiberFrameCaptureBarrier,
  revision: number,
): boolean {
  if (
    revision !== barrier.requestedRevision
    || barrier.appliedRevision !== revision
    || barrier.warmedRevision === revision
  ) {
    return false;
  }
  barrier.warmedRevision = revision;
  return true;
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
 * Stage an image capture without rendering it. Keeping the transaction open
 * lets ExportManager cross a real Fiber frame: camera controllers run first,
 * the canonical camera is re-applied, and camera-dependent `useFrame` uniforms
 * update before the final render/readback callback.
 */
export function beginImageCaptureTransaction<TRenderTarget>(
  {
    renderer,
    scene,
    camera,
    viewportWidth,
    viewportHeight,
    targetWidth,
    targetHeight,
    transparent,
    appliedCamera,
    appliedBackground,
  }: ImageCaptureTransactionOptions<TRenderTarget>,
): PreparedImageCaptureTransaction {
  const originalAspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : null;
  const originalPosition = camera.position.clone();
  const originalQuaternion = camera.quaternion.clone();
  const originalFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : null;
  const originalNear = camera instanceof THREE.PerspectiveCamera ? camera.near : null;
  const originalFar = camera instanceof THREE.PerspectiveCamera ? camera.far : null;
  const originalPixelRatio = renderer.getPixelRatio();
  const originalClearColor = new THREE.Color();
  renderer.getClearColor(originalClearColor);
  const originalClearAlpha = renderer.getClearAlpha();
  const originalRenderTarget = renderer.getRenderTarget();
  const originalViewport = renderer.getViewport(new THREE.Vector4()).clone();
  const originalScissor = renderer.getScissor(new THREE.Vector4()).clone();
  const originalScissorTest = renderer.getScissorTest();
  let restoreBackground = () => {};
  let restored = false;
  let appliedBackgroundState: THREE.Scene['background'] = scene.background;
  let appliedFogState: THREE.Scene['fog'] = scene.fog;

  const applyCanonicalState = () => {
    if (restored) {
      throw new Error('Cannot apply a restored image capture transaction.');
    }
    renderer.setPixelRatio(1);
    renderer.setSize(targetWidth, targetHeight, false);
    renderer.setViewport(0, 0, targetWidth, targetHeight);
    renderer.setScissor(0, 0, targetWidth, targetHeight);
    renderer.setScissorTest(false);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = targetWidth / targetHeight;
      if (appliedCamera) {
        camera.fov = appliedCamera.fov;
        camera.near = appliedCamera.near;
        camera.far = appliedCamera.far;
      }
      camera.updateProjectionMatrix();
    }
    if (appliedCamera) {
      camera.position.fromArray(appliedCamera.position);
      camera.lookAt(new THREE.Vector3().fromArray(appliedCamera.target));
      camera.updateMatrixWorld(true);
    }

    scene.background = appliedBackgroundState;
    scene.fog = appliedFogState;
    if (transparent) {
      restoreBackground = suppressBackgroundForTransparentCapture(scene);
      renderer.setClearColor(0x000000, 0);
    } else {
      if (appliedBackground) {
        restoreBackground = applyBackgroundForOpaqueCapture(
          scene,
          appliedBackground.texture,
          appliedBackground.fogColor,
          appliedBackground.fogDensity,
        );
      }
      renderer.setClearColor(new THREE.Color('#10131a'), 1);
    }

    appliedBackgroundState = scene.background;
    appliedFogState = scene.fog;

    renderer.setRenderTarget(null);
  };

  // Apply once during layout so the next invalidated Fiber frame starts from
  // the requested viewport/background. The early frame callback re-applies the
  // same canonical state after OrbitControls and before camera-space uniforms.
  applyCanonicalState();

  return {
    applyCanonicalState() {
      // Background suppression must only capture restore state once. Re-assert
      // the already-created canonical scene state without nesting restorers.
      if (restored) {
        throw new Error('Cannot apply a restored image capture transaction.');
      }
      renderer.setPixelRatio(1);
      renderer.setSize(targetWidth, targetHeight, false);
      renderer.setViewport(0, 0, targetWidth, targetHeight);
      renderer.setScissor(0, 0, targetWidth, targetHeight);
      renderer.setScissorTest(false);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = targetWidth / targetHeight;
        if (appliedCamera) {
          camera.fov = appliedCamera.fov;
          camera.near = appliedCamera.near;
          camera.far = appliedCamera.far;
        }
        camera.updateProjectionMatrix();
      }
      if (appliedCamera) {
        camera.position.fromArray(appliedCamera.position);
        camera.lookAt(new THREE.Vector3().fromArray(appliedCamera.target));
        camera.updateMatrixWorld(true);
      }
      scene.background = appliedBackgroundState;
      scene.fog = appliedFogState;
      renderer.setClearColor(transparent ? 0x000000 : new THREE.Color('#10131a'), transparent ? 0 : 1);
      renderer.setRenderTarget(null);
    },
    clear() {
      if (restored) throw new Error('Cannot clear a restored image capture transaction.');

      renderer.setRenderTarget(null);
      // EffectComposer deliberately leaves WebGLRenderer.autoClear disabled.
      // An explicit clear makes artifact alpha independent of ambient state.
      renderer.clear(true, true, true);
    },
    restore() {
      if (restored) return;
      restored = true;
      restoreBackground();
      renderer.setRenderTarget(originalRenderTarget);
      // Restore the logical viewport while capture DPR=1 is still active.
      // Three's setPixelRatio() internally reapplies the current logical size;
      // doing it first would transiently allocate the export-sized framebuffer
      // (for example 4096x4096) at the live high-DPR setting.
      renderer.setSize(viewportWidth, viewportHeight, false);
      renderer.setPixelRatio(originalPixelRatio);
      renderer.setViewport(originalViewport);
      renderer.setScissor(originalScissor);
      renderer.setScissorTest(originalScissorTest);
      if (camera instanceof THREE.PerspectiveCamera && originalAspect !== null) {
        camera.aspect = originalAspect;
        if (originalFov !== null) camera.fov = originalFov;
        if (originalNear !== null) camera.near = originalNear;
        if (originalFar !== null) camera.far = originalFar;
        camera.updateProjectionMatrix();
      }
      camera.position.copy(originalPosition);
      camera.quaternion.copy(originalQuaternion);
      camera.updateMatrixWorld(true);
      renderer.setClearColor(originalClearColor, originalClearAlpha);
    },
  };
}

/**
 * Synchronous compatibility wrapper used by focused state tests and any
 * non-Fiber caller. Fiber image export uses beginImageCaptureTransaction.
 */
export function runImageCaptureTransaction<TRenderTarget, TResult>(
  options: ImageCaptureTransactionOptions<TRenderTarget>,
  capture: () => TResult,
): TResult {
  const transaction = beginImageCaptureTransaction(options);
  try {
    transaction.clear();
    return capture();
  } finally {
    transaction.restore();
  }
}

/**
 * Draw the export-visible orientation indicator into the captured raster.
 * Drei's GizmoHelper is a separate HUD portal/useFrame pass, so a direct
 * `gl.render(scene, camera)` cannot capture it. Reconstructing the small axis
 * projection here keeps the artifact contract honest and deterministic.
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
