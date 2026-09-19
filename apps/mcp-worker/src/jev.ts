/**
 * Jev (TypeSafe AI System One) seam for the Lupi edge.
 *
 * One place calls the model. Instructions and criteria are constants here;
 * user text is only ever a value inside `state`. Every answer returned to the
 * browser carries the model version and confidence so the UI can label it as
 * inference, and every call writes one aggregate shadow line (no user text)
 * so thresholds can be tuned from real traffic before a decision is trusted.
 *
 * Production key: `wrangler secret put TYPESAFE_API_KEY` on the lupi-edge
 * Worker. Local: `apps/mcp-worker/.dev.vars`. With no key every route answers
 * `{ configured: false }` and the browser keeps its deterministic behavior.
 */

import { getElementSpecBySymbol } from '@atlas/core';

export interface JevEnv {
  TYPESAFE_API_KEY?: string;
  /** Override for tests or a gateway; defaults to TypeSafe's API. */
  TYPESAFE_API_BASE?: string;
  TYPESAFE_MODEL?: string;
}

export const JEV_DEFAULT_MODEL = 'jev-latest';
const JEV_API_BASE = 'https://api.typesafe.ai';
const JEV_TIMEOUT_MS = 1_500;
const JEV_CACHE_TTL_SECONDS = 3_600;
const MAX_SWITCH_BODY_BYTES = 32 * 1024;
const MAX_SWITCH_CANDIDATES = 40;
const MAX_QUERY_CHARS = 200;

type Criteria = Record<string, string | null>;

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Criteria }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}
export interface JevScoreAnswer {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
}
export type JevAnswer = JevChoiceAnswer | JevNoulAnswer | JevScoreAnswer;

export interface JevResult {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class JevError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function jevConfigured(env: JevEnv): boolean {
  return typeof env.TYPESAFE_API_KEY === 'string' && env.TYPESAFE_API_KEY.trim().length > 0;
}

/** One System One call: state in, typed answers out. Retries once on 429/529. */
export async function systemOne(
  env: JevEnv,
  request: { state: unknown; questions: Record<string, JevQuestion> },
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<JevResult> {
  if (!jevConfigured(env)) throw new JevError('Jev is not configured.', 503);
  const fetcher = options.fetcher ?? fetch;
  const base = (env.TYPESAFE_API_BASE?.trim() || JEV_API_BASE).replace(/\/+$/, '');
  const body = JSON.stringify({ model: env.TYPESAFE_MODEL?.trim() || JEV_DEFAULT_MODEL, ...request });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? JEV_TIMEOUT_MS);
    try {
      const response = await fetcher(`${base}/v1/systemone`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'lupi-edge/jev',
        },
        body,
        signal: controller.signal,
      });
      if (response.status === 429 || response.status === 529) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        throw new JevError(`Jev is rate limited (${response.status}).`, response.status, Number.isFinite(retryAfter) ? retryAfter : null);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new JevError(`Jev request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}.`, response.status);
      }
      const payload = (await response.json()) as JevResult;
      if (!payload || typeof payload !== 'object' || !payload.answers) throw new JevError('Jev returned no answers.', 502);
      return payload;
    } catch (error) {
      if (error instanceof JevError) throw error;
      if (attempt === 0 && (error as { name?: string })?.name !== 'AbortError') continue;
      throw new JevError(error instanceof Error && error.name === 'AbortError' ? 'Jev timed out.' : 'Jev is unreachable.', 504);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new JevError('Jev is unreachable.', 504);
}

/* ─── Molecule switcher ─── */

export interface SwitchCandidate {
  key: string;
  title: string;
  formula?: string;
  elements?: string[];
  atoms?: number;
  source: string;
}

export interface SwitchJudgeRequest {
  query: string;
  elements: string[];
  candidates: SwitchCandidate[];
  loaded?: { title: string; formula?: string } | null;
}

export interface SwitchJudgeResponse {
  configured: boolean;
  model?: string;
  intent?: { choice: string; confidence: number };
  best?: { key: string; confidence: number } | null;
  fit?: Record<string, number>;
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new JevError('Body must be a JSON object.', 400);
  const body = raw as Record<string, unknown>;
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, MAX_QUERY_CHARS) : '';
  const elements = Array.isArray(body.elements)
    ? body.elements
        .filter((value): value is string => typeof value === 'string' && /^[A-Z][a-z]?$/.test(value) && Boolean(getElementSpecBySymbol(value)))
        .slice(0, 12)
    : [];
  if (!Array.isArray(body.candidates)) throw new JevError('"candidates" must be an array.', 400);
  const candidates: SwitchCandidate[] = [];
  const seen = new Set<string>();
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
    });
  }
  if (!query && elements.length === 0) throw new JevError('Provide a "query" or at least one element.', 400);
  if (candidates.length === 0) throw new JevError('Provide at least one candidate.', 400);
  const loaded = body.loaded && typeof body.loaded === 'object' && typeof (body.loaded as { title?: unknown }).title === 'string'
    ? { title: String((body.loaded as { title: string }).title).slice(0, 120), formula: typeof (body.loaded as { formula?: unknown }).formula === 'string' ? String((body.loaded as { formula: string }).formula).slice(0, 60) : undefined }
    : null;
  return { query, elements, candidates, loaded };
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
        'Which candidate in `candidates` best satisfies `request`? Prefer the exact molecule when one is named; when only elements or a class are given, prefer the smallest, most widely recognized molecule that fits. Choose `none` if nothing fits.',
      criteria,
    },
  };
  for (const candidate of request.candidates) {
    questions[`fit:${candidate.key}`] = {
      type: 'noul',
      instructions: `The candidate with key \`${candidate.key}\` satisfies what \`request\` asks for.`,
    };
  }
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
    })),
  };
}

export function mapSwitchAnswers(request: SwitchJudgeRequest, result: JevResult): SwitchJudgeResponse {
  const intent = result.answers.intent;
  const best = result.answers.best;
  const fit: Record<string, number> = {};
  for (const candidate of request.candidates) {
    const answer = result.answers[`fit:${candidate.key}`];
    if (answer && answer.type === 'noul' && typeof answer.noul === 'number') fit[candidate.key] = round3(answer.noul);
  }
  return {
    configured: true,
    model: result.model,
    intent: intent && intent.type === 'choice' ? { choice: intent.choice, confidence: round3(intent.confidence) } : undefined,
    best: best && best.type === 'choice' && best.choice !== 'none' ? { key: best.choice, confidence: round3(best.confidence) } : null,
    fit,
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
    const status = error instanceof JevError ? error.status : 400;
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status });
  }

  if (!jevConfigured(env)) return jsonResponse({ configured: false } satisfies SwitchJudgeResponse);

  const canonical = JSON.stringify({ q: parsed.query, e: parsed.elements, c: parsed.candidates.map((c) => c.key), l: parsed.loaded?.title ?? null });
  const cacheKey = new Request(`https://jev-cache.lupi.live/switch/${await sha256Hex(canonical)}`);
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
