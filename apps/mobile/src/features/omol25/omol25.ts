import type { MoleculeSummary } from "@/src/domain/molecules";

export const OMOL25_MAX_ATOMS = 1_000;
export const OMOL25_PAGE_SIZE = 20;

export const OMOL25_COLLECTION_IDS = [
  "neutral-train",
  "neutral-validation",
  "all-train-preview",
  "train-4m-preview",
  "validation-preview",
] as const;

export type Omol25CollectionId = (typeof OMOL25_COLLECTION_IDS)[number];
export type Omol25Coverage = "complete" | "indexed-preview";

export interface Omol25Collection {
  id: Omol25CollectionId;
  label: string;
  description: string;
  repository: string;
  indexedRows: number;
  estimatedRows: number;
  coverage: Omol25Coverage;
}

export interface Omol25Row {
  rowIndex: number;
  formula: string;
  atomCount: number;
  elements: string[];
  method: string | null;
  loadUrl: string;
}

export interface Omol25Page {
  collection: Omol25CollectionId;
  coverage: Omol25Coverage;
  indexedRows: number;
  matchedRows: number | null;
  offset: number;
  partial: boolean;
  rows: Omol25Row[];
}

export function isOmol25CollectionId(
  value: unknown,
): value is Omol25CollectionId {
  return OMOL25_COLLECTION_IDS.includes(value as Omol25CollectionId);
}

export function omol25RowKey(
  collection: Omol25CollectionId,
  rowIndex: number,
): string {
  return `${collection}/${rowIndex}`;
}

export function parseOmol25RowKey(
  value: unknown,
): { collection: Omol25CollectionId; rowIndex: number } | null {
  if (typeof value !== "string") return null;
  const match =
    /^(neutral-train|neutral-validation|all-train-preview|train-4m-preview|validation-preview)\/(0|[1-9]\d*)$/.exec(
      value,
    );
  if (!match || !isOmol25CollectionId(match[1])) return null;
  const rowIndex = Number(match[2]);
  if (!Number.isSafeInteger(rowIndex) || rowIndex >= 100_000_000) return null;
  return { collection: match[1], rowIndex };
}

export function omol25StructureUrl(origin: string, key: string): string {
  const row = parseOmol25RowKey(key);
  if (!row) throw new Error("Invalid OMol25 source row.");
  return `${origin}/v1/datasets/omol25/${row.collection}/structures/${row.rowIndex}.xyz`;
}

export function omol25MoleculeSummary(
  collection: Omol25CollectionId,
  row: Omol25Row,
): MoleculeSummary {
  const key = omol25RowKey(collection, row.rowIndex);
  return {
    id: `omol25:${collection}:${row.rowIndex}`,
    name: `${row.formula} · OMol25 row ${row.rowIndex}`,
    formula: row.formula,
    tags: ["OMol25", collection, "source coordinates", "bonds not provided"],
    load: { inputType: "omol25", input: key, atomCount: row.atomCount },
  };
}
