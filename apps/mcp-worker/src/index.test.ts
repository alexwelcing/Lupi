import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from './index';

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

  it('collects analytics events on the Cloudflare edge endpoint', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await handleRequest(req('/collectAnalytics', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ event: 'app_landed', sid: 'session-1', ts: 1, props: { atoms: 42 } }),
    }));

    expect(res.status).toBe(204);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('app_landed'));
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

  it('serves the Cloudflare MCP manifest and preserves browser manifest access', async () => {
    const cloudflare = await handleRequest(req('/mcp-manifest.json'));
    const cloudflareBody = await cloudflare.json() as { endpoint: string; browserBridgeManifest: string; tools: Array<{ name: string }> };
    expect(cloudflareBody.endpoint).toBe('/mcp');
    expect(cloudflareBody.browserBridgeManifest).toBe('/browser-mcp-manifest.json');
    expect(cloudflareBody.tools.map((tool) => tool.name)).toContain('lupi.render_molecule_asset');

    const browser = await handleRequest(req('/browser-mcp-manifest.json'), {
      WEB_ASSETS: {
        fetch: async () => new Response('{"schemaVersion":"0.3.0","tools":[]}'),
      },
    });
    const browserBody = await browser.json() as { schemaVersion: string };
    expect(browserBody.schemaVersion).toBe('0.3.0');
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
