/**
 * Types for the Z1 science-panel fixture (`z1GoldenPanelFixture.json`).
 *
 * The fixture is a prototype stand-in for the phase-0 visualization bundle:
 * every displayed scalar is copied from — or recomputed and verified against —
 * `z1-union-campaign.json`, `z1_nebdft2k_barriers.lock.json`, and the local
 * anchor receipts / model cell results. See
 * `tools/build-z1-science-panel-fixture.mjs`.
 */

export type ScienceQualityState =
  | 'clean'
  | 'contaminated'
  | 'strong-win-contaminated'
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
  kind: 'model-failed' | 'extremum-missed';
  reason?: string;
  missedImages?: number[];
  sameEngineAbsErrorMev?: number | null;
}

export interface SciencePathData {
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
  };
  dense: {
    applied: boolean;
    complete: boolean;
    barrierEv: number;
  };
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
