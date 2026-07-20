import { afterEach, describe, expect, it, vi } from 'vitest';
import externalAssetPaths from '../../web/cloudflare-assets-exclude.json';
import browserManifest from '../../web/public/browser-mcp-manifest.json';
import { handleRequest, validateExternalAssetPaths } from './index';

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://mcp.lupi.live${path}`, init);
}

describe('lupi Cloudflare MCP worker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports health without a browser dependency', async () => {
    const res = await handleRequest(req('/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ready: boolean;
      browserRequired: boolean;
      toolCount: number;
      renderExecution: boolean;
      release?: unknown;
    };
    expect(body.ready).toBe(true);
    expect(body.browserRequired).toBe(false);
    expect(body.toolCount).toBeGreaterThanOrEqual(6);
    expect(body.renderExecution).toBe(false);
    expect(body).not.toHaveProperty('release');
    expect(res.headers.get('x-lupi-edge-executed')).toBe('1');
  });

  it('returns health headers without a body for HEAD', async () => {
    const get = await handleRequest(req('/health'));
    const head = await handleRequest(req('/health', { method: 'HEAD' }));

    expect(head.status).toBe(get.status);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(head.headers.get('access-control-allow-methods')).toBe(get.headers.get('access-control-allow-methods'));
    expect(head.headers.get('x-lupi-edge-executed')).toBe('1');
    expect(await head.text()).toBe('');
  });

  it('returns a bodyless edge manifest for HEAD', async () => {
    const head = await handleRequest(req('/mcp-manifest.json', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toMatch(/^application\/json/);
    expect(head.headers.get('x-lupi-edge-executed')).toBe('1');
    expect(await head.text()).toBe('');
  });

  it('reports only Cloudflare-supplied release identity and execution posture', async () => {
    const res = await handleRequest(req('/health'), {
      CF_VERSION_METADATA: {
        id: '4f94c8c7-0fef-4d7f-ae75-430c44e84542',
        tag: '0123456789abcdef0123456789abcdef01234567',
        timestamp: '2026-07-19T20:30:00.000Z',
      },
      RENDERER_ENDPOINT: 'https://renderer.invalid',
    });
    const body = await res.json() as {
      renderExecution: boolean;
      release: { id: string; tag: string; timestamp: string };
    };

    expect(body.renderExecution).toBe(true);
    expect(body.release).toEqual({
      id: '4f94c8c7-0fef-4d7f-ae75-430c44e84542',
      tag: '0123456789abcdef0123456789abcdef01234567',
      timestamp: '2026-07-19T20:30:00.000Z',
    });
  });

  it('serves the built web app through the static asset binding', async () => {
    let fetchedPath = '';
    const res = await handleRequest(req('/materials/clean-energy'), {
      WEB_ASSETS: {
        fetch: async (request) => {
          fetchedPath = new URL(request.url).pathname;
          return new Response('<div id="root"></div>', { headers: { 'content-type': 'text/html' } });
        },
      },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
    expect(fetchedPath).toBe('/materials/clean-energy');
  });

  it('does not intercept Vite bundle assets as MCP render assets', async () => {
    let fetchedPath = '';
    const res = await handleRequest(req('/assets/index-BLAH.js'), {
      WEB_ASSETS: {
        fetch: async (request) => {
          fetchedPath = new URL(request.url).pathname;
          return new Response('console.log("ok")', { headers: { 'content-type': 'text/javascript' } });
        },
      },
    });

    expect(res.status).toBe(200);
    expect(fetchedPath).toBe('/assets/index-BLAH.js');
    expect(await res.text()).toContain('console.log');
  });

  it('proxies Firebase reserved auth paths for popup auth compatibility', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(String(input))));

    const res = await handleRequest(req('/__/auth/handler?apiKey=test'), {
      FIREBASE_AUTH_PROXY_HOST: 'shed-489901.firebaseapp.com',
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('https://shed-489901.firebaseapp.com/__/auth/handler?apiKey=test');
  });

  it('proxies oversized gallery payloads from external object storage', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({
      url: String(input),
      range: new Headers(init?.headers).get('range'),
    }))));

    const res = await handleRequest(req('/gallery/research/hfc/r32_nvt_273K.glimbin', {
      headers: { range: 'bytes=0-4095' },
    }), {
      LUPI_LARGE_ASSET_BASE_URL: 'https://assets.lupi.live',
    });
    const body = await res.json() as { url: string; range: string };

    expect(res.status).toBe(200);
    expect(res.headers.get('x-lupi-asset-source')).toBe('external-proxy');
    expect(body).toMatchObject({
      url: 'https://assets.lupi.live/gallery/research/hfc/r32_nvt_273K.glimbin',
      range: 'bytes=0-4095',
    });
  });

  it('serves oversized gallery payloads from the R2 asset binding with byte ranges', async () => {
    let requestedKey = '';
    let requestedRange: unknown = null;
    const res = await handleRequest(req('/gallery/research/hfc/r32_nvt_273K.glimbin', {
      headers: { range: 'bytes=2-5' },
    }), {
      ASSETS: {
        head: async (key) => {
          requestedKey = key;
          return { size: 10, httpMetadata: { contentType: 'application/octet-stream' } };
        },
        get: async (key, options) => {
          requestedKey = key;
          requestedRange = options?.range ?? null;
          return { size: 4, arrayBuffer: async () => new TextEncoder().encode('cdef').buffer };
        },
        put: async () => undefined,
      },
      LUPI_LARGE_ASSET_BASE_URL: 'https://assets.lupi.live',
    });

    expect(res.status).toBe(206);
    expect(requestedKey).toBe('gallery/research/hfc/r32_nvt_273K.glimbin');
    expect(requestedRange).toEqual({ offset: 2, length: 4 });
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(res.headers.get('x-lupi-asset-source')).toBe('r2');
    expect(await res.text()).toBe('cdef');
  });

  it.each(externalAssetPaths)('routes the shared external-asset allowlist through R2: %s', async (assetPath) => {
    let requestedKey = '';
    const res = await handleRequest(req(`/${assetPath}`), {
      ASSETS: {
        head: async (key) => {
          requestedKey = key;
          return { size: 2, httpMetadata: { contentType: 'application/octet-stream' } };
        },
        get: async () => ({ size: 2, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }),
        put: async () => undefined,
      },
    });

    expect(res.status).toBe(200);
    expect(requestedKey).toBe(assetPath);
    expect(res.headers.get('x-lupi-asset-source')).toBe('r2');
  });

  it('rejects unsafe, empty, and duplicate external-asset configuration', () => {
    expect(() => validateExternalAssetPaths([])).toThrow(/at least one path/);
    expect(() => validateExternalAssetPaths(['/gallery/file.glimbin'])).toThrow(/Invalid external asset path/);
    expect(() => validateExternalAssetPaths(['gallery/../secret'])).toThrow(/Invalid external asset path/);
    expect(() => validateExternalAssetPaths(['gallery\\secret'])).toThrow(/Invalid external asset path/);
    expect(() => validateExternalAssetPaths(['gallery/file', 'gallery/file'])).toThrow(/duplicate paths/);
  });

  it.each(['/collectAnalytics', '/api/analytics'])('collects analytics events on the Cloudflare edge endpoint: %s', async (path) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await handleRequest(req(path, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ event: 'app_landed', sid: 'session-1', ts: 1, props: { atoms: 42 } }),
    }));

    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('app_landed'));
  });

  it.each(['/__/auth/handler?apiKey=test', '/__/firebase/init.json'])('proxies every Firebase reserved namespace: %s', async (path) => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(String(input))));
    const res = await handleRequest(req(path), { FIREBASE_AUTH_PROXY_HOST: 'shed-489901.firebaseapp.com' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`https://shed-489901.firebaseapp.com${path}`);
  });

  it('renders saved-view share HTML from Firestore REST when configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      fields: {
        slug: { stringValue: 'copper-publish' },
        title: { stringValue: 'Copper Publish' },
        visibility: { stringValue: 'public' },
        molecule: {
          mapValue: {
            fields: {
              name: { stringValue: 'Copper FCC' },
              atomCount: { integerValue: '5000' },
            },
          },
        },
      },
    }), { headers: { 'content-type': 'application/json' } })));

    const res = await handleRequest(req('/view/copper-publish'), {
      FIREBASE_PROJECT_ID: 'shed-489901',
      FIREBASE_WEB_API_KEY: 'public-web-key',
      LUPI_PUBLIC_ORIGIN: 'https://lupi.live',
    });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('Copper Publish | Lupi');
    expect(html).toContain('5,000 atoms');
    expect(html).toContain('https://lupi.live/#/view/copper-publish');
  });

  it('implements tools/list JSON-RPC', async () => {
    const res = await handleRequest(req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }));
    const body = await res.json() as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((tool) => tool.name)).toContain('lupi.render_molecule_asset');
  });

  it('keeps the edge and generated browser manifests distinct', async () => {
    const cloudflare = await handleRequest(req('/mcp-manifest.json'));
    const cloudflareBody = await cloudflare.json() as { endpoint: string; browserBridgeManifest: string; tools: Array<{ name: string }> };
    expect(cloudflareBody.endpoint).toBe('/mcp');
    expect(cloudflareBody.browserBridgeManifest).toBe('/browser-mcp-manifest.json');
    expect(cloudflareBody.tools.map((tool) => tool.name)).toContain('lupi.render_molecule_asset');
    expect(cloudflareBody.tools.map((tool) => tool.name)).not.toContain('lupi.set_frame');

    expect(browserManifest.schemaVersion).toBe('0.3.0');
    expect(browserManifest.tools.map((tool) => tool.name)).toContain('lupi.set_frame');
    expect(browserManifest.tools.map((tool) => tool.name)).toContain('lupi.export_asset');
  });

  it('returns a JSON-RPC parse error for invalid JSON', async () => {
    const res = await handleRequest(req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }));
    const body = await res.json() as { error: { code: number; message: string } };
    expect(body.error).toMatchObject({ code: -32700, message: 'Parse error' });
  });

  it('does not respond to JSON-RPC notifications', async () => {
    const res = await handleRequest(req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list' }),
    }));
    expect(res.status).toBe(204);
  });

  it('returns a deterministic queued render contract when no renderer is configured', async () => {
    const request = {
      molecule: { inputType: 'template', input: 'Caffeine' },
      asset: { format: 'png', width: 1024, height: 1024 },
      viewer: { cameraPreset: 'iso', showBonds: true },
    };
    const call = async () => {
      const res = await handleRequest(req('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'render-1',
          method: 'tools/call',
          params: { name: 'lupi.render_molecule_asset', arguments: request },
        }),
      }));
      return await res.json() as {
        result: {
          structuredContent: {
            assetId: string;
            status: string;
            renderer: { mode: string; configured: boolean };
            asset: { format: string; mimeType: string; url: string };
          };
        };
      };
    };

    const first = await call();
    const second = await call();
    const content = first.result.structuredContent;
    expect(content.assetId).toBe(second.result.structuredContent.assetId);
    expect(content.status).toBe('awaiting_renderer');
    expect(content.renderer).toMatchObject({ mode: 'unconfigured', configured: false });
    expect(content.asset).toMatchObject({ format: 'png', mimeType: 'image/png' });
  });

  it('keeps REST render, job, and deterministic asset paths in the Worker runtime', async () => {
    const render = await handleRequest(req('/v1/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ molecule: { inputType: 'template', input: 'Caffeine' } }),
    }));
    expect(render.status).toBe(200);
    expect((await render.json() as { status: string }).status).toBe('awaiting_renderer');

    const job = await handleRequest(req('/v1/jobs/job-1'));
    expect(job.status).toBe(200);
    expect(await job.json()).toMatchObject({ jobId: 'job-1', status: 'unknown' });

    const assetId = `sha256-${'a'.repeat(64)}`;
    const asset = await handleRequest(req(`/assets/${assetId}.png`));
    expect(asset.status).toBe(404);
    expect(await asset.json()).toMatchObject({ error: 'Asset not found', assetId });
  });

  it('serves deterministic asset HEAD from metadata without reading object bytes', async () => {
    const assetId = `sha256-${'b'.repeat(64)}`;
    let headCalls = 0;
    let getCalls = 0;
    let arrayBufferCalls = 0;
    const res = await handleRequest(req(`/assets/${assetId}.png`, { method: 'HEAD' }), {
      ASSETS: {
        head: async () => {
          headCalls += 1;
          return {
            size: 321,
            httpMetadata: { contentType: 'image/png' },
            customMetadata: { sha256: 'c'.repeat(64) },
            arrayBuffer: async () => {
              arrayBufferCalls += 1;
              return new ArrayBuffer(321);
            },
          };
        },
        get: async () => {
          getCalls += 1;
          return null;
        },
        put: async () => undefined,
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe('321');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
    expect({ headCalls, getCalls, arrayBufferCalls }).toEqual({ headCalls: 1, getCalls: 0, arrayBufferCalls: 0 });
  });

  it.each([
    ['/health', 'POST', 'GET, HEAD'],
    ['/mcp', 'GET', 'POST'],
    ['/mcp-manifest.json', 'POST', 'GET, HEAD'],
    ['/v1/render', 'GET', 'POST'],
    ['/v1/jobs/job-1', 'POST', 'GET'],
    [`/assets/sha256-${'a'.repeat(64)}.png`, 'POST', 'GET, HEAD'],
  ])('fails closed on unsupported reserved-route methods: %s %s', async (path, method, allow) => {
    const res = await handleRequest(req(path, { method }));
    expect(res.status).toBe(405);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('allow')).toBe(allow);
    expect(res.headers.get('x-lupi-edge-executed')).toBe('1');
    expect(await res.json()).toMatchObject({ error: 'Method not allowed' });
  });

  it.each([
    '/v1',
    '/v1/unknown',
    `/assets/sha256-${'a'.repeat(63)}.png`,
    '/gallery/curated/lupine_genesis.unknown',
    '/gallery/research/hfc/not-allowlisted.glimbin',
  ])('returns structured 404 instead of SPA HTML for reserved namespaces: %s', async (path) => {
    let staticFallbackCalled = false;
    const res = await handleRequest(req(path), {
      WEB_ASSETS: {
        fetch: async () => {
          staticFallbackCalled = true;
          return new Response('<div id="root"></div>', { headers: { 'content-type': 'text/html' } });
        },
      },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('x-lupi-edge-executed')).toBe('1');
    expect(staticFallbackCalled).toBe(false);
  });

  it('sends queued render jobs when waitUntil is unavailable', async () => {
    const sent: unknown[] = [];
    const res = await handleRequest(req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'render-queue',
        method: 'tools/call',
        params: {
          name: 'lupi.render_molecule_asset',
          arguments: { molecule: { inputType: 'template', input: 'Caffeine' } },
        },
      }),
    }), {
      RENDER_QUEUE: {
        send: async (message) => {
          sent.push(message);
        },
      },
    });

    const body = await res.json() as { result: { structuredContent: { status: string; renderer: { mode: string } } } };
    expect(body.result.structuredContent).toMatchObject({ status: 'queued', renderer: { mode: 'queue' } });
    expect(sent).toHaveLength(1);
  });

  it('does not enqueue duplicate work when a sync renderer is used', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      asset: { dataBase64: 'b2s=', mimeType: 'image/png' },
    }), { headers: { 'content-type': 'application/json' } })));

    const res = await handleRequest(req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'render-sync',
        method: 'tools/call',
        params: {
          name: 'lupi.render_molecule_asset',
          arguments: { molecule: { inputType: 'template', input: 'Caffeine' } },
        },
      }),
    }), {
      RENDERER_ENDPOINT: 'https://renderer.lupi.test/render',
      RENDER_QUEUE: {
        send: async (message) => {
          sent.push(message);
        },
      },
    });

    const body = await res.json() as { result: { structuredContent: { status: string; renderer?: { mode: string } } } };
    expect(body.result.structuredContent.status).toBe('complete');
    expect(sent).toHaveLength(0);
  });

  it('requires bearer auth for protected tools when a secret is configured', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'render-auth',
      method: 'tools/call',
      params: {
        name: 'lupi.render_molecule_asset',
        arguments: { molecule: { inputType: 'template', input: 'Caffeine' } },
      },
    });

    const denied = await handleRequest(req('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), {
      LUPI_MCP_SHARED_SECRET: 'secret',
    });
    const deniedBody = await denied.json() as { error?: { message?: string } };
    expect(deniedBody.error?.message).toBe('Unauthorized');

    const allowed = await handleRequest(req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body,
    }), { LUPI_MCP_SHARED_SECRET: 'secret' });
    const allowedBody = await allowed.json() as { result?: unknown };
    expect(allowedBody.result).toBeTruthy();
  });
});
