/**
 * The gist: a photo becomes a shape, and Jev sculpts it.
 *
 * `POST /v1/scan/gist` asks Claude for the geometric essence of what is in
 * the photo: a label and a handful of blended primitives (`@atlas/core/gist`)
 * that a cloud of particles can settle into. It is a separate, smaller call
 * from `/v1/scan/identify` so the shape and its label land in front of the
 * person before the molecule breakdown does.
 *
 * `POST /v1/scan/sculpt` is the fast loop: given the subject and the current
 * gist, Jev picks one named edit ("flatten it", "add a stem", "keep") and
 * rates how much the shape reads as the subject. The browser fires it every
 * hundred-odd milliseconds while the particles are on screen, applies the
 * chosen move, and asks again. Each call is one System One request with two
 * questions; the moves and their descriptions come from shared code so the
 * edge and the browser agree on what a move id means.
 */

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  GIST_KEEP_MOVE,
  JevError,
  applicableMoves,
  describeGist,
  normalizeGist,
  systemOne as coreSystemOne,
  type Gist,
  type JevQuestion,
} from '@atlas/core';
import { jevClientConfig, jevConfigured } from './jev';
import {
  ScanVisionError,
  anthropicClient,
  parseScanRequest,
  scanConfigured,
  scanVisionModel,
  structuredOutputSchema,
  type ScanEnv,
  type ScanRequest,
} from './scan';

export const GIST_ROUTE = '/v1/scan/gist';
export const SCULPT_ROUTE = '/v1/scan/sculpt';
/** Bump when the instructions or the schema change so cached gists from the old prompt are not served. */
export const GIST_PROMPT_VERSION = 'gist-v1-primitives';
export const SCULPT_PROMPT_VERSION = 'sculpt-v1-moves';
const MAX_GIST_BODY_BYTES = 6 * 1024 * 1024;
const MAX_SCULPT_BODY_BYTES = 16 * 1024;
const GIST_MAX_TOKENS = 1_400;
const GIST_CACHE_TTL_SECONDS = 3_600;
/** The loop wants an answer or nothing; a retry would arrive after the next call anyway. */
const SCULPT_TIMEOUT_MS = 1_200;
const MAX_SUBJECT_CHARS = 80;

/* ─── Gist from a photo ─── */

const GIST_SYSTEM_PROMPT = `You are Lupi's shape sketcher. Someone points a camera at an everyday thing and a cloud of particles has to swirl into a shape a person recognises at a glance. You give that shape as a few blended primitives.

Coordinates: Y is up. The whole object fits inside a cube 2 units across, centred at the origin, standing the way the thing normally sits. Every size is a half-extent or a radius. Kinds:
- sphere: size.x is the radius.
- ellipsoid: size is the three radii.
- box: size is the three half-extents.
- cylinder: size.x radius, size.y half height; it stands along Y.
- capsule: size.x radius, size.y half length of the straight part; along Y.
- cone: size.x bottom radius, size.y half height, size.z top radius (0 for a point); along Y.
- torus: size.x ring radius, size.y tube radius; it lies flat in XZ. Rotate 90 degrees about X to stand it up, like a mug handle.
rotation is degrees about X, Y, Z. blend is how softly a part melts into the rest: 0 is a crisp seam, 0.3 is very soft. subtract carves the shape out instead of adding it (a dimple, the inside of a cup).

Use the fewest primitives that give the gist: one body plus the parts that make it recognisable (a stem, a handle, a spout, legs). At most eight. The first primitive is the body and must not be subtractive. Name parts with one word. Give a short label for what it is, your confidence, and two hex colours: the thing's main colour and an accent. If there is no physical object in the photo, label it "nothing" with confidence 0 and give one small sphere.`;

const VECTOR_SCHEMA = { type: 'object', additionalProperties: false, required: ['x', 'y', 'z'], properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } } as const;

const GIST_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'confidence', 'palette', 'primitives'],
  properties: {
    label: { type: 'string' },
    confidence: { type: 'number' },
    palette: {
      type: 'object',
      additionalProperties: false,
      required: ['main', 'accent'],
      properties: { main: { type: 'string' }, accent: { type: 'string' } },
    },
    primitives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'name', 'center', 'size', 'rotation', 'blend', 'subtract'],
        properties: {
          kind: { type: 'string', enum: ['sphere', 'ellipsoid', 'box', 'cylinder', 'capsule', 'cone', 'torus'] },
          name: { type: 'string' },
          center: VECTOR_SCHEMA,
          size: VECTOR_SCHEMA,
          rotation: VECTOR_SCHEMA,
          blend: { type: 'number' },
          subtract: { type: 'boolean' },
        },
      },
    },
  },
} as const;

/** The model writes vectors as objects and the palette as fields; the gist wants arrays. */
export function gistFromModelJson(raw: unknown): Gist | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const vector = (value: unknown): [number, number, number] | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    return [Number(record.x), Number(record.y), Number(record.z)];
  };
  const palette = body.palette && typeof body.palette === 'object' ? (body.palette as Record<string, unknown>) : {};
  return normalizeGist({
    label: body.label,
    confidence: body.confidence,
    palette: [palette.main, palette.accent],
    primitives: Array.isArray(body.primitives)
      ? body.primitives.map((primitive) => {
          if (!primitive || typeof primitive !== 'object') return null;
          const record = primitive as Record<string, unknown>;
          return { ...record, center: vector(record.center), size: vector(record.size), rotation: vector(record.rotation) };
        })
      : [],
  });
}

export interface GistOutcome {
  gist: Gist;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export async function gistWithVision(env: ScanEnv, request: ScanRequest, options: { fetcher?: typeof fetch } = {}): Promise<GistOutcome> {
  if (!scanConfigured(env)) throw new ScanVisionError('Vision is not configured.', 503, 'not-configured');
  const client = anthropicClient(env, options.fetcher);
  const model = scanVisionModel(env);
  const userText = request.hint ? `Sketch the gist of this. The person added a hint: "${request.hint}".` : 'Sketch the gist of this.';
  let message: BetaMessage;
  try {
    message = await client.beta.messages.create({
      model,
      max_tokens: GIST_MAX_TOKENS,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: GIST_SYSTEM_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: structuredOutputSchema(GIST_OUTPUT_SCHEMA) } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: request.image.mediaType, data: request.image.data } },
            { type: 'text', text: userText },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof APIConnectionTimeoutError) throw new ScanVisionError('Vision timed out.', 504, 'timeout');
    if (error instanceof RateLimitError) throw new ScanVisionError('Vision is rate limited.', 429, 'rate-limited');
    if (error instanceof APIError && typeof error.status === 'number') {
      throw new ScanVisionError(`Vision request failed (${error.status}).`, error.status >= 500 ? 502 : error.status, `http-${error.status}`);
    }
    if (error instanceof APIConnectionError) throw new ScanVisionError('Vision is unreachable.', 504, 'network');
    throw new ScanVisionError('Vision failed.', 502, 'network');
  }
  if (message.stop_reason === 'refusal') throw new ScanVisionError('The model declined to sketch this photo.', 422, 'declined');
  if (message.stop_reason === 'max_tokens') throw new ScanVisionError('The sketch ran past its budget.', 502, 'invalid-response');
  const block = message.content.find((entry): entry is Extract<BetaMessage['content'][number], { type: 'text' }> => entry.type === 'text');
  if (!block) throw new ScanVisionError('The model returned no text.', 502, 'invalid-response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    throw new ScanVisionError('The model returned malformed JSON.', 502, 'invalid-response');
  }
  const gist = gistFromModelJson(parsed);
  if (!gist) throw new ScanVisionError('The model returned an unusable sketch.', 502, 'invalid-response');
  return {
    gist,
    model: message.model,
    usage: { inputTokens: message.usage?.input_tokens ?? null, outputTokens: message.usage?.output_tokens ?? null },
  };
}

export interface GistResponse {
  configured: boolean;
  model?: string;
  gist?: Gist;
  timing?: { ms: number };
  cached?: boolean;
  error?: string;
  reason?: string;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(`${JSON.stringify(value)}\n`, { ...init, headers });
}

/** `POST /v1/scan/gist`: one photo → label and primitives. */
export async function handleScanGist(
  request: Request,
  env: ScanEnv,
  options: { fetcher?: typeof fetch; cache?: Cache | null; now?: () => number } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_GIST_BODY_BYTES) return jsonResponse({ error: 'Request body too large.' }, { status: 413 });
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_GIST_BODY_BYTES) return jsonResponse({ error: 'Request body too large.' }, { status: 413 });
  let parsed: ScanRequest;
  try {
    parsed = parseScanRequest(JSON.parse(new TextDecoder().decode(raw) || 'null'));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400 });
  }
  if (!scanConfigured(env)) return jsonResponse({ configured: false } satisfies GistResponse);

  const now = options.now ?? Date.now;
  const model = scanVisionModel(env);
  const canonical = JSON.stringify({ i: await sha256Hex(parsed.image.data), h: parsed.hint.toLowerCase(), m: model });
  const cacheKey = new Request(`https://scan-cache.lupi.live/gist/${GIST_PROMPT_VERSION}/${await sha256Hex(canonical)}`);
  const cache = options.cache === undefined ? (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null : options.cache;
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) {
      const body = (await hit.json()) as GistResponse;
      return jsonResponse({ ...body, cached: true });
    }
  }

  const started = now();
  let outcome: GistOutcome;
  try {
    outcome = await gistWithVision(env, parsed, { fetcher: options.fetcher });
  } catch (error) {
    const failure = error instanceof ScanVisionError ? error : new ScanVisionError('Vision failed.', 502, 'network');
    console.warn(JSON.stringify({ component: 'lupi_scan', stage: 'gist', model, reason: failure.reason, status: failure.status, ms: now() - started }));
    return jsonResponse({ configured: true, error: failure.message, reason: failure.reason } satisfies GistResponse, { status: failure.status });
  }
  const response: GistResponse = { configured: true, model: outcome.model, gist: outcome.gist, timing: { ms: now() - started } };
  console.log(
    JSON.stringify({
      component: 'lupi_scan',
      stage: 'gist',
      model: outcome.model,
      primitives: outcome.gist.primitives.length,
      confidence: outcome.gist.confidence,
      hasHint: parsed.hint.length > 0,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      ms: response.timing?.ms,
    }),
  );
  if (cache) {
    const stored = new Response(JSON.stringify(response), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${GIST_CACHE_TTL_SECONDS}` },
    });
    await cache.put(cacheKey, stored).catch(() => undefined);
  }
  return jsonResponse(response);
}

/* ─── Sculpt: one Jev judgment per call ─── */

export interface SculptRequest {
  subject: string;
  gist: Gist;
}

export class SculptRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'SculptRequestError';
  }
}

export function parseSculptRequest(raw: unknown): SculptRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SculptRequestError('Body must be a JSON object.');
  const body = raw as Record<string, unknown>;
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, MAX_SUBJECT_CHARS) : '';
  if (!subject) throw new SculptRequestError('"subject" is required.');
  const gist = normalizeGist(body.gist);
  if (!gist) throw new SculptRequestError('"gist" must be a gist with at least one solid primitive.');
  return { subject, gist };
}

export function buildSculptQuestions(request: SculptRequest): { questions: Record<string, JevQuestion>; state: unknown } {
  const moves = applicableMoves(request.gist);
  const criteria: Record<string, string> = { [GIST_KEEP_MOVE]: 'Keep the shape as it is: it already reads as the subject, or no listed edit would help.' };
  for (const move of moves) criteria[move.id] = move.description;
  return {
    state: {
      subject: request.subject,
      shape: describeGist(request.gist),
      note: 'The shape is shown as a cloud of a few thousand particles settled onto its surface, seen from a slowly orbiting camera. Only the silhouette and proportions matter.',
    },
    questions: {
      move: {
        type: 'choice',
        instructions: 'Which single edit to `shape` would make it read more like `subject` to a person glancing at it? Choose `keep` if it already reads as the subject or no edit listed helps.',
        criteria,
      },
      likeness: {
        type: 'noul',
        instructions: 'A person glancing at `shape`, as described, would recognise it as `subject`.',
      },
    },
  };
}

export interface SculptResponse {
  configured: boolean;
  model?: string;
  move?: { id: string; confidence: number; probabilities: Record<string, number> };
  likeness?: number;
  moves?: Array<{ id: string; description: string }>;
  timing?: { ms: number };
  error?: string;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** `POST /v1/scan/sculpt`: subject + gist → one move and a likeness. No cache: every call is a new shape. */
export async function handleScanSculpt(
  request: Request,
  env: ScanEnv,
  options: { fetcher?: typeof fetch; now?: () => number } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  }
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_SCULPT_BODY_BYTES) return jsonResponse({ error: 'Request body too large.' }, { status: 413 });
  let parsed: SculptRequest;
  try {
    parsed = parseSculptRequest(JSON.parse(new TextDecoder().decode(raw) || 'null'));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400 });
  }
  if (!jevConfigured(env)) return jsonResponse({ configured: false } satisfies SculptResponse);

  const now = options.now ?? Date.now;
  const started = now();
  const { questions, state } = buildSculptQuestions(parsed);
  try {
    const result = await coreSystemOne({ ...jevClientConfig(env, { timeoutMs: SCULPT_TIMEOUT_MS, fetcher: options.fetcher }), retries: 0 }, { state, questions });
    const move = result.answers.move;
    const likeness = result.answers.likeness;
    const response: SculptResponse = {
      configured: true,
      model: result.model,
      move:
        move && move.type === 'choice'
          ? {
              id: move.choice,
              confidence: round3(move.confidence),
              probabilities: Object.fromEntries(Object.entries(move.probabilities).map(([key, value]) => [key, round3(value)])),
            }
          : undefined,
      likeness: likeness && likeness.type === 'noul' ? round3(likeness.noul) : undefined,
      moves: applicableMoves(parsed.gist),
      timing: { ms: now() - started },
    };
    console.log(
      JSON.stringify({
        component: 'lupi_jev',
        route: 'sculpt',
        model: result.model,
        primitives: parsed.gist.primitives.length,
        moves: response.moves?.length ?? 0,
        move: response.move?.id ?? null,
        confidence: response.move?.confidence ?? null,
        likeness: response.likeness ?? null,
        inputTokens: result.usage?.input_tokens ?? null,
        ms: response.timing?.ms,
      }),
    );
    return jsonResponse(response);
  } catch (error) {
    const status = error instanceof JevError ? error.status : 502;
    console.warn(JSON.stringify({ component: 'lupi_jev', route: 'sculpt', error: error instanceof Error ? error.message : String(error), status, ms: now() - started }));
    return jsonResponse({ configured: true, error: error instanceof Error ? error.message : 'Jev failed.' } satisfies SculptResponse, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
