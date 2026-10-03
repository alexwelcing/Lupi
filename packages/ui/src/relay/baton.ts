/**
 * baton.ts — what the home page hands the viewer when it opens a molecule:
 * which gallery entry, from where, and the pose and spin the visitor left on
 * the drawing. Module state mirrored to sessionStorage 'lupi.relay.baton' so
 * it survives the React root swap and a same-tab reload; it expires after
 * 30 s. Also the relay-stage registry: the sage stage that covers the page
 * from tap to first frame registers its implementation here.
 *
 * Contract file: additive edits only.
 */
export type Vec3 = [number, number, number];

export interface RelayBaton {
  galleryId: string;
  /** `page`: a molecule page's (/m/<id>) ink drawing, across a page load (sessionStorage). */
  source: 'hero' | 'tile' | 'finder' | 'deeplink' | 'page';
  /** Unit direction from the target to the camera, normalize(position − target), at hand-off; or null. */
  viewDir: Vec3 | null;
  /** The molecule's apparent spin about world +Y (rad/s). */
  bodyOmegaY: number;
  /** performance.now() at hand-off. */
  t: number;
  /**
   * The visitor tapped an ink drawing (an ink tile or finder row; the hero
   * and molecule pages always are): the viewer opens in ink at the drawing's
   * pose and the light comes on (ink/InkLookDriver.tsx, Ink-to-Light).
   */
  ink?: boolean;
}

const STORAGE_KEY = 'lupi.relay.baton';
const EXPIRY_MS = 30_000;

interface StoredBaton {
  baton: RelayBaton;
  /** Date.now() when set (performance.now() does not survive a reload). */
  savedAt: number;
}

let current: StoredBaton | null = null;

function writeStorage(value: StoredBaton | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked: module state still works within the page */
  }
}

function readStorage(): StoredBaton | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredBaton> | null;
    const baton = parsed?.baton;
    if (!baton || typeof baton.galleryId !== 'string' || typeof parsed?.savedAt !== 'number') return null;
    return { baton, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function setBaton(baton: RelayBaton): void {
  current = { baton: { ...baton }, savedAt: Date.now() };
  writeStorage(current);
}

/** The live baton, or null when none was set or it expired. */
export function peekBaton(): RelayBaton | null {
  const entry = current ?? readStorage();
  if (!entry) return null;
  if (Date.now() - entry.savedAt > EXPIRY_MS) {
    current = null;
    writeStorage(null);
    return null;
  }
  current = entry;
  return entry.baton;
}

/** The live baton, cleared. */
export function takeBaton(): RelayBaton | null {
  const baton = peekBaton();
  current = null;
  writeStorage(null);
  return baton;
}

// ─── Relay stage registry ────────────────────────────────────────────

export interface RelayImpl {
  begin(o: { baton: RelayBaton; fromRect: DOMRect | null }): void;
  end(): void;
  isActive(): boolean;
}

let relayImpl: RelayImpl | null = null;

export function registerRelayImpl(impl: RelayImpl): void {
  relayImpl = impl;
}

/** Cover the page with the relay stage; a no-op until a stage is registered. */
export function beginRelay(o: { baton: RelayBaton; fromRect: DOMRect | null }): void {
  relayImpl?.begin(o);
}

export function endRelay(): void {
  relayImpl?.end();
}

export function isRelayActive(): boolean {
  return relayImpl?.isActive() ?? false;
}
