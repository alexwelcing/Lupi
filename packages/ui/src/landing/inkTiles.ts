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
 * Imports only the gallery page list and the ink drawing's pure math: safe
 * for the landing chunk (no three).
 */
import { hasMoleculePage, moleculeInkPath } from '../moleculePage/pages';
import { inkViewDir, type InkPose } from '../moleculePage/ink';

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
