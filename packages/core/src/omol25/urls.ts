import { isOmol25CollectionId, omol25Collection, type Omol25CollectionId } from './collections';

const STRUCTURE_PATH_RE = /^\/v1\/datasets\/omol25\/([a-z0-9-]+)\/structures\/(\d+)\.xyz$/;
/** Same-origin copies of the featured neutral-validation picks. */
export const OMOL25_FEATURED_PATH_RE = /^\/datasets\/omol25\/featured\/omol25_nv_(\d+)\.xyz$/;
export const OMOL25_FEATURED_FILE_PATH = '/datasets/omol25/featured.v1.json';

/** The edge route that materializes one source row as XYZ. */
export function omolStructurePath(collection: Omol25CollectionId, row: number): string {
  return `/v1/datasets/omol25/${collection}/structures/${row}.xyz`;
}

/** Stable key of a featured neutral-validation pick (file names, ink, analytics). */
export function omolPickKey(row: number): string {
  return `omol25_nv_${row}`;
}

export function omolFeaturedPath(row: number): string {
  return `/datasets/omol25/featured/${omolPickKey(row)}.xyz`;
}

/** Ink drawing written by the web build for a featured pick. */
export function omolPickInkPath(row: number): string {
  return `/og/omol25/${omolPickKey(row)}-ink.svg`;
}

/** Viewer title for any OMol25 structure. */
export function omolTitle(formula: string): string {
  return `${formula} (OMol25)`;
}

/**
 * Identify an OMol25 structure URL: an edge structure route on any origin, or
 * a featured pick file. Query and hash are ignored; this names the record, it
 * does not decide whether a URL may be fetched (remoteMoleculeUrlPolicy does).
 */
export function parseOmolStructurePath(
  url: string,
): { collection: Omol25CollectionId; row: number; featured: boolean } | null {
  const pathname = pathnameOf(url);
  if (pathname === null) return null;

  const edge = STRUCTURE_PATH_RE.exec(pathname);
  if (edge) {
    if (!isOmol25CollectionId(edge[1])) return null;
    const row = rowIndex(edge[2], omol25Collection(edge[1]).indexedRows);
    return row === null ? null : { collection: edge[1], row, featured: false };
  }
  const featured = OMOL25_FEATURED_PATH_RE.exec(pathname);
  if (featured) {
    const row = rowIndex(featured[1], omol25Collection('neutral-validation').indexedRows);
    return row === null ? null : { collection: 'neutral-validation', row, featured: true };
  }
  return null;
}

export function isOmol25Url(url: string): boolean {
  return parseOmolStructurePath(url) !== null;
}

function pathnameOf(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url.split(/[?#]/, 1)[0];
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function rowIndex(digits: string, rows: number): number | null {
  const row = Number(digits);
  return Number.isSafeInteger(row) && row >= 0 && row < rows ? row : null;
}
