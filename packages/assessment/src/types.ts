import type { Trajectory } from '@atlas/core/types';

export const ASSESSMENT_SCHEMA_VERSION = 'lupi.asset-assessment.v1' as const;
export const ASSESSMENT_RULESET_VERSION = '1.1.0' as const;

export type AssessmentMode = 'fast' | 'deep';

export type AssetClass =
  | 'atomistic-simulation'
  | 'scientific-benchmark'
  | 'literature-derived-structure'
  | 'reference-structure'
  | 'procedural-scientific-model'
  | 'visualization-demo'
  | 'unknown';

export type AssetFormat =
  | 'glimbin'
  | 'lammps-dump'
  | 'lammps-data'
  | 'lammps-log'
  | 'lammps-profile'
  | 'xyz'
  | 'lupi-json'
  | 'trajectory'
  | 'procedural'
  | 'html'
  | 'unknown';

export type Grade =
  | 'F-' | 'F' | 'F+'
  | 'D-' | 'D' | 'D+'
  | 'C-' | 'C' | 'C+'
  | 'B-' | 'B' | 'B+'
  | 'A-' | 'A' | 'A+'
  | 'S-' | 'S' | 'S+';

export type FacetGrade = Grade | 'N/A' | 'Unrated';

export type EvidenceOrigin =
  | 'source-data'
  | 'derived-from-structure'
  | 'declared'
  | 'human-review'
  | 'needs-calculation';

export interface AssessmentNote {
  ruleId: string;
  message: string;
}

export interface EvidenceItem extends AssessmentNote {
  origin: EvidenceOrigin;
  value?: string | number | boolean | string[];
}

export interface AssessmentSourceReference {
  kind?: 'database' | 'paper' | 'simulation' | 'experiment' | 'generated' | 'internal' | 'unknown';
  name?: string;
  url?: string;
  citation?: string;
  identifiers?: Array<{ scheme: string; value: string }>;
  coordinateOrigin?: string;
}

export interface AssessmentMethodContext {
  name?: string;
  engine?: string;
  engineVersion?: string;
  model?: string;
  modelVersion?: string;
  potential?: string;
  ensemble?: string;
  integrator?: string;
  boundaries?: string;
  units?: string;
  timestep?: number | string;
  duration?: number | string;
  steps?: number;
  sampleCadence?: number | string;
  seed?: number | string;
  inputReference?: string;
  parameters?: Record<string, unknown>;
}

export interface AssessmentInterpretationContext {
  purpose?: string;
  observable?: string;
  qualitative?: string;
  quantitative?: string;
  limitations?: string[];
}

export interface AssessmentValidationContext {
  independent?: boolean;
  humanReviewed?: boolean;
  checks?: Array<{
    name: string;
    status: 'pass' | 'fail' | 'unknown';
    source?: string;
    metric?: number | string;
  }>;
}

export interface AssessmentContext {
  id?: string;
  title?: string;
  declaredClass?: AssetClass;
  source?: AssessmentSourceReference;
  method?: AssessmentMethodContext;
  interpretation?: AssessmentInterpretationContext;
  validation?: AssessmentValidationContext;
  bonds?: { source?: 'source' | 'inferred' | 'none' | 'unknown'; description?: string };
  claims?: {
    atomCount?: number;
    frameCount?: number;
    formula?: string;
    description?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ByteSource {
  kind: 'bytes';
  name: string;
  size?: number;
  locality?: 'local' | 'remote' | 'memory';
  cacheKey?: string;
  readRange(start: number, endExclusive: number): Promise<Uint8Array>;
  openStream?: () => AsyncIterable<Uint8Array>;
  contentHash?: () => Promise<string>;
}

export interface TrajectorySource {
  kind: 'trajectory';
  name: string;
  trajectory: Trajectory;
  size?: number;
  cacheKey?: string;
  sidecars?: { thermo?: boolean; profiles?: boolean };
}

export interface AssetEnvelope {
  schema?: string;
  id?: string;
  name?: string;
  format?: AssetFormat;
  text?: string;
  bytesBase64?: string;
  trajectory?: Trajectory;
  procedural?: boolean;
  context?: AssessmentContext;
}

export interface EnvelopeSource {
  kind: 'envelope';
  name: string;
  envelope: AssetEnvelope;
  cacheKey?: string;
}

export type AssessmentSource = ByteSource | TrajectorySource | EnvelopeSource;

export interface InspectionObservations {
  format: AssetFormat;
  parseable: boolean;
  atomCount?: number;
  /** Authoritative source-frame count (`Trajectory.totalFrames` for active trajectories). */
  frameCount?: number;
  /** Frames currently materialized in memory; may be smaller than `frameCount`. */
  residentFrames?: number;
  /** Whether every authoritative source-frame slot is currently materialized. */
  residencyComplete?: boolean;
  hasCoordinates?: boolean;
  coordinateShapeValid?: boolean;
  finiteCoordinates?: boolean;
  hasSpeciesOrTypes?: boolean;
  hasTypeSemantics?: boolean;
  hasDistanceSemantics?: boolean;
  hasUniqueIds?: boolean;
  hasSourceIdentity?: boolean;
  hasStableIds?: boolean;
  hasCell?: boolean;
  hasPerFrameCell?: boolean;
  hasTimesteps?: boolean;
  hasSourceBonds?: boolean;
  hasInferredBonds?: boolean;
  hasProperties?: boolean;
  propertyNames?: string[];
  hasThermo?: boolean;
  hasProfiles?: boolean;
  variableAtoms?: boolean;
  compressed?: boolean;
  formatVersion?: number;
  unitStyle?: number | string;
  elementSymbols?: string[];
  contentHash?: string;
  mlipEvidence?: boolean;
  inspectedFrames?: number;
  indexEntriesSampled?: number;
  frameIndexValid?: boolean;
}

export interface InspectionResult {
  inspectorId: string;
  observedClass: AssetClass;
  observations: InspectionObservations;
  evidence: EvidenceItem[];
  strengths: AssessmentNote[];
  gaps: AssessmentNote[];
  limitations: AssessmentNote[];
  diagnostics: AssessmentNote[];
}

export interface InspectorInput {
  source: ByteSource;
  sample: Uint8Array;
  sampleText: string;
  context?: AssessmentContext;
  mode: AssessmentMode;
}

export interface AssetInspector {
  id: string;
  detect(input: Pick<InspectorInput, 'source' | 'sample' | 'sampleText'>): number;
  inspect(input: InspectorInput): InspectionResult | Promise<InspectionResult>;
}

export interface FacetAssessment {
  grade: FacetGrade;
  points: number | null;
  reasons: AssessmentNote[];
}

export interface AssessmentReport {
  schemaVersion: typeof ASSESSMENT_SCHEMA_VERSION;
  rulesetVersion: typeof ASSESSMENT_RULESET_VERSION;
  input: {
    name: string;
    size?: number;
    fingerprint: string;
  };
  inspection: { inspectorId: string };
  classification: {
    observed: AssetClass;
    declared?: AssetClass;
    effective: AssetClass;
    conflict: boolean;
  };
  observations: InspectionObservations;
  facets: {
    evidenceAccuracy: FacetAssessment;
    methodReproducibility: FacetAssessment;
    dataDepth: FacetAssessment;
    interpretationCompleteness: FacetAssessment;
  };
  overall: FacetAssessment;
  rankKey: string;
  evidence: EvidenceItem[];
  strengths: AssessmentNote[];
  gaps: AssessmentNote[];
  limitations: AssessmentNote[];
  diagnostics: AssessmentNote[];
}

export interface AssessmentExecution {
  mode: AssessmentMode;
  bytesRead: number;
  readOperations: number;
  durationMs: number;
  cacheHit?: boolean;
  /** Reads performed to establish cache identity before a hit was known. */
  cacheLookupBytesRead?: number;
  /** Read operations performed to establish cache identity before a hit was known. */
  cacheLookupOperations?: number;
}

export interface AssessmentRunResult {
  report: AssessmentReport;
  execution: AssessmentExecution;
}

export interface AssessmentFailure {
  input: string;
  error: string;
}

export interface AssessmentBatchResult {
  results: AssessmentRunResult[];
  failures: AssessmentFailure[];
}

export interface AssessOptions {
  mode?: AssessmentMode;
  inspectors?: AssetInspector[];
  maxFastBytes?: number;
  maxReadOperations?: number;
}

export interface AssessManyOptions extends AssessOptions {
  localConcurrency?: number;
  remoteConcurrency?: number;
}

export interface RankOptions {
  groupByClass?: boolean;
}
