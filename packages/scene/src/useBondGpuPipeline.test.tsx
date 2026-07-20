import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BondGpuComputeInput } from './useBondGpuPipeline';

const renderer = vi.hoisted(() => {
  const initWebGPU = vi.fn();
  const construct = vi.fn();
  const BondPipeline = vi.fn(function (this: unknown, options: unknown) {
    return construct(options);
  });
  return { initWebGPU, construct, BondPipeline };
});

vi.mock('@atlas/renderer', () => ({
  initWebGPU: renderer.initWebGPU,
  BondPipeline: renderer.BondPipeline,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function device() {
  return {
    destroy: vi.fn(),
    createCommandEncoder: vi.fn(() => ({ finish: vi.fn(() => ({})) })),
    queue: { submit: vi.fn() },
  } as unknown as GPUDevice;
}

function readback(count = 1) {
  return { pairs: new Int32Array(count * 2), distances: new Float32Array(count), count };
}

function pipeline(readbackPromise: Promise<ReturnType<typeof readback>> = Promise.resolve(readback())) {
  return {
    destroy: vi.fn(),
    updateElementRadii: vi.fn(),
    updatePositions: vi.fn(),
    updateConfig: vi.fn(),
    computeBonds: vi.fn(),
    readBondsAsync: vi.fn(() => readbackPromise),
  };
}

function input(natoms = 10): BondGpuComputeInput {
  return {
    positions: new Float32Array(natoms * 3),
    types: new Int32Array(natoms),
    natoms,
    covalentRadii: new Float32Array([0, 1]),
    tolerance: 0.45,
    maxBondLength: 3,
  };
}

async function initialize(
  gpuDevice = device(),
  gpuPipeline = pipeline(),
) {
  renderer.initWebGPU.mockResolvedValue({ device: gpuDevice, format: 'bgra8unorm' });
  renderer.construct.mockReturnValue(gpuPipeline);
  const hook = renderHook(({ enabled }) => useBondGpuPipeline(enabled), {
    initialProps: { enabled: true },
  });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return { ...hook, gpuDevice, gpuPipeline };
}

beforeEach(() => {
  renderer.initWebGPU.mockReset();
  renderer.construct.mockReset();
  renderer.BondPipeline.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useBondGpuPipeline ownership', () => {
  it('destroys the installed pipeline and device exactly once on unmount', async () => {
    const { unmount, gpuDevice, gpuPipeline } = await initialize();
    unmount();
    expect(gpuPipeline.destroy).toHaveBeenCalledTimes(1);
    expect(gpuDevice.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys a late device without constructing or updating after unmount', async () => {
    const pending = deferred<{ device: GPUDevice; format: GPUTextureFormat } | null>();
    renderer.initWebGPU.mockReturnValue(pending.promise);
    const hook = renderHook(() => useBondGpuPipeline(true));
    hook.unmount();
    const lateDevice = device();

    await act(async () => {
      pending.resolve({ device: lateDevice, format: 'bgra8unorm' });
      await pending.promise;
    });

    expect(renderer.construct).not.toHaveBeenCalled();
    expect(lateDevice.destroy).toHaveBeenCalledTimes(1);
  });

  it('invalidates pending initialization when disabled', async () => {
    const pending = deferred<{ device: GPUDevice; format: GPUTextureFormat } | null>();
    renderer.initWebGPU.mockReturnValue(pending.promise);
    const hook = renderHook(({ enabled }) => useBondGpuPipeline(enabled), {
      initialProps: { enabled: true },
    });
    hook.rerender({ enabled: false });
    const lateDevice = device();
    await act(async () => {
      pending.resolve({ device: lateDevice, format: 'bgra8unorm' });
      await pending.promise;
    });
    expect(renderer.construct).not.toHaveBeenCalled();
    expect(lateDevice.destroy).toHaveBeenCalledTimes(1);
    expect(hook.result.current).toMatchObject({ ready: false, unsupported: false });
  });

  it('keeps a newer enable attempt when the first initialization resolves late', async () => {
    const first = deferred<{ device: GPUDevice; format: GPUTextureFormat } | null>();
    const second = deferred<{ device: GPUDevice; format: GPUTextureFormat } | null>();
    renderer.initWebGPU.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const installed = pipeline();
    renderer.construct.mockReturnValue(installed);
    const hook = renderHook(({ enabled }) => useBondGpuPipeline(enabled), {
      initialProps: { enabled: true },
    });
    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    const firstDevice = device();
    const secondDevice = device();

    await act(async () => {
      second.resolve({ device: secondDevice, format: 'bgra8unorm' });
      await second.promise;
    });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(async () => {
      first.resolve({ device: firstDevice, format: 'bgra8unorm' });
      await first.promise;
    });

    expect(renderer.construct).toHaveBeenCalledTimes(1);
    expect(firstDevice.destroy).toHaveBeenCalledTimes(1);
    expect(secondDevice.destroy).not.toHaveBeenCalled();
    expect(installed.destroy).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('destroys the acquired device and reports unsupported when initial construction throws', async () => {
    const gpuDevice = device();
    renderer.initWebGPU.mockResolvedValue({ device: gpuDevice, format: 'bgra8unorm' });
    renderer.construct.mockImplementation(() => { throw new Error('constructor failed'); });
    const hook = renderHook(() => useBondGpuPipeline(true));

    await waitFor(() => expect(hook.result.current.unsupported).toBe(true));
    expect(hook.result.current.ready).toBe(false);
    expect(gpuDevice.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps the old pipeline alive when growth construction fails', async () => {
    const oldPipeline = pipeline();
    const hook = await initialize(device(), oldPipeline);
    renderer.construct.mockImplementationOnce(() => { throw new Error('grow failed'); });

    await expect(hook.result.current.compute(input(200_000))).resolves.toBeNull();
    expect(oldPipeline.destroy).not.toHaveBeenCalled();
    await expect(hook.result.current.compute(input(10))).resolves.toEqual(readback());
    hook.unmount();
    expect(oldPipeline.destroy).toHaveBeenCalledTimes(1);
  });

  it('installs a successful growth before destroying the old pipeline', async () => {
    const oldPipeline = pipeline();
    const replacement = pipeline(Promise.resolve(readback(2)));
    const hook = await initialize(device(), oldPipeline);
    renderer.construct.mockReturnValueOnce(replacement);

    await expect(hook.result.current.compute(input(200_000))).resolves.toEqual(readback(2));
    expect(oldPipeline.destroy).toHaveBeenCalledTimes(1);
    expect(replacement.destroy).not.toHaveBeenCalled();
    hook.unmount();
    expect(replacement.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys an uninstalled replacement when invalidated during growth', async () => {
    const oldPipeline = pipeline();
    const replacement = pipeline();
    const hook = await initialize(device(), oldPipeline);
    renderer.construct.mockReturnValueOnce(replacement);

    let computePromise!: Promise<unknown>;
    await act(async () => {
      computePromise = hook.result.current.compute(input(200_000));
      // First microtasks pass ensureInitialized and the pre-construction yield.
      await Promise.resolve();
      await Promise.resolve();
      hook.rerender({ enabled: false });
    });

    await expect(computePromise).resolves.toBeNull();
    expect(oldPipeline.destroy).toHaveBeenCalledTimes(1);
    expect(replacement.destroy).toHaveBeenCalledTimes(1);
  });

  it('suppresses a stale successful readback after disable', async () => {
    const pending = deferred<ReturnType<typeof readback>>();
    const gpuPipeline = pipeline(pending.promise);
    const hook = await initialize(device(), gpuPipeline);
    const computePromise = hook.result.current.compute(input());
    await waitFor(() => expect(gpuPipeline.readBondsAsync).toHaveBeenCalledTimes(1));
    hook.rerender({ enabled: false });
    pending.resolve(readback());

    await expect(computePromise).resolves.toBeNull();
    expect(gpuPipeline.destroy).toHaveBeenCalledTimes(1);
  });

  it('contains a teardown-caused readback rejection after unmount', async () => {
    const pending = deferred<ReturnType<typeof readback>>();
    const gpuPipeline = pipeline(pending.promise);
    const hook = await initialize(device(), gpuPipeline);
    const computePromise = hook.result.current.compute(input());
    await waitFor(() => expect(gpuPipeline.readBondsAsync).toHaveBeenCalledTimes(1));
    hook.unmount();
    pending.reject(new Error('mapping destroyed'));

    await expect(computePromise).resolves.toBeNull();
    expect(gpuPipeline.destroy).toHaveBeenCalledTimes(1);
  });

  it('propagates a readback rejection from the still-current generation', async () => {
    const pending = deferred<ReturnType<typeof readback>>();
    const gpuPipeline = pipeline(pending.promise);
    const hook = await initialize(device(), gpuPipeline);
    const computePromise = hook.result.current.compute(input());
    await waitFor(() => expect(gpuPipeline.readBondsAsync).toHaveBeenCalledTimes(1));
    pending.reject(new Error('readback failed'));
    await expect(computePromise).rejects.toThrow('readback failed');
    hook.unmount();
  });
});

// Import after the module mock declaration so the hook receives the controlled
// renderer boundary above.
import { useBondGpuPipeline } from './useBondGpuPipeline';
