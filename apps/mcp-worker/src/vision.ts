/**
 * The scanner's vision hop, through Hugging Face Inference Providers.
 *
 * One OpenAI-compatible chat completion on the Hub's router
 * (`https://router.huggingface.co/v1/chat/completions`) with the same
 * `HF_TOKEN` the Spaces use, so the scanner needs one token for every remote
 * model it touches. The photo goes as a `data:` URL, the answer comes back
 * under a strict JSON schema, and the router picks the provider (append
 * `:cheapest` or `:fastest` to the model id to steer it).
 *
 * The default model is a small instruct VLM pinned to one provider
 * (`Qwen/Qwen3-VL-30B-A3B-Instruct:novita`, 3B active parameters). The
 * earlier default, the reasoning model `Qwen/Qwen3.6-35B-A3B`, ran past the
 * 17-second deadline on every call in production, and the unpinned
 * `:fastest` route timed out on photos. Reasoning defaults to `none`, and
 * `none` sends no `reasoning_effort` field at all, so a non-reasoning model
 * never costs a rejected request and a retry. Set `HF_VISION_REASONING` to
 * `low` or higher for a reasoning model; a provider that rejects the field
 * is asked once more without it.
 *
 * Nothing here knows what a molecule or a primitive is; `scan.ts` and
 * `gist.ts` bring the prompts and schemas and validate what comes back.
 */

import { hfConfigured, type HfEnv } from './hf';

export interface VisionEnv extends HfEnv {
  /** Pin a different vision model on the router, e.g. `Qwen/Qwen3-VL-235B-A22B-Instruct:cheapest`. */
  HF_VISION_MODEL?: string;
  /** `none` (default, sends no field), `low`, `medium`, or `high`: how long a reasoning model may think before answering. */
  HF_VISION_REASONING?: string;
  /** Override the router for a gateway or a test server. */
  HF_INFERENCE_BASE?: string;
}

export const VISION_MODEL_DEFAULT = 'Qwen/Qwen3-VL-30B-A3B-Instruct:novita';
export const VISION_REASONING_DEFAULT = 'none';
export const VISION_BASE_DEFAULT = 'https://router.huggingface.co/v1';
const REASONING_LEVELS = new Set(['none', 'low', 'medium', 'high']);
/** The browser gives up at 20 s; this leaves room for the Jev hop and the response. */
const VISION_TIMEOUT_MS = 17_000;

export type VisionMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export function visionConfigured(env: VisionEnv): boolean {
  return hfConfigured(env);
}

export function visionModel(env: VisionEnv): string {
  return env.HF_VISION_MODEL?.trim() || VISION_MODEL_DEFAULT;
}

export function visionReasoning(env: VisionEnv): string {
  const value = env.HF_VISION_REASONING?.trim().toLowerCase() || VISION_REASONING_DEFAULT;
  return REASONING_LEVELS.has(value) ? value : VISION_REASONING_DEFAULT;
}

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

/**
 * Structured outputs across providers accept a JSON Schema subset: numeric
 * bounds, string lengths, and array lengths are not reliably honoured and
 * some providers reject them. The schemas in `scan.ts` keep those keywords as
 * documentation and for the normalizers; this strips them from what is sent.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems']);

export function structuredOutputSchema(schema: unknown): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue;
      out[key] = strip(value);
    }
    return out;
  };
  return strip(schema) as Record<string, unknown>;
}

/**
 * The JSON object in a model's reply. Strict schemas make the content pure
 * JSON on most providers; this also survives a stray `<think>` block, a code
 * fence, or a sentence before the object.
 */
export function extractJson(content: string): unknown {
  const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(withoutThinking);
  const candidate = fenced ? fenced[1].trim() : withoutThinking;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) throw new SyntaxError('No JSON object in the reply.');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export interface VisionCall {
  system: string;
  text: string;
  /** Omit for a text-only call (the search's stage). */
  image?: { mediaType: VisionMediaType; data: string };
  schemaName: string;
  schema: unknown;
  maxTokens: number;
  /** Words for the error messages: "describe this photo", "sketch this photo". */
  task: string;
}

export interface VisionReply {
  json: unknown;
  /** The model the router reports, which can carry the provider's own naming. */
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** One chat completion on the router: prompt (and photo) in, the reply's JSON out. */
export async function callVision(env: VisionEnv, call: VisionCall, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<VisionReply> {
  if (!visionConfigured(env)) throw new ScanVisionError('Vision is not configured.', 503, 'not-configured');
  const fetcher = options.fetcher ?? fetch;
  const base = (env.HF_INFERENCE_BASE?.trim() || VISION_BASE_DEFAULT).replace(/\/+$/, '');
  const model = visionModel(env);
  const reasoning = visionReasoning(env);
  const userContent = call.image
    ? [
        { type: 'image_url', image_url: { url: `data:${call.image.mediaType};base64,${call.image.data}` } },
        { type: 'text', text: call.text },
      ]
    : call.text;
  const body: Record<string, unknown> = {
    model,
    max_tokens: call.maxTokens,
    temperature: 0.2,
    stream: false,
    messages: [
      { role: 'system', content: call.system },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_schema', json_schema: { name: call.schemaName, strict: true, schema: structuredOutputSchema(call.schema) } },
  };
  if (reasoning !== 'none') body.reasoning_effort = reasoning;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? VISION_TIMEOUT_MS);
  const post = (payload: Record<string, unknown>) =>
    fetcher(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.HF_TOKEN!.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  let response: Response;
  try {
    response = await post(body);
    if ('reasoning_effort' in body && (response.status === 400 || response.status === 422)) {
      // Not every provider takes `reasoning_effort`; ask once more without it.
      await response.body?.cancel().catch(() => undefined);
      const { reasoning_effort: _dropped, ...plain } = body;
      response = await post(plain);
    }
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new ScanVisionError('Vision timed out.', 504, 'timeout');
    throw new ScanVisionError('Vision is unreachable.', 504, 'network');
  }

  let completion: ChatCompletion;
  try {
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 429) throw new ScanVisionError('Vision is rate limited.', 429, 'rate-limited');
      // Never surface the upstream body: it can carry account details.
      throw new ScanVisionError(`Vision request failed (${response.status}).`, response.status >= 500 ? 502 : response.status, `http-${response.status}`);
    }
    completion = (await response.json()) as ChatCompletion;
  } catch (error) {
    if (error instanceof ScanVisionError) throw error;
    if (controller.signal.aborted) throw new ScanVisionError('Vision timed out.', 504, 'timeout');
    throw new ScanVisionError('The model returned malformed JSON.', 502, 'invalid-response');
  } finally {
    clearTimeout(timer);
  }

  const choice = completion.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') {
    throw new ScanVisionError(`The model declined to ${call.task}.`, 422, 'declined');
  }
  if (choice?.finish_reason === 'length') throw new ScanVisionError('The answer ran past its budget.', 502, 'invalid-response');
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new ScanVisionError('The model returned no text.', 502, 'invalid-response');
  let json: unknown;
  try {
    json = extractJson(content);
  } catch {
    throw new ScanVisionError('The model returned malformed JSON.', 502, 'invalid-response');
  }
  return {
    json,
    model: completion.model || model,
    usage: { inputTokens: completion.usage?.prompt_tokens ?? null, outputTokens: completion.usage?.completion_tokens ?? null },
  };
}
