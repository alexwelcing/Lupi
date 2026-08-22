import {
  normalizeMoleculeSummary,
  type MoleculeSummary,
} from "@/src/domain/molecules";

export const RECENT_MOLECULES_KEY = "lupi.mobile.recent-molecules.v1";
export const RECENT_LIMIT = 12;

export function decodeRecentMolecules(
  serialized: string | null | undefined,
): MoleculeSummary[] {
  if (!serialized) return [];
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!Array.isArray(value)) return [];
    return dedupeById(
      value
        .map(normalizeMoleculeSummary)
        .filter((molecule): molecule is MoleculeSummary => molecule !== null),
    );
  } catch {
    return [];
  }
}

export function nextRecentMolecules(
  current: MoleculeSummary[],
  molecule: MoleculeSummary,
): MoleculeSummary[] {
  const normalized = normalizeMoleculeSummary(molecule);
  if (!normalized) throw new Error("Cannot store an invalid molecule record.");
  return dedupeById([
    normalized,
    ...current.filter((item) => item.id !== normalized.id),
  ]);
}

function dedupeById(molecules: MoleculeSummary[]): MoleculeSummary[] {
  const seen = new Set<string>();
  const result: MoleculeSummary[] = [];
  for (const molecule of molecules) {
    if (seen.has(molecule.id)) continue;
    seen.add(molecule.id);
    result.push(molecule);
    if (result.length === RECENT_LIMIT) break;
  }
  return result;
}
