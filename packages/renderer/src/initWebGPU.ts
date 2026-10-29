/**
 * initWebGPU — the optional WebGPU compute device behind BondPipeline.
 *
 * WebGPU here is an accelerator for bond detection only; every failure
 * (no adapter, no device, a stalled handshake) returns null and the caller
 * falls back to the CPU worker.
 */

/** Default ceiling (ms) for the whole WebGPU init handshake. On weak networks
 *  or wedged drivers, requestAdapter/requestDevice can hang indefinitely; that
 *  froze the bond pipeline's eager init and, on some devices, the page itself.
 *  Audit finding: no-offline-fallback-webgpu-init. WebGPU here is an OPTIONAL
 *  accelerator, so timing out and returning null (→ CPU fallback) is always
 *  safe and far better than a frozen init. */
export const WEBGPU_INIT_TIMEOUT_MS = 5000;

/**
 * Set once the page is known to have no WebGPU adapter (no `navigator.gpu`,
 * or `requestAdapter()` resolved null twice). That does not change during a
 * page's life, so later callers skip the handshake entirely.
 */
let webGPUAdapterUnavailable = false;

/**
 * True when the optional WebGPU compute path is known to be unavailable, so
 * callers can choose the CPU path synchronously (no handshake, no timeout).
 * False means "unknown or available": `initWebGPU` still decides.
 */
export function isWebGPUComputeUnavailable(): boolean {
  if (webGPUAdapterUnavailable) return true;
  if (typeof navigator === 'undefined' || !(navigator as any).gpu) {
    webGPUAdapterUnavailable = true;
    return true;
  }
  return false;
}

/**
 * Initialize the optional WebGPU compute device. Returns `null` (never throws)
 * when WebGPU is unavailable, no adapter/device can be acquired, OR the whole
 * handshake exceeds `timeoutMs` — all of which are treated by callers as a
 * graceful fall back to the CPU spatial-hash path. A page without an adapter
 * returns at once (no timeout wait) and is remembered as such.
 */
export async function initWebGPU(
  timeoutMs: number = WEBGPU_INIT_TIMEOUT_MS,
): Promise<{ device: GPUDevice; format: GPUTextureFormat } | null> {
  if (isWebGPUComputeUnavailable()) return null;

  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, Math.max(0, timeoutMs));
  });

  const handshake = (async (): Promise<{ device: GPUDevice; format: GPUTextureFormat } | null> => {
    try {
      // Try high-performance first; fall back to any available adapter.
      let adapter = await (navigator as any).gpu.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!adapter) {
        adapter = await (navigator as any).gpu.requestAdapter();
      }
      if (!adapter) {
        // Early exit: no adapter is a fact about this page, not a slow
        // driver. The caller falls back to the CPU at once.
        webGPUAdapterUnavailable = true;
        return null;
      }

      // Try generous limits first, then fall back to adapter defaults.
      // Some GPUs (integrated, older discrete) reject 512MB buffers.
      let device: GPUDevice;
      try {
        device = await adapter.requestDevice({
          requiredLimits: {
            maxStorageBufferBindingSize: 512 * 1024 * 1024, // 512MB for large systems
            maxBufferSize: 512 * 1024 * 1024,
          },
        });
      } catch (limitErr: any) {
        console.warn('[WebGPU] Large limits rejected, trying defaults:', limitErr?.message ?? limitErr);
        device = await adapter.requestDevice();
      }

      // The timeout owns the return value, but the handshake still owns any
      // device that arrives later. Reclaim it here before it becomes
      // unreachable; the caller never sees this device and cannot clean it up.
      if (timedOut) {
        device.destroy();
        return null;
      }

      device.lost.then((info: any) => {
        // destroy() on dispose also resolves `lost`; only a real loss is an error.
        if (info?.reason === 'destroyed') return;
        console.error('[WebGPU] device lost:', info.message);
      });
      const format = (navigator as any).gpu.getPreferredCanvasFormat();
      return { device, format };
    } catch (err: any) {
      console.warn('[WebGPU] init threw — falling back:', err?.message ?? err);
      return null;
    }
  })();

  const result = await Promise.race([handshake, timeout]);
  if (!timedOut && timeoutId !== undefined) clearTimeout(timeoutId);
  if (timedOut) {
    console.warn(`WebGPU init exceeded ${timeoutMs}ms — falling back to CPU bonds`);
  }
  return result;
}
