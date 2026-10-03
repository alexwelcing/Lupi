import type { FrameChemistry } from '../types';

export const MOLECULAR_RECIPE_ID = 'lupi-bonds.molecular.v1' as const;
export const DISTANCE_RECIPE_ID = 'lupi-bonds.distance.v1' as const;
export type BondRecipeId = typeof MOLECULAR_RECIPE_ID | typeof DISTANCE_RECIPE_ID;

export const BOND_KIND = { covalent: 0, coordination: 1, ionicContact: 2 } as const;
export type BondKindCode = 0 | 1 | 2;
export type BondKindName = keyof typeof BOND_KIND;
export const BOND_KIND_NAMES = ['covalent', 'coordination', 'ionicContact'] as const satisfies readonly BondKindName[];

/** Draw radius multiplier per kind (covalent, coordination, ionic contact). */
export const BOND_KIND_RADIUS_SCALE = [1, 0.6, 0.45] as const;
/** Colour alpha byte per kind; the shader decodes k = round(a·3): 3 solid, 2 dashed, 1 dotted. */
export const BOND_KIND_STYLE_ALPHA = [255, 170, 85] as const;
export const BOND_KIND_DASH = [null, { periodA: 0.30, duty: 0.60 }, { periodA: 0.16, duty: 0.45 }] as const;

/** Why a candidate pair was not drawn. Codes are stable across versions. */
export const REMOVAL_REASON = {
  clash: 1,
  hydrogenPair: 2,
  hydrogenSinglePartner: 3,
  hydrogenMetalContact: 4,
  acuteAngle: 5,
  valenceCap: 6,
  hapticTrim: 7,
  metalCoordinationCap: 8,
  ionDonorPrecedence: 9,
  ionCoordinationCap: 10,
  bridgedPair: 11,
} as const;
export type RemovalReasonName = keyof typeof REMOVAL_REASON;
export type RemovalReasonCode = (typeof REMOVAL_REASON)[RemovalReasonName];

export interface PerceiveBondsInput {
  atomicNumbers: ArrayLike<number>;
  positions: ArrayLike<number>;
  natoms: number;
  /** Bond tolerance τ in Å (store `bondTolerance`, URL `bt`); clamped to 0..1.5, default 0.45. */
  tolerance?: number;
  recipe?: BondRecipeId;
  /** Keep every removed pair with its reason (default true). Counts are kept either way. */
  collectEvidence?: boolean;
}

export interface BondCounts {
  covalent: number;
  coordination: number;
  ionicContact: number;
  /** Covalent bonds more than 0.20 Å longer than the covalent-radius sum. */
  long: number;
  /** Pairs dropped by steps 2–8 of the molecular recipe (clashes are counted separately). */
  removed: number;
  /** Covalent-class pairs just outside the tolerance: τ < e ≤ τ + 0.20 Å. */
  nearMiss: number;
  /** Pairs closer than 0.40 Å. */
  clashes: number;
  /** Connected components over covalent and coordination bonds (isolated atoms included). */
  fragments: number;
  /** H atoms bonded to two non-hydrogen partners (B–H–B, M–H–M). */
  bridgingH: number;
  /** s-block ions within r_cov(M) + r_cov(C) + τ of a carbon (no line is drawn for these). */
  ionCarbonClose: number;
}

export interface PerceivedBonds {
  recipe: BondRecipeId;
  params: { tolerance: number; contactMargin: number; clashFloor: number; longExcess: number };
  count: number;
  /** [i0, j0, i1, j1, …], i < j, sorted by (i, j). */
  pairs: Int32Array;
  kinds: Uint8Array;
  distances: Float32Array;
  /** d − (r_cov,i + r_cov,j) in Å. */
  excess: Float32Array;
  /** Removed pairs, sorted by (i, j), with their `REMOVAL_REASON` code. */
  evidence: { pairs: Int32Array; reasons: Uint8Array; distances: Float32Array } | null;
  counts: BondCounts;
}

/** The subset of a `PerceivedBonds` the viewer draws, with indices back into it. */
export interface DrawnBonds {
  count: number;
  pairs: Int32Array;
  kinds: Uint8Array;
  distances: Float32Array;
  excess: Float32Array;
  sourceIndex: Int32Array;
}

export type BondProfile = 'auto' | 'distance' | 'molecular';

export interface RecipeGateInput {
  natoms: number;
  frameCount: number;
  sourceBondCount: number;
  inferenceAllowed: boolean;
  /** `Frame.periodic`; only the XYZ parser sets it. */
  periodic: boolean | undefined;
  chemistry: FrameChemistry | null | undefined;
  /** `frame.sourceRecord?.dataset === 'omol25'`. */
  isOmol25Record: boolean;
  profile: BondProfile;
}
