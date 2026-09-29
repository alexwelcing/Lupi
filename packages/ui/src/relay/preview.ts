/**
 * preview.ts — the flat preview a sage plate shows while a molecule opens:
 * `/learn/<id>.svg` for gallery ids that have one (tools/build-gallery-
 * previews.mjs), otherwise nothing, so a plate never requests art that does
 * not exist. Tiny on purpose: the entry chunk's splash imports it.
 */
import previews from '../gallery/previews.json';

const PREVIEW_IDS = new Set<string>(previews.ids);
const GALLERY_ID = /^[a-z0-9_]+$/;

/** `/learn/<id>.svg` when `id` is a gallery id with preview art; else null. */
export function previewUrl(id: string | null | undefined): string | null {
  if (!id || !GALLERY_ID.test(id) || !PREVIEW_IDS.has(id)) return null;
  return `/learn/${id}.svg`;
}

/** The gallery id a deep link opens (`?sim=<id>`), or null. */
export function deepLinkGalleryId(search: string = typeof window === 'undefined' ? '' : window.location.search): string | null {
  const id = new URLSearchParams(search).get('sim');
  return id && GALLERY_ID.test(id) ? id : null;
}
