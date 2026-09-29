/**
 * createLupiRenderer.ts — the one renderer factory for every Lupi <Canvas>.
 *
 * Lupi renders through three's WebGPURenderer: the WebGPU backend when the
 * browser has an adapter, its WebGL2 backend otherwise (plan-final D1):
 *
 * - `?renderer=webgl2`, no `navigator.gpu`, a null adapter or a throwing
 *   adapter probe all construct the renderer with `forceWebGL: true`.
 * - Otherwise the renderer is constructed with `requiredLimits` and three
 *   requests the device itself, with every adapter feature. Passing our own
 *   device would need the same feature list, or three drops into
 *   compatibility mode and forces `samples = 0` (spike G9).
 * - The factory probes the adapter only to raise `maxBufferSize` and
 *   `maxStorageBufferBindingSize` (the 256 MiB default caps large frames). It
 *   never copies `maxStorageBuffersInVertexStage`, which is undefined on
 *   Safari 26.2-26.5 (K31).
 * - The renderer is returned un-initialized. R3F calls `init()`, and three
 *   falls back to WebGL2 by itself when WebGPU init fails. When WebGL2 cannot
 *   start either, R3F's init error reaches CanvasErrorBoundary.
 *
 * R3F v10 sets ACES tone mapping after the factory returns, so the look is
 * configured in `onCreated` (configureViewerRenderer; spike G8).
 */
import * as THREE from 'three/webgpu';
import type { DefaultRendererProps } from '@react-three/fiber/webgpu';
import { installWebGPUCompat, webgpuCompatState } from './webgpuCompat';

export type LupiBackend = 'webgpu' | 'webgl2';

export interface LupiRendererRuntime {
  /** `renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'`, recorded in onCreated. */
  backend: LupiBackend;
  /** True when `?renderer=webgl2` forced the WebGL2 backend. */
  forced: boolean;
  adapterInfo: { vendor: string; architecture: string; device: string; description: string } | null;
  preferredCanvasFormat: string | null;
  /** Only limits the adapter reports (K31). */
  requestedLimits: Record<string, number>;
  /** `renderer.backend.compatibilityMode` on WebGPU; null on WebGL2. */
  compatibilityMode: boolean | null;
  /** `renderer.samples` after init. */
  samples: number;
  /** Live: the webgpuCompat swizzle retry has fired at least once. */
  compat: { swizzleRetry: boolean };
  /** THREE.REVISION */
  three: string;
}

declare global {
  interface Window {
    /** The active viewer renderer, for tests, the smoke harness and the export fingerprint. */
    __lupiRenderer?: Readonly<LupiRendererRuntime> | null;
  }
}

interface AdapterProbe {
  adapterInfo: LupiRendererRuntime['adapterInfo'];
  preferredCanvasFormat: string | null;
  requestedLimits: Record<string, number>;
}

interface RendererSetup {
  forced: boolean;
  probe: AdapterProbe | null;
}

/** Raised from the adapter when present; never `maxStorageBuffersInVertexStage` (K31). */
const RAISED_LIMITS = ['maxBufferSize', 'maxStorageBufferBindingSize'] as const;

/** R3F tears a root down 500 ms after unmount; dispose the renderer after that. */
const DISPOSE_AFTER_TEARDOWN_MS = 750;

/** One renderer per canvas element: guards a factory invoked twice (r3f #3782). */
const rendererByCanvas = new WeakMap<object, Promise<THREE.WebGPURenderer>>();
const setupByRenderer = new WeakMap<THREE.WebGPURenderer, RendererSetup>();
const disposing = new WeakSet<object>();

let runtime: Readonly<LupiRendererRuntime> | null = null;
let runtimeRenderer: THREE.WebGPURenderer | null = null;

/** True when the page asks for the WebGL2 backend (`?renderer=webgl2`). */
export function isWebGL2Forced(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('renderer') === 'webgl2';
}

async function probeAdapter(): Promise<AdapterProbe | null> {
  const gpu = typeof navigator === 'undefined' ? undefined : navigator.gpu;
  if (!gpu) return null;
  try {
    // Mirror three's own request so the limits belong to the adapter it gets.
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance', featureLevel: 'compatibility' });
    if (!adapter) return null;
    const limits = adapter.limits as unknown as Record<string, number | undefined>;
    const requestedLimits: Record<string, number> = {};
    for (const name of RAISED_LIMITS) {
      const value = limits[name];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) requestedLimits[name] = value;
    }
    const info = adapter.info as GPUAdapterInfo | undefined;
    let preferredCanvasFormat: string | null = null;
    try {
      preferredCanvasFormat = gpu.getPreferredCanvasFormat();
    } catch {
      preferredCanvasFormat = null;
    }
    return {
      adapterInfo: info
        ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }
        : null,
      preferredCanvasFormat,
      requestedLimits,
    };
  } catch {
    return null;
  }
}

async function buildRenderer(defaults: DefaultRendererProps): Promise<THREE.WebGPURenderer> {
  installWebGPUCompat();
  const forced = isWebGL2Forced();
  const probe = forced ? null : await probeAdapter();
  const parameters: THREE.WebGPURendererParameters = {
    ...defaults,
    // R3F types `canvas` with its own OffscreenCanvas shim, not the DOM type (spike G13).
    canvas: defaults.canvas as HTMLCanvasElement,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  };
  const renderer = probe
    ? new THREE.WebGPURenderer({ ...parameters, requiredLimits: probe.requestedLimits })
    : new THREE.WebGPURenderer({ ...parameters, forceWebGL: true });
  setupByRenderer.set(renderer, { forced, probe });
  return renderer;
}

/**
 * The `<Canvas renderer>` factory. Returns an un-initialized WebGPURenderer,
 * the same one for repeated calls with the same canvas.
 */
export function createLupiRenderer(defaults: DefaultRendererProps): Promise<THREE.WebGPURenderer> {
  const canvas = defaults.canvas as object;
  const cached = rendererByCanvas.get(canvas);
  if (cached) return cached;
  const pending = buildRenderer(defaults);
  rendererByCanvas.set(canvas, pending);
  pending.catch(() => {
    if (rendererByCanvas.get(canvas) === pending) rendererByCanvas.delete(canvas);
  });
  return pending;
}

/** The subset of the renderer the viewer look configures. */
export interface ViewerRendererTarget {
  outputColorSpace: string;
  shadowMap: { type: THREE.ShadowMapType };
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
}

/**
 * sRGB output, no renderer tone mapping, exposure 1, PCF shadows. Run in
 * onCreated: R3F sets ACES after the factory returns (spike G8). The post
 * pipeline's renderOutput is the only tone mapper (plan-final D14).
 */
export function configureViewerRenderer(renderer: ViewerRendererTarget): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  // r182 deprecates PCFSoftShadowMap; PCFShadowMap is now soft.
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

/** Record what the initialized renderer ended up as; also sets `window.__lupiRenderer`. */
export function recordLupiRendererRuntime(renderer: THREE.WebGPURenderer): LupiRendererRuntime {
  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean; compatibilityMode?: boolean | null };
  const isWebGPU = backend.isWebGPUBackend === true;
  const setup = setupByRenderer.get(renderer);
  const probe = isWebGPU ? setup?.probe ?? null : null;
  const record: LupiRendererRuntime = {
    backend: isWebGPU ? 'webgpu' : 'webgl2',
    forced: setup?.forced ?? isWebGL2Forced(),
    adapterInfo: probe?.adapterInfo ?? null,
    preferredCanvasFormat: probe?.preferredCanvasFormat ?? null,
    requestedLimits: { ...(probe?.requestedLimits ?? {}) },
    compatibilityMode: isWebGPU ? backend.compatibilityMode ?? null : null,
    samples: renderer.samples,
    compat: webgpuCompatState,
    three: THREE.REVISION,
  };
  runtime = Object.freeze(record);
  runtimeRenderer = renderer;
  if (typeof window !== 'undefined') window.__lupiRenderer = runtime;
  return record;
}

/** The runtime record of the active renderer, or null before one is created. */
export function getLupiRendererRuntime(): LupiRendererRuntime | null {
  return runtime;
}

/**
 * Dispose the renderer of an unmounted canvas. R3F v10 does not dispose a
 * WebGPURenderer on unmount (r3f #3926), so without this each viewer visit
 * leaks a device or a GL context. Runs after R3F's own deferred teardown, and
 * skips a canvas that is back in the document (a StrictMode effect replay).
 * Idempotent.
 */
export function disposeLupiRenderer(canvas: HTMLCanvasElement): void {
  const pending = rendererByCanvas.get(canvas);
  if (!pending || disposing.has(canvas)) return;
  disposing.add(canvas);
  setTimeout(() => {
    disposing.delete(canvas);
    if (canvas.isConnected || rendererByCanvas.get(canvas) !== pending) return;
    rendererByCanvas.delete(canvas);
    pending
      .then((renderer) => {
        if (runtimeRenderer === renderer) {
          runtime = null;
          runtimeRenderer = null;
          if (typeof window !== 'undefined') window.__lupiRenderer = null;
        }
        return renderer.dispose();
      })
      .catch(() => {
        // A renderer that never initialized has nothing to release.
      });
  }, DISPOSE_AFTER_TEARDOWN_MS);
}
