import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

interface MockBuffer {
  destroy: ReturnType<typeof vi.fn>;
}

interface MockDeviceControl {
  device: GPUDevice;
  buffers: MockBuffer[];
  failAtBuffer: number | null;
  failAtStage: string | null;
}

function makeDevice(): MockDeviceControl {
  const control: MockDeviceControl = {
    device: null as unknown as GPUDevice,
    buffers: [],
    failAtBuffer: null,
    failAtStage: null,
  };
  const maybeFail = (stage: string) => {
    if (control.failAtStage === stage) throw new Error(`failed at ${stage}`);
    return {};
  };
  control.device = {
    createBuffer: vi.fn(() => {
      const ordinal = control.buffers.length + 1;
      if (control.failAtBuffer === ordinal) throw new Error(`failed at buffer ${ordinal}`);
      const buffer = { destroy: vi.fn() };
      control.buffers.push(buffer);
      return buffer;
    }),
    createShaderModule: vi.fn(() => maybeFail('shader')),
    createBindGroupLayout: vi.fn(() => maybeFail('bind-group-layout')),
    createPipelineLayout: vi.fn(() => maybeFail('pipeline-layout')),
    createComputePipeline: vi.fn(() => maybeFail('compute-pipeline')),
    createBindGroup: vi.fn(() => maybeFail('bind-group')),
  } as unknown as GPUDevice;
  return control;
}

beforeAll(() => {
  vi.stubGlobal('GPUBufferUsage', {
    STORAGE: 1,
    COPY_DST: 2,
    VERTEX: 4,
    COPY_SRC: 8,
    INDIRECT: 16,
    UNIFORM: 32,
    MAP_READ: 64,
  });
  vi.stubGlobal('GPUShaderStage', { COMPUTE: 1 });
});

afterEach(() => vi.restoreAllMocks());

describe('BondPipeline transactional construction', () => {
  it.each([1, 4, 8, 13])('destroys every prior buffer exactly once when buffer %s fails', async (failAt) => {
    const control = makeDevice();
    control.failAtBuffer = failAt;
    const { BondPipeline } = await import('./BondPipeline');

    expect(() => new BondPipeline({ device: control.device, maxAtoms: 10, maxBonds: 20 })).toThrow();
    expect(control.buffers).toHaveLength(failAt - 1);
    for (const buffer of control.buffers) expect(buffer.destroy).toHaveBeenCalledTimes(1);
  });

  it.each(['shader', 'bind-group-layout', 'pipeline-layout', 'compute-pipeline', 'bind-group']) (
    'releases all buffers when %s creation throws',
    async (stage) => {
      const control = makeDevice();
      control.failAtStage = stage;
      const { BondPipeline } = await import('./BondPipeline');

      expect(() => new BondPipeline({ device: control.device, maxAtoms: 10, maxBonds: 20 })).toThrow();
      expect(control.buffers.length).toBeGreaterThan(0);
      for (const buffer of control.buffers) expect(buffer.destroy).toHaveBeenCalledTimes(1);
    },
  );

  it('allows a later successful construction and makes destroy idempotent', async () => {
    const control = makeDevice();
    control.failAtStage = 'bind-group';
    const { BondPipeline } = await import('./BondPipeline');
    expect(() => new BondPipeline({ device: control.device, maxAtoms: 10, maxBonds: 20 })).toThrow();

    const failedBuffers = [...control.buffers];
    control.failAtStage = null;
    const successful = new BondPipeline({ device: control.device, maxAtoms: 10, maxBonds: 20 });
    const successfulBuffers = control.buffers.slice(failedBuffers.length);
    successful.destroy();
    successful.destroy();

    for (const buffer of failedBuffers) expect(buffer.destroy).toHaveBeenCalledTimes(1);
    for (const buffer of successfulBuffers) expect(buffer.destroy).toHaveBeenCalledTimes(1);
  });
});
