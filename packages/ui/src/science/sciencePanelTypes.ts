/**
 * Viewer projection types for canonical Z1 visualization bundles.
 *
 * The adapter maps only validated `lupine.visualization-bundle.v1` manifests.
 * Missing values remain explicit and every displayed identity stays bound to
 * its canonical manifest, run, bundle, campaign, and source digests.
 */

export type ScienceQualityState =
  | 'clean'
  | 'clean-t1'
  | 'contaminated'
  | 'strong-win-contaminated'
  | 'no-guides-completed'
  | 'all-guides-failed';

export type AnchorPointStatus = 'evaluated' | 'nominated' | 'missing' | 'source';

export interface ScienceSeriesPoint {
  image: number;
  /** Absolute energy in eV; null stays null — missing is never interpolated. */
  energyEv: number | null;
  status: AnchorPointStatus;
  /** True when this image was evaluated only to complete the dense profile. */
  denseExtension?: boolean;
}

export interface ScienceEnergySeries {
  id: string;
  label: string;
  engine: string;
  /** e.g. "same-engine evidence — primary", "cross-engine reference — secondary". */
  role: string;
  unit: 'eV';
  zeroConvention: string;
  points: ScienceSeriesPoint[];
}

export interface SeriesExtrema {
  argmin: number;
  argmax: number;
  barrierEv: number | null;
  tieRule: 'first-index';
}

export interface ModelAnchorInfo {
  status: string;
  nominated: number[];
  evaluated: number[];
  complete: boolean;
  shortPathFallback: boolean | null;
  window: number | null;
  modelMinIndex: number | null;
  modelMaxIndex: number | null;
  sparseBarrierEv: number | null;
  sameEngineAbsErrorMev: number | null;
  vaspAbsErrorMev: number | null;
  profileAvailable: boolean;
}

export interface GuidanceMiss {
  model: string;
  kind: 'model-failed' | 'model-missing' | 'extremum-missed';
  reason?: string;
  missedImages?: number[];
  sameEngineAbsErrorMev?: number | null;
}

export interface ScienceBundleRevision {
  schema: 'lupine.visualization-bundle.v1';
  bundleId: string;
  manifestSha256: string;
  provenance: {
    citation: { dataset: string; doi: string; source_repository: string; source_url: string; theory: string };
    license: string;
    sourceRevision: {
      reference_dataset_revision: string;
      reference_source_archive_sha256: string;
      converter_git_commit: string | null;
    };
    preregistration: string;
    amendments: string[];
  };
  campaignSha256: string;
  campaignId: string;
  runId: string;
  status: 'active';
  supersedes: string | null;
  supersedesChain: string[];
  retraction: null;
  qualityState: 'verified' | 'published';
  qualityChecks: Array<{ name: string; status: string; detail: string }>;
  qualityWarnings: string[];
  sourceArtifacts: Array<{
    role: string;
    uri: string;
    schema: string | null;
    sha256: string;
    bytes: number;
    gitCommit: string | null;
  }>;
  sources: {
    campaign: string;
    barrierLock: string;
    anchorReceipts: string[];
    modelArtifacts: string[];
  };
}

export interface SciencePathData {
  revision: ScienceBundleRevision;
  pathIndex: number;
  pathId: string;
  chemicalSystem: string;
  imageCount: number;
  qualityState: ScienceQualityState;
  quality: {
    state: ScienceQualityState;
    t1Verdict: string;
    sameEngineStrongWin: boolean;
    guidedModelCount: number;
    failedModelCount: number;
    missingModelCount?: number;
    modelDenominator: number;
    crossEngineErrorMev: number;
    /** Dense-GPAW − VASP signed error (direction matters; e.g. path-27 is negative). Optional for backward compatibility. */
    crossEngineSignedErrorMev?: number;
    crossEngineLooksAcceptable: boolean;
  };
  reactionCoordinate: {
    label: string;
    unit: string;
    definition: string;
  };
  barriers: {
    referenceBarrierEv: number;
    denseBarrierEv: number;
    denseVsVaspSignedErrorMev: number;
    vaspSaddleImageIndex: number;
  };
  series: ScienceEnergySeries[];
  extrema: Record<string, SeriesExtrema>;
  anchors: {
    universe: number[];
    evaluated: number[];
    unionNominated: number[];
    denseExtensionImages: number[];
    anchorsMissing: number[];
    perModel: Record<string, ModelAnchorInfo>;
    rule: {
      id: string;
      version: string;
      source: { git_commit: string | null; path: string };
      extremaTiePolicy: string;
      windowRule: string;
    };
  };
  dense: {
    applied: boolean;
    complete: boolean;
    barrierEv: number;
  };
  diagnostics: {
    status: 'bound';
    imageIndex: number;
    note: string;
    runs: Array<{
      label: string;
      gpawVersion: string | null;
      params: Record<string, unknown>;
      chargeE: number;
      energyEv: number;
      fermiLevelEv: number;
      gapEv: number;
      occupations: { type: string; width_ev: number };
      scf: { converged: boolean; steps: number; max_iterations: number };
      spin: Record<string, unknown> | null;
    }>;
  } | null;
  t1: {
    unit: 'meV';
    definition: string;
    offsets: Array<{ image: number; offsetMev: number | null; status: string }>;
    offsetMeanMev: number;
    wanderMev: number;
    thresholdMev: number;
    verdict: string;
    driverPair: [number, number];
    evaluatedImageCount: number;
  };
  guidance: {
    misses: GuidanceMiss[];
    subsetTheorem: string;
  };
}

export interface SciencePanelFixture {
  schema: string;
  generatedBy: string;
  provenance: {
    campaignFile: string;
    barrierLockFile: string;
    anchorReceiptDir: string;
    modelInputDir: string;
  };
  campaign: {
    id: string;
    sha256: string;
    recordedAt: string;
    preregistration: string;
    amendment: string;
    thresholds: {
      strongWinMev: number;
      winMev: number;
      t1GateMev: number;
      basis: string;
    };
    gpawParams: Record<string, unknown>;
    t1Summary: {
      pathsWithOffsets: number;
      pathsContaminated: number;
      maxOffsetWanderMev: number;
      meanOffsetWanderMev: number;
    };
    citation: string;
  };
  paths: SciencePathData[];
}
