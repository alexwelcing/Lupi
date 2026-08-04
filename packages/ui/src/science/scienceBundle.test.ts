import { getAtomicNumberBySymbol, type Trajectory } from '@atlas/core';
import { describe, expect, it, vi } from 'vitest';
import {
  verifiedSciencePanelBundleForPathIndex,
  verifiedScienceBundleForManifestSha256,
} from './scienceBundle';
import { CANONICAL_BUNDLE_REGISTRY } from './canonicalBundleRegistry';

function canonicalTrajectory(pathIndex: number): Trajectory {
  const manifest = CANONICAL_BUNDLE_REGISTRY[pathIndex].manifest as any;
  return {
    totalFrames: manifest.image_count,
    atomTypes: [...new Set(manifest.coordinates.species.map((symbol: string) => getAtomicNumberBySymbol(symbol)!))] as number[],
    globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
    frames: manifest.coordinates.frames.map((sourceFrame: any, image: number) => ({
      timestep: image,
      natoms: manifest.coordinates.atom_count,
      boxBounds: Float64Array.from([
        0, Math.abs(sourceFrame.lattice_angstrom[0][0]),
        0, Math.abs(sourceFrame.lattice_angstrom[1][1]),
        0, Math.abs(sourceFrame.lattice_angstrom[2][2]),
      ]),
      boxTilt: Float64Array.from([
        sourceFrame.lattice_angstrom[1][0],
        sourceFrame.lattice_angstrom[2][0],
        sourceFrame.lattice_angstrom[2][1],
      ]),
      triclinic: true,
      columns: ['id', 'type', 'x', 'y', 'z'],
      ids: Int32Array.from(manifest.coordinates.atom_ids.map((_: string, index: number) => index + 1)),
      identity: { kind: 'synthetic-row' as const, unique: true },
      types: Int32Array.from(manifest.coordinates.species.map((symbol: string) => getAtomicNumberBySymbol(symbol)!)),
      typeSemantics: { kind: 'atomic-number' as const, provenance: 'xyz-element-token' as const },
      distanceSemantics: { kind: 'angstrom' as const, provenance: 'source-declared' as const },
      positions: Float32Array.from(sourceFrame.positions_angstrom.flat()),
      bonds: new Int32Array(),
      properties: new Map(),
    })),
  };
}

describe('canonical science bundle registry', () => {
  it('verifies and projects every pinned golden manifest without the legacy fixture', async () => {
    const expected = new Map([
      [0, ['mp-761269_2_1_1_-1_0', 7]],
      [14, ['mp-756912_1_1_1_0_0', 7]],
      [16, ['mp-760344_10_4_0_1_0', 5]],
      [27, ['mp-752552_0_7_0_0_1', 5]],
    ]);
    for (const [pathIndex, [pathId, imageCount]] of expected) {
      const bundle = (await verifiedSciencePanelBundleForPathIndex(pathIndex))!;
      expect(bundle.path.pathId).toBe(pathId);
      expect(bundle.path.imageCount).toBe(imageCount);
      expect(bundle.fixture.schema).toBe('lupine.visualization-bundle.v1');
      expect(bundle.path.revision.manifestSha256).toBe(CANONICAL_BUNDLE_REGISTRY[pathIndex].manifestSha256);
    }
  });

  it('retains exact dense-extension and guide failure semantics', async () => {
    expect((await verifiedSciencePanelBundleForPathIndex(0))!.path.anchors.denseExtensionImages).toEqual([1, 5]);
    expect((await verifiedSciencePanelBundleForPathIndex(14))!.path.anchors.denseExtensionImages).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect((await verifiedSciencePanelBundleForPathIndex(16))!.path.anchors.denseExtensionImages).toEqual([]);
    const fourteen = (await verifiedSciencePanelBundleForPathIndex(14))!.path;
    expect(fourteen.series.map((series) => series.id).sort()).toEqual(['gpaw-anchors', 'vasp-reference']);
    expect(fourteen.quality.guidedModelCount).toBe(0);
    expect(fourteen.quality.modelDenominator).toBe(4);
  });

  it('fails closed when a panel requests an unknown canonical path', async () => {
    expect(await verifiedSciencePanelBundleForPathIndex(999)).toBeNull();
  });

  it('loads path 16 only through its exact content digest and atom-order gate', async () => {
    const entry = CANONICAL_BUNDLE_REGISTRY[16];
    const bundle = await verifiedScienceBundleForManifestSha256(
      entry.manifestSha256,
      canonicalTrajectory(16),
      16,
    );
    expect(bundle?.path.pathIndex).toBe(16);
    expect(bundle?.path.revision.bundleId).toBe((entry.manifest as any).bundle_id);
  });

  it('fails closed for unknown digest, wrong path binding, and atom-order mismatch', async () => {
    const trajectory = canonicalTrajectory(16);
    expect(await verifiedScienceBundleForManifestSha256(`sha256:${'0'.repeat(64)}`, trajectory, 16)).toBeNull();
    expect(await verifiedScienceBundleForManifestSha256(
      CANONICAL_BUNDLE_REGISTRY[16].manifestSha256,
      trajectory,
      14,
    )).toBeNull();

    trajectory.frames[0]!.ids![0] = 2;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await verifiedScienceBundleForManifestSha256(
      CANONICAL_BUNDLE_REGISTRY[16].manifestSha256,
      trajectory,
      16,
    )).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[science-panel] canonical bundle verification failed — failing closed:',
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
