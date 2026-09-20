/**
 * The one Jev (TypeSafe AI System One) client in Lupi.
 *
 * Runtime-neutral: it takes a `fetch`, never touches `process`, `caches`, or
 * a key file, so the Cloudflare Worker (`apps/mcp-worker/src/jev.ts`) and the
 * Node lab (`tools/jev`) share exactly one request encoder, one deadline, one
 * retry rule, and one answer validator. Never import this into a browser
 * bundle: the browser talks to the edge routes, not to TypeSafe.
 *
 * Contract this enforces (docs.typesafe.ai/api):
 * - instructions and criteria are constants chosen by the caller; user text
 *   is only ever a value inside `state`;
 * - every question in the request must be answered, with the declared type,
 *   or the whole response is rejected (`invalid-response`);
 * - a pinned model (`jev-1.13.0`) must be echoed back; the rolling alias
 *   (`jev-latest`) accepts any model string and reports the served version.
 */

export const JEV_API_BASE = 'https://api.typesafe.ai';
/** Rolling alias; the response `model` reports which pinned version served it. */
export const JEV_MODEL_LATEST = 'jev-latest';
/** Pinned version the checked-in lab receipts were recorded against. */
export const JEV_MODEL_PINNED = 'jev-1.13.0';

export type JevCriteria = Record<string, string | null>;

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: JevCriteria }
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

export interface JevRequest {
  state: unknown;
  questions: Record<string, JevQuestion>;
}

export interface JevResult {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export type JevFailureReason =
  | 'not-configured'
  | 'timeout'
  | 'network'
  | 'rate-limited'
  | 'invalid-response'
  | `http-${number}`;

export class JevError extends Error {
  readonly status: number;
  readonly reason: JevFailureReason;
  readonly retryAfterSeconds: number | null;
  constructor(message: string, status: number, reason: JevFailureReason, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface JevClientConfig {
  apiKey: string | undefined;
  /** Defaults to TypeSafe's API; override for a gateway or a test server. */
  baseUrl?: string;
  /** Defaults to the rolling alias. */
  model?: string;
  fetch?: typeof fetch;
  /** Wall-clock deadline for one attempt, including transport. */
  timeoutMs?: number;
  /** Extra attempts after a 429/529 or a transport error. Timeouts never retry. */
  retries?: number;
  /** Pause before a retry. */
  retryDelayMs?: number;
}

export const JEV_DEFAULT_TIMEOUT_MS = 1_500;

export function jevConfigured(config: Pick<JevClientConfig, 'apiKey'>): boolean {
  return typeof config.apiKey === 'string' && config.apiKey.trim().length > 0;
}

/** True when `model` names an exact version rather than a rolling alias. */
export function isPinnedModel(model: string): boolean {
  return !/-latest$/i.test(model);
}

const inUnit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** A Choice answer is valid only when its labels are exactly the rubric's,
 *  probabilities are a finite distribution, and the chosen label wins it. */
export function validChoice(answer: unknown, criteria: Record<string, unknown>): answer is JevChoiceAnswer {
  if (!answer || typeof answer !== 'object') return false;
  const candidate = answer as Partial<JevChoiceAnswer>;
  if (candidate.type !== 'choice' || typeof candidate.choice !== 'string' || !Object.hasOwn(criteria, candidate.choice)) return false;
  if (!inUnit(candidate.confidence)) return false;
  const probabilities = candidate.probabilities;
  if (!probabilities || typeof probabilities !== 'object') return false;
  const keys = Object.keys(criteria);
  if (Object.keys(probabilities).length !== keys.length) return false;
  if (!keys.every((key) => Object.hasOwn(probabilities, key) && inUnit(probabilities[key]))) return false;
  const values = Object.values(probabilities);
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.abs(total - 1) <= 0.03 && probabilities[candidate.choice] >= Math.max(...values);
}

export function validNoul(answer: unknown): answer is JevNoulAnswer {
  return Boolean(answer) && typeof answer === 'object' && (answer as JevNoulAnswer).type === 'noul' && inUnit((answer as JevNoulAnswer).noul);
}

export function validScore(answer: unknown, levels: string[]): answer is JevScoreAnswer {
  if (!answer || typeof answer !== 'object') return false;
  const candidate = answer as Partial<JevScoreAnswer>;
  if (candidate.type !== 'score' || !inUnit(candidate.confidence)) return false;
  if (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score)) return false;
  const probabilities = candidate.probabilities;
  if (!probabilities || typeof probabilities !== 'object') return false;
  const values = Object.values(probabilities);
  return values.length === levels.length && values.every(inUnit);
}

/** Every question answered with its declared type, and nothing else. */
export function validateAnswers(questions: Record<string, JevQuestion>, payload: unknown): payload is JevResult {
  if (!payload || typeof payload !== 'object') return false;
  const result = payload as Partial<JevResult>;
  if (typeof result.model !== 'string' || !result.model || !result.answers || typeof result.answers !== 'object') return false;
  const ids = Object.keys(questions);
  if (Object.keys(result.answers).length !== ids.length) return false;
  for (const id of ids) {
    const question = questions[id];
    const answer = result.answers[id];
    if (question.type === 'choice' && !validChoice(answer, question.criteria)) return false;
    if (question.type === 'noul' && !validNoul(answer)) return false;
    if (question.type === 'score' && !validScore(answer, question.criteria)) return false;
  }
  return true;
}

/** Wire body: the model name plus the caller's state and constant questions. */
export function encodeRequest(config: Pick<JevClientConfig, 'model'>, request: JevRequest): string {
  return JSON.stringify({ model: config.model?.trim() || JEV_MODEL_LATEST, state: request.state, questions: request.questions });
}

/**
 * One System One call: state in, validated typed answers out.
 *
 * Throws `JevError` on every failure so callers can map `reason` (lab
 * receipts) or `status` (edge responses) without re-deriving either. The
 * deadline is enforced by `Promise.race`, so a transport that ignores abort
 * still cannot hold the caller past `timeoutMs`; a late answer is discarded.
 */
export async function systemOne(config: JevClientConfig, request: JevRequest): Promise<JevResult> {
  if (!jevConfigured(config)) throw new JevError('Jev is not configured.', 503, 'not-configured');
  const fetcher = config.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new JevError('No fetch implementation.', 500, 'network');
  const base = (config.baseUrl?.trim() || JEV_API_BASE).replace(/\/+$/, '');
  const model = config.model?.trim() || JEV_MODEL_LATEST;
  const body = encodeRequest({ model }, request);
  const timeoutMs = config.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, config.retries ?? 0);

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new JevError('Jev timed out.', 504, 'timeout'));
      }, timeoutMs);
    });
    const attemptOnce = async (): Promise<JevResult> => {
      let response: Response;
      try {
        response = await fetcher(`${base}/v1/systemone`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': 'lupi/jev',
          },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new JevError('Jev timed out.', 504, 'timeout');
        throw new JevError(error instanceof Error ? `Jev is unreachable: ${error.message}` : 'Jev is unreachable.', 504, 'network');
      }
      if (response.status === 429 || response.status === 529) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
        await response.arrayBuffer().catch(() => undefined);
        throw new JevError(`Jev is rate limited (${response.status}).`, response.status, 'rate-limited', Number.isFinite(retryAfter) ? retryAfter : null);
      }
      if (!response.ok) {
        // Never surface upstream body text: it can carry account details.
        await response.arrayBuffer().catch(() => undefined);
        throw new JevError(`Jev request failed (${response.status}).`, response.status, `http-${response.status}`);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new JevError('Jev returned malformed JSON.', 502, 'invalid-response');
      }
      if (!validateAnswers(request.questions, payload)) throw new JevError('Jev returned an invalid response.', 502, 'invalid-response');
      if (isPinnedModel(model) && payload.model !== model) throw new JevError(`Jev answered with ${payload.model}, not ${model}.`, 502, 'invalid-response');
      return payload;
    };
    try {
      return await Promise.race([attemptOnce(), deadline]);
    } catch (error) {
      const failure = error instanceof JevError ? error : new JevError('Jev failed.', 502, 'network');
      const retryable = failure.reason === 'rate-limited' || failure.reason === 'network';
      if (!retryable || attempt >= retries) throw failure;
      await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs ?? 200));
    } finally {
      clearTimeout(timer);
    }
  }
}

/** One authenticated metadata GET; pays connection setup before an interactive
 *  session starts. Not inference and not a keepalive. */
export async function warmConnection(config: JevClientConfig): Promise<boolean> {
  if (!jevConfigured(config)) return false;
  const fetcher = config.fetch ?? globalThis.fetch;
  const base = (config.baseUrl?.trim() || JEV_API_BASE).replace(/\/+$/, '');
  try {
    const response = await fetcher(`${base}/v1/models`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
    });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
