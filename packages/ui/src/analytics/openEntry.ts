/**
 * openEntry.ts — which surface a visitor opened a structure from, carried to
 * the `molecule_loaded` event that follows it. One shot: the opener marks it,
 * the loader takes it, and a mark older than 30 s is ignored (a load that
 * failed must not credit the next one).
 *
 * The hint lives only in this module's memory and is never persisted. Browser
 * privacy preferences suppress it just as they suppress the event bridge.
 */
import { analyticsPrivacyBlocked } from './session';

export type OpenEntry = 'home-shelf' | 'home-surprise' | 'finder' | 'library' | 'switcher' | 'palette';

/** Legacy exported name for source compatibility. No browser storage uses it. */
export const OPEN_ENTRY_STORAGE_KEY = 'lupi.openEntry';
export const OPEN_ENTRY_TTL_MS = 30_000;

const ENTRIES = new Set<string>(['home-shelf', 'home-surprise', 'finder', 'library', 'switcher', 'palette']);
let pending: { entry: OpenEntry; at: number } | null = null;

export function markOpenEntry(entry: OpenEntry, now: number = Date.now()): void {
  pending = null;
  if (analyticsPrivacyBlocked() || !ENTRIES.has(entry) || !Number.isFinite(now)) return;
  pending = { entry, at: now };
}

export function takeOpenEntry(now: number = Date.now()): OpenEntry | null {
  const mark = pending;
  pending = null;
  if (analyticsPrivacyBlocked() || !mark || !Number.isFinite(now) || now < mark.at || now - mark.at > OPEN_ENTRY_TTL_MS) return null;
  return mark.entry;
}
