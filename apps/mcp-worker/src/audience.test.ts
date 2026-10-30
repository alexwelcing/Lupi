import { describe, expect, it, vi } from 'vitest';
import { handleAudienceRequest, type AudienceCollectorBinding } from './audience';

const event = { id: 'event_00000001', site: 'lupi', visitor: 'visit_00000001', session: 'session_00000001', type: 'feature', name: 'save_view', path: '/library', source: 'search.example', device: 'desktop', automation: false };
const request = (body: string = JSON.stringify(event), headers: Record<string, string> = {}) => new Request('https://lupi.live/api/audience/events?token=do-not-forward', { method: 'POST', headers: { origin: 'https://lupi.live', 'content-type': 'text/plain', ...headers }, body });
function headerNames(headers: Headers) { const names: string[] = []; headers.forEach((_value, name) => names.push(name)); return names.sort(); }

describe('cookieless first-party audience routes', () => {
  it('serves the owned memory-only tracker without setting cookies', async () => {
    const response = await handleAudienceRequest(new Request('https://lupi.live/audience.js'), {});
    const source = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/javascript');
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(source).toContain("storage: 'memory'");
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it('forwards only allowed anonymous event fields and safe headers through the service binding', async () => {
    let forwarded: Request | undefined;
    let cf: unknown;
    let credentials: RequestCredentials | undefined;
    const service: AudienceCollectorBinding = { fetch: vi.fn(async (input, init) => { forwarded = input; cf = init?.cf; credentials = init?.credentials; return new Response('private upstream', { status: 202, headers: { 'set-cookie': 'private=secret', location: 'https://private.invalid', authorization: 'Bearer upstream-secret' } }); }) };
    const incoming = request(JSON.stringify({ ...event, email: 'private@example.com', utm: { token: 'private' }, props: { query: 'private' } }), { cookie: 'session=private', authorization: 'Bearer private', 'user-agent': 'Mozilla/5.0 private@example.com', 'x-unsafe': 'private' });
    Object.defineProperty(incoming, 'cf', { value: { country: 'US', botManagement: { verifiedBot: false } } });
    const response = await handleAudienceRequest(incoming, { AUDIENCE_COLLECTOR: service });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(headerNames(response.headers)).not.toEqual(expect.arrayContaining(['set-cookie', 'authorization', 'location']));
    expect(forwarded!.url).toBe('https://audience-events/v1/events');
    expect(forwarded!.redirect).toBe('manual');
    expect(headerNames(forwarded!.headers)).toEqual(['content-type', 'origin', 'user-agent']);
    expect(forwarded!.headers.get('user-agent')).toBe('Lupi browser');
    expect(forwarded!.headers.get('origin')).toBe('https://lupi.live');
    expect(credentials).toBe('omit');
    expect(await forwarded!.json()).toEqual(event);
    expect(cf).toEqual({ country: 'US', botManagement: { verifiedBot: false } });
  });

  it('preserves automation classification without exposing the complete user agent', async () => {
    const fetch = vi.fn(async (input: Request) => { expect(input.headers.get('user-agent')).toBe('Lupi headless'); return new Response(null, { status: 202 }); });
    await handleAudienceRequest(request(undefined, { 'user-agent': 'Mozilla/5.0 HeadlessChrome/123 private-browser-details' }), { AUDIENCE_COLLECTOR: { fetch } });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('redacts identifying paths and query strings again before forwarding', async () => {
    const fetch = vi.fn(async (input: Request) => { expect(await input.json()).toMatchObject({ path: '/users/:redacted/:id' }); return new Response(null, { status: 202 }); });
    const response = await handleAudienceRequest(request(JSON.stringify({ ...event, path: '/users/alex%2540example.com/123?token=secret#private' })), { AUDIENCE_COLLECTOR: { fetch } });
    expect(response.status).toBe(204);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('enforces allowed origins and methods before reaching the service', async () => {
    const fetch = vi.fn();
    for (const origin of ['https://evil.example', 'null', 'https://lupi.live.evil.example', '']) {
      expect((await handleAudienceRequest(request(undefined, { origin }), { AUDIENCE_COLLECTOR: { fetch } })).status).toBe(403);
    }
    expect((await handleAudienceRequest(new Request('https://lupi.live/api/audience/events'), { AUDIENCE_COLLECTOR: { fetch } })).status).toBe(405);
    expect((await handleAudienceRequest(new Request('https://lupi.live/api/audience/events', { method: 'OPTIONS' }), { AUDIENCE_COLLECTOR: { fetch } })).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('honors privacy request headers without forwarding an event', async () => {
    const fetch = vi.fn();
    for (const header of ['sec-gpc', 'dnt']) expect((await handleAudienceRequest(request(undefined, { [header]: '1' }), { AUDIENCE_COLLECTOR: { fetch } })).status).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds streamed bodies even without a Content-Length header', async () => {
    const fetch = vi.fn();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(9000)); controller.enqueue(new Uint8Array(9000)); }, cancel() { cancelled = true; } });
    const incoming = new Request('https://lupi.live/api/audience/events', { method: 'POST', headers: { origin: 'https://lupi.live' }, body, duplex: 'half' } as RequestInit);
    expect((await handleAudienceRequest(incoming, { AUDIENCE_COLLECTOR: { fetch } })).status).toBe(413);
    expect(cancelled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects oversized, malformed, wrong-site, and unsupported payloads', async () => {
    const fetch = vi.fn();
    for (const body of ['{', JSON.stringify({ ...event, site: 'newts-news' }), JSON.stringify({ ...event, type: 'engagement', activeSeconds: 31 })]) expect((await handleAudienceRequest(request(body), { AUDIENCE_COLLECTOR: { fetch } })).status).toBe(400);
    expect((await handleAudienceRequest(request('x'.repeat(16385)), { AUDIENCE_COLLECTOR: { fetch } })).status).toBe(413);
    expect((await handleAudienceRequest(request(undefined, { 'content-type': 'image/png' }), { AUDIENCE_COLLECTOR: { fetch } })).status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('has no network fallback and does not expose upstream failures', async () => {
    expect((await handleAudienceRequest(request(), {})).status).toBe(503);
    const response = await handleAudienceRequest(request(), { AUDIENCE_COLLECTOR: { fetch: vi.fn(async () => { throw new Error('upstream token=private'); }) } });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
    const upstream = await handleAudienceRequest(request(), { AUDIENCE_COLLECTOR: { fetch: vi.fn(async () => new Response('secret', { status: 400 })) } });
    expect(upstream.status).toBe(503);
    expect(await upstream.text()).not.toContain('secret');
    const redirect = await handleAudienceRequest(request(), { AUDIENCE_COLLECTOR: { fetch: vi.fn(async (_input, init) => { expect(init?.redirect).toBe('manual'); return new Response(null, { status: 302, headers: { location: 'https://private.invalid' } }); }) } });
    expect(redirect.status).toBe(503);
    expect(redirect.headers.has('location')).toBe(false);
  });
});
