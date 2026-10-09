import { buildDiscoveryRequest, discoveryQuery, discoveryResult, exactDiscoveryCandidate, resolveDiscoveryAnswer, systemOne, type DiscoveryResult } from '@atlas/core/jev';
import { jevConfigured, type JevEnv } from './jev';

export const DISCOVERY_PATH = '/v1/discovery/molecule';

/** Shared by REST/native and MCP/chat. No structure retrieval or global state. */
export async function recommendMolecule(raw: unknown, env: JevEnv = {}, fetcher?: typeof fetch): Promise<DiscoveryResult> {
  const query = discoveryQuery(raw);
  const exact = exactDiscoveryCandidate(query);
  if (exact) return discoveryResult(query, 'exact', exact);
  if (!jevConfigured(env)) return discoveryResult(query, 'unavailable');
  try {
    const answer = await systemOne({
      apiKey: env.TYPESAFE_API_KEY, baseUrl: env.TYPESAFE_API_BASE, model: env.TYPESAFE_MODEL,
      timeoutMs: 1500, retries: 0, fetch: fetcher,
    }, buildDiscoveryRequest(query));
    return resolveDiscoveryAnswer(query, answer);
  } catch {
    // Availability never turns a failed judgment into an invented match.
    return discoveryResult(query, 'unavailable');
  }
}

export async function handleMoleculeDiscovery(request: Request, env: JevEnv): Promise<Response> {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { ...headers, allow: 'POST, OPTIONS' } });
  // Bound actual streamed bytes as well as a caller-supplied Content-Length.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (Number(request.headers.get('content-length') ?? 0) > 4096) return Response.json({ error: 'Request body too large.' }, { status: 413, headers });
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); return Response.json({ error: 'Request body too large.' }, { status: 413, headers }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { query?: unknown };
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'query')) throw new Error('Supply only a query.');
    return Response.json(await recommendMolecule(body.query, env), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400, headers });
  } finally { reader?.releaseLock(); }
}
