import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RENDER_ARTIFACT_SPEC_VERSION_V1,
  RENDER_DELIVERY_VERSION_V1,
  RENDER_REQUEST_VERSION_V1,
  createRenderLayerStateV1,
  type RenderDeliveryV1,
  type RenderFormatV1,
  type RenderJsonObjectV1,
  type RenderLayerStateV1,
  type RenderRequestSpecV1,
  type RenderRequestV1,
} from '@atlas/core';
import externalAssetPaths from '../../web/cloudflare-assets-exclude.json';
import browserManifest from '../../web/public/browser-mcp-manifest.json';
import {
  EDGE_RENDER_CAPABILITY_V1,
  MCP_TOOLS,
  handleRequest,
  validateExternalAssetPaths,
} from './index';

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://mcp.lupi.live${path}`, init);
}

const EDGE_ATOMS_VIEW: RenderJsonObjectV1 = {
  camera: { position: [10, 10, 10], target: [0, 0, 0], fov: 45, near: 0.1, far: 10_000 },
  lighting: {
    ambient: 0.6,
    directional: 0.8,
    rim: 0.4,
    keyAzimuth: 45,
    keyElevation: 35,
    fillAzimuth: -45,
    fillElevation: 20,
    rimAzimuth: 135,
    rimElevation: 45,
    fillColor: '#ffffff',
    rimColor: '#ffffff',
    environment: { preset: 'none' },
  },
  postprocess: {
    pipeline: 'raw-scene',
    toneMapping: 'none',
    multisampling: 0,
    outputColorSpace: 'srgb',
  },
  atoms: {
    scale: 1,
    hiddenTypes: [],
    typeScales: {},
    colorSource: 'element',
    colorMode: 'type',
    colorProperty: null,
    colormap: 'viridis',
    uniformColor: '#ffffff',
    elementColorOverrides: {},
    materialPreset: 'matte',
    roughness: 0.6,
    polish: 0,
    propertyRange: [0, 1],
    propertyEmissionStrength: 0,
    materialIntensity: 1,
    texture: 'none',
    clearcoat: 0,
  },
};

function renderRequest(overrides: {
  source?: RenderRequestSpecV1['source'];
  format?: RenderFormatV1;
  width?: number;
  height?: number;
  alpha?: RenderRequestSpecV1['alpha'];
  layers?: RenderLayerStateV1;
  view?: RenderJsonObjectV1;
  delivery?: Partial<RenderDeliveryV1>;
} = {}): RenderRequestV1 {
  return {
    version: RENDER_REQUEST_VERSION_V1,
    spec: {
      version: RENDER_ARTIFACT_SPEC_VERSION_V1,
      source: overrides.source ?? {
        kind: 'reference',
        uri: 'lupi:template/caffeine',
        revision: 'builtin-v1',
      },
      format: overrides.format ?? 'png',
      width: overrides.width ?? 1024,
      height: overrides.height ?? 1024,
      alpha: overrides.alpha ?? 'opaque',
      frame: 0,
      layers: overrides.layers ?? createRenderLayerStateV1(['atoms']),
      view: overrides.view ?? EDGE_ATOMS_VIEW,
    },
    delivery: {
      version: RENDER_DELIVERY_VERSION_V1,
      inline: false,
      maxInlineBytes: 8 * 1024 * 1024,
      sync: false,
      ...overrides.delivery,
    },
  };
}

const CONTENT_SOURCE = {
  kind: 'content',
  mediaType: 'chemical/x-xyz',
  contentDigest: `sha256:${'a'.repeat(64)}`,
} as const;

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
      renderRequestCapability: unknown;
      release?: unknown;
    };
    expect(body.ready).toBe(true);
    expect(body.browserRequired).toBe(false);
    expect(body.toolCount).toBe(6);
    expect(body.renderExecution).toBe(false);
    expect(body.renderRequestCapability).toEqual(EDGE_RENDER_CAPABILITY_V1);
    expect(MCP_TOOLS).toHaveLength(6);
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
      renderProfiles: {
        legacyV0: { execution: boolean; compatibilityOnly: boolean };
        renderRequestV1: { execution: boolean; validationOnly: boolean };
      };
      release: { id: string; tag: string; timestamp: string };
    };

    expect(body.renderExecution).toBe(true);
    expect(body.renderProfiles).toEqual({
      legacyV0: { execution: true, compatibilityOnly: true },
      renderRequestV1: { execution: false, validationOnly: true },
    });
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
    const cloudflareBody = await cloudflare.json() as {
      endpoint: string;
      browserBridgeManifest: string;
      renderRequestCapability: unknown;
      tools: Array<{ name: string }>;
    };
    expect(cloudflareBody.endpoint).toBe('/mcp');
    expect(cloudflareBody.browserBridgeManifest).toBe('/browser-mcp-manifest.json');
    expect(cloudflareBody.tools.map((tool) => tool.name)).toContain('lupi.render_molecule_asset');
    expect(cloudflareBody.tools.map((tool) => tool.name)).not.toContain('lupi.set_frame');
    expect(cloudflareBody.tools).toHaveLength(6);
    expect(cloudflareBody.renderRequestCapability).toEqual(EDGE_RENDER_CAPABILITY_V1);

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

  it('uses canonical request identity while keeping delivery out of that identity', async () => {
    const call = async (request: RenderRequestV1) => {
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
            requestKey: string;
            status: string;
            renderer: { mode: string; configured: boolean };
            output: { format: string; mimeType: string };
          };
        };
      };
    };

    const first = await call(renderRequest());
    const deliveryOnly = await call(renderRequest({
      delivery: {
        inline: true,
        maxInlineBytes: 1024,
        sync: true,
        filename: 'renamed.png',
      },
    }));
    const changedOutput = await call(renderRequest({ width: 1025 }));
    const content = first.result.structuredContent;
    expect(content.requestKey).toMatch(/^request-sha256:[0-9a-f]{64}$/);
    expect(content.requestKey).toBe(deliveryOnly.result.structuredContent.requestKey);
    expect(content.requestKey).not.toBe(changedOutput.result.structuredContent.requestKey);
    expect(content.status).toBe('awaiting_renderer');
    expect(content.renderer).toMatchObject({ mode: 'contract-only', configured: false });
    expect(content.output).toMatchObject({ format: 'png', mimeType: 'image/png' });
    expect(content).not.toHaveProperty('specId');
    expect(content).not.toHaveProperty('artifactKey');
    expect(content).not.toHaveProperty('assetId');
  });

  it('keeps REST render, job, and deterministic asset paths in the Worker runtime', async () => {
    const render = await handleRequest(req('/v1/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(renderRequest()),
    }));
    expect(render.status).toBe(200);
    expect(await render.json()).toMatchObject({
      status: 'awaiting_renderer',
      requestKey: expect.stringMatching(/^request-sha256:[0-9a-f]{64}$/),
    });

    const job = await handleRequest(req('/v1/jobs/job-1'));
    expect(job.status).toBe(200);
    expect(await job.json()).toMatchObject({ jobId: 'job-1', status: 'unknown' });

    const assetId = `sha256-${'a'.repeat(64)}`;
    const asset = await handleRequest(req(`/assets/${assetId}.png`));
    expect(asset.status).toBe(404);
    expect(await asset.json()).toMatchObject({ error: 'Asset not found', assetId });
  });

  it('preserves the legacy molecule request and queue execution profile', async () => {
    const sent: unknown[] = [];
    const legacyRequest = {
      molecule: { inputType: 'template', input: 'Water' },
      asset: { format: 'png', width: 320, height: 240 },
    };
    const res = await handleRequest(req('/v1/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(legacyRequest),
    }), {
      RENDER_QUEUE: { send: async (message) => { sent.push(message); } },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      profile: 'legacy-v0',
      status: 'queued',
      jobId: expect.stringMatching(/^job-[0-9a-f]{24}$/),
      assetId: expect.stringMatching(/^sha256-[0-9a-f]{64}$/),
      renderer: { mode: 'queue', configured: true },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      jobId: body.jobId,
      assetId: body.assetId,
      request: { molecule: { inputType: 'template', input: 'Water' } },
    });
  });

  it('preserves the legacy synchronous renderer and R2 write path', async () => {
    const put = vi.fn(async () => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      asset: { dataBase64: 'b2s=', mimeType: 'image/png' },
    }), { headers: { 'content-type': 'application/json' } })));
    const res = await handleRequest(req('/v1/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        molecule: { inputType: 'template', input: 'Water' },
        asset: { format: 'png', inline: true },
        sync: true,
      }),
    }), {
      RENDERER_ENDPOINT: 'https://renderer.lupi.test/render',
      ASSETS: {
        head: async () => null,
        get: async () => null,
        put,
      },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      profile: 'legacy-v0',
      status: 'complete',
      asset: { dataBase64: 'b2s=', mimeType: 'image/png', byteLength: 2 },
    });
    expect(put).toHaveBeenCalledOnce();
  });

  it.each([
    ['format', renderRequest({ format: 'webp' }), /webp is unsupported/],
    ['alpha', renderRequest({ alpha: 'transparent' }), /transparent is unsupported/],
    [
      'layer',
      renderRequest({
        layers: createRenderLayerStateV1(['atoms', 'bonds']),
        view: {
          ...EDGE_ATOMS_VIEW,
          bonds: {
            tolerance: 0.45,
            colorMode: 'type',
            atomColorSource: 'element',
            atomColorMode: 'type',
            colorProperty: null,
            colormap: 'viridis',
            uniformColor: '#ffffff',
            elementColorOverrides: {},
            materialPreset: 'matte',
            roughness: 0.6,
            polish: 0,
            execution: 'cpu-snapshot-v1',
            materialIntensity: 1,
            clearcoat: 0,
            appliedCount: 0,
          },
        },
      }),
      /enabled layer bonds is unsupported/,
    ],
  ])('rejects unsupported edge %s combinations', async (_kind, request, expected) => {
    const res = await handleRequest(req('/v1/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    }));

    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(expected as RegExp);
  });

  it('reports unsupported MCP render combinations as invalid tool arguments', async () => {
    const res = await handleRequest(req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'unsupported-format',
        method: 'tools/call',
        params: {
          name: 'lupi.render_molecule_asset',
          arguments: renderRequest({ format: 'webp' }),
        },
      }),
    }));

    expect(await res.json()).toMatchObject({
      error: { code: -32602, message: expect.stringMatching(/webp is unsupported/) },
    });
  });

  it('gives content-addressed input a specId but never invents an artifactKey', async () => {
    const res = await handleRequest(req('/v1/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(renderRequest({ source: CONTENT_SOURCE })),
    }));
    const body = await res.json() as Record<string, unknown>;

    expect(body).toMatchObject({
      status: 'awaiting_renderer',
      requestKey: expect.stringMatching(/^request-sha256:[0-9a-f]{64}$/),
      specId: expect.stringMatching(/^spec-sha256:[0-9a-f]{64}$/),
    });
    expect(body).not.toHaveProperty('artifactKey');
  });

  it('never dispatches an unresolved reference source', async () => {
    const sent: unknown[] = [];
    const rendererFetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', rendererFetch);
    const res = await handleRequest(req('/v1/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(renderRequest({ delivery: { sync: true } })),
    }), {
      RENDERER_ENDPOINT: 'https://renderer.lupi.test/render',
      RENDER_QUEUE: { send: async (message) => { sent.push(message); } },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(body).toMatchObject({ status: 'awaiting_renderer' });
    expect(body).not.toHaveProperty('specId');
    expect(body).not.toHaveProperty('artifactKey');
    expect(body).not.toHaveProperty('assetId');
    expect(sent).toHaveLength(0);
    expect(rendererFetch).not.toHaveBeenCalled();
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

  it('does not dispatch or invent artifact identity before a renderer is activated', async () => {
    const sent: unknown[] = [];
    const rendererFetch = vi.fn(async () => new Response(JSON.stringify({
      asset: { dataBase64: 'b2s=', mimeType: 'image/png' },
    }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', rendererFetch);

    const res = await handleRequest(req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'render-contract-only',
        method: 'tools/call',
        params: {
          name: 'lupi.render_molecule_asset',
          arguments: renderRequest({
            source: CONTENT_SOURCE,
            delivery: { sync: true },
          }),
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

    const body = await res.json() as {
      result: { structuredContent: Record<string, unknown> & { renderer?: { mode: string; configured: boolean } } };
    };
    expect(body.result.structuredContent).toMatchObject({
      status: 'awaiting_renderer',
      specId: expect.stringMatching(/^spec-sha256:[0-9a-f]{64}$/),
      renderer: { mode: 'contract-only', configured: false },
    });
    expect(body.result.structuredContent).not.toHaveProperty('artifactKey');
    expect(body.result.structuredContent).not.toHaveProperty('assetId');
    expect(body.result.structuredContent).not.toHaveProperty('jobId');
    expect(sent).toHaveLength(0);
    expect(rendererFetch).not.toHaveBeenCalled();
  });

  it('requires bearer auth for protected tools when a secret is configured', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'render-auth',
      method: 'tools/call',
      params: {
        name: 'lupi.render_molecule_asset',
        arguments: renderRequest(),
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
