/**
 * Shared types, constants, and injected CSS animations for the landing page.
 */

import galleryData from '../gallery-data.json';

export interface GalleryExample {
  id: string;
  title: string;
  subtitle: string;
  domain: string;
  atoms: string;
  frames: string;
  file: string;
  available: boolean;
  colors: [string, string, string];
  featured?: boolean;
  metadata?: Record<string, string>;
  /** Multi-frame trajectory marker + per-atom property to color by, when present. */
  isTrajectory?: boolean;
  autoPlay?: boolean;
  colorBy?: string;
  /** Dedicated-page card: navigates to this route instead of loading a file. */
  route?: string;
}

export const ALL_EXAMPLES: GalleryExample[] = galleryData as any[];

export const FEATURED_IDS = [
  'lupine_sphere_grid',
  'c60_buckyball',
  'cnt_6_6',
  'graphene_ribbon',
  'elliott_gst_crystallization',
  'diamond_crystal',
  'aspirin',
  'brilliant_diamond_macro',
  'cuzr_melt',
];

export function publicAssetUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = (import.meta as any).env?.BASE_URL || '/';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = path.replace(/^\/+/, '');
  return `${cleanBase}${cleanPath}`.replace(/([^:]\/)\/+/g, '$1');
}
