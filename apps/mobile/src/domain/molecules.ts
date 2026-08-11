import {
  isMobileGalleryId,
  mobileGalleryAtomCount,
  type MobileGalleryId,
} from "./mobile-gallery";

export type MoleculeInputType = "template" | "procedural" | "xyz" | "gallery";
export const MOBILE_MAX_ATOMS = 50_000;
const MAX_CATALOG_INPUT_LENGTH = 256;
const MAX_ROUTE_SUMMARY_ID_LENGTH = 128;
const MAX_ROUTE_SUMMARY_NAME_LENGTH = 160;
const MAX_ROUTE_SUMMARY_FORMULA_LENGTH = 96;
const MAX_ROUTE_SUMMARY_TAG_LENGTH = 48;
const MAX_ROUTE_SUMMARY_TAGS = 8;
const MAX_ROUTE_SUMMARY_TAGS_LENGTH = 512;

interface MoleculeLoadBase {
  input: string;
  atomCount?: number;
  element?: string;
  lattice?: string;
}

export type MoleculeLoadInput =
  | ({ inputType: "template" } & MoleculeLoadBase)
  | ({ inputType: "procedural"; atomCount: number } & MoleculeLoadBase)
  | ({ inputType: "xyz" } & MoleculeLoadBase)
  | ({
      inputType: "gallery";
      input: MobileGalleryId;
      atomCount: number;
    } & MoleculeLoadBase);

export interface MoleculeSummary {
  id: string;
  name: string;
  formula: string;
  tags: string[];
  load: MoleculeLoadInput;
}

export const STARTER_MOLECULES: MoleculeSummary[] = [
  {
    id: "caffeine",
    name: "Caffeine",
    formula: "C8H10N4O2",
    tags: ["organic", "alkaloid"],
    load: { inputType: "template", input: "Caffeine" },
  },
  {
    id: "benzene",
    name: "Benzene",
    formula: "C6H6",
    tags: ["organic", "aromatic"],
    load: { inputType: "template", input: "Benzene" },
  },
  {
    id: "water",
    name: "Water",
    formula: "H2O",
    tags: ["small", "solvent"],
    load: { inputType: "template", input: "Water" },
  },
  {
    id: "copper-fcc",
    name: "5,000 Cu FCC lattice",
    formula: "Cu5000",
    tags: ["materials", "fcc"],
    load: {
      inputType: "procedural",
      input: "5,000 Cu FCC lattice",
      atomCount: 5_000,
      element: "Cu",
      lattice: "fcc",
    },
  },
];

export function moleculeFromRouteParams(
  params: Record<string, string | string[] | undefined>,
): MoleculeLoadInput {
  return (
    moleculeLoadFromRouteParams(params, true) ?? {
      inputType: "template",
      input: "Caffeine",
    }
  );
}

function moleculeLoadFromRouteParams(
  params: Record<string, string | string[] | undefined>,
  allowDefault: boolean,
): MoleculeLoadInput | null {
  const requestedInputType = first(params.inputType);
  const inputType =
    requestedInputType === "template" ||
    requestedInputType === "procedural" ||
    requestedInputType === "gallery"
      ? requestedInputType
      : requestedInputType === undefined && allowDefault
        ? "template"
        : null;
  const requestedInput = first(params.input);
  const input = requestedInput || (allowDefault ? "Caffeine" : null);
  if (!inputType || !input) return null;
  const atomCountValue = Number(first(params.atomCount));
  return normalizeMobileMoleculeLoad({
    inputType,
    input,
    ...(Number.isSafeInteger(atomCountValue) && atomCountValue > 0
      ? { atomCount: atomCountValue }
      : {}),
    ...(first(params.element) ? { element: first(params.element) } : {}),
    ...(first(params.lattice) ? { lattice: first(params.lattice) } : {}),
  });
}

export function moleculeRouteParams(
  molecule: MoleculeSummary,
): Record<string, string> {
  const summary = boundedSummaryMetadata(molecule);
  return {
    ...(summary
      ? {
          moleculeFormula: summary.formula,
          moleculeId: summary.id,
          moleculeName: summary.name,
          moleculeTags: JSON.stringify(summary.tags),
        }
      : {}),
    inputType: molecule.load.inputType,
    input: molecule.load.input,
    ...(molecule.load.atomCount
      ? { atomCount: String(molecule.load.atomCount) }
      : {}),
    ...(molecule.load.element ? { element: molecule.load.element } : {}),
    ...(molecule.load.lattice ? { lattice: molecule.load.lattice } : {}),
  };
}

export function moleculeSummaryFromRouteParams(
  params: Record<string, string | string[] | undefined>,
): MoleculeSummary | null {
  const id = boundedRouteParam(
    first(params.moleculeId),
    MAX_ROUTE_SUMMARY_ID_LENGTH,
    false,
  );
  const name = boundedRouteParam(
    first(params.moleculeName),
    MAX_ROUTE_SUMMARY_NAME_LENGTH,
    false,
  );
  const formula = boundedRouteParam(
    first(params.moleculeFormula),
    MAX_ROUTE_SUMMARY_FORMULA_LENGTH,
    true,
  );
  const tags = decodeRouteTags(first(params.moleculeTags));
  const load = moleculeLoadFromRouteParams(params, false);
  if (id === null || name === null || formula === null || !tags || !load)
    return null;
  if (load.inputType === "gallery" && id !== load.input) return null;

  return { id, name, formula, tags, load };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function boundedSummaryMetadata(
  molecule: MoleculeSummary,
): Pick<MoleculeSummary, "id" | "name" | "formula" | "tags"> | null {
  const id = boundedRouteParam(molecule.id, MAX_ROUTE_SUMMARY_ID_LENGTH, false);
  const name = boundedRouteParam(
    molecule.name,
    MAX_ROUTE_SUMMARY_NAME_LENGTH,
    false,
  );
  const formula = boundedRouteParam(
    molecule.formula,
    MAX_ROUTE_SUMMARY_FORMULA_LENGTH,
    true,
  );
  const tags = molecule.tags
    .filter((tag): tag is string => typeof tag === "string")
    .slice(0, MAX_ROUTE_SUMMARY_TAGS);
  if (id === null || name === null || formula === null || !validRouteTags(tags))
    return null;
  return { id, name, formula, tags };
}

function boundedRouteParam(
  value: string | undefined,
  maximum: number,
  allowEmpty: boolean,
): string | null {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!allowEmpty && !value.trim())
  )
    return null;
  return value;
}

function decodeRouteTags(value: string | undefined): string[] | null {
  if (typeof value !== "string" || value.length > MAX_ROUTE_SUMMARY_TAGS_LENGTH)
    return null;
  try {
    const tags: unknown = JSON.parse(value);
    return validRouteTags(tags) ? tags : null;
  } catch {
    return null;
  }
}

function validRouteTags(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_ROUTE_SUMMARY_TAGS &&
    value.every(
      (tag) =>
        typeof tag === "string" && tag.length <= MAX_ROUTE_SUMMARY_TAG_LENGTH,
    ) &&
    JSON.stringify(value).length <= MAX_ROUTE_SUMMARY_TAGS_LENGTH
  );
}

export function normalizeMoleculeSummary(
  value: unknown,
): MoleculeSummary | null {
  const molecule = asRecord(value);
  if (
    !molecule ||
    typeof molecule.id !== "string" ||
    typeof molecule.name !== "string" ||
    typeof molecule.formula !== "string" ||
    !Array.isArray(molecule.tags)
  )
    return null;

  const id = boundedRouteParam(molecule.id, MAX_ROUTE_SUMMARY_ID_LENGTH, false);
  const name = boundedRouteParam(
    molecule.name,
    MAX_ROUTE_SUMMARY_NAME_LENGTH,
    false,
  );
  const formula = boundedRouteParam(
    molecule.formula,
    MAX_ROUTE_SUMMARY_FORMULA_LENGTH,
    true,
  );
  const tags = molecule.tags
    .filter((tag): tag is string => typeof tag === "string")
    .slice(0, MAX_ROUTE_SUMMARY_TAGS);
  if (id === null || name === null || formula === null || !validRouteTags(tags))
    return null;

  const loadEnvelope = asRecord(molecule.load);
  const load = normalizeMobileMoleculeLoad(
    asRecord(loadEnvelope?.molecule) ?? loadEnvelope,
  );
  if (!load || load.inputType === "xyz") return null;
  if (load.inputType === "gallery" && id !== load.input) return null;

  return {
    id,
    name,
    formula,
    tags,
    load,
  };
}

export function normalizeMobileMoleculeLoad(
  value: unknown,
): MoleculeLoadInput | null {
  const load = asRecord(value);
  if (
    !load ||
    (load.inputType !== "template" &&
      load.inputType !== "procedural" &&
      load.inputType !== "gallery") ||
    typeof load.input !== "string" ||
    !load.input.trim() ||
    load.input.length > MAX_CATALOG_INPUT_LENGTH
  )
    return null;

  const input = load.input;
  const atomCount = load.atomCount;
  if (
    atomCount !== undefined &&
    (typeof atomCount !== "number" ||
      !Number.isSafeInteger(atomCount) ||
      atomCount < 1 ||
      atomCount > MOBILE_MAX_ATOMS)
  )
    return null;
  if (load.inputType === "procedural" && atomCount === undefined) return null;
  if (load.inputType === "gallery") {
    if (!isMobileGalleryId(input)) return null;
    if (
      typeof atomCount !== "number" ||
      atomCount !== mobileGalleryAtomCount(input)
    )
      return null;
    return { inputType: "gallery", input, atomCount };
  }

  const generatedMetadata = {
    ...(typeof load.element === "string" && load.element.length <= 8
      ? { element: load.element }
      : {}),
    ...(typeof load.lattice === "string" && load.lattice.length <= 32
      ? { lattice: load.lattice }
      : {}),
  };
  if (load.inputType === "procedural") {
    if (typeof atomCount !== "number") return null;
    return {
      inputType: "procedural",
      input,
      atomCount,
      ...generatedMetadata,
    };
  }
  return {
    inputType: "template",
    input,
    ...(typeof atomCount === "number" ? { atomCount } : {}),
    ...generatedMetadata,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
