import { getAtomicNumberBySymbol, type Trajectory } from '@atlas/core';
import { describe, expect, it } from 'vitest';
import path0 from './canonical-bundles/path-0.visualization-bundle.json';
import path14 from './canonical-bundles/path-14.visualization-bundle.json';
import path16 from './canonical-bundles/path-16.visualization-bundle.json';
import path16Raw from './canonical-bundles/path-16.visualization-bundle.json?raw';
import path27 from './canonical-bundles/path-27.visualization-bundle.json';
import { CANONICAL_VALUE_SOURCE_ASSETS } from './canonicalValueSourceAssets';
import {
  adaptVisualizationBundle,
  verifyVisualizationBundle,
  verifyVisualizationManifest,
} from './adaptVisualizationBundle';

const MANIFEST_SHA = 'sha256:22766c56417b9002e03668c65c53bdda5cb3b725946aef5af66105773708b8cf';
const clone = (): any => JSON.parse(JSON.stringify(path16));

function trajectoryFromManifest(): Trajectory {
  return {
    totalFrames: path16.image_count,
    atomTypes: [...new Set(path16.coordinates.species.map((symbol) => getAtomicNumberBySymbol(symbol)!))],
    globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
    frames: path16.coordinates.frames.map((sourceFrame, image) => ({
      timestep: image,
      natoms: path16.coordinates.atom_count,
      boxBounds: Float64Array.from([
        0, Math.hypot(...sourceFrame.lattice_angstrom[0]),
        0, Math.hypot(...sourceFrame.lattice_angstrom[1]),
        0, Math.hypot(...sourceFrame.lattice_angstrom[2]),
      ]),
      boxTilt: Float64Array.from([
        sourceFrame.lattice_angstrom[1][0],
        sourceFrame.lattice_angstrom[2][0],
        sourceFrame.lattice_angstrom[2][1],
      ]),
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

  it('rejects verified labels with failed checks and contradictory displayed derivations', () => {
    const failedCheck = clone();
    failedCheck.quality.checks[0].status = 'fail';
    expect(() => adaptVisualizationBundle(failedCheck, MANIFEST_SHA)).toThrow(/failed quality check/i);

    const mutations: Array<(manifest: any) => void> = [
      (manifest) => { manifest.quality_gates.same_engine.dense_barrier_ev += 1; },
      (manifest) => { manifest.quality_gates.cross_engine.reference_barrier_ev += 1; },
      (manifest) => { manifest.quality_gates.cross_engine.dense_vs_reference_signed_error_mev += 1; },
      (manifest) => { manifest.quality_gates.cross_engine.dense_vs_reference_abs_error_mev += 1; },
      (manifest) => { manifest.quality_gates.t1.offset_series_mev[0].offset_mev += 1; },
      (manifest) => { manifest.quality_gates.t1.offset_mean_mev += 1; },
      (manifest) => { manifest.quality_gates.t1.wander_mev += 1; },
      (manifest) => { manifest.quality_gates.t1.driver_pair.reverse(); },
      (manifest) => { manifest.quality_gates.t1.verdict = 'clean'; },
      (manifest) => { manifest.selection.per_model.chgnet.sparse_barrier_ev += 1; },
      (manifest) => { manifest.selection.guidance_deficits_mev.chgnet.same_engine_abs_error_mev += 1; },
      (manifest) => { manifest.quality_gates.same_engine.per_model.chgnet.verdict = 'loss'; },
      (manifest) => { manifest.quality_gates.verdict.same_engine = 'loss'; },
      (manifest) => { manifest.quality_gates.verdict.t1 = 'clean'; },
      (manifest) => { manifest.quality_gates.verdict.cross_engine_contaminated = false; },
      (manifest) => { manifest.quality_gates.verdict.label = 'loss_t1_clean'; },
    ];
    for (const mutate of mutations) {
      const contradictory = clone();
      mutate(contradictory);
      expect(() => adaptVisualizationBundle(contradictory, MANIFEST_SHA)).toThrow(/derived canonical value mismatch/i);
    }
  });

  it('preserves missing model evidence separately from failed evidence', () => {
    const missing: any = JSON.parse(JSON.stringify(path14));
    missing.model_provenance[0].status = 'missing';
    missing.model_provenance[0].failure_reason = 'receipt unavailable';
    const path = adaptVisualizationBundle(missing, MANIFEST_SHA);
    expect(path.quality.state).toBe('no-guides-completed');
    expect(path.quality.guidedModelCount).toBe(0);
    expect(path.quality.failedModelCount).toBe(3);
    expect(path.quality.missingModelCount).toBe(1);
    expect(path.guidance.misses).toContainEqual(expect.objectContaining({
      model: 'chgnet',
      kind: 'model-missing',
      reason: 'receipt unavailable',
    }));
  });

  it('fails closed when model status and model-scoped evidence disagree', () => {
    const inconsistent = clone();
    inconsistent.model_provenance[0].status = 'missing';
    expect(() => adaptVisualizationBundle(inconsistent, MANIFEST_SHA)).toThrow(/canonical model-state mismatch/i);
  });

  it('fails closed on duplicate model provenance identities', () => {
    const duplicate = clone();
    duplicate.model_provenance[1].model = duplicate.model_provenance[0].model;
    expect(() => adaptVisualizationBundle(duplicate, MANIFEST_SHA)).toThrow(/duplicate model identities/i);
  });

  it('rejects series whose canonical quantity or absolute semantics cannot be projected', () => {
    const wrongQuantity = clone();
    wrongQuantity.series[0].quantity = 'force';
    expect(() => adaptVisualizationBundle(wrongQuantity, MANIFEST_SHA)).toThrow(/absolute total energies/i);

    const relative = clone();
    relative.series[0].absolute_or_relative = 'relative';
    expect(() => adaptVisualizationBundle(relative, MANIFEST_SHA)).toThrow(/absolute total energies/i);
  });

  it('recomputes anchor containment, uniqueness, and per-model evaluated sets before projection', () => {
    const duplicateEvaluated = clone();
    duplicateEvaluated.selection.evaluated.push(duplicateEvaluated.selection.evaluated[0]);
    expect(() => adaptVisualizationBundle(duplicateEvaluated, MANIFEST_SHA)).toThrow(/anchor set/i);

    const missingFromUniverse: any = JSON.parse(JSON.stringify(path0));
    const denseImage = missingFromUniverse.selection.dense_extension.supplied_indices[0];
    missingFromUniverse.selection.anchor_universe = missingFromUniverse.selection.anchor_universe
      .filter((image: number) => image !== denseImage);
    expect(() => adaptVisualizationBundle(missingFromUniverse, MANIFEST_SHA)).toThrow(/anchor set/i);

    const inconsistentModel = clone();
    inconsistentModel.selection.per_model.chgnet.evaluated.pop();
    expect(() => adaptVisualizationBundle(inconsistentModel, MANIFEST_SHA)).toThrow(/per_model\.chgnet\.evaluated/i);
  });

  it('keeps a clean T1 verdict separate from non-strong same-engine guidance', () => {
    const cleanButNotStrong: any = JSON.parse(JSON.stringify(path27));
    cleanButNotStrong.quality_gates.thresholds_mev.strong_win = -1;
    for (const gate of Object.values(cleanButNotStrong.quality_gates.same_engine.per_model) as any[]) {
      gate.verdict = 'win';
    }
    cleanButNotStrong.quality_gates.verdict.same_engine = 'win';
    cleanButNotStrong.quality_gates.verdict.label = 'win_t1_clean';

    const path = adaptVisualizationBundle(cleanButNotStrong, MANIFEST_SHA);
    expect(path.qualityState).toBe('clean-t1');
    expect(path.quality.sameEngineStrongWin).toBe(false);
  });

  it('projects separately bound electronic diagnostics without dropping their evidence', () => {
    const path = adaptVisualizationBundle(path0, MANIFEST_SHA);
    expect(path.diagnostics).toEqual(expect.objectContaining({
      status: 'bound',
      imageIndex: 3,
    }));
    expect(path.diagnostics?.runs).toHaveLength(2);
    expect(path.diagnostics?.runs[0]).toEqual(expect.objectContaining({
      label: expect.any(String),
      scf: expect.objectContaining({ converged: expect.any(Boolean) }),
      occupations: expect.objectContaining({ type: expect.any(String) }),
    }));
  });
});

describe('atomic canonical load gate', () => {
  it('verifies canonical manifest, bundle, and source bytes without requiring a viewer trajectory', async () => {
    const path = await verifyVisualizationManifest({
      serializedManifest: path16Raw,
      expectedManifestSha256: MANIFEST_SHA,
    });
    expect(path.revision.bundleId).toBe(path16.bundle_id);

    await expect(verifyVisualizationManifest({
      serializedManifest: `${path16Raw} `,
      expectedManifestSha256: MANIFEST_SHA,
    })).rejects.toThrow(/manifest sha-256 mismatch/i);
  });

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
