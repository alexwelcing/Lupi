import { describe, expect, it, vi } from 'vitest';
import { DISCOVERY_CATALOG } from '@atlas/core/jev';
import { handleMoleculeDiscovery, recommendMolecule } from './discovery';
import worker from './index';

const post = (body: unknown) => new Request('https://lupi.live/v1/discovery/molecule', { method: 'POST', body: JSON.stringify(body) });

describe('shared discovery edge', () => {
  it('serves exact names without contacting Jev even when a key is configured', async () => {
    const fetcher = vi.fn();
    const result = await recommendMolecule(' Caffeine ', { TYPESAFE_API_KEY: 'test' }, fetcher);
    expect(result).toMatchObject({ query: 'Caffeine', method: 'exact', candidates: [{ pubchemCid: 2519 }] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not invent a fallback match without a key or when the model fails', async () => {
    expect(await recommendMolecule('something in coffee')).toMatchObject({ method: 'unavailable', candidates: [] });
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 }));
    expect(await recommendMolecule('something in coffee', { TYPESAFE_API_KEY: 'test' }, fetcher)).toMatchObject({ method: 'unavailable', candidates: [] });
  });

  it('validates the model distribution and only returns code-owned metadata', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.state.query).toBe('a hollow carbon cage');
      const ids = Object.keys(body.questions.best.criteria);
      return Response.json({ model: 'jev-1.13.0', answers: { best: { type: 'choice', choice: 'c60_buckyball', confidence: 0.97,
        probabilities: Object.fromEntries(ids.map((id) => [id, id === 'c60_buckyball' ? 0.96 : 0.04 / (ids.length - 1)])),
        url: 'https://untrusted.example/invented.xyz',
      } } });
    });
    const result = await recommendMolecule('a hollow carbon cage', { TYPESAFE_API_KEY: 'test' }, fetcher);
    expect(result.candidates).toEqual([DISCOVERY_CATALOG.find((c) => c.id === 'c60_buckyball')]);
    expect(JSON.stringify(result)).not.toContain('untrusted.example');
  });

  it('routes public REST through the shared service and retains CORS/no-store', async () => {
    const request = post({ query: 'H2O' });
    request.headers.set('Origin', 'https://lupi.live');
    const response = await worker.fetch(request, {}, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://lupi.live');
    expect(await response.json()).toMatchObject({ schema: 'lupi.discovery.v1', method: 'exact', candidates: [{ id: 'water' }] });
  });

  it('rejects malformed bodies and counts streamed bytes, regardless of declared length', async () => {
    for (const body of [{ query: 'x', url: 'https://example.com' }, { query: 'x'.repeat(201) }, null, ['water']]) {
      expect((await handleMoleculeDiscovery(post(body), {})).status).toBe(400);
    }
    const request = post({ query: 'x'.repeat(5000) });
    request.headers.set('content-length', '10');
    expect((await handleMoleculeDiscovery(request, {})).status).toBe(413);
    expect((await handleMoleculeDiscovery(new Request('https://lupi.live/v1/discovery/molecule'), {})).status).toBe(405);
  });
});
