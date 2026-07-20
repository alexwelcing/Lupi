import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  LUPI_EXPORT_BACKGROUND_LAYER,
  LUPI_EXPORT_LAYER_KEY,
  applyBackgroundForOpaqueCapture,
  assertBrowserImageExportIntent,
  claimFiberFrameCapture,
  claimFiberFrameWarmup,
  completeImageCaptureCallback,
  createFiberFrameCaptureBarrier,
  markFiberFrameCaptureApplied,
  runImageCaptureTransaction,
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
  it('captures exactly once and only after the requested revision was applied and warmed', () => {
    const barrier = createFiberFrameCaptureBarrier(7);

    expect(claimFiberFrameCapture(barrier, 7)).toBe(false);
    markFiberFrameCaptureApplied(barrier, 6);
    expect(claimFiberFrameWarmup(barrier, 7)).toBe(false);
    expect(claimFiberFrameCapture(barrier, 7)).toBe(false);

    markFiberFrameCaptureApplied(barrier, 7);
    expect(claimFiberFrameCapture(barrier, 7)).toBe(false);
    expect(claimFiberFrameWarmup(barrier, 7)).toBe(true);
    expect(claimFiberFrameWarmup(barrier, 7)).toBe(false);
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

  it('restores renderer, camera, and background state after synchronous capture failure', () => {
    const originalRenderTarget = { name: 'original-target' };
    const originalBackground = new THREE.Color('#102030');
    const originalFog = new THREE.Fog('#102030', 1, 10);
    const scene = new THREE.Scene();
    scene.background = originalBackground;
    scene.fog = originalFog;

    const background = new THREE.Group();
    background.userData[LUPI_EXPORT_LAYER_KEY] = LUPI_EXPORT_BACKGROUND_LAYER;
    scene.add(background);

    let pixelRatio = 2;
    let width = 800;
    let height = 600;
    let clearColor = new THREE.Color('#abcdef');
    let clearAlpha = 0.75;
    let renderTarget: typeof originalRenderTarget | null = originalRenderTarget;
    let viewport = new THREE.Vector4(11, 22, 333, 444);
    let scissor = new THREE.Vector4(7, 8, 90, 91);
    let scissorTest = true;
    const renderer = {
      getPixelRatio: () => pixelRatio,
      setPixelRatio: (value: number) => { pixelRatio = value; },
      getClearColor: (target: THREE.Color) => target.copy(clearColor),
      getClearAlpha: () => clearAlpha,
      setClearColor: (value: THREE.ColorRepresentation, alpha?: number) => {
        clearColor = new THREE.Color(value);
        if (alpha !== undefined) clearAlpha = alpha;
      },
      getRenderTarget: () => renderTarget,
      setRenderTarget: (value: typeof originalRenderTarget | null) => { renderTarget = value; },
      getViewport: (target: THREE.Vector4) => target.copy(viewport),
      setViewport: (x: number | THREE.Vector4, y?: number, nextWidth?: number, nextHeight?: number) => {
        viewport = x instanceof THREE.Vector4
          ? x.clone()
          : new THREE.Vector4(x, y, nextWidth, nextHeight);
      },
      getScissor: (target: THREE.Vector4) => target.copy(scissor),
      setScissor: (x: number | THREE.Vector4, y?: number, nextWidth?: number, nextHeight?: number) => {
        scissor = x instanceof THREE.Vector4
          ? x.clone()
          : new THREE.Vector4(x, y, nextWidth, nextHeight);
      },
      getScissorTest: () => scissorTest,
      setScissorTest: (enabled: boolean) => { scissorTest = enabled; },
      clear: vi.fn(),
      setSize: (nextWidth: number, nextHeight: number) => {
        width = nextWidth;
        height = nextHeight;
      },
    };
    const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 1000);
    const originalAspect = camera.aspect;
    const originalNear = camera.near;
    const originalFar = camera.far;

    expect(() => runImageCaptureTransaction({
      renderer,
      scene,
      camera,
      viewportWidth: width,
      viewportHeight: height,
      targetWidth: 1920,
      targetHeight: 1080,
      transparent: true,
      appliedCamera: {
        position: [8, 9, 10],
        target: [0, 0, 0],
        fov: 42,
        near: 0.025,
        far: 25_000,
      },
    }, () => {
      expect(pixelRatio).toBe(1);
      expect([width, height]).toEqual([1920, 1080]);
      expect(camera.aspect).toBe(1920 / 1080);
      expect(camera.near).toBe(0.025);
      expect(camera.far).toBe(25_000);
      expect(clearAlpha).toBe(0);
      expect(renderer.clear).toHaveBeenCalledWith(true, true, true);
      expect(viewport.toArray()).toEqual([0, 0, 1920, 1080]);
      expect(scissor.toArray()).toEqual([0, 0, 1920, 1080]);
      expect(scissorTest).toBe(false);
      expect(renderTarget).toBeNull();
      expect(scene.background).toBeNull();
      expect(scene.fog).toBeNull();
      expect(background.visible).toBe(false);
      throw new Error('capture failed');
    })).toThrow('capture failed');

    expect(pixelRatio).toBe(2);
    expect([width, height]).toEqual([800, 600]);
    expect(camera.aspect).toBe(originalAspect);
    expect(camera.near).toBe(originalNear);
    expect(camera.far).toBe(originalFar);
    expect(clearColor.getHexString()).toBe('abcdef');
    expect(clearAlpha).toBe(0.75);
    expect(renderTarget).toBe(originalRenderTarget);
    expect(viewport.toArray()).toEqual([11, 22, 333, 444]);
    expect(scissor.toArray()).toEqual([7, 8, 90, 91]);
    expect(scissorTest).toBe(true);
    expect(scene.background).toBe(originalBackground);
    expect(scene.fog).toBe(originalFog);
    expect(background.visible).toBe(true);
  });

  it('restores logical viewport size before DPR without a transient export-sized high-DPR buffer', () => {
    const scene = new THREE.Scene();
    const originalRenderTarget = { name: 'live-target' };
    let phase: 'capture' | 'restore' = 'capture';
    const restoreCalls: string[] = [];
    const renderer = {
      getPixelRatio: () => 2,
      setPixelRatio: (value: number) => {
        if (phase === 'restore') restoreCalls.push(`setPixelRatio:${value}`);
      },
      getClearColor: (target: THREE.Color) => target.set('#abcdef'),
      getClearAlpha: () => 0.75,
      setClearColor: (value: THREE.ColorRepresentation, alpha?: number) => {
        if (phase === 'restore') {
          restoreCalls.push(`setClearColor:${new THREE.Color(value).getHexString()}:${alpha}`);
        }
      },
      getRenderTarget: () => originalRenderTarget,
      setRenderTarget: (value: typeof originalRenderTarget | null) => {
        if (phase === 'restore') restoreCalls.push(`setRenderTarget:${value?.name ?? 'null'}`);
      },
      getViewport: (target: THREE.Vector4) => target.set(11, 22, 333, 444),
      setViewport: (value: number | THREE.Vector4) => {
        if (phase === 'restore' && value instanceof THREE.Vector4) {
          restoreCalls.push(`setViewport:${value.toArray().join(',')}`);
        }
      },
      getScissor: (target: THREE.Vector4) => target.set(7, 8, 90, 91),
      setScissor: (value: number | THREE.Vector4) => {
        if (phase === 'restore' && value instanceof THREE.Vector4) {
          restoreCalls.push(`setScissor:${value.toArray().join(',')}`);
        }
      },
      getScissorTest: () => true,
      setScissorTest: (enabled: boolean) => {
        if (phase === 'restore') restoreCalls.push(`setScissorTest:${enabled}`);
      },
      clear: vi.fn(),
      setSize: (width: number, height: number, updateStyle?: boolean) => {
        if (phase === 'restore') {
          restoreCalls.push(`setSize:${width}x${height}:${updateStyle}`);
        }
      },
    };

    runImageCaptureTransaction({
      renderer,
      scene,
      camera: new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 1000),
      viewportWidth: 800,
      viewportHeight: 600,
      targetWidth: 4096,
      targetHeight: 4096,
      transparent: false,
    }, () => {
      phase = 'restore';
    });

    expect(restoreCalls).toEqual([
      'setRenderTarget:live-target',
      'setSize:800x600:false',
      'setPixelRatio:2',
      'setViewport:11,22,333,444',
      'setScissor:7,8,90,91',
      'setScissorTest:true',
      'setClearColor:abcdef:0.75',
    ]);
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

  it('explicitly clears an opaque first capture when ambient auto-clear is disabled', () => {
    const scene = new THREE.Scene();
    let clearAlpha = 0;
    let framebufferAlpha = 0;
    let renderTarget: object | null = null;
    const renderer = {
      // Mirrors EffectComposer's renderer policy. runImageCaptureTransaction
      // must not rely on render() performing an implicit clear.
      autoClear: false,
      getPixelRatio: () => 1,
      setPixelRatio: vi.fn(),
      getClearColor: (target: THREE.Color) => target.set('#000000'),
      getClearAlpha: () => clearAlpha,
      setClearColor: (_value: THREE.ColorRepresentation, alpha?: number) => {
        if (alpha !== undefined) clearAlpha = alpha;
      },
      getRenderTarget: () => renderTarget,
      setRenderTarget: (value: object | null) => { renderTarget = value; },
      getViewport: (target: THREE.Vector4) => target.set(0, 0, 800, 600),
      setViewport: vi.fn(),
      getScissor: (target: THREE.Vector4) => target.set(0, 0, 800, 600),
      setScissor: vi.fn(),
      getScissorTest: () => false,
      setScissorTest: vi.fn(),
      setSize: vi.fn(),
      clear: vi.fn(() => { framebufferAlpha = clearAlpha; }),
    };

    runImageCaptureTransaction({
      renderer,
      scene,
      camera: new THREE.PerspectiveCamera(50, 1, 0.1, 1000),
      viewportWidth: 800,
      viewportHeight: 600,
      targetWidth: 256,
      targetHeight: 256,
      transparent: false,
    }, () => {
      // No scene background is ready yet. The explicit clear is the only
      // operation which can establish an opaque framebuffer at this point.
      expect(scene.background).toBeNull();
      expect(renderer.autoClear).toBe(false);
      expect(framebufferAlpha).toBe(1);
    });

    expect(renderer.clear).toHaveBeenCalledWith(true, true, true);
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
