/**
 * The scanner's remote models, through Hugging Face Spaces, and Jev's plan
 * for when to use them.
 *
 * `POST /v1/scan/plan`      Jev decides, from the silhouette's measurements
 *                           and what is running right now, whether to ask
 *                           SAM 3 for the mask and SAM 3D Objects for the
 *                           full shape, and says why. Cheap, one call.
 * `POST /v1/scan/segment`   SAM 3, prompted with the subject: the concept
 *                           mask, back as a small image. About four seconds.
 * `POST /v1/scan/reconstruct`  SAM 3D Objects: a coloured mesh of the
 *                           subject, sampled here into `lupi.points.v1`
 *                           (a few hundred kilobytes) so the page never
 *                           sees the twenty-megabyte GLB. About a minute
 *                           on ZeroGPU, more when the Space is cold.
 *
 * The token stays on the edge. The Spaces are chosen by env and default to
 * public ones; `GET /health` reports which are configured.
 */
import { JevError, packPoints, parseGlb, sampleMeshPoints, systemOne as coreSystemOne, type JevQuestion } from '@atlas/core';
import { gradioCall, gradioFetchFile, gradioUpload, hfConfigured, HfError, spaceHost, spaceRuntime, type HfEnv } from './hf';
import { jevClientConfig, jevConfigured, type JevEnv } from './jev';
import { parseRecipeRequest, type RecipeFeatures } from './recipe';

export const PLAN_ROUTE = '/v1/scan/plan';
export const SEGMENT_ROUTE = '/v1/scan/segment';
export const RECONSTRUCT_ROUTE = '/v1/scan/reconstruct';

export interface RemoteEnv extends HfEnv, JevEnv {
  /** Space ids; the defaults are public Spaces that expose these endpoints. */
  HF_SAM3_SPACE?: string;
  HF_SAM3D_SPACE?: string;
}

export const DEFAULT_SAM3_SPACE = 'prithivMLmods/SAM3-Demo';
export const DEFAULT_SAM3D_SPACE = 'dev-bjoern/sam3d-objects-mcp';
const SAM3_ENDPOINT = '/run_image_segmentation';
const SAM3D_ENDPOINT = '/reconstruct_objects';

const MAX_IMAGE_BODY_BYTES = 3 * 1024 * 1024;
const MAX_SUBJECT_CHARS = 80;
const SEGMENT_TIMEOUT_MS = 60_000;
const RECONSTRUCT_TIMEOUT_MS = 420_000;
const PLAN_TIMEOUT_MS = 1_500;
const DEFAULT_POINTS = 60_000;
const MAX_POINTS = 150_000;

export function remoteConfigured(env: RemoteEnv): boolean {
  return hfConfigured(env);
}

export function remoteSpaces(env: RemoteEnv): { sam3: string; sam3d: string } {
  return { sam3: env.HF_SAM3_SPACE?.trim() || DEFAULT_SAM3_SPACE, sam3d: env.HF_SAM3D_SPACE?.trim() || DEFAULT_SAM3D_SPACE };
}

class RemoteRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'RemoteRequestError';
  }
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(`${JSON.stringify(value)}\n`, { ...init, headers });
}

interface ImageInput {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}

function parseImage(raw: Record<string, unknown>): ImageInput {
  const image = raw.image && typeof raw.image === 'object' ? (raw.image as Record<string, unknown>) : null;
  if (!image) throw new RemoteRequestError('"image" is required.');
  const mediaType = image.mediaType;
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp') throw new RemoteRequestError('"image.mediaType" must be image/jpeg, image/png, or image/webp.');
  const data = typeof image.data === 'string' ? image.data.replace(/\s+/g, '') : '';
  if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw new RemoteRequestError('"image.data" must be base64.');
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mediaType, bytes };
}

function parseSubject(raw: Record<string, unknown>): string {
  const subject = typeof raw.subject === 'string' ? raw.subject.trim().slice(0, MAX_SUBJECT_CHARS) : '';
  if (!subject) throw new RemoteRequestError('"subject" is required.');
  return subject;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_IMAGE_BODY_BYTES) throw new RemoteRequestError('Request body too large.');
  const parsed = JSON.parse(new TextDecoder().decode(raw) || 'null') as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RemoteRequestError('Body must be a JSON object.');
  return parsed as Record<string, unknown>;
}

function failure(error: unknown, route: string, started: number): Response {
  if (error instanceof RemoteRequestError) return jsonResponse({ error: error.message }, { status: 400 });
  const status = error instanceof HfError ? error.status : error instanceof JevError ? error.status : 502;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(JSON.stringify({ component: 'lupi_remote', route, error: message, status, ms: Date.now() - started }));
  return jsonResponse({ configured: true, error: message }, { status: status >= 400 && status < 600 ? status : 502 });
}

/* ─── Availability ─── */

interface ServiceState {
  space: string;
  stage: string;
  hardware: string | null;
  checkedAt: number;
}

const runtimeCache = new Map<string, ServiceState>();
const RUNTIME_TTL_MS = 60_000;

async function serviceState(space: string, env: RemoteEnv, fetcher?: typeof fetch): Promise<ServiceState> {
  const cached = runtimeCache.get(space);
  if (cached && Date.now() - cached.checkedAt < RUNTIME_TTL_MS) return cached;
  try {
    const runtime = await spaceRuntime(space, { token: env.HF_TOKEN, fetcher });
    const state = { space, ...runtime, checkedAt: Date.now() };
    runtimeCache.set(space, state);
    return state;
  } catch (error) {
    const state = { space, stage: `UNREACHABLE (${error instanceof Error ? error.message : String(error)})`, hardware: null, checkedAt: Date.now() };
    runtimeCache.set(space, state);
    return state;
  }
}

/* ─── Plan ─── */

export interface PlanRequest {
  subject: string;
  features: RecipeFeatures;
  /** What the device already has: how the on-device cut looked. */
  device: { masked: boolean; pieces: number };
}

export interface PlanResponse {
  configured: boolean;
  /** Whether the remote models are usable at all (a token is set). */
  remote: boolean;
  services?: { sam3: ServiceState; sam3d: ServiceState };
  mask?: { choice: 'device' | 'sam3'; confidence: number; probabilities: Record<string, number> };
  reconstruct?: { choice: 'skip' | 'sam3d'; confidence: number; probabilities: Record<string, number> };
  /** How much a full 3D turn would add for this subject, 0..1. */
  gains?: number;
  model?: string;
  timing?: { ms: number };
  error?: string;
}

export function parsePlanRequest(raw: Record<string, unknown>): PlanRequest {
  const recipe = parseRecipeRequest({ subject: raw.subject, features: raw.features });
  const device = raw.device && typeof raw.device === 'object' ? (raw.device as Record<string, unknown>) : {};
  return {
    subject: recipe.subject,
    features: recipe.features,
    device: { masked: device.masked !== false, pieces: typeof device.pieces === 'number' && Number.isFinite(device.pieces) ? Math.max(0, Math.round(device.pieces)) : 1 },
  };
}

const words = (values: number[]): string => values.map((value) => value.toFixed(2)).join(' ');

export function buildPlanQuestions(request: PlanRequest, services: { sam3: ServiceState; sam3d: ServiceState }): { questions: Record<string, JevQuestion>; state: unknown } {
  const f = request.features;
  const up = (service: ServiceState) => (service.stage === 'RUNNING' ? `running on ${service.hardware ?? 'unknown hardware'}` : `not running (${service.stage})`);
  return {
    state: {
      subject: request.subject,
      what_the_device_has: {
        note: 'The photo was cut on the device with no model: a flood from the border. These numbers describe that cut.',
        stood_out_from_background: request.device.masked,
        separate_pieces_before_cleanup: request.device.pieces,
        fills_fraction_of_frame: Number(f.fill.toFixed(3)),
        taller_than_wide_by: Number(f.aspect.toFixed(2)),
        width_top_to_bottom: words(f.profile),
        left_right_symmetry: Number(f.symmetry.toFixed(2)),
        edge_raggedness: Number(f.edginess.toFixed(3)),
      },
      remote_models: {
        note: 'Each costs the viewer a wait while particles hold the on-device shape. The viewer is watching the whole time.',
        sam3_concept_mask: { cost: 'about 4 seconds', status: up(services.sam3), does: 'finds the pixels of the named subject; fixes a cut that took background, split the object, or missed thin parts' },
        sam3d_reconstruction: { cost: 'about 60 seconds, several minutes if cold', status: up(services.sam3d), does: 'rebuilds the subject as a full 3D coloured shape from the one photo, so the particles can turn it around and show the back' },
      },
    },
    questions: {
      mask: {
        type: 'choice',
        instructions: 'Which mask should the shape be cut from?',
        criteria: {
          device: 'The on-device cut is fine: one piece, a clean edge, the subject stood out. Do not spend the wait.',
          sam3: 'The on-device cut is doubtful (many pieces, a ragged edge, nothing stood out, the subject likely blends with its background, or it has thin parts a colour flood misses) and SAM 3 is running.',
        },
      },
      reconstruct: {
        type: 'choice',
        instructions: 'Is a full 3D reconstruction worth a minute of the viewer’s wait for `subject`?',
        criteria: {
          skip: 'No: the subject is flat or nearly (a screen, a card, a poster), or the reconstruction service is not running, or the cut was so poor a reconstruction would build the wrong thing.',
          sam3d: 'Yes: the subject is a real solid thing whose back and sides mean something (a mug, an animal, a chair, a shoe, a plant) and SAM 3D is running.',
        },
      },
      gains: {
        type: 'noul',
        instructions: 'Turning `subject` around in 3D would show a viewer something the front view cannot.',
      },
    },
  };
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export async function handleScanPlan(request: Request, env: RemoteEnv, options: { fetcher?: typeof fetch } = {}): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  const started = Date.now();
  try {
    const parsed = parsePlanRequest(await readBody(request));
    const remote = remoteConfigured(env);
    if (!jevConfigured(env)) return jsonResponse({ configured: false, remote } satisfies PlanResponse);
    const spaces = remoteSpaces(env);
    const services = remote
      ? { sam3: await serviceState(spaces.sam3, env, options.fetcher), sam3d: await serviceState(spaces.sam3d, env, options.fetcher) }
      : { sam3: { space: spaces.sam3, stage: 'NO_TOKEN', hardware: null, checkedAt: started }, sam3d: { space: spaces.sam3d, stage: 'NO_TOKEN', hardware: null, checkedAt: started } };
    const { questions, state } = buildPlanQuestions(parsed, services);
    const result = await coreSystemOne({ ...jevClientConfig(env, { timeoutMs: PLAN_TIMEOUT_MS, fetcher: options.fetcher }), retries: 0 }, { state, questions });
    const choice = <T extends string>(key: string) => {
      const answer = result.answers[key];
      return answer && answer.type === 'choice' ? { choice: answer.choice as T, confidence: round3(answer.confidence), probabilities: Object.fromEntries(Object.entries(answer.probabilities).map(([k, v]) => [k, round3(v)])) } : undefined;
    };
    const gains = result.answers.gains;
    const response: PlanResponse = {
      configured: true,
      remote,
      services,
      mask: choice<'device' | 'sam3'>('mask'),
      reconstruct: choice<'skip' | 'sam3d'>('reconstruct'),
      gains: gains && gains.type === 'noul' ? round3(gains.noul) : undefined,
      model: result.model,
      timing: { ms: Date.now() - started },
    };
    console.log(JSON.stringify({ component: 'lupi_jev', route: 'plan', model: result.model, mask: response.mask?.choice ?? null, reconstruct: response.reconstruct?.choice ?? null, gains: response.gains ?? null, sam3: services.sam3.stage, sam3d: services.sam3d.stage, ms: response.timing?.ms }));
    return jsonResponse(response);
  } catch (error) {
    return failure(error, 'plan', started);
  }
}

/* ─── Segment (SAM 3) ─── */

export interface SegmentResponse {
  configured: boolean;
  space?: string;
  masks?: Array<{ label: string; score: number | null; image: string }>;
  timing?: { ms: number };
  error?: string;
}

interface Sam3Result {
  image?: { url?: string; path?: string };
  annotations?: Array<{ image: { url?: string; path?: string }; label: string }>;
}

async function toDataUrl(response: Response): Promise<string> {
  const type = response.headers.get('content-type')?.split(';')[0] || 'image/png';
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

export async function handleScanSegment(request: Request, env: RemoteEnv, options: { fetcher?: typeof fetch } = {}): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  const started = Date.now();
  try {
    const body = await readBody(request);
    const image = parseImage(body);
    const subject = parseSubject(body);
    const threshold = typeof body.threshold === 'number' && Number.isFinite(body.threshold) ? Math.max(0.05, Math.min(0.95, body.threshold)) : 0.45;
    if (!remoteConfigured(env)) return jsonResponse({ configured: false } satisfies SegmentResponse);
    const space = remoteSpaces(env).sam3;
    const host = spaceHost(space);
    const auth = { token: env.HF_TOKEN, fetcher: options.fetcher };
    const upload = await gradioUpload(host, new Blob([image.bytes as BlobPart], { type: image.mediaType }), `photo.${image.mediaType.slice(6)}`, auth);
    const { data } = await gradioCall<[Sam3Result]>(host, SAM3_ENDPOINT, [upload, subject, threshold], { ...auth, timeoutMs: SEGMENT_TIMEOUT_MS });
    const annotations = data[0]?.annotations ?? [];
    const masks: NonNullable<SegmentResponse['masks']> = [];
    for (const annotation of annotations.slice(0, 4)) {
      const score = /\(([\d.]+)\)\s*$/.exec(annotation.label);
      masks.push({ label: annotation.label, score: score ? Number(score[1]) : null, image: await toDataUrl(await gradioFetchFile(host, annotation.image, auth)) });
    }
    const response: SegmentResponse = { configured: true, space, masks, timing: { ms: Date.now() - started } };
    console.log(JSON.stringify({ component: 'lupi_remote', route: 'segment', space, subject, masks: masks.length, best: masks[0]?.score ?? null, ms: response.timing?.ms }));
    return jsonResponse(response);
  } catch (error) {
    return failure(error, 'segment', started);
  }
}

/* ─── Reconstruct (SAM 3D Objects) ─── */

export async function handleScanReconstruct(request: Request, env: RemoteEnv, options: { fetcher?: typeof fetch; random?: () => number } = {}): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  const started = Date.now();
  try {
    const body = await readBody(request);
    const image = parseImage(body);
    const subject = parseSubject(body);
    const count = typeof body.points === 'number' && Number.isFinite(body.points) ? Math.max(1_000, Math.min(MAX_POINTS, Math.round(body.points))) : DEFAULT_POINTS;
    if (!remoteConfigured(env)) return jsonResponse({ configured: false });
    const space = remoteSpaces(env).sam3d;
    const host = spaceHost(space);
    const auth = { token: env.HF_TOKEN, fetcher: options.fetcher };
    const upload = await gradioUpload(host, new Blob([image.bytes as BlobPart], { type: image.mediaType }), `photo.${image.mediaType.slice(6)}`, auth);
    type Out = [{ url?: string; path?: string } | null, { url?: string; path?: string } | null, string];
    const { data, ms: spaceMs } = await gradioCall<Out>(host, SAM3D_ENDPOINT, [upload, subject], { ...auth, timeoutMs: RECONSTRUCT_TIMEOUT_MS });
    const status = typeof data[2] === 'string' ? data[2] : '';
    if (!data[0]) throw new HfError(`SAM 3D returned no model: ${status.slice(0, 200) || 'no detail'}`, 502);
    const glb = await (await gradioFetchFile(host, data[0], auth)).arrayBuffer();
    const mesh = parseGlb(glb);
    const sampled = sampleMeshPoints(mesh, count, { random: options.random });
    const packed = packPoints(sampled);
    const ms = Date.now() - started;
    console.log(JSON.stringify({ component: 'lupi_remote', route: 'reconstruct', space, subject, vertices: mesh.vertexCount, triangles: mesh.indices ? mesh.indices.length / 3 : 0, glbBytes: glb.byteLength, points: sampled.count, bytes: packed.byteLength, spaceMs, ms }));
    return new Response(packed, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        'x-lupi-points': 'lupi.points.v1',
        'x-lupi-space': space,
        'x-lupi-triangles': String(mesh.indices ? Math.floor(mesh.indices.length / 3) : 0),
        'x-lupi-space-ms': String(spaceMs),
        'x-lupi-ms': String(ms),
        'x-lupi-status': status.replace(/[^\x20-\x7e]/g, '').slice(0, 200),
      },
    });
  } catch (error) {
    return failure(error, 'reconstruct', started);
  }
}
