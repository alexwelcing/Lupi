// The R3F v10 <Canvas renderer={factory}> factory: WebGPU with an explicitly
// requested device (raised maxBufferSize / storage limits), falling back to
// WebGPURenderer's WebGL2 backend (forceWebGL) when there is no adapter or when
// ?backend=webgl forces it.
import * as THREE from 'three/webgpu';
import type { DefaultRendererProps } from '@react-three/fiber/webgpu';

export interface RendererReport {
  requested: string;
  path: 'webgpu-own-device' | 'webgpu-three-device' | 'webgl2-fallback' | 'webgl2-forced';
  adapterInfo?: Record<string, string>;
  limits?: Record<string, number>;
  features?: string[];
  error?: string;
}

export const rendererReport: RendererReport = { requested: 'auto', path: 'webgl2-fallback' };

export function createRendererFactory(choice: 'auto' | 'webgpu' | 'webgl', antialias: boolean) {
  rendererReport.requested = choice;
  return async (defaults: DefaultRendererProps): Promise<THREE.WebGPURenderer> => {
    (globalThis as unknown as { __factoryCalls: number }).__factoryCalls = ((globalThis as unknown as { __factoryCalls: number }).__factoryCalls ?? 0) + 1;
    const ownDevice = new URLSearchParams(location.search).get('own') !== '0';
    // R3F types `canvas` with its own OffscreenCanvas shim, which is not the DOM type.
    const base = { ...defaults, canvas: defaults.canvas as HTMLCanvasElement, antialias, alpha: false, powerPreference: 'high-performance' as const };
    if (choice === 'webgl') {
      rendererReport.path = 'webgl2-forced';
      return new THREE.WebGPURenderer({ ...base, forceWebGL: true });
    }
    try {
      const adapter = typeof navigator !== 'undefined' && 'gpu' in navigator
        ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
        : null;
      if (adapter && !ownDevice) {
        // Let three create the device; it requests every adapter feature itself.
        const requiredLimits = { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
        rendererReport.path = 'webgpu-three-device' as RendererReport['path'];
        rendererReport.limits = requiredLimits;
        return new THREE.WebGPURenderer({ ...base, requiredLimits });
      }
      if (adapter) {
        // Mirror three's own device request (all adapter features) so the
        // backend does not drop into compatibility mode (which forces samples=0),
        // then raise the limits Lupi needs: 256 MiB default maxBufferSize caps
        // instancePosition at ~22M atoms.
        const requiredFeatures = [...adapter.features] as GPUFeatureName[];
        const requiredLimits: Record<string, number> = {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxStorageBuffersInVertexStage: (adapter.limits as unknown as Record<string, number>).maxStorageBuffersInVertexStage ?? 0,
        };
        if (!requiredLimits.maxStorageBuffersInVertexStage) delete requiredLimits.maxStorageBuffersInVertexStage;
        const device = await adapter.requestDevice({ requiredFeatures, requiredLimits });
        const info = (adapter as unknown as { info?: GPUAdapterInfo }).info;
        rendererReport.path = 'webgpu-own-device';
        rendererReport.adapterInfo = info
          ? { vendor: info.vendor, architecture: info.architecture, description: info.description, device: info.device }
          : undefined;
        rendererReport.limits = {
          maxBufferSize: device.limits.maxBufferSize,
          maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
          maxStorageBuffersInVertexStage: (device.limits as unknown as Record<string, number>).maxStorageBuffersInVertexStage,
        };
        rendererReport.features = [...device.features];
        return new THREE.WebGPURenderer({ ...base, device });
      }
    } catch (err) {
      rendererReport.error = String(err);
    }
    if (choice === 'webgpu') throw new Error(`WebGPU requested but unavailable: ${rendererReport.error ?? 'no adapter'}`);
    rendererReport.path = 'webgl2-fallback';
    return new THREE.WebGPURenderer({ ...base, forceWebGL: true });
  };
}
