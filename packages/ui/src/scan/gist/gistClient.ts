import { latheFromProfile, normalizeGist, type DepthModel, type Gist, type MaskFeatures, type OutlinePoint } from '@atlas/core/gist';
import type { PreparedImage } from '../identify';

/**
 * Browser calls for the gist stage: one to sketch the shape from the photo,
 * one per sculpting step. Both fail soft: a non-JSON or non-2xx reply is
 * "no answer", and a `configured: false` reply stops the session asking.
 */
export const GIST_PATH = '/v1/scan/gist';
export const SCULPT_PATH = '/v1/scan/sculpt';
export const RECIPE_PATH = '/v1/scan/recipe';
const GIST_TIMEOUT_MS = 20_000;
const SCULPT_TIMEOUT_MS = 2_500;
const RECIPE_TIMEOUT_MS = 3_000;

export interface GistReply {
  configured: boolean;
  model?: string;
  gist?: Gist;
  /** The object's silhouette in the photo, image fractions, (0, 0) top left. */
  outline?: OutlinePoint[];
  /** Roughly the same all the way around a vertical axis: the outline can stand in for the body. */
  revolved?: boolean;
  timing?: { ms: number };
  cached?: boolean;
  error?: string;
  reason?: string;
}

export interface SculptReply {
  configured: boolean;
  model?: string;
  move?: { id: string; confidence: number; probabilities: Record<string, number> };
  likeness?: number;
  moves?: Array<{ id: string; description: string }>;
  shapeProfile?: number[];
  mismatch?: number | null;
  timing?: { ms: number };
  error?: string;
}

let gistUnavailable = false;
let sculptUnavailable = false;

export function resetGistAvailability(): void {
  gistUnavailable = false;
  sculptUnavailable = false;
  recipeUnavailable = false;
}

async function post<T extends { configured: boolean }>(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
  if (typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) return { configured: false } as T;
    const payload = (await response.json()) as T;
    if (payload.configured === false) return payload;
    if (!response.ok) return null;
    return payload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Sketch the gist of a photo. Null means no answer; `configured: false` means the edge has no vision key. */
export async function requestGist(image: PreparedImage, hint: string, signal?: AbortSignal): Promise<GistReply | null> {
  if (gistUnavailable) return { configured: false };
  const reply = await post<GistReply>(GIST_PATH, { image: { mediaType: image.mediaType, data: image.base64 }, hint: hint.trim() || undefined }, GIST_TIMEOUT_MS, signal);
  if (reply?.configured === false) {
    gistUnavailable = true;
    return reply;
  }
  if (!reply?.gist) return reply ? { ...reply, gist: undefined } : null;
  const gist = normalizeGist(reply.gist);
  return gist ? { ...reply, gist } : null;
}

/** One sculpting judgment. Null means no answer this round; the loop just asks again. */
export type SculptMode = 'choice' | 'nouls';

export async function requestSculpt(subject: string, gist: Gist, photoProfile: number[] | null, signal?: AbortSignal, mode: SculptMode = 'choice'): Promise<SculptReply | null> {
  if (sculptUnavailable) return { configured: false };
  const reply = await post<SculptReply>(SCULPT_PATH, { subject, gist, photoProfile: photoProfile ?? undefined, mode }, SCULPT_TIMEOUT_MS, signal);
  if (reply?.configured === false) sculptUnavailable = true;
  return reply;
}

export interface RecipeReply {
  configured: boolean;
  model?: string;
  reads?: number;
  depth?: { choice: DepthModel; confidence: number; probabilities: Record<string, number> };
  fatness?: { choice: 'thin' | 'medium' | 'round'; confidence: number; probabilities: Record<string, number> };
  tolerance?: number;
  timing?: { ms: number };
  error?: string;
}

let recipeUnavailable = false;

/** One recipe judgment for one candidate silhouette; the page fires several in parallel. */
export async function requestRecipe(subject: string, features: MaskFeatures & { tolerance?: number }, signal?: AbortSignal): Promise<RecipeReply | null> {
  if (recipeUnavailable) return { configured: false };
  const { fill, aspect, profile, columns, rows, components, symmetry, edginess, tolerance } = features;
  const reply = await post<RecipeReply>(RECIPE_PATH, { subject, features: { fill, aspect, profile, columns, rows, components, symmetry, edginess, tolerance } }, RECIPE_TIMEOUT_MS, signal);
  if (reply?.configured === false) recipeUnavailable = true;
  return reply;
}

/** Depth for a fatness word, in the volume builder's units. */
export const FATNESS: Record<'thin' | 'medium' | 'round', number> = { thin: 0.3, medium: 0.6, round: 0.9 };

/**
 * Hand-built gists for the demo link and for a deployment without keys, so
 * the stage can be seen without a photo. Same vocabulary the model writes.
 */
export const DEMO_GISTS: Record<string, Gist> = {
  apple: {
    label: 'apple',
    confidence: 1,
    palette: ['#e0493e', '#9bd36a'],
    primitives: [
      { kind: 'ellipsoid', name: 'body', center: [0, -0.05, 0], size: [0.92, 0.82, 0.92], rotation: [0, 0, 0], blend: 0.1, subtract: false },
      { kind: 'sphere', name: 'dimple', center: [0, 0.98, 0], size: [0.34, 0, 0], rotation: [0, 0, 0], blend: 0.08, subtract: true },
      { kind: 'cylinder', name: 'stem', center: [0.04, 0.82, 0], size: [0.05, 0.18, 0], rotation: [0, 0, 12], blend: 0.04, subtract: false },
    ],
  },
  screw: {
    label: 'wood screw',
    confidence: 1,
    palette: ['#b8bcc2', '#6c7580'],
    primitives: [
      { kind: 'cylinder', name: 'body', center: [0, -0.15, 0], size: [0.16, 0.85, 0], rotation: [0, 0, 0], blend: 0.05, subtract: false },
      { kind: 'cone', name: 'tip', center: [0, -1.15, 0], size: [0.16, 0.16, 0], rotation: [0, 0, 0], blend: 0.05, subtract: false },
      { kind: 'cone', name: 'head', center: [0, 0.82, 0], size: [0.18, 0.13, 0.46], rotation: [0, 0, 0], blend: 0.03, subtract: false },
      { kind: 'box', name: 'slot', center: [0, 0.98, 0], size: [0.5, 0.06, 0.05], rotation: [0, 0, 0], blend: 0, subtract: true },
    ],
  },
  banana: {
    label: 'banana',
    confidence: 1,
    palette: ['#f2d23a', '#8a6a1c'],
    primitives: [
      { kind: 'arc', name: 'body', center: [0, 0.35, 0], size: [1.05, 0.2, 0.95], rotation: [0, 0, 180], blend: 0.08, subtract: false },
      { kind: 'cylinder', name: 'stem', center: [-0.86, -0.32, 0], size: [0.06, 0.12, 0], rotation: [0, 0, 25], blend: 0.05, subtract: false },
    ],
  },
  vase: {
    label: 'vase',
    confidence: 1,
    palette: ['#5aa9c9', '#f0e6d2'],
    primitives: [
      latheFromProfile([0.28, 0.2, 0.18, 0.24, 0.42, 0.56, 0.62, 0.6, 0.52, 0.42, 0.34, 0.36]),
    ],
  },
  mug: {
    label: 'coffee mug',
    confidence: 1,
    palette: ['#f2f0ea', '#8b5a2b'],
    primitives: [
      { kind: 'cylinder', name: 'body', center: [0, 0, 0], size: [0.62, 0.78, 0], rotation: [0, 0, 0], blend: 0.05, subtract: false },
      { kind: 'cylinder', name: 'hollow', center: [0, 0.2, 0], size: [0.52, 0.78, 0], rotation: [0, 0, 0], blend: 0.03, subtract: true },
      { kind: 'torus', name: 'handle', center: [0.72, 0, 0], size: [0.38, 0.09, 0], rotation: [90, 0, 0], blend: 0.08, subtract: false },
    ],
  },
};
