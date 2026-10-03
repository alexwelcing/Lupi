/**
 * inkTiles.ts — the ink tiles: molecule wall tiles and finder rows drawn as
 * the molecule's own ink drawing (`/og/m/<id>-ink.svg`, the /m page's
 * drawing at its opening pose), which light up into the 3D molecule on tap.
 *
 * What the hand-off needs, per molecule with a page, comes from the
 * molecule-pages manifest (`/m/manifest.json`, scripts/molecule-pages):
 * the drawing's opening pose (the baton's view direction, so the 3D view
 * opens at the angle the tile shows), its drawn radius and the viewer's fit
 * radius (so the relay stage draws it at the size the 3D view will).
 * Fetched once, at idle; a tap before it arrives still opens in ink, from
 * the viewer's own angle.
 *
 * The drawing's model (`/og/m/<id>-ink.json`, a couple of kB) is fetched as
 * a finger or pointer reaches a tile, so the relay can hand the visitor a
 * drawing they can keep turning while the 3D view loads (the hero's relay,
 * for every molecule with a page); the pose they leave is where 3D opens.
 *
 * Imports only the gallery page list, the ink drawing's pure math and the
 * element table: safe for the landing chunk (no three).
 */
import { getElementSpecBySymbol } from '@atlas/core';
import { hasMoleculePage, moleculeInkPath } from '../moleculePage/pages';
import { inkViewDir, type InkModel, type InkPose } from '../moleculePage/ink';

export interface InkTile {
  /** The drawing's opening pose (radians). */
  pose: InkPose;
  /** Largest distance from the centre to a drawn atom's surface (Å): the drawing's scale. */
  inkRadius: number;
  /** The viewer's content radius before padding (Å): bounds half-diagonal + largest atom. */
  fit: number;
}

const MANIFEST_URL = '/m/manifest.json';

let tiles: Map<string, InkTile> | null = null;
let pending: Promise<Map<string, InkTile>> | null = null;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseManifest(raw: unknown): Map<string, InkTile> {
  const out = new Map<string, InkTile>();
  const pages = (raw as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages)) return out;
  for (const entry of pages) {
    const page = entry as { id?: unknown; pose?: unknown; inkRadius?: unknown; fit?: unknown };
    if (typeof page.id !== 'string' || !Array.isArray(page.pose)) continue;
    const [azimuth, elevation] = page.pose as unknown[];
    if (!finite(azimuth) || !finite(elevation) || !finite(page.inkRadius) || !finite(page.fit)) continue;
    out.set(page.id, { pose: { azimuth, elevation }, inkRadius: page.inkRadius, fit: page.fit });
  }
  return out;
}

/** Fetch the manifest once (never rejects; an empty map when it is unavailable). */
export function loadInkTiles(): Promise<Map<string, InkTile>> {
  if (tiles) return Promise.resolve(tiles);
  if (pending) return pending;
  if (typeof fetch === 'undefined') return Promise.resolve(new Map());
  pending = fetch(MANIFEST_URL, { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((raw) => {
      tiles = parseManifest(raw);
      return tiles;
    })
    .catch(() => {
      // Retry on the next call (an offline blip should not cost the session its poses).
      pending = null;
      return new Map<string, InkTile>();
    });
  return pending;
}

/** Fetch the manifest when the browser is idle (the wall and finder call this on mount). */
export function preloadInkTiles(): void {
  if (tiles || pending || typeof window === 'undefined') return;
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (idle) idle(() => void loadInkTiles(), { timeout: 2500 });
  else setTimeout(() => void loadInkTiles(), 1200);
}

/** The hand-off data for a molecule, when the manifest has arrived. */
export function inkTileFor(id: string): InkTile | null {
  return tiles?.get(id) ?? null;
}

/** The ink drawing a tile shows, or null when the molecule has no page (and so no drawing). */
export function inkTileSrc(id: string): string | null {
  return hasMoleculePage(id) ? moleculeInkPath(id) : null;
}

/** The baton's view direction (normalize(camera − target)) for a tile's pose. */
export function inkTileViewDir(tile: InkTile): [number, number, number] {
  return inkViewDir(tile.pose);
}

// ─── The drawing's model ─────────────────────────────────────────────

const models = new Map<string, InkModel>();
const modelPending = new Map<string, Promise<InkModel | null>>();

/** `/og/m/<id>-ink.json`: the drawing's model. */
export function inkModelPath(id: string): string {
  return `/og/m/${encodeURIComponent(id)}-ink.json`;
}

function isInkModel(raw: unknown): raw is InkModel {
  const m = raw as Partial<InkModel> | null;
  return Boolean(
    m
      && Array.isArray(m.p) && Array.isArray(m.k) && Array.isArray(m.b) && Array.isArray(m.kinds)
      && Array.isArray(m.detents) && m.p.length === m.k.length * 3
      && finite(m.radius) && m.opening && finite(m.opening.azimuth) && finite(m.opening.elevation),
  );
}

/** Fetch a molecule's drawing model once (null when it has no page or the fetch fails). */
export function loadInkModel(id: string): Promise<InkModel | null> {
  const known = models.get(id);
  if (known) return Promise.resolve(known);
  const inFlight = modelPending.get(id);
  if (inFlight) return inFlight;
  if (!hasMoleculePage(id) || typeof fetch === 'undefined') return Promise.resolve(null);
  const request = fetch(inkModelPath(id), { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((raw) => {
      if (!isInkModel(raw)) return null;
      models.set(id, raw);
      return raw;
    })
    .catch(() => null)
    .finally(() => modelPending.delete(id));
  modelPending.set(id, request);
  return request;
}

/** Start fetching a tile's model (a finger or pointer reached it). */
export function prefetchInkModel(id: string): void {
  void loadInkModel(id);
}

/** The drawing model when it has arrived. */
export function inkModelFor(id: string): InkModel | null {
  return models.get(id) ?? null;
}

/**
 * The hand-off data from the model itself (when the manifest has not
 * arrived): its opening pose, drawn radius, and the viewer's fit radius
 * (bounds half-diagonal plus the largest ball-and-stick radius present).
 */
export function inkTileFromModel(model: InkModel): InkTile {
  let hx = 0;
  let hy = 0;
  let hz = 0;
  for (let i = 0; i < model.p.length; i += 3) {
    hx = Math.max(hx, Math.abs(model.p[i]));
    hy = Math.max(hy, Math.abs(model.p[i + 1]));
    hz = Math.max(hz, Math.abs(model.p[i + 2]));
  }
  let atom = 0;
  for (const kind of model.kinds) atom = Math.max(atom, getElementSpecBySymbol(kind.s)?.displayRadius ?? kind.r);
  return { pose: { ...model.opening }, inkRadius: model.radius, fit: Math.hypot(hx, hy, hz) + atom };
}
