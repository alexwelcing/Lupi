/**
 * `POST /v1/scan/recipe`: Jev picks how to turn a silhouette into a volume.
 *
 * The shape of an object now comes from the photo itself (its mask,
 * inflated on the device), so the judgment left for the model is the
 * recipe: which depth model fits the subject (inflate, extrude, revolve),
 * how fat, and, over several candidate masks made at different contrasts,
 * which silhouette actually reads as the subject. Jev never sees pixels; it
 * sees measurements: aspect, fill, the width profile top to bottom, where
 * the mass sits, how many pieces, how symmetric, how ragged the edge is.
 * The browser fires one call per candidate mask in parallel and keeps the
 * winner. One System One call each, no cache.
 */

import { JevError, systemOne as coreSystemOne, type JevQuestion } from '@atlas/core';
import { jevClientConfig, jevConfigured, type JevEnv } from './jev';

export const RECIPE_ROUTE = '/v1/scan/recipe';
const MAX_RECIPE_BODY_BYTES = 8 * 1024;
const RECIPE_TIMEOUT_MS = 1_500;
const MAX_SUBJECT_CHARS = 80;
const MAX_BANDS = 24;

export interface RecipeFeatures {
  fill: number;
  aspect: number;
  profile: number[];
  columns: number[];
  rows: number[];
  components: number;
  symmetry: number;
  edginess: number;
  /** Which contrast threshold made this mask, so the browser can tell candidates apart in logs. */
  threshold?: number;
}

export interface RecipeRequest {
  subject: string;
  features: RecipeFeatures;
}

export class RecipeRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'RecipeRequestError';
  }
}

const unit = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback);
const series = (value: unknown): number[] => (Array.isArray(value) ? value.slice(0, MAX_BANDS).map((entry) => (typeof entry === 'number' && Number.isFinite(entry) ? Math.max(0, Math.min(4, entry)) : 0)) : []);

export function parseRecipeRequest(raw: unknown): RecipeRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RecipeRequestError('Body must be a JSON object.');
  const body = raw as Record<string, unknown>;
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, MAX_SUBJECT_CHARS) : '';
  if (!subject) throw new RecipeRequestError('"subject" is required.');
  const features = body.features && typeof body.features === 'object' ? (body.features as Record<string, unknown>) : null;
  if (!features) throw new RecipeRequestError('"features" is required.');
  const profile = series(features.profile);
  if (profile.length < 3) throw new RecipeRequestError('"features.profile" needs at least three bands.');
  return {
    subject,
    features: {
      fill: unit(features.fill),
      aspect: typeof features.aspect === 'number' && Number.isFinite(features.aspect) ? Math.max(0.05, Math.min(20, features.aspect)) : 1,
      profile,
      columns: series(features.columns),
      rows: series(features.rows),
      components: typeof features.components === 'number' && Number.isFinite(features.components) ? Math.max(0, Math.min(999, Math.round(features.components))) : 1,
      symmetry: unit(features.symmetry, 1),
      edginess: unit(features.edginess),
      threshold: typeof features.threshold === 'number' && Number.isFinite(features.threshold) ? features.threshold : undefined,
    },
  };
}

const words = (values: number[]): string => values.map((value) => value.toFixed(2)).join(' ');

export function buildRecipeQuestions(request: RecipeRequest): { questions: Record<string, JevQuestion>; state: unknown } {
  const f = request.features;
  return {
    state: {
      subject: request.subject,
      silhouette: {
        note: 'A silhouette cut from a photo of the subject, measured. Widths are fractions of the object height, top band first. Mass shares sum to one.',
        taller_than_wide_by: Number(f.aspect.toFixed(2)),
        fills_fraction_of_frame: Number(f.fill.toFixed(3)),
        width_top_to_bottom: words(f.profile),
        mass_top_to_bottom: words(f.rows),
        mass_left_to_right: words(f.columns),
        left_right_symmetry: Number(f.symmetry.toFixed(2)),
        edge_raggedness: Number(f.edginess.toFixed(3)),
        separate_pieces_before_cleanup: f.components,
      },
    },
    questions: {
      reads: {
        type: 'noul',
        instructions: 'These measurements describe a silhouette that a person would recognise as `subject` (rather than a blob, a fragment, or the subject plus a lot of background stuck to it).',
      },
      depth: {
        type: 'choice',
        instructions: 'To give this flat silhouette of `subject` depth, which construction fits the real object best?',
        criteria: {
          inflate: 'Puff it up: deeper where it is wide, shallow at the edges. Organic and rounded things: a tree, a person, an animal, fruit, bread, a cloud, a cushion.',
          extrude: 'Give it one constant, small thickness. Flat things: a book, a phone, a card, a leaf, a plate seen face on, a sign.',
          revolve: 'Spin each row into a disc as wide as the silhouette there. Things the same all the way around a vertical axis: a bottle, a cup, a vase, a lamp, a screw, a can.',
        },
      },
      fatness: {
        type: 'choice',
        instructions: 'How deep is `subject` compared with how wide it looks here?',
        criteria: {
          thin: 'Much shallower than wide: a leaf, a book, a flat fish, a poster.',
          medium: 'About half as deep as wide: a shoe, a laptop, a loaf, a chair from the front.',
          round: 'About as deep as wide: a ball, an apple, a mug, a head, a tree crown, a bottle.',
        },
      },
    },
  };
}

export interface RecipeResponse {
  configured: boolean;
  model?: string;
  reads?: number;
  depth?: { choice: 'inflate' | 'extrude' | 'revolve'; confidence: number; probabilities: Record<string, number> };
  fatness?: { choice: 'thin' | 'medium' | 'round'; confidence: number; probabilities: Record<string, number> };
  threshold?: number;
  timing?: { ms: number };
  error?: string;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(`${JSON.stringify(value)}\n`, { ...init, headers });
}

export async function handleScanRecipe(
  request: Request,
  env: JevEnv,
  options: { fetcher?: typeof fetch; now?: () => number } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  }
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_RECIPE_BODY_BYTES) return jsonResponse({ error: 'Request body too large.' }, { status: 413 });
  let parsed: RecipeRequest;
  try {
    parsed = parseRecipeRequest(JSON.parse(new TextDecoder().decode(raw) || 'null'));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400 });
  }
  if (!jevConfigured(env)) return jsonResponse({ configured: false } satisfies RecipeResponse);
  const now = options.now ?? Date.now;
  const started = now();
  const { questions, state } = buildRecipeQuestions(parsed);
  try {
    const result = await coreSystemOne({ ...jevClientConfig(env, { timeoutMs: RECIPE_TIMEOUT_MS, fetcher: options.fetcher }), retries: 0 }, { state, questions });
    const reads = result.answers.reads;
    const depth = result.answers.depth;
    const fatness = result.answers.fatness;
    const response: RecipeResponse = {
      configured: true,
      model: result.model,
      reads: reads && reads.type === 'noul' ? round3(reads.noul) : undefined,
      depth:
        depth && depth.type === 'choice'
          ? { choice: depth.choice as 'inflate' | 'extrude' | 'revolve', confidence: round3(depth.confidence), probabilities: Object.fromEntries(Object.entries(depth.probabilities).map(([key, value]) => [key, round3(value)])) }
          : undefined,
      fatness:
        fatness && fatness.type === 'choice'
          ? { choice: fatness.choice as 'thin' | 'medium' | 'round', confidence: round3(fatness.confidence), probabilities: Object.fromEntries(Object.entries(fatness.probabilities).map(([key, value]) => [key, round3(value)])) }
          : undefined,
      threshold: parsed.features.threshold,
      timing: { ms: now() - started },
    };
    console.log(
      JSON.stringify({
        component: 'lupi_jev',
        route: 'recipe',
        model: result.model,
        reads: response.reads ?? null,
        depth: response.depth?.choice ?? null,
        depthConfidence: response.depth?.confidence ?? null,
        fatness: response.fatness?.choice ?? null,
        components: parsed.features.components,
        inputTokens: result.usage?.input_tokens ?? null,
        ms: response.timing?.ms,
      }),
    );
    return jsonResponse(response);
  } catch (error) {
    const status = error instanceof JevError ? error.status : 502;
    console.warn(JSON.stringify({ component: 'lupi_jev', route: 'recipe', error: error instanceof Error ? error.message : String(error), status, ms: now() - started }));
    return jsonResponse({ configured: true, error: error instanceof Error ? error.message : 'Jev failed.' } satisfies RecipeResponse, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
