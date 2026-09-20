// Server-only TypeSafe adapter for the lab. The request encoder, deadline,
// retry rule and answer validator live in `@atlas/core/jev`; this wrapper adds
// what an interactive Node demo needs: a result envelope with `source` and
// `elapsedMs`, an exact-request memory cache, and duplicate-request
// coalescing. Run with `tsx` (see package.json). Never import this into a
// browser bundle.
import {
  JEV_MODEL_PINNED,
  JevError,
  systemOne,
  validChoice as coreValidChoice,
  warmConnection as coreWarmConnection,
} from '../../packages/core/src/jev/index.ts';

export const MODEL = JEV_MODEL_PINNED;
export const validChoice = coreValidChoice;

// Pay the observed connection setup cost before announcing the local demo URL.
// This is one metadata GET, not hidden inference or a periodic keepalive.
export function warmConnection(apiKey) {
  return coreWarmConnection({ apiKey, timeoutMs: 10000 });
}

const reasonOf = error => {
  if (!(error instanceof JevError)) return 'network';
  return error.reason === 'rate-limited' ? `http-${error.status}` : error.reason;
};

export function createClient({ apiKey, fetchImpl = fetch, timeoutMs = 1200, cacheTtlMs = 300000,
    cacheSize = 128, now = () => performance.now() } = {}) {
  const cache = new Map(), pending = new Map();
  return async function evaluate(request) {
    const started = now();
    const fallback = reason => ({ source: 'fallback', reason, elapsedMs: Math.round(now() - started) });
    if (!apiKey) return fallback('not-configured');
    const cacheKey = JSON.stringify(request), cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return { source: 'cache', elapsedMs: Math.round(now() - started), response: structuredClone(cached.response) };
    }
    if (pending.has(cacheKey)) return structuredClone(await pending.get(cacheKey));
    const task = (async () => {
      try {
        // The lab pins the model and never retries: a rate limit is a finding, not a hiccup.
        const response = await systemOne({ apiKey, model: MODEL, fetch: fetchImpl, timeoutMs, retries: 0 }, request);
        if (cacheTtlMs > 0 && cacheSize > 0) {
          if (cache.size >= cacheSize) cache.delete(cache.keys().next().value);
          cache.set(cacheKey, { response: structuredClone(response), expires: Date.now() + cacheTtlMs });
        }
        return { source: 'jev', elapsedMs: Math.round(now() - started), response };
      } catch (error) { return fallback(reasonOf(error)); }
    })();
    pending.set(cacheKey, task);
    try { return await task; } finally { pending.delete(cacheKey); }
  };
}
