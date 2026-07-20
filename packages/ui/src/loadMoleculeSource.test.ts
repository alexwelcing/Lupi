import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFrame, createMockTrajectory } from '@atlas/core/test-utils';
import { getStoreState, resetStore } from './test-utils';
import { importDumpFileStreaming, loadMoleculeSource } from './loadMoleculeSource';

const seams = vi.hoisted(() => ({
  streaming: false,
  constructorArgs: [] as unknown[][],
  parseFile: vi.fn(),
  detectFileType: vi.fn(),
  transcodeDumpFile: vi.fn(),
}));

vi.mock('@atlas/parsers', () => ({
  parseFile: seams.parseFile,
  detectFileType: seams.detectFileType,
  transcodeDumpFile: seams.transcodeDumpFile,
}));
vi.mock('@atlas/parsers/StreamingLoader', () => ({
  isGlimbinUrl: () => seams.streaming,
  autoDetectLoader: async () => seams.streaming ? 'streaming' : 'legacy',
  StreamingLoader: class {
    constructor(...args: unknown[]) { seams.constructorArgs.push(args); }
    async fetchHeader() { return {}; }
    async fetchIndex() { return {}; }
    async fetchFrame() { return createMockFrame(); }
    getMetadata() {
      return {
        totalFrames: 1,
        atomTypes: [1],
        globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
        fileSize: 100,
      };
    }
  },
}));

describe('loadMoleculeSource strict remote mode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetStore();
    seams.streaming = false;
    seams.constructorArgs.length = 0;
    seams.parseFile.mockReset();
    seams.parseFile.mockResolvedValue({ trajectory: createMockTrajectory(1, 1), thermo: null });
    seams.detectFileType.mockReset();
    seams.transcodeDumpFile.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sets redirect:error on the real full-fetch seam', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      redirected: false,
      blob: async () => new Blob(['1\nwater\nH 0 0 0\n']),
    });
    await loadMoleculeSource('https://lupi.live/gallery/water.xyz', { strictRemote: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://lupi.live/gallery/water.xyz',
      { redirect: 'error' },
    );
    expect(getStoreState().file).toBeTruthy();
  });

  it('passes redirect:error into every StreamingLoader request seam', async () => {
    seams.streaming = true;
    await loadMoleculeSource('https://lupi.live/gallery/trajectory.glimbin', { strictRemote: true });
    expect(seams.constructorArgs).toHaveLength(1);
    expect(seams.constructorArgs[0][3]).toEqual({ redirect: 'error' });
  });

  it('treats a redirect failure as terminal and makes no second request', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed: redirect mode is set to error'));
    await expect(loadMoleculeSource('https://lupi.live/gallery/redirect.xyz', { strictRemote: true }))
      .rejects.toThrow(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getStoreState().file).toBeNull();
  });

  it('rejects an already-redirected response before parsing', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, redirected: true });
    await expect(loadMoleculeSource('https://lupi.live/gallery/redirected.xyz', { strictRemote: true }))
      .rejects.toThrow(/redirects are not allowed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seams.parseFile).not.toHaveBeenCalled();
  });

  it('upgrades progressive frame identity only after the worker validates every ID', async () => {
    seams.detectFileType.mockReturnValue('dump');
    let headerIdentity: unknown;
    let completedIdentity: unknown;
    let mountedTypeSemantics: unknown;
    let mountedDistanceSemantics: unknown;
    seams.transcodeDumpFile.mockImplementation(async (
      _file: File,
      _opfs: unknown,
      callbacks: {
        onFrame0Header?: (header: unknown) => void;
        onFrame0Chunk?: (chunk: unknown) => void;
        onFrame0Complete?: (loaded: number, identity: unknown) => void;
      },
    ) => {
      callbacks.onFrame0Header?.({
        natoms: 2,
        timestep: 0,
        boxBounds: new Float64Array([0, 1, 0, 1, 0, 1]),
        columns: ['id', 'type', 'x', 'y', 'z'],
        identity: { kind: 'source-id', unique: false },
        typeSemantics: { kind: 'opaque', provenance: 'lammps-type-id' },
        distanceSemantics: { kind: 'unknown', provenance: 'lammps-dump' },
      });
      headerIdentity = getStoreState().file?.trajectory.frames[0]?.identity;
      mountedTypeSemantics = getStoreState().file?.trajectory.frames[0]?.typeSemantics;
      mountedDistanceSemantics = getStoreState().file?.trajectory.frames[0]?.distanceSemantics;
      callbacks.onFrame0Chunk?.({
        start: 0,
        count: 2,
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
        types: new Int32Array([1, 1]),
        ids: new Int32Array([10, 20]),
      });
      callbacks.onFrame0Complete?.(2, { kind: 'source-id', unique: true });
      completedIdentity = getStoreState().file?.trajectory.frames[0]?.identity;
      return { kind: 'single' };
    });

    const result = await importDumpFileStreaming(new File(['dump'], 'identity.dump'));

    expect(result).toEqual({ handled: true, persistedId: null });
    expect(headerIdentity).toEqual({ kind: 'source-id', unique: false });
    expect(completedIdentity).toEqual({ kind: 'source-id', unique: true });
    expect(mountedTypeSemantics).toEqual({ kind: 'opaque', provenance: 'lammps-type-id' });
    expect(mountedDistanceSemantics).toEqual({ kind: 'unknown', provenance: 'lammps-dump' });
    expect(getStoreState().file?.trajectory.frames[0]?.identity)
      .toEqual({ kind: 'source-id', unique: true });
  });
});
