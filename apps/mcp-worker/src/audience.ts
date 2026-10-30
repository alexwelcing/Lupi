import { TRACKER_SOURCE } from './audience-tracker';

export const AUDIENCE_SCRIPT_PATH = '/audience.js';
export const AUDIENCE_EVENTS_PATH = '/api/audience/events';
const MAX_BODY_BYTES = 16 * 1024;
const ORIGINS = new Set(['https://lupi.live', 'https://www.lupi.live']);
const RESPONSE_HEADERS = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

export interface AudienceCollectorBinding {
  fetch(request: Request, init?: RequestInit & { cf?: Record<string, unknown> }): Promise<Response>;
}

export interface AudienceEnv {
  AUDIENCE_COLLECTOR?: AudienceCollectorBinding;
}

function error(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error: message }, { status, headers: { ...RESPONSE_HEADERS, ...headers } });
}

/** Forward only a coarse classification, never the browser's complete UA string. */
function coarseUserAgent(value: string): string {
  const ua = value.slice(0, 512);
  if (/bot\b|crawler|spider|slurp/i.test(ua)) return 'Lupi bot';
  if (/headless|playwright|puppeteer|lighthouse/i.test(ua)) return 'Lupi headless';
  if (/curl\/|wget\/|python-requests|httpclient|go-http-client|node-fetch|undici/i.test(ua)) return 'Lupi automated httpclient';
  return 'Lupi browser';
}

class BodyTooLarge extends Error {}

function anonymousPath(value: string): string {
  const path = new URL(value, 'https://lupi.live').pathname;
  let previous = '';
  return path.split('/').map((segment) => {
    let decoded = segment;
    for (let i = 0; i < 2; i++) { try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; } }
    const secretContext = /^(invite|reset|token|users?|profile|view)$/i.test(previous);
    previous = decoded;
    if (decoded.includes('@')) return ':redacted';
    if (secretContext || /^[-+]?\d+(\.\d+)?$/.test(decoded) || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(decoded) || /^[a-f0-9]{24,}$/i.test(decoded) || decoded.length > 64) return ':id';
    return encodeURIComponent(decoded).replaceAll('%3A', ':');
  }).join('/').slice(0, 200) || '/';
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > MAX_BODY_BYTES) throw new BodyTooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

/** No query/UTM/identity properties or arbitrary nested payloads enter the service. */
function anonymousBody(body: Uint8Array): string | null {
  try {
    const raw: unknown = JSON.parse(new TextDecoder().decode(body));
    const candidates = Array.isArray(raw) ? raw : [raw];
    if (!candidates.length || candidates.length > 20) return null;
    const events = candidates.map((candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error();
      const value = candidate as Record<string, unknown>;
      if (value.site !== 'lupi' || !['id', 'visitor', 'session'].every((name) => typeof value[name] === 'string' && /^[a-z0-9_-]{8,128}$/i.test(value[name] as string))) throw new Error();
      if (!['pageview', 'engagement', 'feature'].includes(String(value.type)) || typeof value.path !== 'string' || value.path.length > 2048) throw new Error();
      if (value.type === 'feature' && (typeof value.name !== 'string' || !/^[a-z][a-z0-9_:-]{0,63}$/.test(value.name))) throw new Error();
      if (value.activeSeconds !== undefined && (typeof value.activeSeconds !== 'number' || !Number.isFinite(value.activeSeconds) || value.activeSeconds < 0 || value.activeSeconds > 30)) throw new Error();
      const event: Record<string, unknown> = { id: value.id, site: 'lupi', visitor: value.visitor, session: value.session, type: value.type, path: anonymousPath(value.path) };
      if (value.type === 'feature') event.name = value.name;
      if (value.type === 'engagement') event.activeSeconds = value.activeSeconds ?? 0;
      if (typeof value.source === 'string' && value.source.length <= 253 && /^[a-z0-9.-]*$/i.test(value.source)) event.source = value.source;
      if (['mobile', 'tablet', 'desktop'].includes(String(value.device))) event.device = value.device;
      if (typeof value.automation === 'boolean') event.automation = value.automation;
      if (typeof value.internal === 'boolean') event.internal = value.internal;
      return event;
    });
    return JSON.stringify(Array.isArray(raw) ? events : events[0]);
  } catch { return null; }
}

/** First-party script and anonymous ingestion; no public-network fallback. */
export async function handleAudienceRequest(request: Request, env: AudienceEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === AUDIENCE_SCRIPT_PATH) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed.', { allow: 'GET, HEAD' });
    return new Response(request.method === 'HEAD' ? null : TRACKER_SOURCE, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff' } });
  }
  if (path !== AUDIENCE_EVENTS_PATH) return error(404, 'Not found.');
  if (request.method !== 'POST') return error(405, 'Method not allowed.', { allow: 'POST' });
  const origin = request.headers.get('origin') ?? '';
  if (!ORIGINS.has(origin)) return error(403, 'Origin is not allowed.');
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType && contentType !== 'text/plain' && contentType !== 'application/json') return error(415, 'Unsupported event content type.');
  let body: Uint8Array;
  try { body = await readBoundedBody(request); }
  catch (cause) { return cause instanceof BodyTooLarge ? error(413, 'Event batch is too large.') : error(400, 'Invalid event batch.'); }
  const payload = anonymousBody(body);
  if (payload === null) return error(400, 'Invalid event batch.');
  if (!env.AUDIENCE_COLLECTOR) return error(503, 'Audience collection is unavailable.');
  const headers = new Headers({ 'content-type': 'text/plain', origin, 'user-agent': coarseUserAgent(request.headers.get('user-agent') ?? '') });
  const forwarded = new Request('https://audience-events/v1/events', { method: 'POST', headers, body: payload, credentials: 'omit', redirect: 'error' });
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  try {
    const response = await env.AUDIENCE_COLLECTOR.fetch(forwarded, { credentials: 'omit', redirect: 'error', ...(cf ? { cf } : {}) });
    // Never relay upstream cookies, private bodies, authorization, or redirects.
    if (!response.ok) return error(503, 'Audience collection is unavailable.');
    return new Response(null, { status: 204, headers: RESPONSE_HEADERS });
  } catch { return error(503, 'Audience collection is unavailable.'); }
}
