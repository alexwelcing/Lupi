import { getAtomicNumberBySymbol, type Trajectory } from '@atlas/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { resetStore } from '../test-utils';
import { CANONICAL_BUNDLE_REGISTRY } from '../science/canonicalBundleRegistry';
import { ViewerLoadSupersededError } from '../viewer/loadGuard';
import { EXAMPLES, type GalleryExample } from './catalog';
import { attachScienceBundle, unwrapGalleryScienceTrajectory } from './loadGalleryExample';

const z1 = (id: string): GalleryExample => {
  const example = EXAMPLES.find((candidate) => candidate.id === id);
  if (!example) throw new Error(`gallery entry ${id} missing`);
  return example;
};

function canonicalTrajectory(pathIndex: number): Trajectory {
  const manifest = CANONICAL_BUNDLE_REGISTRY[pathIndex].manifest as any;
  return {
    totalFrames: manifest.image_count,
    atomTypes: [...new Set(manifest.coordinates.species.map((symbol: string) => getAtomicNumberBySymbol(symbol)!))] as number[],
    globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
    frames: manifest.coordinates.frames.map((sourceFrame: any, image: number) => ({
      timestep: image,
      natoms: manifest.coordinates.atom_count,
      boxBounds: new Float64Array(6), boxTilt: new Float64Array(3), triclinic: true,
      columns: ['id', 'type', 'x', 'y', 'z'],
      ids: Int32Array.from(manifest.coordinates.atom_ids.map((_: string, index: number) => index + 1)),
      identity: { kind: 'synthetic-row' as const, unique: true },
      types: Int32Array.from(manifest.coordinates.species.map((symbol: string) => getAtomicNumberBySymbol(symbol)!)),
      typeSemantics: { kind: 'atomic-number' as const, provenance: 'xyz-element-token' as const },
      distanceSemantics: { kind: 'angstrom' as const, provenance: 'source-declared' as const },
      positions: Float32Array.from(sourceFrame.positions_angstrom.flat()),
      bonds: new Int32Array(), properties: new Map(),
    })),
  };
}

function loadCanonicalFile(pathIndex: number): void {
  useStore.getState().setFile({
    name: `z1-path-${pathIndex}.extxyz`,
    size: 10_315,
    trajectory: canonicalTrajectory(pathIndex),
    thermo: null,
  });
}

describe('attachScienceBundle canonical gallery load', () => {
  beforeEach(() => resetStore());

  it('loads each gallery entry by exact manifest digest', async () => {
    for (const pathIndex of [0, 14, 16, 27]) {
      resetStore();
      loadCanonicalFile(pathIndex);
      const example = z1(`z1_science_path_${pathIndex}`);
      await attachScienceBundle(example);
      expect(useStore.getState().file?.science?.path.pathIndex).toBe(pathIndex);
      expect(useStore.getState().file?.science?.path.revision.manifestSha256).toBe(example.scienceManifestSha256);
      expect(useStore.getState().activePanel).toBe('science');
    }
  });

  it('fails closed for an unknown digest rather than falling back to mutable path lookup', async () => {
    loadCanonicalFile(16);
    await attachScienceBundle({
      ...z1('z1_science_path_16'),
      scienceManifestSha256: `sha256:${'0'.repeat(64)}`,
    });
    expect(useStore.getState().file?.science).toBeUndefined();
    expect(useStore.getState().activePanel).toBeNull();
  });

  it('fails closed when the trajectory disagrees with the canonical atom/frame contract', async () => {
    loadCanonicalFile(16);
    useStore.getState().file!.trajectory.frames[0]!.types[0] = 1;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await attachScienceBundle(z1('z1_science_path_16'));
    expect(useStore.getState().file?.science).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('cannot commit a verified bundle after a newer viewer load supersedes it', async () => {
    loadCanonicalFile(16);
    await expect(attachScienceBundle(z1('z1_science_path_16'), () => false))
      .rejects.toBeInstanceOf(ViewerLoadSupersededError);
    expect(useStore.getState().file?.science).toBeUndefined();
    expect(useStore.getState().activePanel).toBeNull();
  });

  it('is a no-op for ordinary gallery entries', async () => {
    loadCanonicalFile(16);
    const plain = EXAMPLES.find((example) => example.sciencePathIndex == null && example.available && !example.route)!;
    await attachScienceBundle(plain);
    expect(useStore.getState().file?.science).toBeUndefined();
  });

  it('keeps minimum-image playback when an embedded client omits the science deck', () => {
    loadCanonicalFile(16);
    const before = useStore.getState().file;
    expect(before).toBeTruthy();
    unwrapGalleryScienceTrajectory(z1('z1_science_path_16'));
    const after = useStore.getState().file;
    expect(after).not.toBe(before);
    expect(after?.trajectory).not.toBe(before?.trajectory);
    expect(after?.science).toBeUndefined();
    expect(useStore.getState().activePanel).toBeNull();
  });
});
