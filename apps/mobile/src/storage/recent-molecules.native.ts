import Storage from "expo-sqlite/kv-store";

import type { MoleculeSummary } from "@/src/domain/molecules";

import { createRecentMoleculeRepository } from "./recent-molecules-repository";

const repository = createRecentMoleculeRepository(Storage);

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
