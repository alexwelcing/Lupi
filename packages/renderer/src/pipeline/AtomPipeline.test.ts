import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockDevice() {
  return {
    destroy: vi.fn(),
    lost: new Promise(() => {}),
  } as unknown as GPUDevice;
}

describe('initWebGPU lifetime', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a successfully acquired device without destroying caller ownership', async () => {
    const device = mockDevice();
    const adapter = { requestDevice: vi.fn().mockResolvedValue(device) };
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue(adapter),
        getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
      },
    });
    const { initWebGPU } = await import('./AtomPipeline');

    await expect(initWebGPU(100)).resolves.toEqual({ device, format: 'bgra8unorm' });
    expect(device.destroy).not.toHaveBeenCalled();
  });

  it('returns at the deadline and destroys a device that resolves late exactly once', async () => {
    vi.useFakeTimers();
    const pending = deferred<GPUDevice>();
    const device = mockDevice();
    const adapter = { requestDevice: vi.fn().mockReturnValue(pending.promise) };
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue(adapter),
        getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
      },
    });
    const { initWebGPU } = await import('./AtomPipeline');

    const initialization = initWebGPU(10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(initialization).resolves.toBeNull();

    pending.resolve(device);
    await vi.runAllTicks();
    await Promise.resolve();
    expect(device.destroy).toHaveBeenCalledTimes(1);
  });

  it('returns null after both device requests fail and does not invent cleanup', async () => {
    const adapter = { requestDevice: vi.fn().mockRejectedValue(new Error('request failed')) };
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue(adapter),
        getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
      },
    });
    const { initWebGPU } = await import('./AtomPipeline');

    await expect(initWebGPU(100)).resolves.toBeNull();
    expect(adapter.requestDevice).toHaveBeenCalledTimes(2);
  });

  it('returns null when adapter acquisition itself rejects', async () => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockRejectedValue(new Error('adapter failed')),
        getPreferredCanvasFormat: vi.fn(),
      },
    });
    const { initWebGPU } = await import('./AtomPipeline');

    await expect(initWebGPU(100)).resolves.toBeNull();
  });
});
