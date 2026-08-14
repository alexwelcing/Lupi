import type { MoleculeSummary } from "@/src/domain/molecules";

import {
  decodeRecentMolecules,
  nextRecentMolecules,
  RECENT_MOLECULES_KEY,
} from "./recent-molecules-codec";

export interface RecentMoleculeKeyValueStorage {
  getItem(key: string): Promise<string | null> | string | null;
  removeItem(key: string): Promise<void> | void;
  setItem(key: string, value: string): Promise<void> | void;
}

export function createRecentMoleculeRepository(
  storage: RecentMoleculeKeyValueStorage,
) {
  let mutationQueue: Promise<void> = Promise.resolve();

  const read = async (): Promise<MoleculeSummary[]> =>
    decodeRecentMolecules(await storage.getItem(RECENT_MOLECULES_KEY));

  const enqueue = (mutation: () => Promise<void>): Promise<void> => {
    const operation = mutationQueue.then(mutation, mutation);
    mutationQueue = operation.catch(() => undefined);
    return operation;
  };

  return {
    async get(): Promise<MoleculeSummary[]> {
      await mutationQueue;
      return read();
    },

    record(molecule: MoleculeSummary): Promise<void> {
      return enqueue(async () => {
        const current = await read();
        const next = nextRecentMolecules(current, molecule);
        await storage.setItem(RECENT_MOLECULES_KEY, JSON.stringify(next));
      });
    },

    clear(): Promise<void> {
      return enqueue(async () => {
        await storage.removeItem(RECENT_MOLECULES_KEY);
      });
    },
  };
}
