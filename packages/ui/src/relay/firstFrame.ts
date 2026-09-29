/**
 * firstFrame.ts — "the first real frame of this file is on screen".
 *
 * The key is the loaded file's `trajectory` object, so a new file (even with
 * the same name) is a new key. The relay stage and arrival listen for it.
 *
 * Contract file: additive edits only.
 */
export const FIRST_FRAME_EVENT = 'lupi:first-frame';

const seen = new WeakSet<object>();
const listeners = new Set<(key: object) => void>();

/** Mark `key`'s first frame (once per key); notifies listeners and dispatches FIRST_FRAME_EVENT on window. */
export function markFirstFrame(key: object): void {
  if (seen.has(key)) return;
  seen.add(key);
  for (const listener of Array.from(listeners)) {
    try {
      listener(key);
    } catch (error) {
      console.error('[lupi] first-frame listener threw', error);
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FIRST_FRAME_EVENT));
}

export function hasFirstFrame(key: object): boolean {
  return seen.has(key);
}

export function onFirstFrame(listener: (key: object) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
