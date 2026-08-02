import { getAtomicNumberBySymbol, type Trajectory } from '@atlas/core';
import Ajv2020 from 'ajv/dist/2020';
import { CANONICAL_VALUE_SOURCE_ASSETS } from './canonicalValueSourceAssets';
import schema from './lupine.visualization-bundle.v1.schema.json';
import type {
  AnchorPointStatus,
  ModelAnchorInfo,
  ScienceEnergySeries,
  SciencePathData,
  ScienceQualityState,
  SeriesExtrema,
} from './sciencePanelTypes';

const SCHEMA = 'lupine.visualization-bundle.v1' as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

type SourceArtifact = {
  role: string;
  uri: string;
  schema: string | null;
  sha256: string;
  bytes: number;
  git_commit: string | null;
};
type CanonicalSeries = {
  series_id: string;
  engine_or_model: string;
  kind: 'dft_single_point' | 'reference' | 'model';
  unit: string;
  zero_convention: string;
  image_indices: number[];
  values: Array<number | null>;
  value_status: string[];
  value_sources: Array<{ asset_sha256: string; json_pointer: string } | null>;
};
type CanonicalManifest = {
  schema: typeof SCHEMA;
  bundle_id: string;
  campaign_id: string;
  campaign_sha256: string;
  run_id: string;
  path_id: string;
  path_index: number;
  chemical_system: string;
  image_count: number;
  created_at: string;
  status: 'active' | 'superseded' | 'retracted';
  supersedes: string | null;
  retraction: string | null;
  source_artifacts: SourceArtifact[];
  producer: { tool: string; normalized_parameters: Record<string, unknown> };
  model_provenance: Array<{ model: string; status: 'completed' | 'failed' | 'missing'; failure_reason: string | null }>;
  coordinates: {
    units: 'angstrom';
    atom_count: number;
    atom_ids: string[];
    species: string[];
    reaction_coordinate: { definition: string; unit: string; values: number[] };
    frames: Array<{
      image_index: number;
      lattice_angstrom: number[][];
      pbc: boolean[];
      positions_angstrom: number[][];
    }>;
  };
  series: CanonicalSeries[];
  selection: {
    anchor_universe: number[];
    evaluated: number[];
    nominated_union: number[];
    dense_extension: { applied: boolean; supplied_indices: number[] };
    per_model: Record<string, {
      nominated: number[];
      evaluated: number[];
      complete: boolean;
      short_path_fallback: boolean;
      window: number;
      model_min_index: number;
      model_max_index: number;
      sparse_barrier_ev: number;
    }>;
    guidance_misses: Record<string, number[]>;
    guidance_deficits_mev: Record<string, {
      dense_barrier_ev: number;
      same_engine_abs_error_mev: number;
      same_engine_signed_error_mev: number;
      sparse_barrier_ev: number;
    }>;
    subset_theorem: string;
  };
  quality_gates: {
    thresholds_mev: { strong_win: number; win: number; t1_gate: number };
    same_engine: {
      dense_complete: boolean;
      dense_barrier_ev: number | null;
      per_model: Record<string, {
        complete: boolean;
        dense_barrier_ev: number | null;
        same_engine_abs_error_mev: number | null;
        same_engine_signed_error_mev: number | null;
        sparse_barrier_ev: number | null;
        verdict: 'strong_win' | 'win' | 'loss' | 'incomplete';
      }>;
    };
    cross_engine: {
      reference_barrier_ev: number;
      dense_vs_reference_signed_error_mev: number | null;
      dense_vs_reference_abs_error_mev: number | null;
    };
    t1: {
      offset_definition: string;
      offset_series_mev: Array<{ image_index: number; offset_mev: number }>;
      offset_mean_mev: number | null;
      offset_min_mev: number | null;
      offset_max_mev: number | null;
      wander_mev: number | null;
      gate_mev: number;
      verdict: 'clean' | 'contaminated' | 'insufficient_data';
      driver_pair: [number, number] | null;
    };
    verdict: {
      same_engine: 'strong_win' | 'win' | 'loss' | 'incomplete' | 'no_guidance';
      t1: 'clean' | 'contaminated' | 'insufficient_data';
      cross_engine_contaminated: boolean;
      label: string;
    };
  };
  assets: Array<{ sha256: string }>;
  provenance: {
    creators: unknown;
    organization: unknown;
    citation: { dataset: string; doi: string; source_repository: string; source_url: string; theory: string };
    license: string;
    source_revision: {
      reference_dataset_revision: string;
      reference_source_archive_sha256: string;
      converter_git_commit: string | null;
    };
    preregistration: string;
    amendments: string[];
  };
  quality: {
    state: 'complete' | 'partial' | 'invalid' | 'quarantined' | 'verified' | 'published';
    checks: Array<{ name: string; status: string; detail: string }>;
    warnings: string[];
  };
};

function digest(value: string, label: string): string {
  if (!SHA256.test(value)) throw new Error(`Invalid ${label}: expected sha256:<64 lowercase hex>`);
  return value;
}

function decodeJsonPointerToken(token: string): string {
  if (/~(?:[^01]|$)/.test(token)) throw new Error(`invalid JSON pointer escape in ${token}`);
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  if (!pointer.startsWith('/')) throw new Error('JSON pointer must be empty or start with /');
  let current = document;
  for (const encodedToken of pointer.slice(1).split('/')) {
    const token = decodeJsonPointerToken(encodedToken);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new Error(`invalid array index ${token}`);
      const index = Number(token);
      if (index >= current.length) throw new Error(`array index ${token} is out of bounds`);
      current = current[index];
      continue;
    }
    if (current == null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
      throw new Error(`object member ${token} does not exist`);
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function canonicalNumbersAgree(actual: number | null, expected: number | null): boolean {
  if (actual == null || expected == null) return actual === expected;
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-9;
}

function assertDerivedCanonicalValue(label: string, actual: unknown, expected: unknown): void {
  const agrees = typeof actual === 'number' || actual == null
    ? canonicalNumbersAgree(actual as number | null, expected as number | null)
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (!agrees) {
    throw new Error(`Derived canonical value mismatch for ${label}`);
  }
}

function sameEngineVerdict(
  absoluteErrorMev: number | null,
  complete: boolean,
  strongWinMev: number,
  winMev: number,
): 'strong_win' | 'win' | 'loss' | 'incomplete' {
  if (!complete || absoluteErrorMev == null) return 'incomplete';
  if (absoluteErrorMev <= strongWinMev) return 'strong_win';
  if (absoluteErrorMev <= winMev) return 'win';
  return 'loss';
}

function assertExactModelSet(label: string, actual: string[], expected: string[]): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (new Set(actualSorted).size !== actualSorted.length || actualSorted.join('\0') !== expectedSorted.join('\0')) {
    throw new Error(
      `Canonical model-state mismatch at ${label}: expected [${expectedSorted.join(', ')}], got [${actualSorted.join(', ')}]`,
    );
  }
}

function validateCanonicalManifest(input: unknown): CanonicalManifest {
  const candidate = input as { schema?: unknown } | null;
  if (candidate?.schema !== SCHEMA) {
    throw new Error(`Unsupported visualization bundle schema: ${String(candidate?.schema)}`);
  }
  if (!validateSchema(input)) {
    const errors = validateSchema.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Invalid canonical visualization bundle schema: ${errors ?? 'unknown validation error'}`);
  }
  const manifest = input as CanonicalManifest;
  if (manifest.status !== 'active' || manifest.retraction !== null) {
    throw new Error(`Panel requires an active bundle; got status=${manifest.status}`);
  }
  if (manifest.quality.state !== 'verified' && manifest.quality.state !== 'published') {
    throw new Error(`Panel requires verified or published quality; got ${manifest.quality.state}`);
  }
  const failedQualityCheck = manifest.quality.checks.find((check) => check.status !== 'pass');
  if (failedQualityCheck) {
    throw new Error(`Panel rejects failed quality check: ${failedQualityCheck.name}`);
  }

  const wantedImages = Array.from({ length: manifest.image_count }, (_, index) => index);
  const coordinates = manifest.coordinates;
  if (
    coordinates.atom_ids.length !== coordinates.atom_count
    || coordinates.species.length !== coordinates.atom_count
    || new Set(coordinates.atom_ids).size !== coordinates.atom_count
    || coordinates.atom_ids.some((atomId, atom) => atomId !== `a${atom.toString().padStart(3, '0')}`)
    || coordinates.frames.length !== manifest.image_count
    || coordinates.reaction_coordinate.values.length !== manifest.image_count
    || coordinates.reaction_coordinate.values.some((image, index) => image !== wantedImages[index])
    || coordinates.frames.some((frame, image) => (
      frame.image_index !== image
      || frame.positions_angstrom.length !== coordinates.atom_count
    ))
  ) {
    throw new Error('Coordinate cardinality mismatch: atom identity/order, frames, and reaction profile must agree');
  }
  const assets = new Set(manifest.assets.map((asset) => asset.sha256));
  for (const [seriesIndex, series] of manifest.series.entries()) {
    if (series.unit !== 'eV') {
      throw new Error(`Series unit mismatch at series/${seriesIndex}: expected eV, got ${series.unit}`);
    }
    if (
      series.image_indices.length !== manifest.image_count
      || series.values.length !== manifest.image_count
      || series.value_status.length !== manifest.image_count
      || series.value_sources.length !== manifest.image_count
      || series.image_indices.some((image, index) => image !== wantedImages[index])
    ) {
      throw new Error(`Invalid series/${seriesIndex}: profile/image order does not match image_count`);
    }
    for (const [image, source] of series.value_sources.entries()) {
      if (source == null) {
        if (series.values[image] != null) {
          throw new Error(`Unbound value source at series/${seriesIndex}/value_sources/${image}: non-null value has no source`);
        }
        continue;
      }
      if (!assets.has(source.asset_sha256)) {
        throw new Error(`Unbound value source at series/${seriesIndex}/value_sources/${image}: ${source.asset_sha256}`);
      }
      const serializedSource = CANONICAL_VALUE_SOURCE_ASSETS[source.asset_sha256];
      if (serializedSource == null) {
        throw new Error(`Unbound value source at series/${seriesIndex}/value_sources/${image}: frozen asset bytes are unavailable`);
      }
      let resolved: unknown;
      try {
        resolved = resolveJsonPointer(JSON.parse(serializedSource), source.json_pointer);
      } catch (error) {
        throw new Error(
          `Unresolved value source at series/${seriesIndex}/value_sources/${image}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!Object.is(resolved, series.values[image])) {
        throw new Error(`Mismatched value source at series/${seriesIndex}/value_sources/${image}`);
      }
    }
  }

  const denseSeries = manifest.series.find((series) => series.series_id === 'gpaw_total_energy');
  const referenceSeries = manifest.series.find((series) => series.series_id === 'vasp_reference_total_energy');
  if (!denseSeries || !referenceSeries) {
    throw new Error('Derived canonical value mismatch: required GPAW and VASP series are missing');
  }
  const denseExtrema = extrema(denseSeries.values);
  const referenceExtrema = extrema(referenceSeries.values);
  const denseBarrier = denseExtrema.barrierEv;
  const referenceBarrier = referenceExtrema.barrierEv;
  if (denseBarrier == null || referenceBarrier == null) {
    throw new Error('Derived canonical value mismatch: complete GPAW and VASP barriers are required');
  }
  const signedCrossEngineErrorMev = (denseBarrier - referenceBarrier) * 1000;
  assertDerivedCanonicalValue('quality_gates.same_engine.dense_barrier_ev', manifest.quality_gates.same_engine.dense_barrier_ev, denseBarrier);
  assertDerivedCanonicalValue('quality_gates.cross_engine.reference_barrier_ev', manifest.quality_gates.cross_engine.reference_barrier_ev, referenceBarrier);
  assertDerivedCanonicalValue('quality_gates.cross_engine.dense_vs_reference_signed_error_mev', manifest.quality_gates.cross_engine.dense_vs_reference_signed_error_mev, signedCrossEngineErrorMev);
  assertDerivedCanonicalValue('quality_gates.cross_engine.dense_vs_reference_abs_error_mev', manifest.quality_gates.cross_engine.dense_vs_reference_abs_error_mev, Math.abs(signedCrossEngineErrorMev));

  const verdictRank = { strong_win: 0, win: 1, loss: 2, incomplete: 3 } as const;
  const perModelVerdicts: Array<'strong_win' | 'win' | 'loss' | 'incomplete'> = [];
  for (const [model, selection] of Object.entries(manifest.selection.per_model)) {
    const nominatedValues = selection.nominated.map((image) => denseSeries.values[image]);
    if (nominatedValues.some((value) => value == null)) {
      throw new Error(`Derived canonical value mismatch: ${model} nominated an unevaluated GPAW image`);
    }
    const sparseBarrier = extrema(nominatedValues as number[]).barrierEv;
    if (sparseBarrier == null) {
      throw new Error(`Derived canonical value mismatch: ${model} has no nominated GPAW values`);
    }
    const signedSameEngineErrorMev = (sparseBarrier - denseBarrier) * 1000;
    const absoluteSameEngineErrorMev = Math.abs(signedSameEngineErrorMev);
    const deficit = manifest.selection.guidance_deficits_mev[model];
    const gate = manifest.quality_gates.same_engine.per_model[model];
    if (!deficit || !gate) {
      throw new Error(`Derived canonical value mismatch: ${model} guidance evidence is missing`);
    }
    assertDerivedCanonicalValue(`selection.per_model.${model}.sparse_barrier_ev`, selection.sparse_barrier_ev, sparseBarrier);
    assertDerivedCanonicalValue(`selection.guidance_deficits_mev.${model}.dense_barrier_ev`, deficit.dense_barrier_ev, denseBarrier);
    assertDerivedCanonicalValue(`selection.guidance_deficits_mev.${model}.sparse_barrier_ev`, deficit.sparse_barrier_ev, sparseBarrier);
    assertDerivedCanonicalValue(`selection.guidance_deficits_mev.${model}.same_engine_signed_error_mev`, deficit.same_engine_signed_error_mev, signedSameEngineErrorMev);
    assertDerivedCanonicalValue(`selection.guidance_deficits_mev.${model}.same_engine_abs_error_mev`, deficit.same_engine_abs_error_mev, absoluteSameEngineErrorMev);
    assertDerivedCanonicalValue(`quality_gates.same_engine.per_model.${model}.complete`, gate.complete, selection.complete);
    assertDerivedCanonicalValue(`quality_gates.same_engine.per_model.${model}.dense_barrier_ev`, gate.dense_barrier_ev, denseBarrier);
    assertDerivedCanonicalValue(`quality_gates.same_engine.per_model.${model}.sparse_barrier_ev`, gate.sparse_barrier_ev, sparseBarrier);
    assertDerivedCanonicalValue(`quality_gates.same_engine.per_model.${model}.same_engine_signed_error_mev`, gate.same_engine_signed_error_mev, signedSameEngineErrorMev);
    assertDerivedCanonicalValue(`quality_gates.same_engine.per_model.${model}.same_engine_abs_error_mev`, gate.same_engine_abs_error_mev, absoluteSameEngineErrorMev);
    const verdict = sameEngineVerdict(
      absoluteSameEngineErrorMev,
      selection.complete,
      manifest.quality_gates.thresholds_mev.strong_win,
      manifest.quality_gates.thresholds_mev.win,
    );
    assertDerivedCanonicalValue(`quality_gates.same_engine.per_model.${model}.verdict`, gate.verdict, verdict);
    perModelVerdicts.push(verdict);
  }

  const offsets = denseSeries.values.flatMap((denseValue, image) => {
    const referenceValue = referenceSeries.values[image];
    return denseValue == null || referenceValue == null
      ? []
      : [{ image_index: image, offset_mev: (denseValue - referenceValue) * 1000 }];
  });
  const t1 = manifest.quality_gates.t1;
  if (
    t1.offset_series_mev.length !== offsets.length
    || t1.offset_series_mev.some((offset, index) => (
      offset.image_index !== offsets[index]?.image_index
      || !canonicalNumbersAgree(offset.offset_mev, offsets[index]?.offset_mev ?? null)
    ))
  ) {
    throw new Error('Derived canonical value mismatch for quality_gates.t1.offset_series_mev');
  }
  if (offsets.length === 0) {
    assertDerivedCanonicalValue('quality_gates.t1.offset_mean_mev', t1.offset_mean_mev, null);
    assertDerivedCanonicalValue('quality_gates.t1.offset_min_mev', t1.offset_min_mev, null);
    assertDerivedCanonicalValue('quality_gates.t1.offset_max_mev', t1.offset_max_mev, null);
    assertDerivedCanonicalValue('quality_gates.t1.wander_mev', t1.wander_mev, null);
    assertDerivedCanonicalValue('quality_gates.t1.driver_pair', t1.driver_pair, null);
    assertDerivedCanonicalValue('quality_gates.t1.verdict', t1.verdict, 'insufficient_data');
  } else {
    const minimumOffset = offsets.reduce((minimum, offset) => offset.offset_mev < minimum.offset_mev ? offset : minimum);
    const maximumOffset = offsets.reduce((maximum, offset) => offset.offset_mev > maximum.offset_mev ? offset : maximum);
    const offsetMean = offsets.reduce((sum, offset) => sum + offset.offset_mev, 0) / offsets.length;
    const wander = maximumOffset.offset_mev - minimumOffset.offset_mev;
    assertDerivedCanonicalValue('quality_gates.t1.offset_mean_mev', t1.offset_mean_mev, offsetMean);
    assertDerivedCanonicalValue('quality_gates.t1.offset_min_mev', t1.offset_min_mev, minimumOffset.offset_mev);
    assertDerivedCanonicalValue('quality_gates.t1.offset_max_mev', t1.offset_max_mev, maximumOffset.offset_mev);
    assertDerivedCanonicalValue('quality_gates.t1.wander_mev', t1.wander_mev, wander);
    assertDerivedCanonicalValue('quality_gates.t1.driver_pair', t1.driver_pair, [minimumOffset.image_index, maximumOffset.image_index]);
    assertDerivedCanonicalValue('quality_gates.t1.verdict', t1.verdict, wander <= t1.gate_mev ? 'clean' : 'contaminated');
  }
  assertDerivedCanonicalValue('quality_gates.thresholds_mev.t1_gate', manifest.quality_gates.thresholds_mev.t1_gate, t1.gate_mev);
  const expectedSameEngineVerdict = perModelVerdicts.length === 0
    ? 'no_guidance'
    : perModelVerdicts.reduce((worst, verdict) => (
      verdictRank[verdict] > verdictRank[worst] ? verdict : worst
    ));
  assertDerivedCanonicalValue('quality_gates.verdict.same_engine', manifest.quality_gates.verdict.same_engine, expectedSameEngineVerdict);
  assertDerivedCanonicalValue('quality_gates.verdict.t1', manifest.quality_gates.verdict.t1, t1.verdict);
  assertDerivedCanonicalValue(
    'quality_gates.verdict.cross_engine_contaminated',
    manifest.quality_gates.verdict.cross_engine_contaminated,
    t1.verdict === 'contaminated',
  );
  assertDerivedCanonicalValue(
    'quality_gates.verdict.label',
    manifest.quality_gates.verdict.label,
    `${expectedSameEngineVerdict}_t1_${t1.verdict}`,
  );

  const sourceRoles = new Set(manifest.source_artifacts.map((source) => source.role));
  for (const role of ['campaign_record', 'barrier_panel', 'anchor_receipt', 'model_cell_result']) {
    if (!sourceRoles.has(role)) throw new Error(`Invalid source_artifacts: required role ${role} is missing`);
  }
  return manifest;
}

async function sha256(text: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function panelSeriesId(series: CanonicalSeries): string {
  if (series.series_id === 'gpaw_total_energy') return 'gpaw-anchors';
  if (series.series_id === 'vasp_reference_total_energy') return 'vasp-reference';
  if (series.series_id.startsWith('model_total_energy/')) return `model-${series.engine_or_model}`;
  throw new Error(`Unsupported canonical series ${series.series_id}`);
}

function extrema(values: Array<number | null>): SeriesExtrema {
  const observed = values.flatMap((value, image) => value == null ? [] : [{ image, value }]);
  if (observed.length === 0) throw new Error('Cannot derive extrema from an all-missing series');
  let minimum = observed[0];
  let maximum = observed[0];
  for (const point of observed.slice(1)) {
    if (point.value < minimum.value) minimum = point;
    if (point.value > maximum.value) maximum = point;
  }
  return {
    argmin: minimum.image,
    argmax: maximum.image,
    barrierEv: maximum.value - minimum.value,
    tieRule: 'first-index',
  };
}

function pointStatus(status: string, value: number | null): AnchorPointStatus {
  if (value == null) return status === 'failed' ? 'missing' : 'nominated';
  return status === 'evaluated' ? 'evaluated' : 'source';
}

function qualityState(manifest: CanonicalManifest, successful: number, failed: number): ScienceQualityState {
  if (successful === 0 && failed === manifest.model_provenance.length) return 'all-guides-failed';
  if (successful === 0) return 'no-guides-completed';
  if (manifest.quality_gates.t1.verdict === 'clean') return 'clean';
  return manifest.quality_gates.verdict.same_engine === 'strong_win'
    ? 'strong-win-contaminated'
    : 'contaminated';
}

/** Versioned canonical v1 → panel view-model adapter. Unknown/invalid schemas fail closed. */
export function adaptVisualizationBundle(
  input: unknown,
  manifestSha256: string,
  supersedesChain?: string[],
): SciencePathData {
  const manifest = validateCanonicalManifest(input);
  digest(manifestSha256, 'serialized manifest SHA-256');
  const resolvedSupersedesChain = supersedesChain ?? (manifest.supersedes ? [manifest.supersedes] : []);
  if (manifest.supersedes !== (resolvedSupersedesChain[0] ?? null)) {
    throw new Error('Invalid supersedes chain: immediate predecessor does not match the manifest');
  }
  const provenanceModelNames = manifest.model_provenance.map((model) => model.model);
  if (new Set(provenanceModelNames).size !== provenanceModelNames.length) {
    throw new Error('Canonical model-state mismatch: model_provenance contains duplicate model identities');
  }
  const successfulModels = manifest.model_provenance.filter((model) => model.status === 'completed');
  const failedModels = manifest.model_provenance.filter((model) => model.status === 'failed');
  const missingModels = manifest.model_provenance.filter((model) => model.status === 'missing');
  const completedModelNames = successfulModels.map((model) => model.model);
  assertExactModelSet(
    'series[series_id=model_total_energy/*]',
    manifest.series
      .filter((source) => source.series_id.startsWith('model_total_energy/'))
      .map((source) => source.engine_or_model),
    completedModelNames,
  );
  assertExactModelSet('selection.per_model', Object.keys(manifest.selection.per_model), completedModelNames);
  assertExactModelSet(
    'selection.guidance_deficits_mev',
    Object.keys(manifest.selection.guidance_deficits_mev),
    completedModelNames,
  );
  assertExactModelSet('selection.guidance_misses', Object.keys(manifest.selection.guidance_misses), completedModelNames);
  assertExactModelSet(
    'quality_gates.same_engine.per_model',
    Object.keys(manifest.quality_gates.same_engine.per_model),
    completedModelNames,
  );
  const denseExtension = new Set(manifest.selection.dense_extension.supplied_indices);
  const series: ScienceEnergySeries[] = manifest.series.map((source) => ({
    id: panelSeriesId(source),
    label: source.kind === 'reference'
      ? 'VASP reference'
      : source.kind === 'dft_single_point' ? 'GPAW anchors' : source.engine_or_model,
    engine: source.engine_or_model,
    role: source.kind === 'reference'
      ? 'cross-engine reference — secondary'
      : source.kind === 'dft_single_point' ? 'same-engine evidence — primary' : 'guiding model profile',
    unit: 'eV',
    zeroConvention: source.zero_convention,
    points: source.values.map((energyEv, image) => ({
      image,
      energyEv,
      status: pointStatus(source.value_status[image], energyEv),
      ...(denseExtension.has(image) && source.series_id === 'gpaw_total_energy' ? { denseExtension: true } : {}),
    })),
  }));
  const extremaBySeries = Object.fromEntries(
    manifest.series.map((source) => [panelSeriesId(source), extrema(source.values)]),
  );
  const perModel: Record<string, ModelAnchorInfo> = {};
  for (const model of manifest.model_provenance) {
    const selected = manifest.selection.per_model[model.model];
    const deficit = manifest.selection.guidance_deficits_mev[model.model];
    perModel[model.model] = selected ? {
      status: model.status,
      nominated: selected.nominated,
      evaluated: selected.evaluated,
      complete: selected.complete,
      shortPathFallback: selected.short_path_fallback,
      window: selected.window,
      modelMinIndex: selected.model_min_index,
      modelMaxIndex: selected.model_max_index,
      sparseBarrierEv: selected.sparse_barrier_ev,
      sameEngineAbsErrorMev: deficit?.same_engine_abs_error_mev ?? null,
      vaspAbsErrorMev: manifest.quality_gates.cross_engine.dense_vs_reference_abs_error_mev,
      profileAvailable: true,
    } : {
      status: model.status,
      nominated: [], evaluated: [], complete: false,
      shortPathFallback: null, window: null, modelMinIndex: null, modelMaxIndex: null,
      sparseBarrierEv: null, sameEngineAbsErrorMev: null, vaspAbsErrorMev: null,
      profileAvailable: false,
    };
  }

  const t1 = manifest.quality_gates.t1;
  const denseBarrier = manifest.quality_gates.same_engine.dense_barrier_ev;
  const signedCrossEngine = manifest.quality_gates.cross_engine.dense_vs_reference_signed_error_mev;
  const absoluteCrossEngine = manifest.quality_gates.cross_engine.dense_vs_reference_abs_error_mev;
  if (
    t1.offset_mean_mev == null || t1.wander_mev == null || t1.driver_pair == null
    || t1.verdict === 'insufficient_data' || denseBarrier == null
    || signedCrossEngine == null || absoluteCrossEngine == null
  ) {
    throw new Error('Unsupported canonical bundle: panel requires complete barrier and T1 evidence');
  }
  const sources = manifest.source_artifacts;
  const sourceDigests = (role: string) => sources.filter((source) => source.role === role).map((source) => source.sha256);
  const state = qualityState(manifest, successfulModels.length, failedModels.length);

  return {
    revision: {
      schema: SCHEMA,
      bundleId: manifest.bundle_id,
      manifestSha256,
      provenance: {
        citation: manifest.provenance.citation,
        license: manifest.provenance.license,
        sourceRevision: manifest.provenance.source_revision,
        preregistration: manifest.provenance.preregistration,
        amendments: manifest.provenance.amendments,
      },
      campaignSha256: manifest.campaign_sha256,
      campaignId: manifest.campaign_id,
      runId: manifest.run_id,
      status: 'active',
      supersedes: manifest.supersedes,
      supersedesChain: resolvedSupersedesChain,
      retraction: null,
      qualityState: manifest.quality.state as 'verified' | 'published',
      qualityChecks: manifest.quality.checks,
      qualityWarnings: manifest.quality.warnings,
      sourceArtifacts: sources.map((source) => ({
        role: source.role,
        uri: source.uri,
        schema: source.schema,
        sha256: source.sha256,
        bytes: source.bytes,
        gitCommit: source.git_commit,
      })),
      sources: {
        campaign: sourceDigests('campaign_record')[0],
        barrierLock: sourceDigests('barrier_panel')[0],
        anchorReceipts: sourceDigests('anchor_receipt'),
        modelArtifacts: sourceDigests('model_cell_result'),
      },
    },
    pathIndex: manifest.path_index,
    pathId: manifest.path_id,
    chemicalSystem: manifest.chemical_system,
    imageCount: manifest.image_count,
    qualityState: state,
    quality: {
      state,
      t1Verdict: t1.verdict,
      sameEngineStrongWin: manifest.quality_gates.verdict.same_engine === 'strong_win',
      guidedModelCount: successfulModels.length,
      failedModelCount: failedModels.length,
      missingModelCount: missingModels.length,
      modelDenominator: manifest.model_provenance.length,
      crossEngineErrorMev: absoluteCrossEngine,
      crossEngineSignedErrorMev: signedCrossEngine,
      crossEngineLooksAcceptable: absoluteCrossEngine <= manifest.quality_gates.thresholds_mev.win,
    },
    reactionCoordinate: {
      label: 'NEB image index',
      unit: manifest.coordinates.reaction_coordinate.unit,
      definition: manifest.coordinates.reaction_coordinate.definition,
    },
    barriers: {
      referenceBarrierEv: manifest.quality_gates.cross_engine.reference_barrier_ev,
      denseBarrierEv: denseBarrier,
      denseVsVaspSignedErrorMev: signedCrossEngine,
      vaspSaddleImageIndex: extremaBySeries['vasp-reference'].argmax,
    },
    series,
    extrema: extremaBySeries,
    anchors: {
      universe: manifest.selection.anchor_universe,
      evaluated: manifest.selection.evaluated,
      unionNominated: manifest.selection.nominated_union,
      denseExtensionImages: manifest.selection.dense_extension.supplied_indices,
      anchorsMissing: manifest.selection.anchor_universe.filter((image) => !manifest.selection.evaluated.includes(image)),
      perModel,
    },
    dense: {
      applied: manifest.selection.dense_extension.applied,
      complete: manifest.quality_gates.same_engine.dense_complete,
      barrierEv: denseBarrier,
    },
    t1: {
      unit: 'meV',
      definition: t1.offset_definition,
      offsets: Array.from({ length: manifest.image_count }, (_, image) => {
        const offset = t1.offset_series_mev.find((entry) => entry.image_index === image);
        return offset
          ? { image, offsetMev: offset.offset_mev, status: 'evaluated' }
          : { image, offsetMev: null, status: 'missing' };
      }),
      offsetMeanMev: t1.offset_mean_mev,
      wanderMev: t1.wander_mev,
      thresholdMev: t1.gate_mev,
      verdict: t1.verdict,
      driverPair: t1.driver_pair,
      evaluatedImageCount: t1.offset_series_mev.length,
    },
    guidance: {
      misses: [
        ...failedModels.map((model) => ({ model: model.model, kind: 'model-failed' as const, reason: model.failure_reason ?? 'model unavailable' })),
        ...missingModels.map((model) => ({ model: model.model, kind: 'model-missing' as const, reason: model.failure_reason ?? 'model evidence missing' })),
        ...Object.entries(manifest.selection.guidance_misses)
          .filter(([, images]) => images.length > 0)
          .map(([model, images]) => ({
            model,
            kind: 'extremum-missed' as const,
            missedImages: images,
            sameEngineAbsErrorMev: manifest.selection.guidance_deficits_mev[model]?.same_engine_abs_error_mev ?? null,
          })),
      ],
      subsetTheorem: manifest.selection.subset_theorem,
    },
  };
}

function vectorLength(v: number[]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/** Cell semantics must agree with positions before a trajectory may present bundle science. */
function verifyTrajectoryLattice(manifest: CanonicalManifest, trajectory: Trajectory): void {
  manifest.coordinates.frames.forEach((sourceFrame, image) => {
    const frame = trajectory.frames[image];
    const lattice = sourceFrame.lattice_angstrom;
    if (!frame || !lattice || lattice.length !== 3) {
      throw new Error(`Cell mismatch at NEB image ${image}: manifest lattice is unavailable`);
    }
    const [xlo, xhi, ylo, yhi, zlo, zhi] = Array.from(frame.boxBounds);
    const spans = [xhi - xlo, yhi - ylo, zhi - zlo];
    const lengths = lattice.map(vectorLength);
    spans.forEach((span, axis) => {
      if (Math.abs(span - lengths[axis]) > 1e-4) {
        throw new Error(
          `Cell mismatch at NEB image ${image}: box span ${axis} is ${span.toFixed(5)} Å but the canonical lattice is ${lengths[axis].toFixed(5)} Å`,
        );
      }
    });
    const [xy, xz, yz] = Array.from(frame.boxTilt);
    if (frame.triclinic) {
      const tilts: Array<[number, [number, number], number]> = [
        [xy, [1, 0], lattice[1][0]],
        [xz, [2, 0], lattice[2][0]],
        [yz, [2, 1], lattice[2][1]],
      ];
      for (const [expected, [row, col], actual] of tilts) {
        if (Math.abs(actual - expected) > 1e-4) {
          throw new Error(
            `Cell mismatch at NEB image ${image}: triclinic tilt differs from the canonical lattice (${actual.toFixed(5)} vs ${expected.toFixed(5)})`,
          );
        }
      }
    } else {
      const offDiagonal = [
        lattice[0][1], lattice[0][2], lattice[1][0],
        lattice[1][2], lattice[2][0], lattice[2][1],
      ];
      if (offDiagonal.some((component) => Math.abs(component) > 1e-4)) {
        throw new Error(`Cell mismatch at NEB image ${image}: orthogonal box cannot carry a non-orthogonal canonical lattice`);
      }
    }
  });
}

function assertIndexSet(indices: number[], imageCount: number, label: string): void {
  indices.forEach((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= imageCount) {
      throw new Error(`Anchor set ${label} contains out-of-range image ${index} (image_count=${imageCount})`);
    }
  });
}

/** Status and value must never contradict: evaluated ↔ numeric, anything else ↔ null. */
function verifySeriesConsistency(manifest: CanonicalManifest): void {
  const NON_EVALUATED = new Set(['failed', 'missing', 'rejected_params_mismatch', 'not_recorded']);
  manifest.series.forEach((series) => {
    series.values.forEach((value, image) => {
      const status = series.value_status[image];
      if (status === 'evaluated' && value == null) {
        throw new Error(`Series ${series.series_id} declares image ${image} evaluated but carries no value`);
      }
      if (NON_EVALUATED.has(status) && value != null) {
        throw new Error(
          `Series ${series.series_id} declares image ${image} ${status} but carries a numeric value; contradictory evidence cannot be plotted`,
        );
      }
    });
  });
}

/** Pinned anchor evidence must be internally consistent before it may be projected. */
function verifyAnchorSets(manifest: CanonicalManifest): void {
  const imageCount = manifest.image_count;
  const selection = manifest.selection;
  assertIndexSet(selection.anchor_universe, imageCount, 'anchor_universe');
  assertIndexSet(selection.evaluated, imageCount, 'evaluated');
  assertIndexSet(selection.nominated_union, imageCount, 'nominated_union');
  assertIndexSet(selection.dense_extension.supplied_indices, imageCount, 'dense_extension');
  for (const [model, perModel] of Object.entries(selection.per_model)) {
    assertIndexSet(perModel.nominated, imageCount, `per_model.${model}.nominated`);
    assertIndexSet(perModel.evaluated, imageCount, `per_model.${model}.evaluated`);
  }
  const universe = new Set(selection.anchor_universe);
  const evaluated = new Set(selection.evaluated);
  const union = new Set(selection.nominated_union);
  if (!selection.nominated_union.every((image) => universe.has(image))) {
    throw new Error('Anchor set nominated_union is not contained in anchor_universe');
  }
  const successfulNominated = new Set<number>();
  for (const model of manifest.model_provenance) {
    if (model.status === 'completed') {
      selection.per_model[model.model]?.nominated.forEach((image) => successfulNominated.add(image));
    }
  }
  if (successfulNominated.size !== union.size || [...successfulNominated].some((image) => !union.has(image))) {
    throw new Error('Anchor set nominated_union does not equal the union of successful per-model nominations');
  }
  const expectedExtension = new Set([...evaluated].filter((image) => !union.has(image)));
  const suppliedExtension = new Set(selection.dense_extension.supplied_indices);
  if (
    suppliedExtension.size !== expectedExtension.size
    || [...suppliedExtension].some((image) => !expectedExtension.has(image))
  ) {
    throw new Error('Dense-extension set does not equal evaluated minus nominated_union');
  }
}

function verifyTrajectoryAtomOrder(manifest: CanonicalManifest, trajectory: Trajectory): void {
  if (trajectory.totalFrames !== manifest.image_count || trajectory.frames.length !== manifest.image_count) {
    throw new Error(`Trajectory/profile frame mismatch: expected ${manifest.image_count}, got ${trajectory.totalFrames}`);
  }
  const expectedTypes = manifest.coordinates.species.map((symbol) => getAtomicNumberBySymbol(symbol)!);
  manifest.coordinates.frames.forEach((sourceFrame, image) => {
    const frame = trajectory.frames[image];
    if (
      !frame || frame.natoms !== manifest.coordinates.atom_count
      || frame.types.length !== expectedTypes.length
      || (frame.identity?.kind !== 'source-order' && frame.identity?.kind !== 'synthetic-row')
      || frame.identity.unique !== true
      || frame.typeSemantics?.kind !== 'atomic-number'
      || !frame.ids || frame.ids.length !== manifest.coordinates.atom_count
    ) {
      throw new Error(`Atom identity/order mismatch at NEB image ${image}: authoritative source order is unavailable`);
    }
    if (manifest.coordinates.units !== 'angstrom' || frame.distanceSemantics?.kind !== 'angstrom') {
      throw new Error(`Trajectory unit mismatch at NEB image ${image}: expected ${manifest.coordinates.units}`);
    }
    expectedTypes.forEach((atomicNumber, atom) => {
      if (frame.ids![atom] !== atom + 1 || frame.types[atom] !== atomicNumber) {
        throw new Error(`Atom identity/order mismatch at NEB image ${image}, atom ${atom}`);
      }
    });
    const expectedPositions = sourceFrame.positions_angstrom.flat();
    if (frame.positions.length !== expectedPositions.length) {
      throw new Error(`Atom identity/order mismatch at NEB image ${image}: position cardinality differs`);
    }
    expectedPositions.forEach((position, coordinate) => {
      const actualPosition = frame.positions[coordinate];
      if (
        !Number.isFinite(position)
        || !Number.isFinite(actualPosition)
        || Math.abs(actualPosition - position) > 1e-5
      ) {
        throw new Error(`Atom identity/order mismatch at NEB image ${image}, coordinate ${coordinate}`);
      }
    });
  });
}

async function verifyCanonicalManifest({
  serializedManifest,
  expectedManifestSha256,
  supersedesChain,
}: {
  serializedManifest: string;
  expectedManifestSha256: string;
  supersedesChain?: string[];
}): Promise<{ manifest: CanonicalManifest; path: SciencePathData }> {
  digest(expectedManifestSha256, 'expected serialized manifest SHA-256');
  const actualManifestSha256 = await sha256(serializedManifest);
  if (actualManifestSha256 !== expectedManifestSha256) {
    throw new Error(`Manifest SHA-256 mismatch: expected ${expectedManifestSha256}, got ${actualManifestSha256}`);
  }
  const manifest = validateCanonicalManifest(JSON.parse(serializedManifest));
  const identityLine = `  "bundle_id": "${manifest.bundle_id}",\n`;
  if (serializedManifest.split(identityLine).length !== 2) {
    throw new Error('Canonical bundle_id line is missing or duplicated');
  }
  const computedBundleId = await sha256(serializedManifest.replace(identityLine, ''));
  if (computedBundleId !== manifest.bundle_id) {
    throw new Error(`Canonical bundle_id mismatch: expected ${manifest.bundle_id}, got ${computedBundleId}`);
  }
  const referencedValueSourceDigests = new Set(
    manifest.series.flatMap((series) => series.value_sources.flatMap((source) => (
      source == null ? [] : [source.asset_sha256]
    ))),
  );
  for (const sourceDigest of referencedValueSourceDigests) {
    const serializedSource = CANONICAL_VALUE_SOURCE_ASSETS[sourceDigest];
    if (serializedSource == null) {
      throw new Error(`Value-source asset bytes unavailable: ${sourceDigest}`);
    }
    const actualSourceDigest = await sha256(serializedSource);
    if (actualSourceDigest !== sourceDigest) {
      throw new Error(`Value-source asset SHA-256 mismatch: expected ${sourceDigest}, got ${actualSourceDigest}`);
    }
  }
  return {
    manifest,
    path: adaptVisualizationBundle(manifest, actualManifestSha256, supersedesChain),
  };
}

/** Manifest bytes, canonical identity, and frozen source bindings pass or nothing is returned. */
export async function verifyVisualizationManifest({
  serializedManifest,
  expectedManifestSha256,
  supersedesChain,
}: {
  serializedManifest: string;
  expectedManifestSha256: string;
  supersedesChain?: string[];
}): Promise<SciencePathData> {
  return (await verifyCanonicalManifest({
    serializedManifest,
    expectedManifestSha256,
    supersedesChain,
  })).path;
}

/** Manifest bytes, canonical identity, source bindings, and atom order pass or nothing is returned. */
export async function verifyVisualizationBundle({
  serializedManifest,
  expectedManifestSha256,
  trajectory,
  supersedesChain,
}: {
  serializedManifest: string;
  expectedManifestSha256: string;
  trajectory: Trajectory;
  supersedesChain?: string[];
}): Promise<SciencePathData> {
  const verified = await verifyCanonicalManifest({
    serializedManifest,
    expectedManifestSha256,
    supersedesChain,
  });
  verifyTrajectoryAtomOrder(verified.manifest, trajectory);
  verifyTrajectoryLattice(verified.manifest, trajectory);
  verifyAnchorSets(verified.manifest);
  verifySeriesConsistency(verified.manifest);
  return verified.path;
}
