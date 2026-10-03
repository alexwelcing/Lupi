/**
 * openEntry.ts — which surface a visitor opened a structure from, carried to
 * the `molecule_loaded` event that follows it. One shot: the opener marks it,
 * the loader takes it, and a mark older than 30 s is ignored (a load that
 * failed must not credit the next one).
 *
 * Imports nothing, so the landing page can mark an open without pulling in
 * the analytics session or its sink.
 */

export type OpenEntry = 'home-shelf' | 'home-surprise' | 'finder' | 'library' | 'switcher' | 'palette';

export const OPEN_ENTRY_STORAGE_KEY = 'lupi.openEntry';
export const OPEN_ENTRY_TTL_MS = 30_000;

const ENTRIES = new Set<string>(['home-shelf', 'home-surprise', 'finder', 'library', 'switcher', 'palette']);

export function markOpenEntry(entry: OpenEntry, now: number = Date.now()): void {
  try {
    sessionStorage.setItem(OPEN_ENTRY_STORAGE_KEY, JSON.stringify({ entry, at: now }));
  } catch {
    // Storage blocked (private mode, sandboxed frame): the load is simply untagged.
  }
}

export function takeOpenEntry(now: number = Date.now()): OpenEntry | null {
  try {
    const raw = sessionStorage.getItem(OPEN_ENTRY_STORAGE_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(OPEN_ENTRY_STORAGE_KEY);
    const parsed = JSON.parse(raw) as { entry?: unknown; at?: unknown } | null;
    const at = parsed?.at;
    if (typeof parsed?.entry !== 'string' || !ENTRIES.has(parsed.entry) || typeof at !== 'number') return null;
    if (now < at || now - at > OPEN_ENTRY_TTL_MS) return null;
    return parsed.entry as OpenEntry;
  } catch {
    return null;
  }
}
