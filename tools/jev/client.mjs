// Server-only, dependency-free TypeSafe adapter. Never import this into a browser bundle.
export const MODEL = 'jev-1.13.0';

// Pay the observed connection setup cost before announcing the local demo URL.
// This is one metadata GET, not hidden inference or a periodic keepalive.
export async function warmConnection(apiKey) {
  if (!apiKey) return false;
  try {
    const response = await fetch('https://api.typesafe.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000),
    });
    await response.arrayBuffer();
    return response.ok;
  } catch { return false; }
}

export function validChoice(answer, criteria) {
  if (!answer || answer.type !== 'choice' || !Object.hasOwn(criteria, answer.choice)
      || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1
      || !answer.probabilities || typeof answer.probabilities !== 'object') return false;
  const keys = Object.keys(criteria), probabilities = answer.probabilities;
  if (Object.keys(probabilities).length !== keys.length) return false;
  if (!keys.every(key => Object.hasOwn(probabilities, key) && Number.isFinite(probabilities[key])
      && probabilities[key] >= 0 && probabilities[key] <= 1)) return false;
  const values = Object.values(probabilities);
  return Math.abs(values.reduce((a, b) => a + b, 0) - 1) <= 0.03
    && probabilities[answer.choice] >= Math.max(...values);
}

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
      const controller = new AbortController();
      let timer;
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(fallback('timeout')); }, timeoutMs);
      });
      const upstream = (async () => {
        try {
          const response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
            method: 'POST', signal: controller.signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          });
          if (!response.ok) return fallback(`http-${response.status}`);
          const result = await response.json();
          if (result?.model !== MODEL || !result.answers || typeof result.answers !== 'object') return fallback('invalid-response');
          if (Object.keys(result.answers).length !== Object.keys(request.questions).length) return fallback('invalid-response');
          for (const [id, question] of Object.entries(request.questions)) {
            if (question.type !== 'choice' || !validChoice(result.answers[id], question.criteria)) return fallback('invalid-response');
          }
          if (!controller.signal.aborted && cacheTtlMs > 0 && cacheSize > 0) {
            if (cache.size >= cacheSize) cache.delete(cache.keys().next().value);
            cache.set(cacheKey, { response: structuredClone(result), expires: Date.now() + cacheTtlMs });
          }
          return { source: 'jev', elapsedMs: Math.round(now() - started), response: result };
        } catch { return fallback(controller.signal.aborted ? 'timeout' : 'network'); }
      })();
      try { return await Promise.race([upstream, deadline]); }
      finally { clearTimeout(timer); }
    })();
    pending.set(cacheKey, task);
    try { return await task; } finally { pending.delete(cacheKey); }
  };
}
