import { normalizeGist, type Gist } from '@atlas/core/gist';
import type { PreparedImage } from '../identify';

/**
 * Browser calls for the gist stage: one to sketch the shape from the photo,
 * one per sculpting step. Both fail soft: a non-JSON or non-2xx reply is
 * "no answer", and a `configured: false` reply stops the session asking.
 */
export const GIST_PATH = '/v1/scan/gist';
export const SCULPT_PATH = '/v1/scan/sculpt';
const GIST_TIMEOUT_MS = 20_000;
const SCULPT_TIMEOUT_MS = 2_500;

export interface GistReply {
  configured: boolean;
  model?: string;
  gist?: Gist;
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
  timing?: { ms: number };
  error?: string;
}

let gistUnavailable = false;
let sculptUnavailable = false;

export function resetGistAvailability(): void {
  gistUnavailable = false;
  sculptUnavailable = false;
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
export async function requestSculpt(subject: string, gist: Gist, signal?: AbortSignal): Promise<SculptReply | null> {
  if (sculptUnavailable) return { configured: false };
  const reply = await post<SculptReply>(SCULPT_PATH, { subject, gist }, SCULPT_TIMEOUT_MS, signal);
  if (reply?.configured === false) sculptUnavailable = true;
  return reply;
}

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
