import type { MoleculeSummary } from "@/src/domain/molecules";

import { createRecentMoleculeRepository } from "./recent-molecules-repository";

const repository = createRecentMoleculeRepository({
  getItem(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  removeItem(key) {
    globalThis.localStorage?.removeItem(key);
  },
  setItem(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
});

export async function getRecentMolecules(): Promise<MoleculeSummary[]> {
  return repository.get();
}

export async function recordRecentMolecule(
  molecule: MoleculeSummary,
): Promise<void> {
  return repository.record(molecule);
}

export async function clearRecentMolecules(): Promise<void> {
  return repository.clear();
}
