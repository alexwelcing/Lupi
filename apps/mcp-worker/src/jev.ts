/**
 * Jev (TypeSafe AI System One) seam for the Lupi edge.
 *
 * The model is called through the one shared client in `@atlas/core/jev`;
 * this file owns the edge routes, caching, and logging. Instructions and
 * criteria are constants here;
 * user text is only ever a value inside `state`. Every answer returned to the
 * browser carries the model version and confidence so the UI can label it as
 * inference, and every call writes one aggregate shadow line (no user text)
 * so thresholds can be tuned from real traffic before a decision is trusted.
 *
 * Production key: `wrangler secret put TYPESAFE_API_KEY` on the lupi-edge
 * Worker. Local: `apps/mcp-worker/.dev.vars`. With no key every route answers
 * `{ configured: false }` and the browser keeps its deterministic behavior.
 */

import {
  JEV_MODEL_LATEST,
  JevError,
  getElementSpecBySymbol,
  jevConfigured as coreConfigured,
  systemOne as coreSystemOne,
  type JevClientConfig,
  type JevCriteria,
  type JevQuestion,
  type JevRequest,
  type JevResult,
  type PropertyEvidence,
  type PropertyRankJudgment,
  type ViewerCommandDecision,
  PROPERTY_RANK_PROMPT_VERSION,
  evidenceState,
  parsePropertyEvidence,
  propertyRankQuestions,
  rankable,
  readPropertyRankAnswers,
  VIEWER_COMMAND_PROMPT_VERSION,
  buildViewerCommandRequest,
  localViewerAction,
  resolveViewerCommandDecision,
  viewerCommandFor,
} from '@atlas/core';

export { JevError } from '@atlas/core';
export type { JevAnswer, JevChoiceAnswer, JevNoulAnswer, JevQuestion, JevResult, JevScoreAnswer } from '@atlas/core';

export interface JevEnv {
  TYPESAFE_API_KEY?: string;
  /** Override for tests or a gateway; defaults to TypeSafe's API. */
  TYPESAFE_API_BASE?: string;
  TYPESAFE_MODEL?: string;
}

export const JEV_DEFAULT_MODEL = JEV_MODEL_LATEST;
/** Interactive budget: the browser already shows a deterministic answer. */
const JEV_TIMEOUT_MS = 1_500;
const JEV_CACHE_TTL_SECONDS = 3_600;
/** Bump when instructions or criteria change so cached judgments from the old prompt are not served. */
export const JEV_PROMPT_VERSION = `switch-v4-everyday+${PROPERTY_RANK_PROMPT_VERSION}`;
const MAX_SWITCH_BODY_BYTES = 64 * 1024;
/** Choice cardinality is 255; the whole gallery plus local matches fits. */
const MAX_SWITCH_CANDIDATES = 160;
/** Per-candidate fit Nouls are asked only for the candidates the browser is
 *  already showing (flagged `fit`), never for the whole pool. */
const MAX_FIT_CANDIDATES = 24;
const MAX_QUERY_CHARS = 200;
/** Routes advertised by `/health`; the browser reads this to know what to ask. */
export const JEV_ROUTES = ['/v1/switch/judge', '/v1/viewer/command'] as const;

type Criteria = JevCriteria;

/** A malformed browser request; never a Jev failure. */
export class JevRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'JevRequestError';
  }
}

export function jevConfigured(env: JevEnv): boolean {
  return coreConfigured({ apiKey: env.TYPESAFE_API_KEY });
}

/** The edge's client configuration: one retry on 429/529 or a transport
 *  error, never on a timeout, and the interactive deadline above. */
export function jevClientConfig(env: JevEnv, options: { timeoutMs?: number; fetcher?: typeof fetch } = {}): JevClientConfig {
  return {
    apiKey: env.TYPESAFE_API_KEY,
    baseUrl: env.TYPESAFE_API_BASE,
    model: env.TYPESAFE_MODEL?.trim() || JEV_DEFAULT_MODEL,
    fetch: options.fetcher,
    timeoutMs: options.timeoutMs ?? JEV_TIMEOUT_MS,
    retries: 1,
  };
}

/** One System One call from the edge, through the shared core client. */
export function systemOne(env: JevEnv, request: JevRequest, options: { timeoutMs?: number; fetcher?: typeof fetch } = {}): Promise<JevResult> {
  return coreSystemOne(jevClientConfig(env, options), request);
}

/* ─── Molecule switcher ─── */

export interface SwitchCandidate {
  key: string;
  title: string;
  formula?: string;
  elements?: string[];
  atoms?: number;
  source: string;
  /** Gallery shelf ("Metals & Alloys", "Atomized Media"): tells a molecule from a material or a demo. */
  category?: string;
  /** Ask a per-candidate fit probability for this one (bounded). */
  fit?: boolean;
  /** Reference properties (density, phase, ...) the ranking reads as evidence. */
  evidence?: PropertyEvidence;
}

export interface SwitchJudgeRequest {
  query: string;
  elements: string[];
  candidates: SwitchCandidate[];
  loaded?: { title: string; formula?: string } | null;
  /** Also ask the property-ranking questions ("floats in water", "heaviest metal") for every candidate. */
  rank?: boolean;
}

export interface SwitchJudgeResponse {
  configured: boolean;
  model?: string;
  intent?: { choice: string; confidence: number };
  best?: { key: string; confidence: number } | null;
  fit?: Record<string, number>;
  /** Present only when the request asked for ranking. */
  rank?: PropertyRankJudgment | null;
  cached?: boolean;
}

const INTENT_CRITERIA: Criteria = {
  named_molecule: 'A specific molecule or compound by common or systematic name',
  formula: 'A chemical formula such as C6H6 or H2O',
  elements: 'Only element symbols or element names, asking for anything containing them',
  class_or_property: 'A class of molecule or a property, such as "a sugar", "something aromatic", "an amino acid"',
  material: 'A crystal, alloy, lattice, surface, or bulk material rather than a small molecule',
  not_a_molecule: 'Not a request for a molecular structure at all',
};

const KEY_PATTERN = /^[A-Za-z0-9:_./-]{1,80}$/;

export function parseSwitchJudgeRequest(raw: unknown): SwitchJudgeRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new JevRequestError('Body must be a JSON object.');
  const body = raw as Record<string, unknown>;
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, MAX_QUERY_CHARS) : '';
  const elements = Array.isArray(body.elements)
    ? body.elements
        .filter((value): value is string => typeof value === 'string' && /^[A-Z][a-z]?$/.test(value) && Boolean(getElementSpecBySymbol(value)))
        .slice(0, 12)
    : [];
  if (!Array.isArray(body.candidates)) throw new JevRequestError('"candidates" must be an array.');
  const candidates: SwitchCandidate[] = [];
  const seen = new Set<string>();
  let fitCount = 0;
  for (const item of body.candidates.slice(0, MAX_SWITCH_CANDIDATES)) {
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
      category: typeof candidate.category === 'string' && candidate.category.trim() ? candidate.category.trim().slice(0, 40) : undefined,
      fit: candidate.fit === true && fitCount < MAX_FIT_CANDIDATES ? ((fitCount += 1), true) : undefined,
      evidence: parsePropertyEvidence(candidate.evidence),
    });
  }
  if (fitCount === 0) candidates.slice(0, MAX_FIT_CANDIDATES).forEach((candidate) => { candidate.fit = true; });
  if (!query && elements.length === 0) throw new JevRequestError('Provide a "query" or at least one element.');
  if (candidates.length === 0) throw new JevRequestError('Provide at least one candidate.');
  const loaded = body.loaded && typeof body.loaded === 'object' && typeof (body.loaded as { title?: unknown }).title === 'string'
    ? { title: String((body.loaded as { title: string }).title).slice(0, 120), formula: typeof (body.loaded as { formula?: unknown }).formula === 'string' ? String((body.loaded as { formula: string }).formula).slice(0, 60) : undefined }
    : null;
  return { query, elements, candidates, loaded, rank: body.rank === true && query.length > 0 };
}

/** The candidates the ranking questions are asked about: known substances only. */
function rankKeys(request: SwitchJudgeRequest): string[] {
  return request.candidates.filter(rankable).map((candidate) => candidate.key);
}

/** The questions are constants; the request only fills `state`. */
export function buildSwitchQuestions(request: SwitchJudgeRequest): Record<string, JevQuestion> {
  const criteria: Criteria = { none: 'None of the listed candidates is what the request asks for' };
  for (const candidate of request.candidates) {
    criteria[candidate.key] = [candidate.title, candidate.formula, candidate.atoms ? `${candidate.atoms} atoms` : null, candidate.source]
      .filter(Boolean)
      .join(' · ');
  }
  const questions: Record<string, JevQuestion> = {
    intent: {
      type: 'choice',
      instructions: 'What kind of molecular structure request is `request.query` (with `request.elements` if the query is empty)?',
      criteria: INTENT_CRITERIA,
    },
    best: {
      type: 'choice',
      instructions:
        'Which candidate in `candidates` best satisfies `request`? Prefer the exact molecule when one is named; when only elements or a class are given, prefer the molecule most people would have heard of (a food, drug, or household compound) over a laboratory reagent, and among equally familiar options prefer the smaller one. Choose `none` if nothing fits.',
      criteria,
    },
  };
  for (const candidate of request.candidates) {
    if (!candidate.fit) continue;
    questions[`fit:${candidate.key}`] = {
      type: 'noul',
      instructions: `The candidate with key \`${candidate.key}\` satisfies what \`request\` asks for.`,
    };
  }
  if (request.rank) Object.assign(questions, propertyRankQuestions(rankKeys(request)));
  return questions;
}

export function buildSwitchState(request: SwitchJudgeRequest): unknown {
  return {
    request: {
      query: request.query,
      elements: request.elements,
      currently_loaded: request.loaded ?? null,
    },
    candidates: request.candidates.map((candidate) => ({
      key: candidate.key,
      title: candidate.title,
      formula: candidate.formula ?? null,
      elements: candidate.elements ?? null,
      atoms: candidate.atoms ?? null,
      source: candidate.source,
      ...(candidate.category ? { category: candidate.category } : {}),
      ...evidenceState(candidate.evidence),
    })),
  };
}

export function mapSwitchAnswers(request: SwitchJudgeRequest, result: JevResult): SwitchJudgeResponse {
  const intent = result.answers.intent;
  const best = result.answers.best;
  const fit: Record<string, number> = {};
  for (const candidate of request.candidates) {
    if (!candidate.fit) continue;
    const answer = result.answers[`fit:${candidate.key}`];
    if (answer && answer.type === 'noul' && typeof answer.noul === 'number') fit[candidate.key] = round3(answer.noul);
  }
  return {
    configured: true,
    model: result.model,
    intent: intent && intent.type === 'choice' ? { choice: intent.choice, confidence: round3(intent.confidence) } : undefined,
    best: best && best.type === 'choice' && best.choice !== 'none' ? { key: best.choice, confidence: round3(best.confidence) } : null,
    fit,
    ...(request.rank ? { rank: readPropertyRankAnswers(result, rankKeys(request)) } : {}),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
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

/** `POST /v1/switch/judge`: rank molecule-switch candidates with Jev. */
export async function handleSwitchJudge(
  request: Request,
  env: JevEnv,
  options: { fetcher?: typeof fetch; cache?: Cache | null; now?: () => number } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  }
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_SWITCH_BODY_BYTES) return jsonResponse({ error: 'Request body too large.' }, { status: 413 });
  let parsed: SwitchJudgeRequest;
  try {
    parsed = parseSwitchJudgeRequest(JSON.parse(new TextDecoder().decode(raw) || 'null'));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400 });
  }

  if (!jevConfigured(env)) return jsonResponse({ configured: false } satisfies SwitchJudgeResponse);

  const canonical = JSON.stringify({
    q: parsed.query,
    e: parsed.elements,
    c: parsed.candidates.map((c) => [c.key, c.category ?? null, c.evidence ?? null]),
    l: parsed.loaded?.title ?? null,
    r: parsed.rank === true,
  });
  const cacheKey = new Request(`https://jev-cache.lupi.live/switch/${JEV_PROMPT_VERSION}/${await sha256Hex(canonical)}`);
  const cache = options.cache === undefined ? (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null : options.cache;
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) {
      const body = (await hit.json()) as SwitchJudgeResponse;
      return jsonResponse({ ...body, cached: true });
    }
  }

  const started = (options.now ?? Date.now)();
  try {
    const result = await systemOne(env, { state: buildSwitchState(parsed), questions: buildSwitchQuestions(parsed) }, { fetcher: options.fetcher });
    const mapped = mapSwitchAnswers(parsed, result);
    console.log(
      JSON.stringify({
        component: 'lupi_jev',
        route: 'switch',
        model: result.model,
        candidates: parsed.candidates.length,
        hasQuery: parsed.query.length > 0,
        elements: parsed.elements.length,
        intent: mapped.intent?.choice ?? null,
        intentConfidence: mapped.intent?.confidence ?? null,
        bestConfidence: mapped.best?.confidence ?? null,
        rankMode: mapped.rank?.mode.choice ?? null,
        rankModeConfidence: mapped.rank?.mode.confidence ?? null,
        rankProperty: mapped.rank?.property.choice ?? null,
        rankPropertyConfidence: mapped.rank?.property.confidence ?? null,
        inputTokens: result.usage?.input_tokens ?? null,
        ms: (options.now ?? Date.now)() - started,
      }),
    );
    if (cache) {
      const stored = new Response(JSON.stringify(mapped), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${JEV_CACHE_TTL_SECONDS}` },
      });
      await cache.put(cacheKey, stored).catch(() => undefined);
    }
    return jsonResponse(mapped);
  } catch (error) {
    const status = error instanceof JevError ? error.status : 502;
    console.warn(JSON.stringify({ component: 'lupi_jev', route: 'switch', error: error instanceof Error ? error.message : String(error), status }));
    // The browser treats any non-2xx as "no judgment"; it never blocks the switch.
    return jsonResponse({ configured: true, error: error instanceof Error ? error.message : 'Jev failed.' }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}

/* ─── Natural-language viewer command ─── */

export interface ViewerCommandResponse {
  configured: boolean;
  model?: string;
  decision?: ViewerCommandDecision & { source: 'local' | 'jev' };
  cached?: boolean;
  error?: string;
}

const MAX_COMMAND_BODY_BYTES = 4 * 1024;

/**
 * `POST /v1/viewer/command`: `{ text }` → one code-owned typed command or
 * nothing. Exact literals never leave the edge. Everything else goes through
 * the shared interpreter with the lab's conservative gate; the browser
 * executes the returned command only on explicit user selection.
 */
export async function handleViewerCommand(
  request: Request,
  env: JevEnv,
  options: { fetcher?: typeof fetch; cache?: Cache | null; now?: () => number } = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
  }
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_COMMAND_BODY_BYTES) return jsonResponse({ error: 'Request body too large.' }, { status: 413 });
  let text: string;
  let jevRequest: JevRequest;
  try {
    const body = JSON.parse(new TextDecoder().decode(raw) || 'null') as { text?: unknown } | null;
    jevRequest = buildViewerCommandRequest(body && typeof body === 'object' ? body.text : undefined);
    text = (jevRequest.state as { userRequest: string }).userRequest;
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400 });
  }

  const local = localViewerAction(text);
  if (local) {
    return jsonResponse({ configured: jevConfigured(env), decision: { action: local, command: viewerCommandFor(local), confidence: 1, source: 'local' } } satisfies ViewerCommandResponse);
  }
  if (!jevConfigured(env)) return jsonResponse({ configured: false } satisfies ViewerCommandResponse);

  const model = env.TYPESAFE_MODEL?.trim() || JEV_DEFAULT_MODEL;
  const cacheKey = new Request(`https://jev-cache.lupi.live/command/${VIEWER_COMMAND_PROMPT_VERSION}/${model}/${await sha256Hex(text.toLowerCase())}`);
  const cache = options.cache === undefined ? (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null : options.cache;
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) {
      const body = (await hit.json()) as ViewerCommandResponse;
      return jsonResponse({ ...body, cached: true });
    }
  }

  const started = (options.now ?? Date.now)();
  try {
    const result = await systemOne(env, jevRequest, { fetcher: options.fetcher });
    const decision = resolveViewerCommandDecision(result, model);
    const mapped: ViewerCommandResponse = { configured: true, model: result.model, decision: { ...decision, source: 'jev' } };
    console.log(
      JSON.stringify({
        component: 'lupi_jev',
        route: 'command',
        model: result.model,
        chars: text.length,
        action: decision.action,
        reason: decision.reason ?? null,
        confidence: decision.confidence ?? null,
        inputTokens: result.usage?.input_tokens ?? null,
        ms: (options.now ?? Date.now)() - started,
      }),
    );
    if (cache) {
      const stored = new Response(JSON.stringify(mapped), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${JEV_CACHE_TTL_SECONDS}` },
      });
      await cache.put(cacheKey, stored).catch(() => undefined);
    }
    return jsonResponse(mapped);
  } catch (error) {
    const status = error instanceof JevError ? error.status : 502;
    console.warn(JSON.stringify({ component: 'lupi_jev', route: 'command', error: error instanceof Error ? error.message : String(error), status }));
    return jsonResponse({ configured: true, error: error instanceof Error ? error.message : 'Jev failed.' }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
