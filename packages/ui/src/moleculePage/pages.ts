/**
 * pages.ts — which gallery molecules have a zero-canvas page at /m/<id>, and
 * where its share card, ink drawing and desk models live.
 *
 * One rule shared by the build-time generator (scripts/generate-molecule-
 * pages.mts) and the app's links, so a link never points at a page the build
 * did not write: a single-frame XYZ under gallery/curated/ that opens
 * directly, small enough to draw as ink (MOLECULE_PAGE_MAX_ATOMS).
 *
 * Imports only the gallery JSON: safe for the landing chunk.
 */
import galleryData from '../gallery-data.json';

/** Above this many atoms the ink drawing is too dense to read; no page. */
export const MOLECULE_PAGE_MAX_ATOMS = 600;

interface GalleryEntryLike {
  id: string;
  file?: string;
  route?: string;
  available?: boolean;
  atoms?: string;
  frames?: string;
  isTrajectory?: boolean;
}

function atomCount(label: string | undefined): number {
  const digits = (label ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

/** True when the build writes /m/<id> for this gallery entry. */
export function hasMoleculePageEntry(entry: GalleryEntryLike): boolean {
  if (entry.available === false || entry.route || entry.isTrajectory) return false;
  const file = entry.file ?? '';
  if (!file.startsWith('gallery/curated/') || !file.endsWith('.xyz')) return false;
  if (entry.frames && entry.frames !== '1') return false;
  const atoms = atomCount(entry.atoms);
  return atoms > 0 && atoms <= MOLECULE_PAGE_MAX_ATOMS;
}

/** Gallery ids with a molecule page, in gallery order. */
export const MOLECULE_PAGE_IDS: readonly string[] = (galleryData as GalleryEntryLike[])
  .filter(hasMoleculePageEntry)
  .map((entry) => entry.id);

const PAGE_ID_SET = new Set(MOLECULE_PAGE_IDS);

/** `/gallery/curated/…/caffeine.xyz` → `caffeine`, for pages only. */
const PAGE_ID_BY_FILE = new Map(
  (galleryData as GalleryEntryLike[]).filter(hasMoleculePageEntry).map((entry) => [`/${entry.file}`, entry.id]),
);

export function hasMoleculePage(id: string | null | undefined): id is string {
  return typeof id === 'string' && PAGE_ID_SET.has(id);
}

/** `/m/<id>`: the molecule's page (the canonical share link for a gallery molecule). */
export function moleculePagePath(id: string): string {
  return `/m/${encodeURIComponent(id)}`;
}

/** The 1200×630 share card (Open Graph / Twitter). */
export function moleculeCardPath(id: string): string {
  return `/og/m/${encodeURIComponent(id)}.png`;
}

/** The ink drawing alone, transparent, at the page's opening pose. */
export function moleculeInkPath(id: string): string {
  return `/og/m/${encodeURIComponent(id)}-ink.svg`;
}

/** AR Quick Look (iPhone, iPad) and Scene Viewer (Android) models. */
export function moleculeDeskPaths(id: string): { usdz: string; glb: string } {
  const safe = encodeURIComponent(id);
  return { usdz: `/ar/${safe}.usdz`, glb: `/ar/${safe}.glb` };
}

/** The absolute share URL for a molecule page on `origin`. */
export function moleculePageUrl(id: string, origin = typeof window === 'undefined' ? 'https://lupi.live' : window.location.origin): string {
  return `${origin.replace(/\/+$/, '')}${moleculePagePath(id)}`;
}

/**
 * The molecule page for what the viewer shows: the gallery card it was opened
 * from, else its source file (a saved view or a shared link of a gallery
 * molecule loads by URL). Null for anything without a page.
 */
export function moleculePageIdFor(activeCardId: string | null | undefined, sourceUrl?: string | null): string | null {
  if (hasMoleculePage(activeCardId)) return activeCardId;
  if (!sourceUrl) return null;
  try {
    const pathname = decodeURIComponent(new URL(sourceUrl, 'https://lupi.live').pathname);
    return PAGE_ID_BY_FILE.get(pathname) ?? null;
  } catch {
    return null;
  }
}
