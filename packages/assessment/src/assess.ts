import type { Frame, Trajectory } from '@atlas/core/types';
import { averageFacets, ASSET_CLASS_ORDER, facetFromPoints, makeRankKey, notApplicableFacet, pointsForGrade, unratedFacet } from './grades';
import { BUILT_IN_INSPECTORS, decodeSample } from './inspectors';
import { byteSourceFromBytes, byteSourceFromText, decodeBase64, sampleFingerprint, trajectorySource } from './sources';
import type {
  AssetClass,
  AssessmentBatchResult,
  AssessmentContext,
  AssessmentExecution,
  AssessmentReport,
  AssessmentRunResult,
  AssessmentSource,
  AssessManyOptions,
  AssessOptions,
  ByteSource,
  EnvelopeSource,
  FacetAssessment,
  InspectionResult,
  RankOptions,
  TrajectorySource,
} from './types';
import { ASSESSMENT_RULESET_VERSION, ASSESSMENT_SCHEMA_VERSION } from './types';

const DEFAULT_FAST_BYTES = 128 * 1024;
const DEFAULT_READ_OPERATIONS = 2;

export async function assessAsset(
  input: AssessmentSource,
  context?: AssessmentContext,
  options: AssessOptions = {},
): Promise<AssessmentRunResult> {
  const started = performance.now();
  const mode = options.mode ?? 'fast';
  const normalized = normalizeSource(input, context);
  let inspection: InspectionResult;
  let fingerprint: string;
  let bytesRead = 0;
  let readOperations = 0;

  if (normalized.source.kind === 'trajectory') {
    inspection = inspectTrajectory(normalized.source, normalized.context, mode);
    fingerprint = trajectoryFingerprint(normalized.source);
  } else {
    const maxFastBytes = Math.max(4_096, options.maxFastBytes ?? DEFAULT_FAST_BYTES);
    const maxReadOperations = Math.max(1, options.maxReadOperations ?? DEFAULT_READ_OPERATIONS);
    const observedSource = wrapByteSource(normalized.source, {
      mode,
      maxFastBytes,
      maxReadOperations,
      onRead(bytes) { bytesRead += bytes; readOperations++; },
    });
    const prefixLimit = Math.min(normalized.source.size ?? 256, 256, maxFastBytes);
    const prefix = await observedSource.readRange(0, prefixLimit);
    let sample = prefix;
    const isGlimbin = prefix.byteLength >= 4 && new TextDecoder().decode(prefix.subarray(0, 4)) === 'GLIM';
    if (!isGlimbin) {
      const sampleTarget = Math.min(observedSource.size ?? maxFastBytes, maxFastBytes);
      if (prefix.byteLength === prefixLimit && prefix.byteLength < sampleTarget) {
        const tail = await observedSource.readRange(prefix.byteLength, sampleTarget);
        sample = concatenateBytes(prefix, tail);
      }
    }
    fingerprint = `${normalized.source.size ?? 'unknown'}:${sampleFingerprint(sample)}`;
    const sampleText = decodeSample(sample);
    const inspectors = options.inspectors ?? BUILT_IN_INSPECTORS;
    const inspector = inspectors
      .map((candidate, index) => ({ candidate, index, score: candidate.detect({ source: observedSource, sample, sampleText }) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.candidate;
    if (!inspector) throw new Error('No asset inspectors are registered.');
    inspection = await inspector.inspect({ source: observedSource, sample, sampleText, context: normalized.context, mode });
    if (mode === 'deep') {
      inspection = await deepenInspection(observedSource, inspection);
    }
  }

  const report = buildReport(
    normalized.source.name,
    normalized.source.size,
    fingerprint,
    inspection,
    normalized.context,
  );
  const execution: AssessmentExecution = {
    mode,
    bytesRead,
    readOperations,
    durationMs: round3(performance.now() - started),
  };
  return { report, execution };
}

export async function assessMany(
  inputs: Array<AssessmentSource | { source: AssessmentSource; context?: AssessmentContext }>,
  options: AssessManyOptions = {},
): Promise<AssessmentBatchResult> {
  const indexed = inputs.map((entry, index) => ({
    index,
    source: 'source' in entry ? entry.source : entry,
    context: 'source' in entry ? entry.context : undefined,
  }));
  const local = indexed.filter((entry) => !(entry.source.kind === 'bytes' && entry.source.locality === 'remote'));
  const remote = indexed.filter((entry) => entry.source.kind === 'bytes' && entry.source.locality === 'remote');
  const completed: Array<{ index: number; result?: AssessmentRunResult; error?: string; input: string }> = [];

  await Promise.all([
    runPool(local, Math.max(1, options.localConcurrency ?? 8), completed, options),
    runPool(remote, Math.max(1, options.remoteConcurrency ?? 4), completed, options),
  ]);

  completed.sort((a, b) => a.index - b.index);
  return {
    results: completed.flatMap((entry) => entry.result ? [entry.result] : []),
    failures: completed.flatMap((entry) => entry.error ? [{ input: entry.input, error: entry.error }] : []),
  };
}

export function rankAssessments(reports: AssessmentReport[], options: RankOptions = {}): AssessmentReport[] {
  const indexed = reports.map((report, index) => ({ report, index }));
  indexed.sort((a, b) => {
    if (options.groupByClass !== false) {
      const classDiff = classIndex(a.report.classification.effective) - classIndex(b.report.classification.effective);
      if (classDiff) return classDiff;
    }
    const overallDiff = (b.report.overall.points ?? -1) - (a.report.overall.points ?? -1);
    if (overallDiff) return overallDiff;
    const totalDiff = facetTotal(b.report) - facetTotal(a.report);
    if (totalDiff) return totalDiff;
    const evidenceDiff = (b.report.facets.evidenceAccuracy.points ?? -1) - (a.report.facets.evidenceAccuracy.points ?? -1);
    return evidenceDiff || a.index - b.index;
  });
  return indexed.map((entry) => entry.report);
}

export function canonicalAssessmentJson(report: AssessmentReport): string {
  return JSON.stringify(sortObject(report));
}

function normalizeSource(
  input: AssessmentSource,
  context?: AssessmentContext,
): { source: ByteSource | TrajectorySource; context?: AssessmentContext } {
  if (input.kind !== 'envelope') return { source: input, context };
  return normalizeEnvelope(input, context);
}

function normalizeEnvelope(
  source: EnvelopeSource,
  suppliedContext?: AssessmentContext,
): { source: ByteSource | TrajectorySource; context?: AssessmentContext } {
  const envelope = source.envelope;
  const context = mergeContext(envelope.context, suppliedContext);
  if (envelope.trajectory) {
    return { source: trajectorySource(envelope.trajectory, { name: source.name, cacheKey: source.cacheKey }), context };
  }
  if (typeof envelope.text === 'string') {
    return { source: byteSourceFromText(envelope.text, source.name), context };
  }
  if (typeof envelope.bytesBase64 === 'string') {
    return { source: byteSourceFromBytes(decodeBase64(envelope.bytesBase64), source.name), context };
  }
  if (envelope.procedural) {
    const defaultClass = context?.metadata?.scientific === false || context?.metadata?.domain === 'visualization'
      ? 'visualization-demo'
      : 'procedural-scientific-model';
    const proceduralPayload = JSON.stringify({
      procedural: true,
      kind: 'procedural',
      metadata: context?.metadata,
    });
    return { source: byteSourceFromText(proceduralPayload, `${source.name}.json`), context: mergeContext(context, { declaredClass: context?.declaredClass ?? defaultClass }) };
  }
  return { source: byteSourceFromText(JSON.stringify(envelope), `${source.name}.json`), context };
}

function inspectTrajectory(source: TrajectorySource, context: AssessmentContext | undefined, mode: 'fast' | 'deep'): InspectionResult {
  const trajectory = source.trajectory;
  const totalFrames = authoritativeFrameCount(trajectory);
  const resident = residentFrameEntries(trajectory);
  const inspectedEntries = mode === 'deep' ? resident : sampleResidentFrames(resident);
  const inspected = inspectedEntries.map((entry) => entry.frame);
  const first = resident[0]?.frame;
  const residencyComplete = resident.length === totalFrames
    && resident.every((entry, index) => entry.index === index);
  const identityCoverageComplete = residencyComplete && inspectedEntries.length === resident.length;
  let finiteCoordinates = inspected.length > 0;
  let coordinateShapeValid = inspected.length > 0;
  let typeShapeValid = inspected.length > 0;
  let hasProperties = false;
  let hasBonds = false;
  let hasCell = false;
  const propertyNames = new Set<string>();
  for (const frame of inspected) {
    coordinateShapeValid &&= frame.positions.length === frame.natoms * 3;
    typeShapeValid &&= frame.types.length === frame.natoms;
    const positionLimit = mode === 'deep' ? frame.positions.length : Math.min(frame.positions.length, 3_072);
    for (let i = 0; i < positionLimit; i++) {
      if (!Number.isFinite(frame.positions[i])) { finiteCoordinates = false; break; }
    }
    hasProperties ||= frame.properties.size > 0;
    frame.properties.forEach((_values, name) => propertyNames.add(name));
    hasBonds ||= frame.bonds.length > 0;
    hasCell ||= validCell(frame);
  }
  const identity = inspectIdentity(inspected, mode, identityCoverageComplete);
  // Frame.bonds carries materialized connectivity but no provenance field.
  // Caller context is declared metadata, so it cannot promote those bonds to
  // assessor-observed source topology.
  const sourceBonds = false;
  const inferredBonds = hasBonds;
  const timesteps = new Set(resident.map((entry) => entry.frame.timestep));
  const mlipEvidence = contextContains(context, /mlip|chgnet|mace|nequip|gap/i);
  const diagnostics: InspectionResult['diagnostics'] = [];
  const gaps: InspectionResult['gaps'] = [];
  const limitations: InspectionResult['limitations'] = [];

  if (!Number.isSafeInteger(trajectory.totalFrames) || trajectory.totalFrames < 0) {
    diagnostics.push({ ruleId: 'trajectory.total-frames.invalid', message: 'Trajectory.totalFrames is not a non-negative safe integer.' });
  }
  if (resident.some((entry) => entry.index >= totalFrames)) {
    diagnostics.push({ ruleId: 'trajectory.resident-index.out-of-range', message: 'A resident frame occupies a slot outside authoritative totalFrames.' });
  }
  if (trajectory.residency?.mode !== 'sparse' && !residencyComplete) {
    diagnostics.push({ ruleId: 'trajectory.residency.complete-conflict', message: 'Trajectory declares complete residency but one or more authoritative frame slots are absent.' });
  }
  if (!residencyComplete) {
    limitations.push({
      ruleId: 'trajectory.residency.partial',
      message: `Only ${resident.length} of ${totalFrames} authoritative frames are resident; assessment covers materialized frames only.`,
    });
  }
  if (!coordinateShapeValid && inspected.length) {
    gaps.push({ ruleId: 'structure.coordinates.shape-invalid', message: 'At least one inspected frame does not contain exactly three coordinates per atom.' });
  }
  if (!typeShapeValid && inspected.length) {
    gaps.push({ ruleId: 'structure.types.shape-invalid', message: 'At least one inspected frame does not contain exactly one type value per atom.' });
  }
  if (!identity.idsShapeValid && inspected.length) {
    gaps.push({ ruleId: 'identity.shape-invalid', message: 'At least one inspected frame does not contain exactly one atom ID per atom.' });
  }
  if (identity.hasUniqueIds === false && identity.idsShapeValid) {
    gaps.push({ ruleId: 'identity.duplicate-ids', message: 'Duplicate atom IDs prevent reliable atom continuity across frames.' });
  }
  if (identity.hasUniqueIds === undefined && identity.idsShapeValid) {
    limitations.push({ ruleId: 'identity.uniqueness-sampled', message: 'Fast assessment did not exhaustively prove atom-ID uniqueness for a large frame.' });
  }
  if (identity.uniqueClaimContradiction) {
    diagnostics.push({ ruleId: 'identity.unique-claim-contradiction', message: 'A frame declares unique source identity but contains duplicate atom IDs.' });
  }
  if (!identity.hasSourceIdentity && inspected.length) {
    limitations.push({
      ruleId: 'identity.provenance-missing',
      message: 'Atom IDs lack source-backed identity semantics; row IDs alone are not treated as stable atom identity.',
    });
  }
  if (identity.continuous === false && inspected.length > 1) {
    gaps.push({ ruleId: 'identity.discontinuous', message: 'Source-backed atom IDs are not continuous across inspected frames.' });
  }
  if (identity.continuous === undefined && inspected.length > 1) {
    limitations.push({ ruleId: 'identity.continuity-sampled', message: 'Fast assessment did not exhaustively prove atom-ID continuity for large frames.' });
  }
  if (!identityCoverageComplete && inspected.length) {
    limitations.push({
      ruleId: 'identity.frame-coverage-incomplete',
      message: 'Stable atom identity was not claimed because not every authoritative frame was resident and exhaustively inspected.',
    });
  }
  if (!inspected.every(hasMeaningfulTypeSemantics) && inspected.length) {
    limitations.push({ ruleId: 'types.semantics-missing', message: 'Atom type values are present without complete source-backed element/type semantics.' });
  }
  if (!inspected.every(hasMeaningfulDistanceSemantics) && inspected.length) {
    limitations.push({ ruleId: 'coordinates.units-unresolved', message: 'Coordinate distance semantics are missing or unresolved for an inspected frame.' });
  }
  return {
    inspectorId: 'trajectory-object-v1',
    observedClass: first ? (totalFrames > 1 ? 'atomistic-simulation' : 'reference-structure') : 'unknown',
    observations: {
      format: 'trajectory',
      parseable: Boolean(first),
      atomCount: first?.natoms,
      frameCount: totalFrames,
      residentFrames: resident.length,
      residencyComplete,
      inspectedFrames: inspected.length,
      hasCoordinates: Boolean(first?.positions.length),
      coordinateShapeValid,
      finiteCoordinates,
      hasSpeciesOrTypes: typeShapeValid && Boolean(first?.types.length),
      hasTypeSemantics: inspected.length > 0 && inspected.every(hasMeaningfulTypeSemantics),
      hasDistanceSemantics: inspected.length > 0 && inspected.every(hasMeaningfulDistanceSemantics),
      hasUniqueIds: identity.hasUniqueIds,
      hasSourceIdentity: identity.hasSourceIdentity,
      hasStableIds: identity.hasStableIds,
      hasCell,
      hasPerFrameCell: totalFrames > 1 && residencyComplete ? resident.every((entry) => validCell(entry.frame)) : undefined,
      hasTimesteps: resident.length > 1 ? timesteps.size > 1 : undefined,
      hasSourceBonds: sourceBonds,
      hasInferredBonds: inferredBonds,
      hasProperties,
      propertyNames: [...propertyNames].sort(),
      hasThermo: source.sidecars?.thermo,
      hasProfiles: source.sidecars?.profiles,
      variableAtoms: resident.some((entry) => entry.frame.natoms !== first?.natoms),
      mlipEvidence,
    },
    evidence: [
      { ruleId: 'source.trajectory.loaded', message: 'Assessment used the materialized Lupi trajectory directly.', origin: 'source-data' },
      { ruleId: 'source.trajectory.total-frames', message: 'Authoritative source-frame count was read from Trajectory.totalFrames.', origin: 'source-data', value: totalFrames },
      { ruleId: 'source.trajectory.resident-frames', message: 'Resident and inspected frame counts are reported separately from source-frame count.', origin: 'derived-from-structure', value: `${resident.length} resident; ${inspected.length} inspected` },
      { ruleId: 'structure.coordinates.finite', message: 'Coordinate finiteness was checked on inspected frames.', origin: 'derived-from-structure', value: finiteCoordinates },
    ],
    strengths: totalFrames > 1 ? [{ ruleId: 'data.trajectory.materialized', message: `Trajectory declares ${totalFrames} source frames; ${resident.length} are currently materialized.` }] : [],
    gaps,
    limitations: [
      ...limitations,
      ...(inferredBonds ? [{ ruleId: 'bond.inferred-not-source', message: 'Bonds are present in viewer data but lack source-topology provenance, so they are treated as inferred.' }] : []),
      ...(hasBonds && context?.bonds?.source === 'source'
        ? [{ ruleId: 'bond.source-provenance-unverified', message: 'Supplied context declares source bonds, but the active trajectory does not carry independently inspectable bond provenance.' }]
        : []),
      ...(mlipEvidence ? [{ ruleId: 'method.mlip-not-dft', message: 'MLIP output is model evidence and is not labeled as DFT or experiment.' }] : []),
    ],
    diagnostics,
  };
}

function buildReport(
  name: string,
  size: number | undefined,
  fingerprint: string,
  inspection: InspectionResult,
  context?: AssessmentContext,
): AssessmentReport {
  const classification = resolveClassification(inspection.observedClass, context);
  if (classification.conflict) {
    inspection.diagnostics.push({
      ruleId: 'classification.declared-observed-conflict',
      message: `Declared class ${classification.declared} conflicts with observed class ${classification.observed}; observed evidence remains authoritative.`,
    });
  }
  const claimNotes = checkClaims(inspection, context);
  inspection.diagnostics.push(...claimNotes.diagnostics);
  inspection.gaps.push(...claimNotes.gaps);

  const evidenceAccuracy = scoreEvidence(classification.effective, inspection, context, claimNotes.hasContradiction);
  const methodReproducibility = scoreMethod(classification.effective, inspection, context);
  const dataDepth = scoreData(classification.effective, inspection, context);
  const interpretationCompleteness = scoreInterpretation(classification.effective, context);
  const facetList = [evidenceAccuracy, methodReproducibility, dataDepth, interpretationCompleteness];
  const facetReasons = facetList.flatMap((facet) => facet.reasons);
  const overall = averageFacets(facetList);
  const report: AssessmentReport = {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    rulesetVersion: ASSESSMENT_RULESET_VERSION,
    input: { name, size, fingerprint },
    inspection: { inspectorId: inspection.inspectorId },
    classification,
    observations: inspection.observations,
    facets: { evidenceAccuracy, methodReproducibility, dataDepth, interpretationCompleteness },
    overall,
    rankKey: makeRankKey(classification.effective, overall, facetList),
    evidence: uniqueNotes([...inspection.evidence, ...contextEvidence(context)]),
    strengths: uniqueNotes([...inspection.strengths, ...facetReasons.filter((reason) => reason.ruleId.includes('.strength.'))]),
    gaps: uniqueNotes([...inspection.gaps, ...facetReasons.filter(isGapReason)]),
    limitations: uniqueNotes([...inspection.limitations, ...contextLimitations(context)]),
    diagnostics: uniqueNotes(inspection.diagnostics),
  };
  return report;
}

function contextEvidence(context?: AssessmentContext): InspectionResult['evidence'] {
  if (!context) return [];
  const evidence: InspectionResult['evidence'] = [];
  if (context.declaredClass) evidence.push({ ruleId: 'classification.declared', message: 'The asset class was supplied as declared metadata.', origin: 'declared' as const, value: context.declaredClass });
  if (context.source?.kind) evidence.push({ ruleId: 'provenance.source-kind', message: 'A source kind was supplied with the asset.', origin: 'declared' as const, value: context.source.kind });
  if (context.source?.name) evidence.push({ ruleId: 'provenance.source-name', message: 'A named source was supplied with the asset.', origin: 'declared' as const, value: context.source.name });
  if (context.source?.url || context.source?.citation) evidence.push({ ruleId: 'provenance.source-reference', message: 'A source URL or citation was supplied with the asset.', origin: 'declared' as const, value: context.source.url ?? context.source.citation });
  if (context.source?.identifiers?.length) evidence.push({
    ruleId: 'provenance.identifiers',
    message: 'Structured source identifiers were supplied with the asset.',
    origin: 'declared' as const,
    value: context.source.identifiers.map((identifier) => `${identifier.scheme}:${identifier.value}`).sort(),
  });
  if (context.method?.name || context.method?.engine) evidence.push({ ruleId: 'method.declared', message: 'A structured method or engine was supplied.', origin: 'declared' as const, value: context.method.name ?? context.method.engine });
  if (context.method?.model || context.method?.potential) evidence.push({ ruleId: 'method.model-declared', message: 'A model or potential was supplied.', origin: 'declared' as const, value: context.method.model ?? context.method.potential });
  if (context.validation?.independent) evidence.push({ ruleId: 'validation.independent-declared', message: 'Independent validation was declared in supplied context.', origin: 'declared' as const, value: true });
  if (context.validation?.humanReviewed) evidence.push({ ruleId: 'validation.human-review-declared', message: 'Human review was declared in supplied context.', origin: 'declared' as const, value: true });
  for (const check of context.validation?.checks ?? []) {
    evidence.push({ ruleId: 'validation.check-declared', message: `Validation check declared: ${check.name}.`, origin: 'declared' as const, value: check.status });
  }
  if (context.bonds?.source) evidence.push({ ruleId: 'bonds.provenance-declared', message: 'Bond provenance was supplied as declared metadata.', origin: 'declared' as const, value: context.bonds.source });
  if (context.interpretation?.purpose) evidence.push({ ruleId: 'interpretation.purpose-declared', message: 'An intended purpose was supplied.', origin: 'declared' as const, value: context.interpretation.purpose });
  return evidence;
}

function contextLimitations(context?: AssessmentContext): AssessmentReport['limitations'] {
  return (context?.interpretation?.limitations ?? []).map((message, index) => ({
    ruleId: `interpretation.declared-limitation.${index + 1}`,
    message,
  }));
}

function isGapReason(reason: { ruleId: string }): boolean {
  return reason.ruleId === 'evidence.insufficient'
    || reason.ruleId === 'evidence.contradiction'
    || reason.ruleId === 'evidence.s-verification-required'
    || reason.ruleId === 'method.insufficient'
    || reason.ruleId === 'method.file-only'
    || reason.ruleId === 'data.unmaterialized'
    || reason.ruleId === 'interpretation.not-supplied';
}

function resolveClassification(observed: AssetClass, context?: AssessmentContext): AssessmentReport['classification'] {
  const declared = context?.declaredClass;
  if (!declared) return { observed, effective: observed, conflict: false };
  if (observed === 'unknown' || observed === declared || isClassRefinement(observed, declared)) {
    return { observed, declared, effective: declared, conflict: false };
  }
  return { observed, declared, effective: observed, conflict: true };
}

function isClassRefinement(observed: AssetClass, declared: AssetClass): boolean {
  return (observed === 'atomistic-simulation' && (declared === 'scientific-benchmark' || declared === 'literature-derived-structure'))
    || (observed === 'reference-structure' && declared === 'literature-derived-structure');
}

function scoreEvidence(
  assetClass: AssetClass,
  inspection: InspectionResult,
  context: AssessmentContext | undefined,
  contradiction: boolean,
): FacetAssessment {
  if (assetClass === 'visualization-demo') {
    return notApplicableFacet('evidence.non-scientific', 'Scientific evidence grading is not applicable to an explicitly non-scientific visualization/demo.');
  }
  if (assetClass === 'unknown' && !context?.source) {
    return unratedFacet('evidence.insufficient', 'No scientific source evidence is available to grade.');
  }
  const reasons = [];
  if (contradiction || context?.validation?.checks?.some((check) => check.status === 'fail')) {
    reasons.push({ ruleId: 'evidence.contradiction', message: 'Observed evidence contradicts a declared claim or validation check.' });
    return facetFromPoints(1, reasons);
  }
  const observed = inspection.observations;
  let points = observed.parseable ? 3 : 0;
  if (observed.parseable) reasons.push({ ruleId: 'evidence.strength.parseable-source', message: 'A registered inspector parsed source data.' });
  if (observed.finiteCoordinates === true && observed.coordinateShapeValid !== false) {
    points += 2;
    reasons.push({ ruleId: 'evidence.strength.coordinates-checked', message: 'Coordinate finiteness was derived from materialized source data.' });
  }
  if (observed.coordinateShapeValid === true) points += 1;
  if (observed.hasSpeciesOrTypes) points += 1;
  if (observed.contentHash) points += 1;

  const hasDeclaredValidation = Boolean(
    context?.validation?.independent
    || context?.validation?.humanReviewed
    || context?.validation?.checks?.length,
  );
  points = Math.min(points, 14);
  if (hasDeclaredValidation) {
    reasons.push({
      ruleId: 'evidence.s-verification-required',
      message: 'Declared review and validation records improve traceability but are not assessor-verified evidence; S-level accuracy requires a trusted verification receipt channel.',
    });
  }
  if (context?.source) reasons.push({ ruleId: 'evidence.traceability.declared-source', message: 'Structured source provenance accompanies the asset as declared metadata; it does not add verified accuracy points.' });
  return facetFromPoints(points, reasons);
}

function scoreMethod(assetClass: AssetClass, inspection: InspectionResult, context?: AssessmentContext): FacetAssessment {
  if (assetClass === 'unknown' && !context?.method) return unratedFacet('method.insufficient', 'No method evidence is available to grade.');
  const method = context?.method;
  if (!method) {
    return facetFromPoints(3, [{ ruleId: 'method.file-only', message: 'The materialized asset is inspectable but no structured generation or simulation method was supplied.' }]);
  }
  let points = 2;
  const reasons = [{ ruleId: 'method.strength.structured', message: 'Structured method metadata is present.' }];
  const add = (value: unknown, weight = 1) => { if (present(value)) points += weight; };
  add(method.name ?? method.engine, 2);
  add(method.engineVersion);
  add(method.model ?? method.potential, 2);
  add(method.modelVersion);
  add(method.ensemble);
  add(method.integrator);
  add(method.boundaries);
  add(method.units);
  add(method.timestep, 2);
  add(method.duration ?? method.steps);
  add(method.sampleCadence);
  add(method.seed);
  add(method.inputReference, 2);
  if (method.parameters && Object.keys(method.parameters).length) points += 1;
  if (inspection.observations.mlipEvidence) reasons.push({ ruleId: 'method.mlip-labeled', message: 'The method is explicitly identified as MLIP evidence rather than DFT or experiment.' });
  return facetFromPoints(Math.min(17, points), reasons);
}

function scoreData(assetClass: AssetClass, inspection: InspectionResult, context?: AssessmentContext): FacetAssessment {
  const observed = inspection.observations;
  if (!observed.parseable && !observed.hasThermo && !observed.hasProfiles) {
    return unratedFacet('data.unmaterialized', 'No parseable materialized coordinates, trajectory, or simulation sidecar was available.');
  }
  let points = 0;
  const reasons = [];
  if (observed.hasCoordinates) { points += 4; reasons.push({ ruleId: 'data.strength.coordinates', message: 'Materialized coordinates are available.' }); }
  if (observed.hasSpeciesOrTypes) points += 2;
  if (observed.hasStableIds) points += 1;
  if (observed.hasCell) points += 2;
  if ((observed.frameCount ?? observed.inspectedFrames ?? 0) > 1) reasons.push({ ruleId: 'data.scale.trajectory', message: 'Multiple frames describe asset scale but do not increase its quality grade by themselves.' });
  if (observed.hasTimesteps) points += 1;
  const bondsApplicable = assetClass === 'reference-structure' || assetClass === 'literature-derived-structure';
  if (observed.hasSourceBonds) points += 2;
  else if (bondsApplicable && context?.bonds?.source === 'none') reasons.push({ ruleId: 'data.bonds.explicitly-absent', message: 'Bond topology is explicitly absent rather than inferred.' });
  if (observed.hasProperties) { points += 2; reasons.push({ ruleId: 'data.strength.properties', message: 'Named per-atom or per-structure properties are available.' }); }
  if (observed.hasThermo || observed.hasProfiles) points += 2;
  if (observed.finiteCoordinates === false || observed.coordinateShapeValid === false) points = Math.min(points, 2);
  return facetFromPoints(Math.min(17, points), reasons);
}

function scoreInterpretation(assetClass: AssetClass, context?: AssessmentContext): FacetAssessment {
  const interpretation = context?.interpretation;
  const title = context?.title;
  const description = context?.claims?.description;
  if (!interpretation && !title && !description) {
    if (assetClass === 'unknown' || assetClass === 'visualization-demo') {
      return unratedFacet('interpretation.not-supplied', 'No interpretation or explanatory context was supplied with the asset.');
    }
    return facetFromPoints(0, [{
      ruleId: 'interpretation.not-supplied',
      message: 'Scientific assets require explanatory context; absence is graded as missing completeness rather than excluded from the overall mean.',
    }]);
  }
  let points = 0;
  const reasons = [];
  if (title) points += 2;
  if (description) points += 2;
  if (interpretation?.purpose) { points += 3; reasons.push({ ruleId: 'interpretation.strength.purpose', message: 'The asset states what it is intended to demonstrate.' }); }
  if (interpretation?.observable) points += 3;
  if (interpretation?.qualitative) points += 2;
  if (interpretation?.quantitative) points += 2;
  if (interpretation?.limitations?.length) { points += 2; reasons.push({ ruleId: 'interpretation.strength.limitations', message: 'Scientific limitations are stated explicitly.' }); }
  if (assetClass === 'visualization-demo' && interpretation?.purpose) points += 1;
  return facetFromPoints(Math.min(17, points), reasons);
}

function checkClaims(inspection: InspectionResult, context?: AssessmentContext) {
  const diagnostics = [];
  const gaps = [];
  let hasContradiction = false;
  const comparisons: Array<[string, number | undefined, number | undefined]> = [
    ['atom-count', context?.claims?.atomCount, inspection.observations.atomCount],
    ['frame-count', context?.claims?.frameCount, inspection.observations.frameCount],
  ];
  for (const [name, claimed, observed] of comparisons) {
    if (claimed === undefined || observed === undefined) continue;
    if (claimed !== observed) {
      hasContradiction = true;
      const message = `Declared ${name} ${claimed} does not match observed source value ${observed}.`;
      diagnostics.push({ ruleId: `claim.${name}.mismatch`, message });
      gaps.push({ ruleId: `claim.${name}.repair`, message });
    }
  }
  return { diagnostics, gaps, hasContradiction };
}

async function deepenInspection(source: ByteSource, initial: InspectionResult): Promise<InspectionResult> {
  const observations = { ...initial.observations };
  if (source.contentHash) {
    try { observations.contentHash = await source.contentHash(); }
    catch { initial.diagnostics.push({ ruleId: 'deep.hash.failed', message: 'Full content hashing was unavailable for this source.' }); }
  }
  if (!source.openStream) {
    initial.limitations.push({ ruleId: 'deep.stream.unavailable', message: 'Deep streaming inspection is unavailable for this source adapter.' });
    return { ...initial, observations };
  }
  if (observations.format === 'lammps-dump' || observations.format === 'xyz') {
    const scan = await scanTextFrames(source.openStream(), observations.format);
    observations.frameCount = scan.frames;
    observations.inspectedFrames = scan.frames;
    if (scan.finiteCoordinates !== undefined) observations.finiteCoordinates = scan.finiteCoordinates;
    observations.coordinateShapeValid = !scan.incompleteFrame;
    if (scan.incompleteFrame) {
      initial.diagnostics.push({
        ruleId: 'deep.trajectory.incomplete-frame',
        message: 'Deep inspection found an incomplete trajectory frame; only fully materialized frames were counted.',
      });
    }
    initial.evidence.push({
      ruleId: 'deep.frames.streamed',
      message: 'Deep mode streamed the available text asset and counted only complete frames.',
      origin: 'derived-from-structure',
      value: scan.frames,
    });
  }
  return { ...initial, observations };
}

async function scanTextFrames(stream: AsyncIterable<Uint8Array>, format: 'lammps-dump' | 'xyz') {
  const decoder = new TextDecoder();
  let pending = '';
  let frames = 0;
  let finiteCoordinates = true;
  let incompleteFrame = false;
  let xyzAtomsRemaining = 0;
  let xyzNeedComment = false;
  let xyzFrameOpen = false;
  let dumpFrameOpen = false;
  let dumpAwaitAtomCount = false;
  let dumpHasAtomCount = false;
  let dumpInAtoms = false;
  let dumpAtomsRemaining = 0;
  let dumpColumns: string[] = [];
  const processLine = (line: string) => {
    if (format === 'xyz') {
      if (xyzNeedComment) { xyzNeedComment = false; return; }
      if (xyzAtomsRemaining > 0) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4 || parts.slice(1, 4).some((value) => !Number.isFinite(Number(value)))) finiteCoordinates = false;
        xyzAtomsRemaining--;
        if (xyzAtomsRemaining === 0) {
          frames++;
          xyzFrameOpen = false;
        }
        return;
      }
      if (!line.trim()) return;
      const count = Number(line.trim());
      if (Number.isInteger(count) && count > 0) {
        xyzFrameOpen = true;
        xyzAtomsRemaining = count;
        xyzNeedComment = true;
      }
      return;
    }
    if (/^ITEM:\s*TIMESTEP/.test(line)) {
      if (dumpFrameOpen) incompleteFrame = true;
      dumpFrameOpen = true;
      dumpAwaitAtomCount = false;
      dumpHasAtomCount = false;
      dumpInAtoms = false;
      dumpAtomsRemaining = 0;
      dumpColumns = [];
      return;
    }
    if (!dumpFrameOpen) return;
    if (/^ITEM:\s*NUMBER OF ATOMS/.test(line)) { dumpAwaitAtomCount = true; return; }
    if (dumpAwaitAtomCount) {
      const count = Number(line.trim());
      if (Number.isSafeInteger(count) && count >= 0) {
        dumpAtomsRemaining = count;
        dumpHasAtomCount = true;
      } else {
        incompleteFrame = true;
      }
      dumpAwaitAtomCount = false;
      return;
    }
    const atomHeader = line.match(/^ITEM:\s*ATOMS\s+(.+)/);
    if (atomHeader) {
      dumpColumns = atomHeader[1].trim().split(/\s+/);
      dumpInAtoms = dumpHasAtomCount;
      if (!dumpHasAtomCount) incompleteFrame = true;
      if (dumpInAtoms && dumpAtomsRemaining === 0) {
        frames++;
        dumpFrameOpen = false;
        dumpInAtoms = false;
      }
      return;
    }
    if (dumpInAtoms && /^ITEM:\s*/.test(line)) {
      incompleteFrame = true;
      dumpFrameOpen = false;
      dumpInAtoms = false;
      dumpAtomsRemaining = 0;
      return;
    }
    if (dumpInAtoms && dumpAtomsRemaining > 0) {
      const values = line.trim().split(/\s+/);
      const indices = coordinateIndices(dumpColumns);
      if (indices.some((index) => index < 0 || !Number.isFinite(Number(values[index])))) finiteCoordinates = false;
      dumpAtomsRemaining--;
      if (dumpAtomsRemaining === 0) {
        frames++;
        dumpFrameOpen = false;
        dumpInAtoms = false;
      }
    }
  };
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) processLine(line);
  }
  pending += decoder.decode();
  if (pending) processLine(pending);
  if (format === 'xyz') incompleteFrame ||= xyzFrameOpen || xyzNeedComment || xyzAtomsRemaining > 0;
  else incompleteFrame ||= dumpFrameOpen || dumpAwaitAtomCount || dumpInAtoms || dumpAtomsRemaining > 0;
  return { frames, finiteCoordinates, incompleteFrame };
}

function coordinateIndices(columns: string[]): number[] {
  for (const names of [['x', 'y', 'z'], ['xs', 'ys', 'zs'], ['xu', 'yu', 'zu']]) {
    const indices = names.map((name) => columns.indexOf(name));
    if (indices.every((index) => index >= 0)) return indices;
  }
  return [-1];
}

function wrapByteSource(
  source: ByteSource,
  limits: { mode: 'fast' | 'deep'; maxFastBytes: number; maxReadOperations: number; onRead(bytes: number): void },
): ByteSource {
  let bytes = 0;
  let operations = 0;
  return {
    ...source,
    get size() { return source.size; },
    get cacheKey() { return source.cacheKey; },
    async readRange(start, endExclusive) {
      operations++;
      if (limits.mode === 'fast' && operations > limits.maxReadOperations) throw new Error('Fast assessment exceeded its read-operation budget.');
      const requested = Math.max(0, endExclusive - start);
      const remaining = limits.mode === 'fast' ? Math.max(0, limits.maxFastBytes - bytes) : requested;
      const result = await source.readRange(start, start + Math.min(requested, remaining));
      bytes += result.byteLength;
      limits.onRead(result.byteLength);
      return result;
    },
    openStream: source.openStream ? async function* () {
      operations++;
      for await (const chunk of source.openStream!()) {
        limits.onRead(chunk.byteLength);
        yield chunk;
      }
    } : undefined,
  };
}

function concatenateBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const combined = new Uint8Array(first.byteLength + second.byteLength);
  combined.set(first, 0);
  combined.set(second, first.byteLength);
  return combined;
}

async function runPool(
  entries: Array<{ index: number; source: AssessmentSource; context?: AssessmentContext }>,
  concurrency: number,
  output: Array<{ index: number; result?: AssessmentRunResult; error?: string; input: string }>,
  options: AssessManyOptions,
) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      try {
        const result = await assessAsset(entry.source, entry.context, options);
        output.push({ index: entry.index, result, input: sourceName(entry.source) });
      } catch (error) {
        output.push({ index: entry.index, error: error instanceof Error ? error.message : String(error), input: sourceName(entry.source) });
      }
    }
  });
  await Promise.all(workers);
}

function sourceName(source: AssessmentSource): string {
  return source.name;
}

function mergeContext(base?: AssessmentContext, override?: AssessmentContext): AssessmentContext | undefined {
  if (!base) return override;
  if (!override) return base;
  return {
    ...base,
    ...override,
    source: { ...base.source, ...override.source },
    method: { ...base.method, ...override.method },
    interpretation: { ...base.interpretation, ...override.interpretation },
    validation: { ...base.validation, ...override.validation },
    bonds: { ...base.bonds, ...override.bonds },
    claims: { ...base.claims, ...override.claims },
    metadata: { ...base.metadata, ...override.metadata },
  };
}

function validCell(frame: Frame): boolean {
  return frame.boxBounds.length >= 6
    && Number.isFinite(frame.boxBounds[0])
    && frame.boxBounds[1] > frame.boxBounds[0]
    && frame.boxBounds[3] > frame.boxBounds[2]
    && frame.boxBounds[5] > frame.boxBounds[4];
}

interface ResidentFrameEntry {
  index: number;
  frame: Frame;
}

function authoritativeFrameCount(trajectory: Trajectory): number {
  return Number.isSafeInteger(trajectory.totalFrames) && trajectory.totalFrames >= 0
    ? trajectory.totalFrames
    : 0;
}

function residentFrameEntries(trajectory: Trajectory): ResidentFrameEntry[] {
  return Object.keys(trajectory.frames)
    .map(Number)
    .filter((index) => Number.isSafeInteger(index) && index >= 0 && Boolean(trajectory.frames[index]))
    .sort((a, b) => a - b)
    .map((index) => ({ index, frame: trajectory.frames[index]! }));
}

function sampleResidentFrames(frames: ResidentFrameEntry[]): ResidentFrameEntry[] {
  if (frames.length <= 3) return frames;
  return [frames[0], frames[Math.floor(frames.length / 2)], frames[frames.length - 1]];
}

function inspectIdentity(
  frames: Frame[],
  mode: 'fast' | 'deep' = 'fast',
  frameCoverageComplete = true,
) {
  if (!frames.length) {
    return {
      idsShapeValid: false,
      hasUniqueIds: false as boolean | undefined,
      hasSourceIdentity: false,
      continuous: false as boolean | undefined,
      hasStableIds: false,
      uniqueClaimContradiction: false,
    };
  }

  const idsShapeValid = frames.every((frame) => frame.ids.length === frame.natoms);
  const hasSourceIdentity = frames.every((frame) =>
    frame.identity?.kind === 'source-id' || frame.identity?.kind === 'source-order');
  const fullyInspectable = mode === 'deep' || frames.every((frame) => frame.ids.length <= 4_096);
  let hasUniqueIds: boolean | undefined;
  let continuous: boolean | undefined;

  if (!idsShapeValid) {
    hasUniqueIds = false;
    continuous = false;
  } else if (!fullyInspectable) {
    hasUniqueIds = undefined;
    continuous = undefined;
  } else {
    hasUniqueIds = frames.every((frame) => new Set(frame.ids).size === frame.ids.length);
    continuous = hasSourceIdentity;
    for (let index = 1; continuous && index < frames.length; index++) {
      const previous = frames[index - 1];
      const current = frames[index];
      if (previous.identity?.kind !== current.identity?.kind) {
        continuous = false;
      } else if (previous.identity?.kind === 'source-order') {
        continuous = previous.natoms === current.natoms && sameNumberSequence(previous.ids, current.ids);
      } else if (previous.natoms === current.natoms) {
        continuous = sameNumberSet(previous.ids, current.ids);
      } else {
        continuous = false;
      }
    }
  }

  const producerClaimsUnique = frames.every((frame) => frame.identity?.unique === true);
  const uniqueClaimContradiction = frames.some((frame) =>
    frame.identity?.unique === true
    && frame.ids.length === frame.natoms
    && (mode === 'deep' || frame.ids.length <= 4_096)
    && new Set(frame.ids).size !== frame.ids.length);
  if (!frameCoverageComplete) {
    if (hasUniqueIds === true) hasUniqueIds = undefined;
    if (continuous === true) continuous = undefined;
  }
  const producerIdentityInvalid = !idsShapeValid
    || !hasSourceIdentity
    || !producerClaimsUnique
    || hasUniqueIds === false
    || continuous === false;
  return {
    idsShapeValid,
    hasUniqueIds,
    hasSourceIdentity,
    continuous,
    hasStableIds: producerIdentityInvalid
      ? false
      : hasUniqueIds === true && continuous === true
        ? true
        : undefined,
    uniqueClaimContradiction,
  };
}

function sameNumberSequence(first: ArrayLike<number>, second: ArrayLike<number>): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function sameNumberSet(first: ArrayLike<number>, second: ArrayLike<number>): boolean {
  if (first.length !== second.length) return false;
  const values = new Set<number>();
  for (let index = 0; index < first.length; index++) values.add(first[index]);
  if (values.size !== first.length) return false;
  for (let index = 0; index < second.length; index++) {
    if (!values.has(second[index])) return false;
  }
  return true;
}

function hasMeaningfulTypeSemantics(frame: Frame): boolean {
  return Boolean(frame.typeSemantics)
    && !(frame.typeSemantics?.kind === 'opaque' && frame.typeSemantics.provenance === 'legacy-unknown');
}

function hasMeaningfulDistanceSemantics(frame: Frame): boolean {
  return Boolean(frame.distanceSemantics) && frame.distanceSemantics?.kind !== 'unknown';
}

function trajectoryFingerprint(source: TrajectorySource): string {
  const trajectory = source.trajectory;
  const totalFrames = authoritativeFrameCount(trajectory);
  const resident = residentFrameEntries(trajectory);
  const sampled = sampleResidentFrames(resident);
  const parts = [
    'lupi-trajectory-sample-v2',
    `total:${totalFrames}`,
    `resident:${resident.length}`,
    `residency:${trajectory.residency?.mode ?? 'legacy-complete'}`,
    `atomTypes:${boundedArraySignature([...trajectory.atomTypes].sort((a, b) => a - b), 128)}`,
    `globalMin:${boundedArraySignature(trajectory.globalBounds.min, 3)}`,
    `globalMax:${boundedArraySignature(trajectory.globalBounds.max, 3)}`,
    `sidecars:${source.sidecars?.thermo ? 1 : 0},${source.sidecars?.profiles ? 1 : 0}`,
  ];
  for (const { index, frame } of sampled) {
    parts.push(
      `frame:${index}`,
      `timestep:${canonicalNumber(frame.timestep)}`,
      `natoms:${frame.natoms}`,
      `identity:${frame.identity?.kind ?? 'missing'},${frame.identity?.unique ?? 'unknown'}`,
      `typeSemantics:${JSON.stringify(sortObject(frame.typeSemantics ?? null))}`,
      `distanceSemantics:${JSON.stringify(sortObject(frame.distanceSemantics ?? null))}`,
      `ids:${boundedArraySignature(frame.ids, 96)}`,
      `types:${boundedArraySignature(frame.types, 96)}`,
      `positions:${boundedArraySignature(frame.positions, 192)}`,
      `box:${boundedArraySignature(frame.boxBounds, 9)}`,
      `tilt:${boundedArraySignature(frame.boxTilt, 3)}`,
      `bonds:${boundedArraySignature(frame.bonds, 96)}`,
      `columns:${frame.columns.slice(0, 32).join(',')}`,
    );
  }
  const sample = new TextEncoder().encode(parts.join('\u001f'));
  return `${totalFrames}:${resident.length}:${sampleFingerprint(sample)}`;
}

function boundedArraySignature(values: ArrayLike<number>, maxValues: number): string {
  if (values.length === 0) return '0[]';
  const count = Math.min(values.length, Math.max(1, maxValues));
  const sampled: string[] = [];
  let previous = -1;
  for (let offset = 0; offset < count; offset++) {
    const index = count === 1 ? 0 : Math.round(offset * (values.length - 1) / (count - 1));
    if (index === previous) continue;
    sampled.push(`${index}:${canonicalNumber(values[index])}`);
    previous = index;
  }
  return `${values.length}[${sampled.join(',')}]`;
}

function canonicalNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (Object.is(value, -0)) return '-0';
  return String(value);
}

function contextContains(context: AssessmentContext | undefined, pattern: RegExp): boolean {
  if (!context) return false;
  return pattern.test(JSON.stringify(context));
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function uniqueNotes<T extends { ruleId: string; message: string }>(notes: T[]): T[] {
  const seen = new Set<string>();
  return notes.filter((entry) => {
    const key = `${entry.ruleId}\u0000${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classIndex(assetClass: AssetClass): number {
  const index = ASSET_CLASS_ORDER.indexOf(assetClass);
  return index < 0 ? ASSET_CLASS_ORDER.length : index;
}

function facetTotal(report: AssessmentReport): number {
  return Object.values(report.facets).reduce((sum, facet) => sum + (pointsForGrade(facet.grade) ?? 0), 0);
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => [key, sortObject(child)]));
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
