/**
 * Photo → molecules on the Lupi edge.
 *
 * `POST /v1/scan/identify` takes one photo and answers "what is this,
 * molecularly?" in two hops that the browser never sees separately:
 *
 *   1. Claude looks at the photo and returns a structured guess: what the
 *      subject is (with a likelihood distribution over a few candidates),
 *      the materials it is made of, and for each material the molecules that
 *      matter, with a formula and one line on why.
 *   2. Jev (TypeSafe System One) ranks the browser's gallery pool against
 *      that identification, exactly as it does for the molecule switcher
 *      (`jev.ts`): one `best` pick to open first, plus a per-candidate fit
 *      for the molecules Claude named that the gallery already has.
 *
 * Keys live only on the Worker: `ANTHROPIC_API_KEY` for vision and
 * `TYPESAFE_API_KEY` for Jev. Without the vision key the route answers
 * `{ configured: false }`; without the Jev key the vision answer still comes
 * back and `jev` is `null`. The photo is never logged and never stored; the
 * edge cache is keyed on a hash of the bytes and holds the answer for an hour.
 */

import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError, RateLimitError } from '@anthropic-ai/sdk';
import type { BetaBase64ImageSource, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  JevError,
  buildSwitchQuestions,
  buildSwitchState,
  jevConfigured,
  mapSwitchAnswers,
  systemOne,
  type JevEnv,
  type SwitchCandidate,
  type SwitchJudgeRequest,
  type SwitchJudgeResponse,
} from './jev';

export interface ScanEnv extends JevEnv {
  /** Anthropic key for the vision hop. `wrangler secret put ANTHROPIC_API_KEY`; never a var. */
  ANTHROPIC_API_KEY?: string;
  /** Override for a gateway or a test server. */
  ANTHROPIC_API_BASE?: string;
  /** Pin a different Claude model for the vision hop. */
  ANTHROPIC_VISION_MODEL?: string;
}

export const SCAN_ROUTE = '/v1/scan/identify';
export const SCAN_VISION_MODEL_DEFAULT = 'claude-opus-5';
/** Bump when the instructions or the schema change so cached answers from the old prompt are not served. */
export const SCAN_PROMPT_VERSION = 'scan-v1-materials';
/** A 1024 px JPEG from the browser is well under 1 MB; this leaves room for a phone that skipped the downscale. */
const MAX_SCAN_BODY_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_BASE64_CHARS = 5 * 1024 * 1024;
const MAX_HINT_CHARS = 200;
const MAX_SCAN_CANDIDATES = 160;
const MAX_FIT_CANDIDATES = 24;
/** The swirl is fun for about this long; past it the answer is late, not magical. */
const VISION_TIMEOUT_MS = 14_000;
const VISION_MAX_TOKENS = 1_800;
const SCAN_CACHE_TTL_SECONDS = 3_600;
const IMAGE_MEDIA_TYPES = new Set<BetaBase64ImageSource['media_type']>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const KEY_PATTERN = /^[A-Za-z0-9:_./-]{1,80}$/;

/* ─── Request ─── */

export interface ScanImage {
  mediaType: BetaBase64ImageSource['media_type'];
  data: string;
}

export interface ScanRequest {
  image: ScanImage;
  hint: string;
  candidates: SwitchCandidate[];
}

/** A malformed browser request; never a model failure. */
export class ScanRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ScanRequestError';
  }
}

export function scanConfigured(env: ScanEnv): boolean {
  return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}

export function scanVisionModel(env: ScanEnv): string {
  return env.ANTHROPIC_VISION_MODEL?.trim() || SCAN_VISION_MODEL_DEFAULT;
}

export function parseScanRequest(raw: unknown): ScanRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ScanRequestError('Body must be a JSON object.');
  const body = raw as Record<string, unknown>;
  const image = body.image;
  if (!image || typeof image !== 'object') throw new ScanRequestError('"image" must be an object with mediaType and data.');
  const mediaType = (image as { mediaType?: unknown }).mediaType;
  const data = (image as { data?: unknown }).data;
  if (typeof mediaType !== 'string' || !IMAGE_MEDIA_TYPES.has(mediaType as BetaBase64ImageSource['media_type'])) {
    throw new ScanRequestError('"image.mediaType" must be image/jpeg, image/png, image/webp, or image/gif.');
  }
  if (typeof data !== 'string' || data.length === 0) throw new ScanRequestError('"image.data" must be a base64 string.');
  const cleaned = data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (cleaned.length > MAX_IMAGE_BASE64_CHARS) throw new ScanRequestError('Image is too large; send a downscaled copy.');
  if (!/^[A-Za-z0-9+/]+=*$/.test(cleaned)) throw new ScanRequestError('"image.data" is not valid base64.');
  const hint = typeof body.hint === 'string' ? body.hint.trim().slice(0, MAX_HINT_CHARS) : '';
  const candidates: SwitchCandidate[] = [];
  const seen = new Set<string>();
  if (Array.isArray(body.candidates)) {
    for (const item of body.candidates.slice(0, MAX_SCAN_CANDIDATES)) {
      if (!item || typeof item !== 'object') continue;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.key !== 'string' || !KEY_PATTERN.test(candidate.key) || seen.has(candidate.key)) continue;
      if (typeof candidate.title !== 'string' || !candidate.title.trim()) continue;
      seen.add(candidate.key);
      candidates.push({
        key: candidate.key,
        title: candidate.title.trim().slice(0, 120),
        formula: typeof candidate.formula === 'string' ? candidate.formula.slice(0, 60) : undefined,
        elements: Array.isArray(candidate.elements) ? candidate.elements.filter((e): e is string => typeof e === 'string').slice(0, 20) : undefined,
        atoms: typeof candidate.atoms === 'number' && Number.isFinite(candidate.atoms) ? Math.round(candidate.atoms) : undefined,
        source: typeof candidate.source === 'string' ? candidate.source.slice(0, 20) : 'unknown',
      });
    }
  }
  return { image: { mediaType: mediaType as BetaBase64ImageSource['media_type'], data: cleaned }, hint, candidates };
}

/* ─── Vision ─── */

export interface ScanMolecule {
  name: string;
  formula: string;
  role: string;
  /** Rough share of this material by mass, when it makes sense to say. */
  share: number | null;
}

export interface ScanMaterial {
  name: string;
  /** Rough share of the subject, 0..1; the list need not sum to one. */
  share: number;
  summary: string;
  molecules: ScanMolecule[];
}

export interface ScanIdentification {
  /** The best one-line name for what is in the photo. */
  subject: string;
  /** How sure the model is about `subject`, 0..1. */
  confidence: number;
  /** A short likelihood distribution over what the subject could be, best first. */
  guesses: Array<{ label: string; probability: number }>;
  /** One fun sentence to lead with; the kind of thing you would say out loud. */
  headline: string;
  materials: ScanMaterial[];
  /** Element symbols that dominate the subject by mass, most first. */
  elements: string[];
  /** True when the photo has no physical subject to talk about (a blank wall, a screenshot of text). */
  nothingToScan: boolean;
}

const SCAN_SYSTEM_PROMPT = `You are Lupi's molecular scanner. Someone points a camera at an everyday thing and you say what it is made of, molecule by molecule, so they can open those molecules in a 3D viewer.

Look at the photo and decide what the main subject is. Then break it down into the materials it is made of, and for each material name the molecules that actually matter: the ones that make up most of its mass, or the one that gives it its smell, colour, taste, or strength. Prefer small, nameable molecules with a real formula (water, cellulose, sucrose, caffeine, sodium chloride, polyethylene as its repeat unit). For proteins and polymers give the repeat unit or the best-known member, not a formula you invented. Be concrete about shares when a rough number is honest and use null when it is not.

Keep every string short. The headline is one playful sentence someone would say out loud. Roles are a few words ("gives the yolk its colour", "most of the white by mass"). If the photo has no physical subject (blank, text, a screenshot), set nothingToScan to true and keep the lists empty.`;

const SCAN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'confidence', 'guesses', 'headline', 'materials', 'elements', 'nothingToScan'],
  properties: {
    subject: { type: 'string', maxLength: 80 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    guesses: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'probability'],
        properties: { label: { type: 'string', maxLength: 60 }, probability: { type: 'number', minimum: 0, maximum: 1 } },
      },
    },
    headline: { type: 'string', maxLength: 160 },
    materials: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'share', 'summary', 'molecules'],
        properties: {
          name: { type: 'string', maxLength: 60 },
          share: { type: 'number', minimum: 0, maximum: 1 },
          summary: { type: 'string', maxLength: 160 },
          molecules: {
            type: 'array',
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'formula', 'role', 'share'],
              properties: {
                name: { type: 'string', maxLength: 60 },
                formula: { type: 'string', maxLength: 40 },
                role: { type: 'string', maxLength: 90 },
                share: { type: ['number', 'null'], minimum: 0, maximum: 1 },
              },
            },
          },
        },
      },
    },
    elements: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 2 } },
    nothingToScan: { type: 'boolean' },
  },
} as const;

/** A model failure of any kind; mapped to a status the browser treats as "no answer". */
export class ScanVisionError extends Error {
  readonly status: number;
  readonly reason: 'not-configured' | 'timeout' | 'network' | 'rate-limited' | 'declined' | 'invalid-response' | `http-${number}`;
  constructor(message: string, status: number, reason: ScanVisionError['reason']) {
    super(message);
    this.name = 'ScanVisionError';
    this.status = status;
    this.reason = reason;
  }
}

const inUnit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const clamp01 = (value: unknown, fallback = 0): number => (inUnit(value) ? value : fallback);
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Coerce the model's JSON into the identification shape. Exported for the tests and the lab. */
export function normalizeIdentification(raw: unknown): ScanIdentification | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const subject = text(body.subject, 80);
  const nothingToScan = body.nothingToScan === true;
  if (!subject && !nothingToScan) return null;
  const guesses = Array.isArray(body.guesses)
    ? body.guesses
        .map((guess) => (guess && typeof guess === 'object' ? { label: text((guess as { label?: unknown }).label, 60), probability: clamp01((guess as { probability?: unknown }).probability) } : null))
        .filter((guess): guess is { label: string; probability: number } => Boolean(guess?.label))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 4)
    : [];
  const materials: ScanMaterial[] = Array.isArray(body.materials)
    ? body.materials
        .map((material) => {
          if (!material || typeof material !== 'object') return null;
          const record = material as Record<string, unknown>;
          const name = text(record.name, 60);
          if (!name) return null;
          const molecules: ScanMolecule[] = Array.isArray(record.molecules)
            ? record.molecules
                .map((molecule) => {
                  if (!molecule || typeof molecule !== 'object') return null;
                  const entry = molecule as Record<string, unknown>;
                  const moleculeName = text(entry.name, 60);
                  if (!moleculeName) return null;
                  return {
                    name: moleculeName,
                    formula: text(entry.formula, 40),
                    role: text(entry.role, 90),
                    share: inUnit(entry.share) ? entry.share : null,
                  };
                })
                .filter((molecule): molecule is ScanMolecule => molecule !== null)
                .slice(0, 4)
            : [];
          return { name, share: clamp01(record.share), summary: text(record.summary, 160), molecules };
        })
        .filter((material): material is ScanMaterial => material !== null)
        .sort((a, b) => b.share - a.share)
        .slice(0, 4)
    : [];
  const elements = Array.isArray(body.elements)
    ? body.elements.filter((symbol): symbol is string => typeof symbol === 'string' && /^[A-Z][a-z]?$/.test(symbol)).slice(0, 8)
    : [];
  return {
    subject: subject || 'Nothing to scan',
    confidence: clamp01(body.confidence),
    guesses,
    headline: text(body.headline, 160),
    materials,
    elements,
    nothingToScan,
  };
}

export interface VisionOutcome {
  identification: ScanIdentification;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  /** True when the server-side fallback served this answer instead of the requested model. */
  fallback: boolean;
}

function anthropicClient(env: ScanEnv, fetcher?: typeof fetch): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_API_BASE?.trim() || undefined,
    timeout: VISION_TIMEOUT_MS,
    maxRetries: 1,
    fetch: fetcher,
  });
}

/** One vision call: photo in, validated identification out. */
export async function identifyWithVision(env: ScanEnv, request: ScanRequest, options: { fetcher?: typeof fetch } = {}): Promise<VisionOutcome> {
  if (!scanConfigured(env)) throw new ScanVisionError('Vision is not configured.', 503, 'not-configured');
  const client = anthropicClient(env, options.fetcher);
  const model = scanVisionModel(env);
  const userText = request.hint
    ? `What is this made of, molecularly? The person added a hint: "${request.hint}".`
    : 'What is this made of, molecularly?';
  let message: BetaMessage;
  try {
    // Low effort keeps the answer under the swirl; the schema keeps it exact.
    // The server-side fallback keeps a policy decline from turning into a blank screen.
    message = await client.beta.messages.create({
      model,
      max_tokens: VISION_MAX_TOKENS,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SCAN_SYSTEM_PROMPT,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCAN_OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
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
      // Never surface the upstream body: it can carry account details.
      throw new ScanVisionError(`Vision request failed (${error.status}).`, error.status >= 500 ? 502 : error.status, `http-${error.status}`);
    }
    if (error instanceof APIConnectionError) throw new ScanVisionError('Vision is unreachable.', 504, 'network');
    throw new ScanVisionError('Vision failed.', 502, 'network');
  }
  if (message.stop_reason === 'refusal') throw new ScanVisionError('The model declined to describe this photo.', 422, 'declined');
  if (message.stop_reason === 'max_tokens') throw new ScanVisionError('The answer ran past its budget.', 502, 'invalid-response');
  const block = message.content.find((entry): entry is Extract<BetaMessage['content'][number], { type: 'text' }> => entry.type === 'text');
  if (!block) throw new ScanVisionError('The model returned no text.', 502, 'invalid-response');
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.text);
  } catch {
    throw new ScanVisionError('The model returned malformed JSON.', 502, 'invalid-response');
  }
  const identification = normalizeIdentification(parsed);
  if (!identification) throw new ScanVisionError('The model returned an unusable answer.', 502, 'invalid-response');
  const iterations = (message.usage as { iterations?: Array<{ type?: string }> }).iterations ?? [];
  return {
    identification,
    model: message.model,
    usage: { inputTokens: message.usage?.input_tokens ?? null, outputTokens: message.usage?.output_tokens ?? null },
    fallback: iterations.some((iteration) => iteration.type === 'fallback_message'),
  };
}

/* ─── Matching the answer to the gallery ─── */

/** A few names people (and models) use that differ from the gallery titles. */
const NAME_ALIASES: Record<string, string> = {
  h2o: 'water',
  'dihydrogen monoxide': 'water',
  'table salt': 'sodium chloride',
  salt: 'sodium chloride',
  nacl: 'sodium chloride',
  sugar: 'sucrose',
  'table sugar': 'sucrose',
  'ethyl alcohol': 'ethanol',
  alcohol: 'ethanol',
  'acetylsalicylic acid': 'aspirin',
  'dextrose': 'glucose',
  'd-glucose': 'glucose',
  'buckyball': 'buckminsterfullerene',
  c60: 'buckminsterfullerene',
  'fullerene': 'buckminsterfullerene',
  graphene: 'graphene nanoribbon',
  diamond: 'diamond crystal',
  'carbon nanotube': 'carbon nanotube',
  'laughing gas': 'nitrous oxide',
  n2o: 'nitrous oxide',
  o2: 'oxygen',
  'dioxygen': 'oxygen',
  epinephrine: 'adrenaline',
  'noradrenaline': 'norepinephrine',
  'tetrahydrocannabinol': 'thc',
  cannabidiol: 'cbd',
  'adenosine triphosphate': 'atp',
  'gamma-aminobutyric acid': 'gaba',
  'silica': 'sio₂ amorphous silica',
  'silicon dioxide': 'sio₂ amorphous silica',
  quartz: 'sio₂ amorphous silica',
  glass: 'sio₂ amorphous silica',
  ice: 'ice/water cluster',
};

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';

/** Lowercase, plain digits, letters and digits only; "Cu₆₄Zr₃₆" and "Cu64Zr36" agree. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[₀-₉]/g, (digit) => String(SUBSCRIPTS.indexOf(digit)))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeFormula(value: string): string {
  return normalizeName(value).replace(/\s+/g, '');
}

export interface ScanMatch {
  /** The molecule as Claude named it. */
  molecule: { name: string; formula: string; material: string };
  key: string;
  title: string;
  source: string;
  /** `title` when the name matched, `formula` when only the formula did. */
  matchedBy: 'title' | 'formula';
}

/** Which of Claude's molecules the gallery already has, by name then by formula. */
export function matchMolecules(identification: ScanIdentification, candidates: SwitchCandidate[]): ScanMatch[] {
  const byTitle = new Map<string, SwitchCandidate>();
  const byFormula = new Map<string, SwitchCandidate>();
  for (const candidate of candidates) {
    const title = normalizeName(candidate.title);
    if (title && !byTitle.has(title)) byTitle.set(title, candidate);
    if (candidate.formula) {
      const formula = normalizeFormula(candidate.formula);
      if (formula && !byFormula.has(formula)) byFormula.set(formula, candidate);
    }
  }
  const matches: ScanMatch[] = [];
  const seenKeys = new Set<string>();
  for (const material of identification.materials) {
    for (const molecule of material.molecules) {
      const name = normalizeName(molecule.name);
      const alias = NAME_ALIASES[name] ? normalizeName(NAME_ALIASES[name]) : null;
      const formula = molecule.formula ? normalizeFormula(molecule.formula) : '';
      const aliasedFormula = NAME_ALIASES[formula] ? normalizeName(NAME_ALIASES[formula]) : null;
      let candidate = byTitle.get(name) ?? (alias ? byTitle.get(alias) : undefined) ?? (aliasedFormula ? byTitle.get(aliasedFormula) : undefined);
      let matchedBy: ScanMatch['matchedBy'] = 'title';
      if (!candidate && formula) {
        candidate = byFormula.get(formula);
        matchedBy = 'formula';
      }
      if (!candidate || seenKeys.has(candidate.key)) continue;
      seenKeys.add(candidate.key);
      matches.push({
        molecule: { name: molecule.name, formula: molecule.formula, material: material.name },
        key: candidate.key,
        title: candidate.title,
        source: candidate.source,
        matchedBy,
      });
    }
  }
  return matches;
}

/* ─── Jev ─── */

/** The switch-judge state for a scan: the identification is the "query". */
export function buildScanJudgeRequest(identification: ScanIdentification, candidates: SwitchCandidate[], matches: ScanMatch[]): SwitchJudgeRequest | null {
  if (candidates.length === 0) return null;
  const names = identification.materials.flatMap((material) => material.molecules.map((molecule) => molecule.name));
  const query = `${identification.subject}. Made of: ${[...new Set(names)].join(', ')}`.slice(0, 200);
  const fitKeys = new Set(matches.slice(0, MAX_FIT_CANDIDATES).map((match) => match.key));
  return {
    query,
    elements: identification.elements.slice(0, 12),
    loaded: null,
    candidates: candidates.map((candidate) => ({ ...candidate, fit: fitKeys.has(candidate.key) ? true : undefined })),
  };
}

export interface ScanJevOutcome extends SwitchJudgeResponse {
  ms: number;
}

async function judgeWithJev(env: ScanEnv, request: SwitchJudgeRequest, options: { fetcher?: typeof fetch; now: () => number }): Promise<ScanJevOutcome | null> {
  if (!jevConfigured(env)) return null;
  const started = options.now();
  try {
    const result = await systemOne(env, { state: buildSwitchState(request), questions: buildSwitchQuestions(request) }, { fetcher: options.fetcher });
    return { ...mapSwitchAnswers(request, result), ms: options.now() - started };
  } catch (error) {
    const status = error instanceof JevError ? error.status : 502;
    console.warn(JSON.stringify({ component: 'lupi_jev', route: 'scan', error: error instanceof Error ? error.message : String(error), status }));
    return null;
  }
}

/* ─── Route ─── */

export interface ScanResponse {
  configured: boolean;
  model?: { vision: string; jev: string | null };
  identification?: ScanIdentification;
  /** Claude's molecules the gallery can open immediately. */
  matches?: ScanMatch[];
  /** Jev's ranking of the gallery pool against the identification; null when Jev is off or failed. */
  jev?: { best: { key: string; confidence: number } | null; fit: Record<string, number>; intent?: { choice: string; confidence: number } } | null;
  timing?: { visionMs: number; jevMs: number | null; totalMs: number };
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

/** `POST /v1/scan/identify`: one photo → identification, gallery matches, and Jev's pick. */
export async function handleScanIdentify(
  request: Request,
  env: ScanEnv,
  options: { fetcher?: typeof fetch; jevFetcher?: typeof fetch; cache?: Cache | null; now?: () => number } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_SCAN_BODY_BYTES) return jsonResponse({ error: 'Request body too large.' }, { status: 413 });
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_SCAN_BODY_BYTES) return jsonResponse({ error: 'Request body too large.' }, { status: 413 });
  let parsed: ScanRequest;
  try {
    parsed = parseScanRequest(JSON.parse(new TextDecoder().decode(raw) || 'null'));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400 });
  }

  if (!scanConfigured(env)) return jsonResponse({ configured: false } satisfies ScanResponse);

  const now = options.now ?? Date.now;
  const model = scanVisionModel(env);
  const canonical = JSON.stringify({ i: await sha256Hex(parsed.image.data), h: parsed.hint.toLowerCase(), c: parsed.candidates.map((c) => c.key), m: model });
  const cacheKey = new Request(`https://scan-cache.lupi.live/identify/${SCAN_PROMPT_VERSION}/${await sha256Hex(canonical)}`);
  const cache = options.cache === undefined ? (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null : options.cache;
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) {
      const body = (await hit.json()) as ScanResponse;
      return jsonResponse({ ...body, cached: true });
    }
  }

  const started = now();
  let vision: VisionOutcome;
  try {
    vision = await identifyWithVision(env, parsed, { fetcher: options.fetcher });
  } catch (error) {
    const failure = error instanceof ScanVisionError ? error : new ScanVisionError('Vision failed.', 502, 'network');
    console.warn(JSON.stringify({ component: 'lupi_scan', stage: 'vision', model, reason: failure.reason, status: failure.status, ms: now() - started }));
    return jsonResponse({ configured: true, error: failure.message, reason: failure.reason } satisfies ScanResponse, { status: failure.status });
  }
  const visionMs = now() - started;

  const matches = matchMolecules(vision.identification, parsed.candidates);
  const judgeRequest = vision.identification.nothingToScan ? null : buildScanJudgeRequest(vision.identification, parsed.candidates, matches);
  const jev = judgeRequest ? await judgeWithJev(env, judgeRequest, { fetcher: options.jevFetcher ?? options.fetcher, now }) : null;

  const response: ScanResponse = {
    configured: true,
    model: { vision: vision.model, jev: jev?.model ?? null },
    identification: vision.identification,
    matches,
    jev: jev ? { best: jev.best ?? null, fit: jev.fit ?? {}, intent: jev.intent } : null,
    timing: { visionMs, jevMs: jev?.ms ?? null, totalMs: now() - started },
  };
  console.log(
    JSON.stringify({
      component: 'lupi_scan',
      stage: 'done',
      model: vision.model,
      fallback: vision.fallback,
      jevModel: jev?.model ?? null,
      candidates: parsed.candidates.length,
      hasHint: parsed.hint.length > 0,
      confidence: vision.identification.confidence,
      materials: vision.identification.materials.length,
      molecules: vision.identification.materials.reduce((sum, material) => sum + material.molecules.length, 0),
      matched: matches.length,
      bestConfidence: jev?.best?.confidence ?? null,
      inputTokens: vision.usage.inputTokens,
      outputTokens: vision.usage.outputTokens,
      visionMs,
      jevMs: jev?.ms ?? null,
      ms: response.timing?.totalMs,
    }),
  );
  if (cache) {
    const stored = new Response(JSON.stringify(response), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${SCAN_CACHE_TTL_SECONDS}` },
    });
    await cache.put(cacheKey, stored).catch(() => undefined);
  }
  return jsonResponse(response);
}
