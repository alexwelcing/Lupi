import { getAtomicNumberBySymbol, type Trajectory } from '@atlas/core';
import { describe, expect, it } from 'vitest';
import path16 from './canonical-bundles/path-16.visualization-bundle.json';
import path16Raw from './canonical-bundles/path-16.visualization-bundle.json?raw';
import { CANONICAL_VALUE_SOURCE_ASSETS } from './canonicalValueSourceAssets';
import { adaptVisualizationBundle, verifyVisualizationBundle } from './adaptVisualizationBundle';

const MANIFEST_SHA = 'sha256:a80daede7aafdd155fcc1d9b56f3ddbf4636e2ea647934f8a1202f7526c069b5';
const clone = (): any => JSON.parse(JSON.stringify(path16));

function trajectoryFromManifest(): Trajectory {
  return {
    totalFrames: path16.image_count,
    atomTypes: [...new Set(path16.coordinates.species.map((symbol) => getAtomicNumberBySymbol(symbol)!))],
    globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
    frames: path16.coordinates.frames.map((sourceFrame, image) => ({
      timestep: image,
      natoms: path16.coordinates.atom_count,
      boxBounds: new Float64Array(6),
      boxTilt: new Float64Array(3),
      triclinic: true,
      columns: ['id', 'type', 'x', 'y', 'z'],
      ids: Int32Array.from(path16.coordinates.atom_ids.map((_, index) => index + 1)),
      identity: { kind: 'synthetic-row', unique: true },
      types: Int32Array.from(path16.coordinates.species.map((symbol) => getAtomicNumberBySymbol(symbol)!)),
      typeSemantics: { kind: 'atomic-number', provenance: 'xyz-element-token' },
      distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
      positions: Float32Array.from(sourceFrame.positions_angstrom.flat()),
      bonds: new Int32Array(),
      properties: new Map(),
    })),
  };
}

describe('canonical visualization-bundle adapter', () => {
  it('maps exact revision and all requested source digest classes', () => {
    const path = adaptVisualizationBundle(path16, MANIFEST_SHA);
    expect(path.revision).toEqual(expect.objectContaining({
      schema: 'lupine.visualization-bundle.v1',
      bundleId: path16.bundle_id,
      manifestSha256: MANIFEST_SHA,
      runId: path16.run_id,
      status: 'active',
      qualityState: 'verified',
    }));
    expect(path.revision.sources.campaign).toMatch(/^sha256:/);
    expect(path.revision.sources.barrierLock).toMatch(/^sha256:/);
    expect(path.revision.sources.anchorReceipts).toHaveLength(5);
    expect(path.revision.sources.modelArtifacts).toHaveLength(4);
  });

  it('fails closed on an unknown schema or any schema-invalid extension', () => {
    expect(() => adaptVisualizationBundle({ ...path16, schema: 'lupine.visualization-bundle.v2' }, MANIFEST_SHA))
      .toThrow(/unsupported visualization bundle schema/i);
    expect(() => adaptVisualizationBundle({ ...path16, unexpected: true }, MANIFEST_SHA))
      .toThrow(/canonical visualization bundle schema/i);
  });

  it('fails closed on retracted run state and unbound displayed value sources', () => {
    const retracted = clone();
    retracted.status = 'retracted';
    retracted.retraction = 'withdrawn';
    expect(() => adaptVisualizationBundle(retracted, MANIFEST_SHA)).toThrow(/active bundle/i);

    const unbound = clone();
    unbound.series[0].value_sources[0].asset_sha256 = `sha256:${'0'.repeat(64)}`;
    expect(() => adaptVisualizationBundle(unbound, MANIFEST_SHA)).toThrow(/unbound value source/i);

    const unresolved = clone();
    unresolved.series[0].value_sources[0].json_pointer = '/not/a/real/value';
    expect(() => adaptVisualizationBundle(unresolved, MANIFEST_SHA)).toThrow(/unresolved value source/i);
  });
});

describe('atomic canonical load gate', () => {
  it('verifies manifest bytes, bundle identity, source bindings, and atom order together', async () => {
    const path = await verifyVisualizationBundle({
      serializedManifest: path16Raw,
      expectedManifestSha256: MANIFEST_SHA,
      trajectory: trajectoryFromManifest(),
    });
    expect(path.revision.bundleId).toBe(path16.bundle_id);
  });

  it('rejects changed manifest bytes and non-authoritative atom identity', async () => {
    await expect(verifyVisualizationBundle({
      serializedManifest: `${path16Raw} `,
      expectedManifestSha256: MANIFEST_SHA,
      trajectory: trajectoryFromManifest(),
    })).rejects.toThrow(/manifest sha-256 mismatch/i);

    const trajectory = trajectoryFromManifest();
    trajectory.frames[0]!.identity = { kind: 'unknown', unique: true };
    await expect(verifyVisualizationBundle({
      serializedManifest: path16Raw,
      expectedManifestSha256: MANIFEST_SHA,
      trajectory,
    })).rejects.toThrow(/atom identity\/order mismatch/i);
  });

  it('rejects frozen value-source bytes that do not match their content digest', async () => {
    const source = path16.series[0].value_sources[0]!;
    const mutableAssets = CANONICAL_VALUE_SOURCE_ASSETS as Record<string, string>;
    const original = mutableAssets[source.asset_sha256];
    mutableAssets[source.asset_sha256] = `${original} `;
    try {
      await expect(verifyVisualizationBundle({
        serializedManifest: path16Raw,
        expectedManifestSha256: MANIFEST_SHA,
        trajectory: trajectoryFromManifest(),
      })).rejects.toThrow(/value-source asset sha-256 mismatch/i);
    } finally {
      mutableAssets[source.asset_sha256] = original;
    }
  });

  it('rejects changed atom IDs even when species and positions still match', async () => {
    const trajectory = trajectoryFromManifest();
    trajectory.frames[0]!.ids![0] = 2;
    await expect(verifyVisualizationBundle({
      serializedManifest: path16Raw,
      expectedManifestSha256: MANIFEST_SHA,
      trajectory,
    })).rejects.toThrow(/atom identity\/order mismatch/i);
  });

  it('rejects trajectory units and element semantics that do not match the manifest', async () => {
    const wrongDistanceUnit = trajectoryFromManifest();
    wrongDistanceUnit.frames[0]!.distanceSemantics = { kind: 'unknown', provenance: 'lammps-dump' };
    await expect(verifyVisualizationBundle({
      serializedManifest: path16Raw,
      expectedManifestSha256: MANIFEST_SHA,
      trajectory: wrongDistanceUnit,
    })).rejects.toThrow(/trajectory unit mismatch/i);

    const opaqueElements = trajectoryFromManifest();
    opaqueElements.frames[0]!.typeSemantics = { kind: 'opaque', provenance: 'lammps-type-id' };
    await expect(verifyVisualizationBundle({
      serializedManifest: path16Raw,
      expectedManifestSha256: MANIFEST_SHA,
      trajectory: opaqueElements,
    })).rejects.toThrow(/atom identity\/order mismatch/i);
  });

  it('rejects non-finite trajectory coordinates instead of bypassing coordinate agreement', async () => {
    const trajectory = trajectoryFromManifest();
    trajectory.frames[0]!.positions[0] = Number.NaN;

    await expect(verifyVisualizationBundle({
      serializedManifest: path16Raw,
      expectedManifestSha256: MANIFEST_SHA,
      trajectory,
    })).rejects.toThrow(/atom identity\/order mismatch/i);
  });

  it('rejects coordinate and profile cardinality that disagree with the manifest identity', () => {
    const wrongAtomCardinality = clone();
    wrongAtomCardinality.coordinates.atom_ids.pop();
    expect(() => adaptVisualizationBundle(wrongAtomCardinality, MANIFEST_SHA))
      .toThrow(/coordinate cardinality mismatch/i);

    const wrongFrameCardinality = clone();
    wrongFrameCardinality.coordinates.frames[0].positions_angstrom.pop();
    expect(() => adaptVisualizationBundle(wrongFrameCardinality, MANIFEST_SHA))
      .toThrow(/coordinate cardinality mismatch/i);

    const wrongEnergyUnit = clone();
    wrongEnergyUnit.series[0].unit = 'meV';
    expect(() => adaptVisualizationBundle(wrongEnergyUnit, MANIFEST_SHA))
      .toThrow(/series unit mismatch/i);
  });
});
