import type { SwitchCandidate } from './switchIndex';

/**
 * The last few molecules switched to in this session, newest first. Kept in
 * memory only: it exists so that flipping back and forth between two
 * structures is one click, not a search.
 */
const MAX_RECENT = 6;
let recent: SwitchCandidate[] = [];
const listeners = new Set<() => void>();

export function rememberSwitch(candidate: SwitchCandidate): void {
  recent = [candidate, ...recent.filter((item) => item.key !== candidate.key)].slice(0, MAX_RECENT);
  listeners.forEach((listener) => listener());
}

export function recentSwitches(): SwitchCandidate[] {
  return recent;
}

export function subscribeRecent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetRecentSwitches(): void {
  recent = [];
  listeners.forEach((listener) => listener());
}
