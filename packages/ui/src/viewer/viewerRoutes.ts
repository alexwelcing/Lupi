import type { SeoEducationKind } from '../landing/SeoEducationPage';
import { slugifySavedViewTitle } from '../savedViews';

export function currentHashRoute() {
  if (typeof window === 'undefined') return '/';
  const hash = window.location.hash.replace(/^#/, '').trim();
  return hash.startsWith('/') ? hash : '/';
}

export function currentPathRoute() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname || '/';
}

export function normalizedPathRoute(route: string) {
  if (route === '/') return route;
  return route.replace(/\/+$/, '') || '/';
}

export function savedViewSlugFromRoute(route: string): string | null {
  const routePath = route.split('?')[0] || '/';
  if (!routePath.startsWith('/view/')) return null;
  try {
    return slugifySavedViewTitle(decodeURIComponent(routePath.slice('/view/'.length)));
  } catch {
    return null;
  }
}

export const SEO_EDUCATION_ROUTES: Record<string, SeoEducationKind> = {
  '/study/organic-functional-groups': 'functional-groups',
  '/study/functional-group-examples': 'functional-group-examples',
  '/study/organic-chemistry-3d-molecule-viewer': 'ochem-viewer',
  '/materials/omol25': 'omol25',
  '/materials/omol25-molecule-geometry': 'omol25-geometry',
  '/materials/million-atom-viewer': 'million-atom-viewer',
};

export function isTestbedRoute(search = typeof window === 'undefined' ? '' : window.location.search) {
  return new URLSearchParams(search).has('testbed');
}

export function isEmojiRoute(hashRoute = currentHashRoute(), search = typeof window === 'undefined' ? '' : window.location.search) {
  return new URLSearchParams(search).has('emoji') || hashRoute.split('?')[0] === '/system/emoji';
}

export function isBillionAtomsRoute(search = typeof window === 'undefined' ? '' : window.location.search) {
  return new URLSearchParams(search).has('billion-atoms');
}

export function isMcpViewerRoute(hashPath: string, search = typeof window === 'undefined' ? '' : window.location.search) {
  return hashPath === '/mcp' || new URLSearchParams(search).has('mcp');
}

export function isEmbeddedMobileViewerRoute(hashRoute: string): boolean {
  return hashRoute.split('?')[0] === '/embed/mobile';
}

/**
 * Legacy Z1 science URLs: `?demo=science-panel` or `#/demo/science-panel`.
 * These redirect into the integrated viewer experience (`#/science/<index>`
 * with the trajectory loaded and the SCIENCE deck section open) inside
 * ViewerApp; the standalone demo page no longer exists.
 */
export function isScienceDemoRoute(hashRoute = currentHashRoute(), search = typeof window === 'undefined' ? '' : window.location.search) {
  return new URLSearchParams(search).get('demo') === 'science-panel' || hashRoute.split('?')[0] === '/demo/science-panel' || isSciencePanelRoute(hashRoute);
}

/**
 * Canonical science route: `#/science/<index>` (normalized like `/view/:slug`).
 * Lands in the viewer: the bound Z1 gallery trajectory loads through the
 * normal pipeline and the SCIENCE deck section opens.
 */
export function isSciencePanelRoute(hashRoute: string): boolean {
  return /^\/science\/\d+$/.test(hashRoute.split('?')[0]);
}

/** Parse the zero-based path index from `#/science/<index>`; null when absent/invalid. */
export function sciencePathIndexFromRoute(route: string): number | null {
  const match = route.split('?')[0].match(/^\/science\/(\d+)$/);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * Library routes: the browsable, source-backed molecular library restored by
 * the 2026-09-18 owner decision (docs/library-restoration-design.md). These
 * are path routes, not homepage tabs, so they survive landing redesigns and
 * can be deep-linked by lessons and agents.
 */
export type LibraryCollectionId = 'all' | 'gallery' | 'omol25' | 'research' | 'potentials' | 'random';

export const LIBRARY_ROUTES: Record<string, LibraryCollectionId> = {
  '/library': 'all',
  '/library/gallery': 'gallery',
  '/library/omol25': 'omol25',
  '/library/research': 'research',
  '/library/potentials': 'potentials',
  '/library/random': 'random',
};

export function libraryPath(collection: LibraryCollectionId): string {
  return collection === 'all' ? '/library' : `/library/${collection}`;
}

export function libraryCollectionFromRoute(route: string): LibraryCollectionId | null {
  return LIBRARY_ROUTES[normalizedPathRoute(route.split('?')[0] || '/')] ?? null;
}

/**
 * Pre-reset homepage tabs and the retired OMol25 education URLs now live in
 * the Library. Returns the path to redirect to, or null when the URL is not a
 * legacy library entry point. Research execution tabs stay retired.
 */
export function libraryRedirectTarget(pathname: string, search: string): string | null {
  const path = normalizedPathRoute(pathname);
  if (path === '/materials/omol25' || path === '/materials/omol25-molecule-geometry') {
    return '/library/omol25';
  }
  if (path !== '/') return null;
  const tab = new URLSearchParams(search).get('tab');
  switch (tab) {
    case 'browse':
      return '/library';
    case 'simulations':
      return '/library/gallery';
    case 'omol25':
      return '/library/omol25';
    case 'research':
      return '/library/research';
    case 'potentials':
      return '/library/potentials';
    default:
      return null;
  }
}
