import { describe, expect, it } from 'vitest';
import type { Frame, Trajectory } from '@atlas/core/types';
import {
  assessAsset,
  assessMany,
  averageFacets,
  byteSourceFromBlob,
  byteSourceFromBytes,
  byteSourceFromStream,
  byteSourceFromText,
  byteSourceFromUrl,
  canonicalAssessmentJson,
  envelopeSource,
  facetFromPoints,
  gradeFromPoints,
  rankAssessments,
  trajectorySource,
  type AssessmentContext,
  type AssetInspector,
  type AssessmentSource,
  type ByteSource,
} from './index';

const xyz = `3
water structure
O 0 0 0
H 0.9572 0 0
H -0.239 0.927 0
`;

const richContext: AssessmentContext = {
  title: 'Water reference geometry',
  declaredClass: 'literature-derived-structure',
  source: {
    kind: 'database',
    name: 'Example source',
    url: 'https://example.org/record/1',
    citation: 'Example record 1',
    identifiers: [{ scheme: 'example', value: '1' }],
    coordinateOrigin: 'Published Cartesian coordinates',
  },
  method: {
    name: 'Reference import',
    engine: 'converter',
    engineVersion: '1.0',
    model: 'source-record',
    units: 'angstrom',
    inputReference: 'example:1',
  },
  interpretation: {
    purpose: 'Reference geometry for viewer verification.',
    observable: 'Atomic positions',
    qualitative: 'Bent triatomic geometry',
    quantitative: 'Three atoms',
    limitations: ['This fixture is not an energetic calculation.'],
  },
  validation: {
    independent: true,
    humanReviewed: true,
    checks: [{ name: 'coordinate review', status: 'pass', source: 'fixture review' }],
  },
  claims: { atomCount: 3, frameCount: 1, description: 'Materialized XYZ coordinates.' },
};

describe('grade contract', () => {
  it('maps every point boundary monotonically and floors applicable means', () => {
    expect(Array.from({ length: 18 }, (_, point) => gradeFromPoints(point))).toEqual([
      'F-', 'F', 'F+', 'D-', 'D', 'D+', 'C-', 'C', 'C+',
      'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+',
    ]);
    expect(averageFacets([facetFromPoints(10, []), facetFromPoints(11, [])])).toMatchObject({ points: 10, grade: 'B' });
  });

  it('does not promote self-declared validation or human review to verified S evidence', async () => {
    const declared = await assessAsset(byteSourceFromText(xyz, 'water.xyz'), richContext);
    const withoutAttestations = await assessAsset(byteSourceFromText(xyz, 'water.xyz'), {
      ...richContext,
      validation: { ...richContext.validation, independent: false, humanReviewed: false },
    });
    expect(declared.report.facets.evidenceAccuracy.points).toBeLessThan(15);
    expect(declared.report.facets.evidenceAccuracy.points).toBe(withoutAttestations.report.facets.evidenceAccuracy.points);
    expect(declared.report.evidence
      .filter((item) => item.ruleId.startsWith('validation.'))
      .every((item) => item.origin === 'declared')).toBe(true);
    expect(declared.report.gaps.map((note) => note.ruleId)).toContain('evidence.s-verification-required');
  });

  it('does not turn caller-supplied provenance into verified accuracy points', async () => {
    const observedOnly = await assessAsset(byteSourceFromText(xyz, 'observed.xyz'));
    const declared = await assessAsset(byteSourceFromText(xyz, 'declared.xyz'), richContext);
    expect(declared.report.facets.evidenceAccuracy.points).toBe(observedOnly.report.facets.evidenceAccuracy.points);
    expect(declared.report.facets.evidenceAccuracy.reasons.map((reason) => reason.ruleId))
      .toContain('evidence.traceability.declared-source');
  });

  it('distinguishes N/A, Unrated, and demonstrated contradiction', async () => {
    const demo = await assessAsset(byteSourceFromText('not scientific', 'demo.bin'), { declaredClass: 'visualization-demo' });
    expect(demo.report.facets.evidenceAccuracy.grade).toBe('N/A');
    expect(demo.report.facets.dataDepth.grade).toBe('Unrated');

    const contradiction = await assessAsset(byteSourceFromText(xyz, 'water.xyz'), {
      ...richContext,
      claims: { ...richContext.claims, atomCount: 99 },
    });
    expect(contradiction.report.facets.evidenceAccuracy.grade).toBe('F');
    expect(contradiction.report.diagnostics.map((note) => note.ruleId)).toContain('claim.atom-count.mismatch');
  });

  it('includes missing required interpretation in a scientific asset overall grade', async () => {
    const complete = await assessAsset(byteSourceFromText(xyz, 'complete.xyz'), richContext);
    const incomplete = await assessAsset(byteSourceFromText(xyz, 'incomplete.xyz'), {
      ...richContext,
      title: undefined,
      interpretation: undefined,
      claims: { ...richContext.claims, description: undefined },
    });
    expect(incomplete.report.facets.interpretationCompleteness).toMatchObject({ grade: 'F-', points: 0 });
    expect(incomplete.report.overall.points).toBeLessThan(complete.report.overall.points!);
    expect(incomplete.report.gaps.map((note) => note.ruleId)).toContain('interpretation.not-supplied');
  });

  it('keeps observed and declared classes separate', async () => {
    const refined = await assessAsset(byteSourceFromText('ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n1\nITEM: BOX BOUNDS pp pp pp\n0 1\n0 1\n0 1\nITEM: ATOMS id type x y z\n1 1 0 0 0\n', 'run.dump'), {
      declaredClass: 'scientific-benchmark',
    });
    expect(refined.report.classification).toMatchObject({ observed: 'atomistic-simulation', declared: 'scientific-benchmark', effective: 'scientific-benchmark', conflict: false });

    const conflict = await assessAsset(byteSourceFromText(xyz, 'water.xyz'), { declaredClass: 'atomistic-simulation' });
    expect(conflict.report.classification).toMatchObject({ observed: 'reference-structure', declared: 'atomistic-simulation', effective: 'reference-structure', conflict: true });
    expect(conflict.report.diagnostics.map((note) => note.ruleId)).toContain('classification.declared-observed-conflict');
  });
});

describe('built-in inspectors', () => {
  const glimbin = () => {
    const bytes = new Uint8Array(800);
    bytes.set(new TextEncoder().encode('GLIM'));
    const view = new DataView(bytes.buffer);
    view.setUint16(4, 2, true);
    view.setUint16(6, 0x0038, true);
    view.setUint32(8, 4, true);
    view.setUint32(12, 128, true);
    view.setBigUint64(152, 256n, true);
    bytes[16] = 2;
    for (let index = 0; index < 4; index++) {
      const base = 256 + index * 24;
      view.setBigUint64(base, BigInt(400 + index * 100), true);
      view.setUint32(base + 8, 100, true);
      view.setUint32(base + 12, 100, true);
      view.setUint32(base + 16, index * 1000, true);
      view.setUint32(base + 20, 128, true);
    }
    return bytes;
  };

  const cases: Array<[string, AssessmentSource, string]> = [
    ['GLIMBIN', byteSourceFromBytes(glimbin(), 'asset.glimbin'), 'glimbin'],
    ['LAMMPS dump', byteSourceFromText('ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp\n0 1\n0 1\n0 1\nITEM: ATOMS id type x y z q\n1 1 0 0 0 -1\n2 2 1 0 0 1\n', 'dump.bin'), 'lammps-dump'],
    ['LAMMPS data', byteSourceFromText('LAMMPS data\n\n2 atoms\n1 bonds\n\nMasses\n\n1 1.0\n\nAtoms\n\n1 1 0 0 0\n\nBonds\n\n1 1 1 2\n', 'data.lmp'), 'lammps-data'],
    ['LAMMPS log', byteSourceFromText('LAMMPS (2 Aug 2023)\nStep Temp PotEng\n0 300 -1\n', 'log.lammps'), 'lammps-log'],
    ['LAMMPS profile', byteSourceFromText('# Chunk-averaged data for fix profile\n# Chunk Coord1 Ncount density\n0 1\n', 'profile.dat'), 'lammps-profile'],
    ['XYZ', byteSourceFromText(xyz, 'mislabeled.lammpstrj'), 'xyz'],
    ['Lupi JSON', byteSourceFromText(JSON.stringify({ frames: [{ natoms: 1, species: ['Cu'], positions: [0, 0, 0], ids: [1], bonds: [] }] }), 'asset.json'), 'lupi-json'],
    ['procedural envelope', envelopeSource({ name: 'fcc', procedural: true, context: { metadata: { lattice: 'fcc' } } }), 'lupi-json'],
    ['HTML response', byteSourceFromText('<!doctype html><html><body>error</body></html>', 'asset.xyz'), 'html'],
    ['unknown bytes', byteSourceFromBytes(Uint8Array.from([0, 255, 17, 88]), 'asset.bin'), 'unknown'],
  ];

  for (const [label, source, expectedFormat] of cases) {
    it(`recognizes ${label} in fast and deep modes`, async () => {
      for (const mode of ['fast', 'deep'] as const) {
        const result = await assessAsset(source, undefined, { mode });
        expect(result.report.observations.format).toBe(expectedFormat);
        expect(result.report.schemaVersion).toBe('lupi.asset-assessment.v1');
        if (expectedFormat === 'glimbin') {
          expect(result.report.observations).toMatchObject({ indexEntriesSampled: 4, frameIndexValid: true });
        }
      }
    });
  }

  it('uses content evidence ahead of a misleading extension', async () => {
    const result = await assessAsset(byteSourceFromText(xyz, 'simulation.lammpstrj'));
    expect(result.report.observations.format).toBe('xyz');
  });

  it('does not treat an unproven JSON bond array as source topology', async () => {
    const payload = JSON.stringify({
      frames: [{ natoms: 2, species: ['H', 'H'], positions: [0, 0, 0, 1, 0, 0], ids: [1, 2], bonds: [[0, 1]] }],
    });
    const result = await assessAsset(byteSourceFromText(payload, 'bonded.json'));
    expect(result.report.observations).toMatchObject({
      hasUniqueIds: true,
      hasSourceIdentity: false,
      hasStableIds: false,
      hasSourceBonds: false,
      hasInferredBonds: true,
    });
    expect(result.report.limitations.map((note) => note.ruleId)).toEqual(expect.arrayContaining([
      'identity.json-provenance-unverified',
      'bond.json-provenance-unverified',
    ]));
  });

  it('accepts a custom inspector without altering the scoring engine', async () => {
    const inspector: AssetInspector = {
      id: 'custom-format-v1',
      detect: () => 1,
      inspect: () => ({
        inspectorId: 'custom-format-v1',
        observedClass: 'reference-structure',
        observations: { format: 'unknown', parseable: true, hasCoordinates: true },
        evidence: [{ ruleId: 'custom.parsed', message: 'Custom structure parsed.', origin: 'source-data' }],
        strengths: [], gaps: [], limitations: [], diagnostics: [],
      }),
    };
    const result = await assessAsset(byteSourceFromText('custom', 'asset.custom'), undefined, { inspectors: [inspector] });
    expect(result.report.inspection.inspectorId).toBe('custom-format-v1');
    expect(result.report.facets.evidenceAccuracy.grade).toBe('D-');
  });

  it('classifies explicitly non-scientific procedural assets as visualization demos', async () => {
    const result = await assessAsset(envelopeSource({
      name: 'procedural-art',
      procedural: true,
      context: { metadata: { scientific: false, domain: 'visualization' } },
    }));
    expect(result.report.classification).toMatchObject({ observed: 'visualization-demo', effective: 'visualization-demo', conflict: false });
    expect(result.report.facets.evidenceAccuracy.grade).toBe('N/A');
  });

  it('deep-streams complete text trajectories and hashes content', async () => {
    const twoFrames = `${xyz}${xyz}`;
    const result = await assessAsset(byteSourceFromText(twoFrames, 'two.xyz'), undefined, { mode: 'deep' });
    expect(result.report.observations.frameCount).toBe(2);
    expect(result.report.observations.finiteCoordinates).toBe(true);
    expect(result.report.observations.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deep mode inspects a final coordinate row without a trailing newline', async () => {
    const noTrailingNewline = '1\ninvalid final row\nH NaN 0 0';
    const result = await assessAsset(byteSourceFromText(noTrailingNewline, 'invalid.xyz'), undefined, { mode: 'deep' });
    expect(result.report.observations.finiteCoordinates).toBe(false);
  });

  it('deep mode counts only complete XYZ frames and diagnoses a truncated final frame', async () => {
    const truncated = `${xyz}2\ntruncated final frame\nH 0 0 0\n`;
    const result = await assessAsset(byteSourceFromText(truncated, 'truncated.xyz'), undefined, { mode: 'deep' });
    expect(result.report.observations.frameCount).toBe(1);
    expect(result.report.observations.inspectedFrames).toBe(1);
    expect(result.report.diagnostics.map((note) => note.ruleId)).toContain('deep.trajectory.incomplete-frame');
  });

  it('deep mode counts only complete LAMMPS dump frames', async () => {
    const complete = 'ITEM: TIMESTEP\n0\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp\n0 1\n0 1\n0 1\nITEM: ATOMS id type x y z\n1 1 0 0 0\n2 1 1 0 0\n';
    const truncated = 'ITEM: TIMESTEP\n1\nITEM: NUMBER OF ATOMS\n2\nITEM: BOX BOUNDS pp pp pp\n0 1\n0 1\n0 1\nITEM: ATOMS id type x y z\n1 1 0 0 0\n';
    const result = await assessAsset(byteSourceFromText(`${complete}${truncated}`, 'truncated.dump'), undefined, { mode: 'deep' });
    expect(result.report.observations.frameCount).toBe(1);
    expect(result.report.observations.inspectedFrames).toBe(1);
    expect(result.report.diagnostics.map((note) => note.ruleId)).toContain('deep.trajectory.incomplete-frame');
  });
});

describe('trajectory provenance', () => {
  it('uses authoritative totalFrames while reporting sparse resident and inspected coverage', async () => {
    const frame = cloneFrame(makeTrajectory(false).frames[0]!, { timestep: 700 });
    const frames = new Array<Frame | undefined>(120);
    frames[70] = frame;
    const trajectory: Trajectory = {
      frames,
      totalFrames: 120,
      residency: { mode: 'sparse', maxResidentFrames: 3, maxResidentBytes: 1_000_000 },
      atomTypes: [1],
      globalBounds: { min: [0, 0, 0], max: [1, 0, 0] },
    };
    const assessed = await assessAsset(trajectorySource(trajectory), { claims: { frameCount: 120 } });
    expect(assessed.report.classification.observed).toBe('atomistic-simulation');
    expect(assessed.report.observations).toMatchObject({
      frameCount: 120,
      residentFrames: 1,
      inspectedFrames: 1,
      residencyComplete: false,
      atomCount: 2,
      parseable: true,
    });
    expect(assessed.report.limitations.map((note) => note.ruleId)).toContain('trajectory.residency.partial');
    expect(assessed.report.diagnostics.map((note) => note.ruleId)).not.toContain('claim.frame-count.mismatch');
  });

  it('does not promote viewer-inferred bonds to source topology', async () => {
    const trajectory = makeTrajectory(true);
    const inferred = await assessAsset(trajectorySource(trajectory), { bonds: { source: 'inferred' } });
    const sourced = await assessAsset(trajectorySource(trajectory), { bonds: { source: 'source' } });
    expect(inferred.report.observations).toMatchObject({ hasSourceBonds: false, hasInferredBonds: true });
    expect(sourced.report.observations).toMatchObject({ hasSourceBonds: false, hasInferredBonds: true });
    expect(sourced.report.limitations.map((note) => note.ruleId)).toContain('bond.source-provenance-unverified');
  });

  it('identifies MLIP evidence without relabeling it as DFT or experiment', async () => {
    const assessed = await assessAsset(trajectorySource(makeTrajectory(false)), { method: { model: 'MACE MLIP' } });
    expect(assessed.report.observations.mlipEvidence).toBe(true);
    expect(assessed.report.limitations.map((note) => note.ruleId)).toContain('method.mlip-not-dft');
  });

  it('accepts source-ID row shuffles but rejects duplicate identity claims', async () => {
    const first = makeTrajectory(false).frames[0]!;
    const shuffled = cloneFrame(first, {
      timestep: 1,
      ids: new Int32Array([2, 1]),
      types: new Int32Array([1, 1]),
      positions: new Float32Array([1, 0, 0, 0, 0, 0]),
    });
    const stable = await assessAsset(trajectorySource(makeTrajectoryFromFrames([first, shuffled])));
    expect(stable.report.observations).toMatchObject({
      hasUniqueIds: true,
      hasSourceIdentity: true,
      hasStableIds: true,
    });

    const duplicate = cloneFrame(shuffled, { ids: new Int32Array([1, 1]) });
    const broken = await assessAsset(trajectorySource(makeTrajectoryFromFrames([first, duplicate])));
    expect(broken.report.observations).toMatchObject({ hasUniqueIds: false, hasStableIds: false });
    expect(broken.report.gaps.map((note) => note.ruleId)).toContain('identity.duplicate-ids');
    expect(broken.report.diagnostics.map((note) => note.ruleId)).toContain('identity.unique-claim-contradiction');
  });

  it('does not infer global stable identity from fast samples that omit a bad frame', async () => {
    const base = makeTrajectory(false).frames[0]!;
    const frames = [
      cloneFrame(base, { timestep: 0 }),
      cloneFrame(base, { timestep: 1, ids: new Int32Array([1, 1]) }),
      cloneFrame(base, { timestep: 2 }),
      cloneFrame(base, { timestep: 3 }),
    ];
    const fast = await assessAsset(trajectorySource(makeTrajectoryFromFrames(frames)), undefined, { mode: 'fast' });
    const deep = await assessAsset(trajectorySource(makeTrajectoryFromFrames(frames)), undefined, { mode: 'deep' });
    expect(fast.report.observations.hasStableIds).toBeUndefined();
    expect(fast.report.limitations.map((note) => note.ruleId)).toContain('identity.frame-coverage-incomplete');
    expect(deep.report.observations).toMatchObject({ hasUniqueIds: false, hasStableIds: false });
  });

  it('rejects source-ID continuity when the atom population changes', async () => {
    const first = makeTrajectory(false).frames[0]!;
    const smaller = cloneFrame(first, {
      timestep: 1,
      natoms: 1,
      ids: new Int32Array([1]),
      types: new Int32Array([1]),
      positions: new Float32Array([0, 0, 0]),
    });
    const assessed = await assessAsset(trajectorySource(makeTrajectoryFromFrames([first, smaller])), undefined, { mode: 'deep' });
    expect(assessed.report.observations.hasStableIds).toBe(false);
    expect(assessed.report.gaps.map((note) => note.ruleId)).toContain('identity.discontinuous');
  });

  it('reports identity, atom-type, and distance semantic gaps instead of inferring them', async () => {
    const legacy = cloneFrame(makeTrajectory(false).frames[0]!, {
      identity: undefined,
      typeSemantics: undefined,
      distanceSemantics: undefined,
    });
    const assessed = await assessAsset(trajectorySource(makeTrajectoryFromFrames([legacy])));
    expect(assessed.report.observations).toMatchObject({
      hasUniqueIds: true,
      hasSourceIdentity: false,
      hasStableIds: false,
      hasTypeSemantics: false,
      hasDistanceSemantics: false,
    });
    expect(assessed.report.limitations.map((note) => note.ruleId)).toEqual(expect.arrayContaining([
      'identity.provenance-missing',
      'types.semantics-missing',
      'coordinates.units-unresolved',
    ]));
  });

  it('fingerprints bounded samples of coordinates, types, and identity semantics', async () => {
    const base = makeTrajectory(false).frames[0]!;
    const variants = [
      base,
      cloneFrame(base, { positions: new Float32Array([0.25, 0, 0, 1, 0, 0]) }),
      cloneFrame(base, { types: new Int32Array([1, 8]) }),
      cloneFrame(base, { identity: { kind: 'source-order', unique: true } }),
    ];
    const assessed = await Promise.all(variants.map((frame) =>
      assessAsset(trajectorySource(makeTrajectoryFromFrames([frame])))));
    expect(new Set(assessed.map((result) => result.report.input.fingerprint)).size).toBe(4);
  });
});

describe('bounded, deterministic batch execution', () => {
  it('does not cache mutable envelopes by their reusable record ID', () => {
    const first = envelopeSource({ id: 'same-record', text: 'first' });
    const changed = envelopeSource({ id: 'same-record', text: 'changed' });
    const immutable = envelopeSource(
      { id: 'same-record', text: 'first' },
      undefined,
      { immutableContentId: 'sha256:fixture-first' },
    );
    expect(first.cacheKey).toBeUndefined();
    expect(changed.cacheKey).toBeUndefined();
    expect(immutable.cacheKey).toBe('envelope:unknown:sha256:fixture-first');
  });

  it('stays within the fast sample and read-operation budget', async () => {
    let calls = 0;
    let requested = 0;
    const source: ByteSource = {
      kind: 'bytes', name: 'huge.xyz', size: 10_000_000, locality: 'local',
      async readRange(start, end) {
        calls++;
        requested += end - start;
        return new TextEncoder().encode(xyz);
      },
    };
    const result = await assessAsset(source);
    expect(calls).toBeLessThanOrEqual(2);
    expect(requested).toBeLessThanOrEqual(128 * 1024);
    expect(result.execution.bytesRead).toBeLessThanOrEqual(128 * 1024);
  });

  it('keeps canonical content byte-stable across byte and Blob adapters', async () => {
    const bytes = new TextEncoder().encode(xyz);
    const blobSource = byteSourceFromBlob(new Blob([bytes]), 'water.xyz');
    expect(blobSource.cacheKey).toBeUndefined();
    const fromBytes = await assessAsset(byteSourceFromBytes(bytes, 'water.xyz'), richContext);
    const fromBlob = await assessAsset(blobSource, richContext);
    expect(canonicalAssessmentJson(fromBytes.report)).toBe(canonicalAssessmentJson(fromBlob.report));
    expect(canonicalAssessmentJson(fromBytes.report)).not.toContain('durationMs');
  });

  it('assesses one-shot streams through the same canonical contract', async () => {
    async function* chunks() {
      const bytes = new TextEncoder().encode(xyz);
      yield bytes.subarray(0, 13);
      yield bytes.subarray(13);
    }
    const streamed = await assessAsset(byteSourceFromStream(chunks(), 'water.xyz', new TextEncoder().encode(xyz).byteLength), richContext);
    const memory = await assessAsset(byteSourceFromText(xyz, 'water.xyz'), richContext);
    expect(canonicalAssessmentJson(streamed.report)).toBe(canonicalAssessmentJson(memory.report));
  });

  it('continues a batch after per-item failures', async () => {
    const failing: ByteSource = { kind: 'bytes', name: 'broken', async readRange() { throw new Error('unreadable'); } };
    const batch = await assessMany([byteSourceFromText(xyz, 'good.xyz'), failing]);
    expect(batch.results).toHaveLength(1);
    expect(batch.failures).toEqual([{ input: 'broken', error: 'unreadable' }]);
  });

  it('enforces independent local and remote concurrency limits', async () => {
    let localActive = 0;
    let remoteActive = 0;
    let maxLocal = 0;
    let maxRemote = 0;
    const makeDelayed = (name: string, locality: 'local' | 'remote'): ByteSource => ({
      kind: 'bytes', name, locality, size: xyz.length,
      async readRange() {
        if (locality === 'local') maxLocal = Math.max(maxLocal, ++localActive);
        else maxRemote = Math.max(maxRemote, ++remoteActive);
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (locality === 'local') localActive--;
        else remoteActive--;
        return new TextEncoder().encode(xyz);
      },
    });
    const sources = [
      ...Array.from({ length: 6 }, (_, i) => makeDelayed(`local-${i}.xyz`, 'local')),
      ...Array.from({ length: 4 }, (_, i) => makeDelayed(`remote-${i}.xyz`, 'remote')),
    ];
    const batch = await assessMany(sources, { localConcurrency: 2, remoteConcurrency: 1 });
    expect(batch.results).toHaveLength(10);
    expect(maxLocal).toBeLessThanOrEqual(2);
    expect(maxRemote).toBeLessThanOrEqual(1);
  });

  it('ranks within class by score while preserving stable ties', async () => {
    const low = (await assessAsset(byteSourceFromText(xyz, 'low.xyz'))).report;
    const high = (await assessAsset(byteSourceFromText(xyz, 'high.xyz'), richContext)).report;
    const tied = { ...low, input: { ...low.input, name: 'tie.xyz' } };
    expect(rankAssessments([low, high, tied]).map((report) => report.input.name)).toEqual(['high.xyz', 'low.xyz', 'tie.xyz']);
  });

  it('assesses 100 small local assets under the reference budget', async () => {
    const sources = Array.from({ length: 100 }, (_, index) => byteSourceFromText(xyz, `${index}.xyz`));
    const started = performance.now();
    const batch = await assessMany(sources);
    expect(batch.results).toHaveLength(100);
    expect(batch.failures).toHaveLength(0);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it('returns diagnostics rather than crashing on malformed byte samples', async () => {
    for (let seed = 0; seed < 64; seed++) {
      const bytes = Uint8Array.from({ length: seed + 1 }, (_, index) => (seed * 31 + index * 17) & 0xff);
      const assessed = await assessAsset(byteSourceFromBytes(bytes, `fuzz-${seed}.bin`));
      expect(assessed.report.diagnostics.length + assessed.report.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('remote safety and request limits', () => {
  it.each([
    'http://localhost/a.xyz',
    'https://127.0.0.1/a.xyz',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.2/a.xyz',
    'https://[::1]/a.xyz',
    'https://[::ffff:127.0.0.1]/a.xyz',
    'https://[::ffff:7f00:1]/a.xyz',
  ])('rejects local, private, or link-local target %s', (url) => {
    expect(() => byteSourceFromUrl(url, { requireHttps: true })).toThrow(/private|HTTPS/i);
  });

  it('uses at most two bounded range requests', async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests++;
      expect(new Headers(init?.headers).get('range')).toMatch(/^bytes=0-/);
      return new Response(xyz, {
        status: 206,
        headers: {
          'content-range': `bytes 0-${new TextEncoder().encode(xyz).length - 1}/${new TextEncoder().encode(xyz).length}`,
          etag: '"fixture-v1"',
        },
      });
    };
    const source = byteSourceFromUrl('https://assets.example.org/water.xyz', {
      requireHttps: true,
      allowedOrigins: ['https://assets.example.org'],
      fetchImpl,
    });
    const assessed = await assessAsset(source);
    expect(assessed.report.observations.format).toBe('xyz');
    expect(requests).toBeLessThanOrEqual(2);
    expect(source.cacheKey).toMatch(/fixture-v1.*[a-f0-9]{16}$/);
  });

  it('rejects servers that ignore a non-zero Range without reading an unbounded body', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => `H ${index} 0 0`).join('\n');
    const largeXyz = `100\nrange ignored\n${rows}\n`;
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests++;
      return new Response(largeXyz, {
        status: 200,
        headers: { 'content-length': String(new TextEncoder().encode(largeXyz).byteLength) },
      });
    };
    const source = byteSourceFromUrl('https://assets.example.org/no-range.xyz', {
      requireHttps: true,
      allowedOrigins: ['https://assets.example.org'],
      fetchImpl,
    });
    await expect(assessAsset(source)).rejects.toThrow(/ignored a non-zero byte range/);
    expect(requests).toBe(2);
  });

  it('retains bounded GLIMBIN header evidence when a frame-index range is ignored', async () => {
    const header = new Uint8Array(256);
    header.set(new TextEncoder().encode('GLIM'));
    const view = new DataView(header.buffer);
    view.setUint16(4, 2, true);
    view.setUint32(8, 1, true);
    view.setUint32(12, 128, true);
    view.setBigUint64(152, 8_000_000n, true);
    header[16] = 2;
    let requests = 0;
    let cancelled = false;
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests++;
      const range = new Headers(init?.headers).get('range');
      if (range === 'bytes=0-255') {
        return new Response(header, { status: 206, headers: { 'content-range': 'bytes 0-255/9000000' } });
      }
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(64 * 1024)); },
        cancel() { cancelled = true; },
      }), { status: 200, headers: { 'content-length': '9000000' } });
    };
    const source = byteSourceFromUrl('https://assets.example.org/offset.glimbin', {
      requireHttps: true,
      allowedOrigins: ['https://assets.example.org'],
      fetchImpl,
    });
    const assessed = await assessAsset(source);
    expect(assessed.report.observations).toMatchObject({ format: 'glimbin', frameCount: 1, frameIndexValid: false });
    expect(assessed.report.diagnostics.map((note) => note.ruleId)).toContain('format.glimbin.frame-index-unavailable');
    expect(requests).toBe(2);
    expect(cancelled).toBe(true);
  });

  it('rejects an unsafe redirect target without following it', async () => {
    let requests = 0;
    const fetchImpl: typeof fetch = async () => {
      requests++;
      return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private.xyz' } });
    };
    const source = byteSourceFromUrl('https://assets.example.org/redirect', {
      requireHttps: true,
      allowedOrigins: ['https://assets.example.org'],
      fetchImpl,
    });
    await expect(assessAsset(source)).rejects.toThrow(/private network|not permitted/);
    expect(requests).toBe(1);
  });

  it('times out remote reads and exposes an item failure instead of hanging a batch', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
    const source = byteSourceFromUrl('https://assets.example.org/slow.xyz', {
      requireHttps: true,
      allowedOrigins: ['https://assets.example.org'],
      timeoutMs: 100,
      fetchImpl,
    });
    const batch = await assessMany([byteSourceFromText(xyz, 'good.xyz'), source]);
    expect(batch.results).toHaveLength(1);
    expect(batch.failures).toHaveLength(1);
  });
});

function makeTrajectory(withBonds: boolean): Trajectory {
  const frame: Frame = {
    timestep: 0,
    natoms: 2,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1, 2]),
    identity: { kind: 'source-id', unique: true },
    types: new Int32Array([1, 1]),
    typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
    positions: new Float32Array([0, 0, 0, 1, 0, 0]),
    bonds: withBonds ? new Int32Array([0, 1]) : new Int32Array(),
    properties: new Map([['force', new Float32Array([0, 0])]]),
  };
  return {
    frames: [frame],
    totalFrames: 1,
    atomTypes: [1],
    globalBounds: { min: [0, 0, 0], max: [1, 0, 0] },
  };
}

function cloneFrame(frame: Frame, overrides: Partial<Frame> = {}): Frame {
  return {
    ...frame,
    boxBounds: new Float64Array(frame.boxBounds),
    boxTilt: new Float64Array(frame.boxTilt),
    columns: [...frame.columns],
    ids: new Int32Array(frame.ids),
    types: new Int32Array(frame.types),
    positions: new Float32Array(frame.positions),
    bonds: new Int32Array(frame.bonds),
    properties: new Map([...frame.properties].map(([name, values]) => [name, new Float32Array(values)])),
    ...overrides,
  };
}

function makeTrajectoryFromFrames(frames: Frame[]): Trajectory {
  const types = new Set<number>();
  for (const frame of frames) for (const type of frame.types) types.add(type);
  return {
    frames,
    totalFrames: frames.length,
    residency: { mode: 'complete' },
    atomTypes: [...types].sort((a, b) => a - b),
    globalBounds: { min: [0, 0, 0], max: [1, 0, 0] },
  };
}
