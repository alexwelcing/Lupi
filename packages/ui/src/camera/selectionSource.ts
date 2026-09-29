/**
 * selectionSource.ts — tells CameraFocus that a selection came from a canvas
 * tap (which must not move the camera) rather than a panel or search pick
 * (which glides to the atom). The mark expires after 500 ms.
 *
 * Contract file: additive edits only.
 */
const EXPIRY_MS = 500;

let markedAt: number | null = null;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Call right before a canvas tap writes the selection. */
export function markCanvasSelection(): void {
  markedAt = now();
}

/** True (once) when the latest selection came from a canvas tap within 500 ms. */
export function consumeCanvasSelection(): boolean {
  const at = markedAt;
  markedAt = null;
  return at !== null && now() - at <= EXPIRY_MS;
}
