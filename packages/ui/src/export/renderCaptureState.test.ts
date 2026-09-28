import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  LUPI_EXPORT_BACKGROUND_LAYER,
  LUPI_EXPORT_LAYER_KEY,
  applyBackgroundForOpaqueCapture,
  assertBrowserImageExportIntent,
  beginImageCaptureTransaction,
  claimFiberFrameCapture,
  claimFiberFrameWarmup,
  completeImageCaptureCallback,
  createFiberFrameCaptureBarrier,
  markFiberFrameCaptureApplied,
  markFiberFrameCaptureWarmed,
  suppressBackgroundForTransparentCapture,
} from './renderCaptureState';

describe('browser image export intent', () => {
  it('uses the shared format contract to reject transparent JPEG', () => {
    expect(() => assertBrowserImageExportIntent('jpeg', true)).toThrow(
      /JPEG export does not support transparent output/,
    );
    expect(() => assertBrowserImageExportIntent('jpeg', false)).not.toThrow();
    expect(() => assertBrowserImageExportIntent('png', true)).not.toThrow();
    expect(() => assertBrowserImageExportIntent('webp', true)).not.toThrow();
  });
});

describe('Fiber image capture revision barrier', () => {
  it('captures exactly once, only after the revision was applied and its warm-up finished', () => {
    const barrier = createFiberFrameCaptureBarrier(7);

    expect(claimFiberFrameCapture(barrier, 7)).toBe(false);
    markFiberFrameCaptureApplied(barrier, 6);
    expect(claimFiberFrameWarmup(barrier, 7)).toBe(false);
    expect(claimFiberFrameCapture(barrier, 7)).toBe(false);

    markFiberFrameCaptureApplied(barrier, 7);
    expect(claimFiberFrameCapture(barrier, 7)).toBe(false);
    markFiberFrameCaptureWarmed(barrier, 7); // no warm-up started yet: ignored
    expect(claimFiberFrameCapture(barrier, 7)).toBe(false);
    expect(claimFiberFrameWarmup(barrier, 7)).toBe(true);
    expect(claimFiberFrameWarmup(barrier, 7)).toBe(false);
    expect(claimFiberFrameCapture(barrier, 7)).toBe(false); // warm-up still pending
    markFiberFrameCaptureWarmed(barrier, 7);
    expect(claimFiberFrameCapture(barrier, 7)).toBe(true);
    expect(claimFiberFrameCapture(barrier, 7)).toBe(false);
  });
});

describe('transparent capture scene state', () => {
  it('suppresses opted-in backgrounds and restores exact scene state', () => {
    const scene = new THREE.Scene();
    const background = new THREE.Color('#102030');
    const fog = new THREE.Fog('#102030', 1, 10);
    scene.background = background;
    scene.fog = fog;

    const visibleBackground = new THREE.Group();
    visibleBackground.userData[LUPI_EXPORT_LAYER_KEY] = LUPI_EXPORT_BACKGROUND_LAYER;
    const alreadyHiddenBackground = new THREE.Group();
    alreadyHiddenBackground.userData[LUPI_EXPORT_LAYER_KEY] = LUPI_EXPORT_BACKGROUND_LAYER;
    alreadyHiddenBackground.visible = false;
    const molecule = new THREE.Mesh();
    scene.add(visibleBackground, alreadyHiddenBackground, molecule);

    const restore = suppressBackgroundForTransparentCapture(scene);

    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
    expect(visibleBackground.visible).toBe(false);
    expect(alreadyHiddenBackground.visible).toBe(false);
    expect(molecule.visible).toBe(true);

    restore();
    restore();

    expect(scene.background).toBe(background);
    expect(scene.fog).toBe(fog);
    expect(visibleBackground.visible).toBe(true);
    expect(alreadyHiddenBackground.visible).toBe(false);
    expect(molecule.visible).toBe(true);
  });

  it('renders with a camera copy at the target aspect and never moves the live camera', () => {
    const live = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 1000);
    live.position.set(1, 2, 3);
    live.lookAt(0, 0, 0);
    live.updateMatrixWorld(true);
    const livePosition = live.position.clone();
    const liveQuaternion = live.quaternion.clone();

    const transaction = beginImageCaptureTransaction({
      scene: new THREE.Scene(),
      camera: live,
      targetWidth: 1920,
      targetHeight: 1080,
      transparent: false,
      appliedCamera: { position: [8, 9, 10], target: [0, 0, 0], fov: 42, near: 0.025, far: 25_000 },
    });
    const capture = transaction.camera as THREE.PerspectiveCamera;

    expect(capture).not.toBe(live);
    expect(capture.aspect).toBe(1920 / 1080);
    expect([capture.fov, capture.near, capture.far]).toEqual([42, 0.025, 25_000]);
    expect(capture.position.toArray()).toEqual([8, 9, 10]);
    expect(live.aspect).toBe(4 / 3);
    expect([live.fov, live.near, live.far]).toEqual([50, 0.1, 1000]);
    expect(live.position.equals(livePosition)).toBe(true);
    expect(live.quaternion.equals(liveQuaternion)).toBe(true);

    // Without a finalized camera the copy follows the live camera (for
    // example after OrbitControls moved it) at the target aspect.
    const follow = beginImageCaptureTransaction({
      scene: new THREE.Scene(),
      camera: live,
      targetWidth: 100,
      targetHeight: 60,
      transparent: false,
    });
    live.position.set(4, 5, 6);
    follow.applyCanonicalState();
    const followed = follow.camera as THREE.PerspectiveCamera;
    expect(followed.position.toArray()).toEqual([4, 5, 6]);
    expect(followed.aspect).toBeCloseTo(100 / 60, 12);
    expect(followed.fov).toBe(50);
    follow.restore();
    expect(() => follow.applyCanonicalState()).toThrow(/restored/);
    expect(() => follow.withCaptureScene(() => undefined)).toThrow(/restored/);
  });

  it('suppresses backgrounds only inside a transparent capture render, also when it throws', () => {
    const scene = new THREE.Scene();
    const originalBackground = new THREE.Color('#102030');
    const originalFog = new THREE.Fog('#102030', 1, 10);
    scene.background = originalBackground;
    scene.fog = originalFog;
    const backdrop = new THREE.Group();
    backdrop.userData[LUPI_EXPORT_LAYER_KEY] = LUPI_EXPORT_BACKGROUND_LAYER;
    scene.add(backdrop);

    const transaction = beginImageCaptureTransaction({
      scene,
      camera: new THREE.PerspectiveCamera(),
      targetWidth: 320,
      targetHeight: 240,
      transparent: true,
    });
    expect(scene.background).toBe(originalBackground);

    const seen = transaction.withCaptureScene(() => ({
      background: scene.background,
      fog: scene.fog,
      backdropVisible: backdrop.visible,
    }));
    expect(seen).toEqual({ background: null, fog: null, backdropVisible: false });
    expect(scene.background).toBe(originalBackground);
    expect(scene.fog).toBe(originalFog);
    expect(backdrop.visible).toBe(true);

    expect(() => transaction.withCaptureScene(() => {
      throw new Error('capture failed');
    })).toThrow('capture failed');
    expect(scene.background).toBe(originalBackground);
    expect(scene.fog).toBe(originalFog);
    expect(backdrop.visible).toBe(true);
  });

  it('keeps the live background for an opaque capture without a finalized one', () => {
    const scene = new THREE.Scene();
    const background = new THREE.Color('#101817');
    scene.background = background;
    const transaction = beginImageCaptureTransaction({
      scene,
      camera: new THREE.PerspectiveCamera(),
      targetWidth: 64,
      targetHeight: 64,
      transparent: false,
    });
    expect(transaction.withCaptureScene(() => scene.background)).toBe(background);
  });

  it('applies the finalized opaque background and restores stale live state', () => {
    const scene = new THREE.Scene();
    const staleBackground = new THREE.Color('#10131a');
    const staleFog = new THREE.Fog('#10131a', 1, 10);
    const finalizedBackground = new THREE.Texture();
    scene.background = staleBackground;
    scene.fog = staleFog;

    const staleBackdrop = new THREE.Group();
    staleBackdrop.userData[LUPI_EXPORT_LAYER_KEY] = LUPI_EXPORT_BACKGROUND_LAYER;
    scene.add(staleBackdrop);

    const restore = applyBackgroundForOpaqueCapture(
      scene,
      finalizedBackground,
      '#ffffff',
      0.0015,
    );

    expect(scene.background).toBe(finalizedBackground);
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2);
    expect((scene.fog as THREE.FogExp2).color.getHexString()).toBe('ffffff');
    expect((scene.fog as THREE.FogExp2).density).toBe(0.0015);
    expect(staleBackdrop.visible).toBe(false);

    restore();
    expect(scene.background).toBe(staleBackground);
    expect(scene.fog).toBe(staleFog);
    expect(staleBackdrop.visible).toBe(true);
  });

  it('always cleans up after an asynchronous delivery callback throws', () => {
    const deliveryError = new Error('consumer failed');
    const cleanup = vi.fn();
    const reportError = vi.fn();

    completeImageCaptureCallback(
      () => { throw deliveryError; },
      cleanup,
      reportError,
    );

    expect(reportError).toHaveBeenCalledWith(deliveryError);
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
