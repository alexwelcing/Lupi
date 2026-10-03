export type Omol25CollectionId =
  | 'neutral-train'
  | 'neutral-validation'
  | 'all-train-preview'
  | 'train-4m-preview'
  | 'validation-preview';

export interface Omol25Collection {
  id: Omol25CollectionId;
  label: string;
  /** Hugging Face repository of the ColabFit conversion. */
  repo: string;
  /** Rows the Hugging Face Dataset Viewer serves; the edge rejects any row past this. */
  indexedRows: number;
  /** The Dataset Viewer's `estimated_num_rows`, which understates the larger repositories. */
  hfEstimatedRows: number;
  /** Configurations in the source split, from the ColabFit dataset cards and arXiv:2505.08762 Table 1. */
  sourceRows: number;
  coverage: 'complete' | 'indexed-preview';
  license: 'CC-BY-4.0';
}

/** Rows of the two complete neutral splits, for surfaces that need only the count (the landing). */
export const OMOL25_NEUTRAL_TRAIN_ROWS = 34_335_828;
export const OMOL25_NEUTRAL_VALIDATION_ROWS = 27_697;

/**
 * The public ColabFit conversions of OMol25 that Lupi pages through its edge.
 * Only the two neutral splits are complete; the Dataset Viewer has indexed a
 * bounded window of the others, so they stay labelled as previews.
 */
export const OMOL25_COLLECTIONS: readonly Omol25Collection[] = [
  {
    id: 'neutral-train',
    label: 'Neutral train',
    repo: 'colabfit/OMol25_train_neutral',
    indexedRows: OMOL25_NEUTRAL_TRAIN_ROWS,
    hfEstimatedRows: OMOL25_NEUTRAL_TRAIN_ROWS,
    sourceRows: OMOL25_NEUTRAL_TRAIN_ROWS,
    coverage: 'complete',
    license: 'CC-BY-4.0',
  },
  {
    id: 'neutral-validation',
    label: 'Neutral validation',
    repo: 'colabfit/OMol25_neutral_validation',
    indexedRows: OMOL25_NEUTRAL_VALIDATION_ROWS,
    hfEstimatedRows: OMOL25_NEUTRAL_VALIDATION_ROWS,
    sourceRows: OMOL25_NEUTRAL_VALIDATION_ROWS,
    coverage: 'complete',
    license: 'CC-BY-4.0',
  },
  {
    id: 'all-train-preview',
    label: 'All train',
    repo: 'colabfit/OMol25_train',
    indexedRows: 841_736,
    hfEstimatedRows: 65_331_709,
    sourceRows: 101_666_280,
    coverage: 'indexed-preview',
    license: 'CC-BY-4.0',
  },
  {
    id: 'train-4m-preview',
    label: '4M train',
    repo: 'colabfit/OMol25_train_4M',
    indexedRows: 1_000_000,
    hfEstimatedRows: 2_657_915,
    sourceRows: 3_986_754,
    coverage: 'indexed-preview',
    license: 'CC-BY-4.0',
  },
  {
    id: 'validation-preview',
    label: 'Validation',
    repo: 'colabfit/OMol25_validation',
    indexedRows: 800_000,
    hfEstimatedRows: 1_842_258,
    sourceRows: 2_762_021,
    coverage: 'indexed-preview',
    license: 'CC-BY-4.0',
  },
];

// Pure, so a bundle that needs only the counts or the elements drops the table.
export const OMOL25_COLLECTION_IDS: readonly Omol25CollectionId[] = /* @__PURE__ */ OMOL25_COLLECTIONS.map((c) => c.id);

const BY_ID = /* @__PURE__ */ new Map<string, Omol25Collection>(/* @__PURE__ */ OMOL25_COLLECTIONS.map((c) => [c.id, c]));

export function isOmol25CollectionId(value: unknown): value is Omol25CollectionId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function omol25Collection(id: Omol25CollectionId): Omol25Collection {
  return BY_ID.get(id)!;
}

/**
 * The 17 elements of the two complete neutral splits (neutral-validation
 * facets and the neutral-train card): no transition metals or lanthanides.
 */
export const OMOL25_NEUTRAL_ELEMENTS: readonly string[] = [
  'H', 'C', 'N', 'O', 'F', 'P', 'S', 'Cl', 'Br', 'I', 'Si', 'B', 'Li', 'Na', 'K', 'Mg', 'Ca',
];
