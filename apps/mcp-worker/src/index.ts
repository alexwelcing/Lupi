type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface R2ObjectLike {
  size?: number;
  body?: ReadableStream<Uint8Array> | null;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  writeHttpMetadata?: (headers: Headers) => void;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

interface R2GetOptionsLike {
  range?: { offset: number; length?: number } | { suffix: number };
}

interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string, options?: R2GetOptionsLike): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
}

interface FetcherLike {
  fetch(request: Request): Promise<Response>;
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface QueueLike<T> {
  send(message: T): Promise<void>;
}

export interface Env {
  WEB_ASSETS?: FetcherLike;
  ASSETS?: R2BucketLike;
  DB?: D1DatabaseLike;
  RENDER_QUEUE?: QueueLike<RenderQueueMessage>;
  ASSET_BASE_URL?: string;
  CORS_ORIGINS?: string;
  FIREBASE_AUTH_PROXY_HOST?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_WEB_API_KEY?: string;
  LUPI_LARGE_ASSET_BASE_URL?: string;
  LUPI_PUBLIC_ORIGIN?: string;
  LUPI_MCP_SHARED_SECRET?: string;
  RENDERER_ENDPOINT?: string;
  RENDERER_TOKEN?: string;
}

type MoleculeInputType = 'name' | 'template' | 'smiles' | 'xyz' | 'description' | 'procedural';
type AssetFormat = 'png' | 'jpeg' | 'jpg' | 'webp' | 'glb' | 'usdz';

interface RenderMoleculeAssetArgs {
  molecule: {
    inputType?: MoleculeInputType;
    input?: string;
    name?: string;
    smiles?: string;
    xyz?: string;
    atomCount?: number | string;
    element?: string;
    elements?: string[] | string;
    lattice?: 'sc' | 'bcc' | 'fcc' | string;
    spacing?: number | string;
  };
  asset?: {
    format?: AssetFormat;
    width?: number;
    height?: number;
    transparent?: boolean;
    inline?: boolean;
    maxInlineBytes?: number;
  };
  viewer?: Record<string, JsonValue>;
  sync?: boolean;
}

interface RenderQueueMessage {
  jobId: string;
  assetId: string;
  cacheKey: string;
  request: NormalizedRenderRequest;
}

interface NormalizedRenderRequest {
  molecule: Required<Pick<RenderMoleculeAssetArgs['molecule'], 'inputType' | 'input'>> & Record<string, JsonValue>;
  asset: {
    format: Exclude<AssetFormat, 'jpg'>;
    width?: number;
    height?: number;
    transparent: boolean;
    inline: boolean;
    maxInlineBytes: number;
  };
  viewer: Record<string, JsonValue>;
  rendererVersion: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonValue;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const SERVER_VERSION = '2026-07-09.cloudflare-control-plane.0';
const RENDERER_VERSION = 'lupi-render-contract@2026-07-09';
const DEFAULT_MAX_INLINE_BYTES = 8 * 1024 * 1024;
const DEFAULT_FIREBASE_AUTH_PROXY_HOST = 'shed-489901.firebaseapp.com';
const DEFAULT_PUBLIC_ORIGIN = 'https://lupi.live';
const DEFAULT_SOCIAL_IMAGE = '/og-lupi.png';
const MAX_ANALYTICS_BODY_BYTES = 16 * 1024;
const EXTERNAL_ASSET_PATHS = new Set([
  'gallery/curated/lupine_genesis.lammpstrj',
  'gallery/curated/lupine_genesis.glimbin',
  'gallery/research/hfc/r32_nvt_273K.glimbin',
  'gallery/research/hfc/r125_nvt_273K.glimbin',
]);
const ANALYTICS_EVENTS = new Set([
  'app_landed',
  'molecule_loaded',
  'molecule_interacted',
  'signup_start',
  'signup_complete',
  'view_saved',
  'view_shared',
  'view_forked',
  'return_active',
  'render_failed',
  'render_fallback_shown',
]);

export const MCP_TOOLS: ToolDefinition[] = [
  {
    name: 'lupi.status',
    description: 'Report the Cloudflare MCP control plane status, configured bindings, and renderer availability.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lupi.search_molecules',
    description: 'Search the built-in molecule shortcuts exposed by the agent-native MCP control plane.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: 'lupi.render_molecule_asset',
    description: 'Create or retrieve a cached molecule asset render job without launching a browser. Returns asset/job metadata and URLs when available.',
    inputSchema: {
      type: 'object',
      required: ['molecule'],
      properties: {
        molecule: {
          type: 'object',
          properties: {
            inputType: { type: 'string', enum: ['name', 'template', 'smiles', 'xyz', 'description', 'procedural'] },
            input: { type: 'string' },
            name: { type: 'string' },
            smiles: { type: 'string' },
            xyz: { type: 'string' },
            atomCount: { type: ['number', 'string'] },
            element: { type: 'string' },
            elements: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
            lattice: { type: 'string', enum: ['sc', 'bcc', 'fcc'] },
            spacing: { type: ['number', 'string'] },
          },
        },
        asset: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp', 'glb', 'usdz'] },
            width: { type: 'number', minimum: 64, maximum: 4096 },
            height: { type: 'number', minimum: 64, maximum: 4096 },
            transparent: { type: 'boolean' },
            inline: { type: 'boolean' },
            maxInlineBytes: { type: 'number', minimum: 1024, maximum: 67108864 },
          },
        },
        viewer: { type: 'object' },
        sync: { type: 'boolean', description: 'If true and RENDERER_ENDPOINT is configured, try a synchronous backend render.' },
      },
    },
  },
  {
    name: 'lupi.get_render_job',
    description: 'Read render-job status from the D1 job ledger.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: { jobId: { type: 'string', minLength: 1 } },
    },
  },
  {
    name: 'lupi.get_asset',
    description: 'Read cached asset metadata and URL from R2 by assetId.',
    inputSchema: {
      type: 'object',
      required: ['assetId'],
      properties: {
        assetId: { type: 'string', minLength: 1 },
        format: { type: 'string', enum: ['png', 'jpeg', 'jpg', 'webp', 'glb', 'usdz'] },
      },
    },
  },
  {
    name: 'lupi.viewer_manifest',
    description: 'Return the Cloudflare MCP manifest and the browser bridge manifest path for compatibility.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const TEMPLATE_INDEX = [
  { id: 'caffeine', name: 'Caffeine', formula: 'C8H10N4O2', tags: ['template', 'organic', 'alkaloid'] },
  { id: 'aspirin', name: 'Aspirin', formula: 'C9H8O4', tags: ['template', 'organic', 'pharmaceutical'] },
  { id: 'benzene', name: 'Benzene', formula: 'C6H6', tags: ['template', 'organic', 'aromatic'] },
  { id: 'water', name: 'Water', formula: 'H2O', tags: ['template', 'small', 'solvent'] },
  { id: 'copper-fcc', name: '5,000 Cu FCC lattice', formula: 'Cu5000', tags: ['procedural', 'materials', 'fcc'] },
];

export default {
  fetch(request: Request, env: Env, ctx: { waitUntil?: (promise: Promise<unknown>) => void }): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};

export async function handleRequest(
  request: Request,
  env: Env = {},
  ctx: { waitUntil?: (promise: Promise<unknown>) => void } = {},
): Promise<Response> {
  const url = new URL(request.url);
  const cors = corsHeaders(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(statusPayload(env), { headers: cors });
    }

    if (isFirebaseReservedPath(url.pathname)) {
      return withCors(await proxyFirebaseReservedPath(request, env), cors);
    }

    if (url.pathname === '/collectAnalytics' || url.pathname === '/api/analytics') {
      return withCors(await collectAnalytics(request), cors);
    }

    if (url.pathname.startsWith('/view/')) {
      return withCors(await renderSavedViewShare(request, env), cors);
    }

    if (isExternalAssetPath(url.pathname)) {
      return withCors(await proxyExternalAsset(request, env), cors);
    }

    if (request.method === 'GET' && url.pathname === '/browser-mcp-manifest.json' && env.WEB_ASSETS) {
      const assetUrl = new URL('/mcp-manifest.json', url);
      return withCors(await env.WEB_ASSETS.fetch(new Request(assetUrl, request)), cors);
    }

    if (request.method === 'GET' && url.pathname === '/mcp-manifest.json') {
      return json(manifestPayload(), { headers: cors });
    }

    if (request.method === 'POST' && url.pathname === '/mcp') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json(rpcError(null, -32700, 'Parse error'), { headers: cors });
      }
      const result = await handleJsonRpc(body, request, env, ctx);
      if (result === null) return new Response(null, { status: 204, headers: cors });
      return json(result, { headers: cors });
    }

    if (request.method === 'POST' && url.pathname === '/v1/render') {
      await assertAuthorized(request, env);
      const args = await request.json() as RenderMoleculeAssetArgs;
      return json(await renderMoleculeAsset(args, env, ctx), { headers: cors });
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (request.method === 'GET' && jobMatch) {
      await assertAuthorized(request, env);
      return json(await readJob(jobMatch[1], env), { headers: cors });
    }

    const assetMatch = url.pathname.match(/^\/assets\/(sha256-[a-f0-9]{64})\.(png|jpe?g|webp|glb|usdz)$/i);
    if (request.method === 'GET' && assetMatch) {
      const response = await readAssetResponse(assetMatch[1], assetMatch[2] as AssetFormat | undefined, env);
      return withCors(response, cors);
    }

    if (env.WEB_ASSETS && (request.method === 'GET' || request.method === 'HEAD')) {
      return withCors(await env.WEB_ASSETS.fetch(request), cors);
    }

    if (request.method === 'GET' && url.pathname === '/') {
      return json(statusPayload(env), { headers: cors });
    }

    return json({ error: 'Not found', path: url.pathname }, { status: 404, headers: cors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'Unauthorized' ? 401 : 500;
    return json({ error: message }, { status, headers: cors });
  }
}

export async function handleJsonRpc(
  body: unknown,
  request: Request,
  env: Env,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void },
): Promise<unknown | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, -32600, 'Invalid JSON-RPC batch');
    const responses = await Promise.all(body.map((entry) => handleSingleJsonRpc(entry, request, env, ctx)));
    const filtered = responses.filter((entry) => entry !== null);
    return filtered.length > 0 ? filtered : null;
  }
  return handleSingleJsonRpc(body, request, env, ctx);
}

async function handleSingleJsonRpc(
  body: unknown,
  request: Request,
  env: Env,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void },
): Promise<unknown | null> {
  const rpc = body as JsonRpcRequest;
  const hasId = isRecord(body) && Object.prototype.hasOwnProperty.call(body, 'id');
  const id = rpc?.id ?? null;
  const result = (value: unknown) => hasId ? rpcResult(id, value) : null;
  if (!rpc || typeof rpc !== 'object' || typeof rpc.method !== 'string') {
    return rpcError(id, -32600, 'Invalid JSON-RPC request');
  }

  try {
    switch (rpc.method) {
      case 'initialize':
        return result({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'lupi-cloudflare-mcp', version: SERVER_VERSION },
        });
      case 'notifications/initialized':
        return null;
      case 'ping':
        return result({});
      case 'tools/list':
        return result({ tools: MCP_TOOLS.map((tool) => ({ ...tool })) });
      case 'tools/call': {
        const params = rpc.params ?? {};
        const name = typeof params.name === 'string' ? params.name : '';
        const args = isRecord(params.arguments) ? params.arguments : {};
        if (name !== 'lupi.status' && name !== 'lupi.search_molecules' && name !== 'lupi.viewer_manifest') {
          await assertAuthorized(request, env);
        }
        const toolResult = await callTool(name, args, env, ctx);
        return result(toolContent(toolResult));
      }
      default:
        return hasId ? rpcError(id, -32601, `Unsupported JSON-RPC method: ${rpc.method}`) : null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return hasId ? rpcError(id, message === 'Unauthorized' ? -32001 : -32000, message) : null;
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void },
): Promise<unknown> {
  switch (name) {
    case 'lupi.status':
      return statusPayload(env);
    case 'lupi.search_molecules':
      return searchMolecules(args);
    case 'lupi.render_molecule_asset':
      return await renderMoleculeAsset(args as unknown as RenderMoleculeAssetArgs, env, ctx);
    case 'lupi.get_render_job':
      return await readJob(String(args.jobId ?? ''), env);
    case 'lupi.get_asset':
      return await readAssetMetadata(String(args.assetId ?? ''), normalizeFormat(args.format), env);
    case 'lupi.viewer_manifest':
      return manifestPayload();
    default:
      throw new Error(`Unsupported Lupi Cloudflare MCP tool: ${name}`);
  }
}

async function renderMoleculeAsset(
  args: RenderMoleculeAssetArgs,
  env: Env,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void },
) {
  const normalized = normalizeRenderRequest(args);
  const canonical = canonicalJson(normalizeJson(normalized) ?? {});
  const hash = await sha256Hex(canonical);
  const assetId = `sha256-${hash}`;
  const cacheKey = `${assetId}.${normalized.asset.format}`;
  const assetKey = assetObjectKey(assetId, normalized.asset.format);
  const jobId = `job-${hash.slice(0, 24)}`;
  const cached = env.ASSETS ? await env.ASSETS.head(assetKey) : null;

  if (cached) {
    const assetUrl = publicAssetUrl(assetId, normalized.asset.format, env);
    const result = {
      jobId,
      assetId,
      cacheKey,
      status: 'complete',
      cached: true,
      asset: {
        format: normalized.asset.format,
        mimeType: cached.httpMetadata?.contentType ?? mimeForFormat(normalized.asset.format),
        byteLength: cached.size ?? Number(cached.customMetadata?.byteLength ?? 0),
        sha256: cached.customMetadata?.sha256 ?? hash,
        url: assetUrl,
      },
      request: normalized,
    };
    await upsertJob(env, { ...result, status: 'complete', assetKey });
    return result;
  }

  const useSyncRenderer = Boolean(env.RENDERER_ENDPOINT && args.sync !== false);
  const rendererMode = useSyncRenderer ? 'http' : env.RENDER_QUEUE ? 'queue' : 'unconfigured';
  const created = {
    jobId,
    assetId,
    cacheKey,
    status: rendererMode === 'unconfigured' ? 'awaiting_renderer' : 'queued',
    cached: false,
    renderer: {
      mode: rendererMode,
      configured: rendererMode !== 'unconfigured',
    },
    request: normalized,
    asset: {
      format: normalized.asset.format,
      mimeType: mimeForFormat(normalized.asset.format),
      url: publicAssetUrl(assetId, normalized.asset.format, env),
    },
    next: {
      pollTool: 'lupi.get_render_job',
      pollArguments: { jobId },
      message: rendererMode === 'unconfigured'
        ? 'Cloudflare MCP control plane accepted the request, but no renderer backend or queue is configured yet.'
        : 'Render job accepted. Poll lupi.get_render_job or fetch the returned asset URL after completion.',
    },
  };

  await upsertJob(env, { ...created, assetKey });

  if (rendererMode === 'queue' && env.RENDER_QUEUE) {
    const message = { jobId, assetId, cacheKey, request: normalized };
    const send = env.RENDER_QUEUE.send(message).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await updateJobStatus(env, jobId, 'failed', message);
      throw error;
    });
    if (ctx.waitUntil) ctx.waitUntil(send);
    else await send;
  }

  if (useSyncRenderer) {
    const rendered = await trySynchronousRenderer(env, { jobId, assetId, cacheKey, request: normalized, assetKey });
    if (rendered) return rendered;
  }

  return created;
}

function normalizeRenderRequest(args: RenderMoleculeAssetArgs): NormalizedRenderRequest {
  if (!args || !isRecord(args) || !isRecord(args.molecule)) {
    throw new Error('lupi.render_molecule_asset requires a molecule object.');
  }
  const moleculeArgs = args.molecule;
  const input = readString(moleculeArgs.input)
    ?? readString(moleculeArgs.name)
    ?? readString(moleculeArgs.smiles)
    ?? readString(moleculeArgs.xyz)
    ?? 'Caffeine';
  const inputType = readInputType(moleculeArgs.inputType, moleculeArgs) ?? 'template';
  const assetArgs = isRecord(args.asset) ? args.asset : {};
  const format = normalizeFormat(assetArgs.format) ?? 'png';
  const image = format === 'png' || format === 'jpeg' || format === 'webp';
  const width = image ? clampInt(readNumber(assetArgs.width) ?? 1024, 64, 4096) : undefined;
  const height = image ? clampInt(readNumber(assetArgs.height) ?? width ?? 1024, 64, 4096) : undefined;
  return {
    molecule: compactRecord({
      inputType,
      input,
      name: readString(moleculeArgs.name),
      smiles: readString(moleculeArgs.smiles),
      xyz: readString(moleculeArgs.xyz),
      atomCount: normalizeJsonScalar(moleculeArgs.atomCount),
      element: readString(moleculeArgs.element),
      elements: normalizeElements(moleculeArgs.elements),
      lattice: readString(moleculeArgs.lattice),
      spacing: normalizeJsonScalar(moleculeArgs.spacing),
    }) as NormalizedRenderRequest['molecule'],
    asset: {
      format,
      width,
      height,
      transparent: Boolean(assetArgs.transparent),
      inline: Boolean(assetArgs.inline),
      maxInlineBytes: clampInt(readNumber(assetArgs.maxInlineBytes) ?? DEFAULT_MAX_INLINE_BYTES, 1024, 64 * 1024 * 1024),
    },
    viewer: isRecord(args.viewer) ? normalizeRecord(args.viewer) : {},
    rendererVersion: RENDERER_VERSION,
  };
}

async function trySynchronousRenderer(
  env: Env,
  job: { jobId: string; assetId: string; cacheKey: string; request: NormalizedRenderRequest; assetKey: string },
) {
  if (!env.RENDERER_ENDPOINT) return null;
  let payload: { asset?: { dataBase64?: string; mimeType?: string; sha256?: string; byteLength?: number } };
  try {
    const res = await fetch(env.RENDERER_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.RENDERER_TOKEN ? { authorization: `Bearer ${env.RENDERER_TOKEN}` } : {}),
      },
      body: JSON.stringify({ jobId: job.jobId, assetId: job.assetId, request: job.request }),
    });
    if (!res.ok) return await markRenderFailed(env, job, `Renderer HTTP ${res.status}`);
    payload = await res.json() as typeof payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return await markRenderFailed(env, job, message);
  }
  const dataBase64 = payload.asset?.dataBase64;
  if (!dataBase64) return await markRenderFailed(env, job, 'Renderer response did not include asset.dataBase64');
  const bytes = base64ToUint8Array(dataBase64);
  const sha256 = payload.asset?.sha256 ?? await sha256Hex(bytes);
  const mimeType = payload.asset?.mimeType ?? mimeForFormat(job.request.asset.format);
  if (env.ASSETS) {
    await env.ASSETS.put(job.assetKey, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { sha256, byteLength: String(bytes.byteLength), jobId: job.jobId },
    });
  }
  const result = {
    jobId: job.jobId,
    assetId: job.assetId,
    cacheKey: job.cacheKey,
    status: 'complete',
    cached: false,
    asset: {
      format: job.request.asset.format,
      mimeType,
      byteLength: bytes.byteLength,
      sha256,
      url: publicAssetUrl(job.assetId, job.request.asset.format, env),
      dataBase64: job.request.asset.inline && bytes.byteLength <= job.request.asset.maxInlineBytes ? dataBase64 : undefined,
    },
    request: job.request,
  };
  await upsertJob(env, { ...result, status: 'complete', assetKey: job.assetKey });
  return result;
}

async function markRenderFailed(
  env: Env,
  job: { jobId: string; assetId: string; cacheKey: string; request: NormalizedRenderRequest; assetKey: string },
  error: string,
) {
  const result = {
    jobId: job.jobId,
    assetId: job.assetId,
    cacheKey: job.cacheKey,
    status: 'failed',
    cached: false,
    error,
    renderer: { mode: 'http', configured: true },
    asset: {
      format: job.request.asset.format,
      mimeType: mimeForFormat(job.request.asset.format),
      url: publicAssetUrl(job.assetId, job.request.asset.format, env),
    },
    request: job.request,
  };
  await upsertJob(env, { ...result, assetKey: job.assetKey });
  return result;
}

function searchMolecules(args: Record<string, unknown>) {
  const query = String(args.query ?? args.text ?? '').trim().toLowerCase();
  const limit = clampInt(readNumber(args.limit) ?? 10, 1, 25);
  const hits = TEMPLATE_INDEX
    .filter((item) => !query || item.name.toLowerCase().includes(query) || item.formula.toLowerCase().includes(query) || item.tags.some((tag) => tag.includes(query)))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      load: item.id === 'copper-fcc'
        ? { molecule: { inputType: 'procedural', input: item.name, atomCount: 5000, element: 'Cu', lattice: 'fcc' } }
        : { molecule: { inputType: 'template', input: item.name } },
    }));
  return { query, returned: hits.length, molecules: hits };
}

async function readJob(jobId: string, env: Env) {
  if (!jobId) throw new Error('jobId is required.');
  if (!env.DB) return { jobId, status: 'unknown', message: 'D1 binding DB is not configured.' };
  const row = await env.DB.prepare('SELECT * FROM render_jobs WHERE id = ?').bind(jobId).first<Record<string, unknown>>();
  return row ?? { jobId, status: 'not_found' };
}

async function readAssetMetadata(assetId: string, format: Exclude<AssetFormat, 'jpg'> | undefined, env: Env) {
  if (!assetId) throw new Error('assetId is required.');
  const safeFormat = format ?? 'png';
  const key = assetObjectKey(assetId, safeFormat);
  const object = env.ASSETS ? await env.ASSETS.head(key) : null;
  return {
    assetId,
    format: safeFormat,
    status: object ? 'available' : 'missing',
    url: object ? publicAssetUrl(assetId, safeFormat, env) : null,
    byteLength: object?.size ?? null,
    mimeType: object?.httpMetadata?.contentType ?? mimeForFormat(safeFormat),
    sha256: object?.customMetadata?.sha256 ?? null,
  };
}

async function readAssetResponse(assetId: string, rawFormat: AssetFormat | undefined, env: Env) {
  const format = normalizeFormat(rawFormat) ?? 'png';
  const key = assetObjectKey(assetId, format);
  const object = env.ASSETS ? await env.ASSETS.get(key) : null;
  if (!object) return json({ error: 'Asset not found', assetId, format }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set('etag', object.customMetadata?.sha256 ?? assetId);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(await object.arrayBuffer?.(), { headers });
}

async function upsertJob(env: Env, job: Record<string, unknown>) {
  if (!env.DB) return;
  const requestJson = JSON.stringify(job.request ?? {});
  await env.DB.prepare(`
    INSERT INTO render_jobs (id, asset_id, cache_key, status, request_json, asset_key, mime_type, byte_length, sha256, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      request_json = excluded.request_json,
      asset_key = excluded.asset_key,
      mime_type = excluded.mime_type,
      byte_length = excluded.byte_length,
      sha256 = excluded.sha256,
      error = excluded.error,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    job.jobId,
    job.assetId,
    job.cacheKey,
    job.status,
    requestJson,
    job.assetKey ?? null,
    (job.asset as Record<string, unknown> | undefined)?.mimeType ?? null,
    (job.asset as Record<string, unknown> | undefined)?.byteLength ?? null,
    (job.asset as Record<string, unknown> | undefined)?.sha256 ?? null,
    job.error ?? null,
  ).run();
}

async function updateJobStatus(env: Env, jobId: string, status: string, error?: string) {
  if (!env.DB) return;
  await env.DB.prepare('UPDATE render_jobs SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(status, error ?? null, jobId)
    .run();
}

function statusPayload(env: Env) {
  return {
    ready: true,
    name: 'lupi-cloudflare-edge',
    version: SERVER_VERSION,
    toolCount: MCP_TOOLS.length,
    agentNative: true,
    browserRequired: false,
    bindings: {
      webAssets: Boolean(env.WEB_ASSETS),
      r2: Boolean(env.ASSETS),
      d1: Boolean(env.DB),
      queue: Boolean(env.RENDER_QUEUE),
      rendererEndpoint: Boolean(env.RENDERER_ENDPOINT),
      firebaseProject: Boolean(env.FIREBASE_PROJECT_ID),
      largeAssetProxy: Boolean(env.LUPI_LARGE_ASSET_BASE_URL || env.ASSET_BASE_URL),
      authRequired: Boolean(env.LUPI_MCP_SHARED_SECRET),
    },
  };
}

function manifestPayload() {
  return {
    schemaVersion: '0.1.0',
    server: { name: 'lupi-cloudflare-mcp', version: SERVER_VERSION },
    endpoint: '/mcp',
    protocol: 'MCP JSON-RPC over HTTP',
    browserBridgeManifest: '/browser-mcp-manifest.json',
    tools: MCP_TOOLS,
  };
}

function toolContent(value: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

async function assertAuthorized(request: Request, env: Env) {
  const secret = env.LUPI_MCP_SHARED_SECRET;
  if (!secret) return;
  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) throw new Error('Unauthorized');
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function json(value: unknown, init: ResponseInit & { headers?: HeadersInit } = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value, null, 2) + '\n', { ...init, headers });
}

function withCors(response: Response, cors: Headers) {
  const headers = new Headers(response.headers);
  cors.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsHeaders(request: Request, env: Env) {
  const headers = new Headers();
  const origin = request.headers.get('origin') ?? '*';
  const allowed = env.CORS_ORIGINS?.split(',').map((entry) => entry.trim()).filter(Boolean);
  headers.set('access-control-allow-origin', !allowed?.length || allowed.includes(origin) ? origin : allowed[0]);
  headers.set('vary', 'origin');
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,authorization,mcp-session-id');
  headers.set('access-control-expose-headers', 'content-type,etag');
  return headers;
}

function readInputType(value: unknown, molecule: Record<string, unknown>): MoleculeInputType | undefined {
  if (value === 'name' || value === 'template' || value === 'smiles' || value === 'xyz' || value === 'description' || value === 'procedural') return value;
  if (molecule.atomCount !== undefined || molecule.lattice !== undefined) return 'procedural';
  if (molecule.smiles !== undefined) return 'smiles';
  if (molecule.xyz !== undefined) return 'xyz';
  return undefined;
}

function normalizeFormat(value: unknown): Exclude<AssetFormat, 'jpg'> | undefined {
  const raw = typeof value === 'string' ? value.toLowerCase() : undefined;
  if (raw === 'jpg') return 'jpeg';
  return raw === 'png' || raw === 'jpeg' || raw === 'webp' || raw === 'glb' || raw === 'usdz' ? raw : undefined;
}

function mimeForFormat(format: Exclude<AssetFormat, 'jpg'>) {
  switch (format) {
    case 'png': return 'image/png';
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'glb': return 'model/gltf-binary';
    case 'usdz': return 'model/vnd.usdz+zip';
  }
}

function assetObjectKey(assetId: string, format: Exclude<AssetFormat, 'jpg'>) {
  return `assets/${assetId}.${format === 'jpeg' ? 'jpg' : format}`;
}

function publicAssetUrl(assetId: string, format: Exclude<AssetFormat, 'jpg'>, env: Env) {
  const base = env.ASSET_BASE_URL?.replace(/\/$/, '');
  const ext = format === 'jpeg' ? 'jpg' : format;
  return base ? `${base}/assets/${assetId}.${ext}` : `/assets/${assetId}.${ext}`;
}

function isFirebaseReservedPath(pathname: string) {
  return pathname.startsWith('/__/auth/') || pathname.startsWith('/__/firebase/');
}

function isExternalAssetPath(pathname: string) {
  return EXTERNAL_ASSET_PATHS.has(pathname.replace(/^\/+/, ''));
}

async function proxyExternalAsset(request: Request, env: Env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const source = new URL(request.url);
  const objectPath = source.pathname.replace(/^\/+/, '');
  const r2Response = await readLargeAssetFromR2(objectPath, request, env);
  if (r2Response) return r2Response;

  const base = (env.LUPI_LARGE_ASSET_BASE_URL || env.ASSET_BASE_URL)?.replace(/\/+$/, '');
  if (!base) {
    return json({ error: 'External asset storage is not configured.' }, { status: 503 });
  }
  const target = new URL(`${base}/${objectPath}`);
  target.search = source.search;
  const headers = new Headers();
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  const response = await fetch(target, { method: request.method, headers });
  const out = new Headers(response.headers);
  out.set('cache-control', response.ok ? 'public, max-age=31536000, immutable' : 'no-cache');
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: out,
  });
}

async function readLargeAssetFromR2(objectPath: string, request: Request, env: Env) {
  if (!env.ASSETS) return null;
  const head = await env.ASSETS.head(objectPath);
  if (!head) return null;

  const headers = new Headers();
  head.writeHttpMetadata?.(headers);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('content-type', headers.get('content-type') || contentTypeForObjectPath(objectPath));

  const size = head.size ?? Number(head.customMetadata?.byteLength ?? 0);
  const range = parseSingleByteRange(request.headers.get('range'), size);
  if (range?.unsatisfiable) {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (request.method === 'HEAD') {
    if (size > 0) headers.set('content-length', String(size));
    return new Response(null, { headers });
  }

  const object = await env.ASSETS.get(objectPath, range?.r2 ? { range: range.r2 } : undefined);
  if (!object) return null;
  const body = object.body ?? (object.arrayBuffer ? await object.arrayBuffer() : null);
  if (range?.contentRange) {
    headers.set('content-range', range.contentRange);
    headers.set('content-length', String(range.length));
    return new Response(body, { status: 206, headers });
  }
  if (size > 0) headers.set('content-length', String(size));
  return new Response(body, { headers });
}

function parseSingleByteRange(header: string | null, size: number) {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const suffix = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    const length = Math.min(size, suffix);
    const start = size - length;
    const end = size - 1;
    return {
      r2: { suffix: length },
      contentRange: `bytes ${start}-${end}/${size}`,
      length,
    };
  }
  const start = Number.parseInt(match[1], 10);
  const requestedEnd = match[2] === '' ? size - 1 : Number.parseInt(match[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start >= size || requestedEnd < start) {
    return { unsatisfiable: true };
  }
  const end = Math.min(size - 1, requestedEnd);
  const length = end - start + 1;
  return {
    r2: { offset: start, length },
    contentRange: `bytes ${start}-${end}/${size}`,
    length,
  };
}

function contentTypeForObjectPath(objectPath: string) {
  if (objectPath.endsWith('.lammpstrj') || objectPath.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (objectPath.endsWith('.glimbin')) return 'application/octet-stream';
  return 'application/octet-stream';
}

async function proxyFirebaseReservedPath(request: Request, env: Env) {
  const source = new URL(request.url);
  const host = env.FIREBASE_AUTH_PROXY_HOST || DEFAULT_FIREBASE_AUTH_PROXY_HOST;
  const target = new URL(`${source.pathname}${source.search}`, `https://${host}`);
  const headers = new Headers(request.headers);
  headers.delete('host');
  return await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
}

async function collectAnalytics(request: Request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }) + '\n', {
      status: 405,
      headers: { allow: 'POST, OPTIONS', 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_ANALYTICS_BODY_BYTES) return new Response(null, { status: 413 });

  try {
    const raw = new TextDecoder().decode(body);
    const parsed = raw.trim() ? JSON.parse(raw) : null;
    const events = Array.isArray(parsed) ? parsed : [parsed];
    for (const event of events) {
      const sanitized = sanitizeAnalyticsEvent(event);
      if (sanitized) console.log(JSON.stringify({ component: 'lupi_analytics', ...sanitized }));
    }
  } catch (error) {
    console.warn('analytics_collect_failed', error instanceof Error ? error.message : String(error));
  }

  return new Response(null, { status: 204 });
}

function sanitizeAnalyticsEvent(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const event = typeof raw.event === 'string' ? raw.event : '';
  if (!ANALYTICS_EVENTS.has(event)) return null;
  return compactRecord({
    event,
    sid: typeof raw.sid === 'string' ? raw.sid.slice(0, 64) : undefined,
    ts: typeof raw.ts === 'number' && Number.isFinite(raw.ts) ? raw.ts : undefined,
    isReturning: typeof raw.isReturning === 'boolean' ? raw.isReturning : undefined,
    utm: isRecord(raw.utm) ? raw.utm : undefined,
    props: isRecord(raw.props) ? raw.props : undefined,
    path: typeof raw.path === 'string' ? raw.path.slice(0, 200) : undefined,
  });
}

async function renderSavedViewShare(request: Request, env: Env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  const url = new URL(request.url);
  const slug = savedViewSlugFromPath(url.pathname);
  const publicOrigin = env.LUPI_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN;
  let status = 404;
  let model = buildMissingViewShareModel(slug || 'saved-view', publicOrigin);
  let redirectToApp = false;

  if (slug) {
    try {
      const doc = await readSavedViewDoc(slug, env);
      if (doc?.visibility === 'public') {
        status = 200;
        model = buildSavedViewShareModel(slug, doc, publicOrigin);
        redirectToApp = true;
      }
    } catch (error) {
      status = 500;
      console.error('lupi_view_share_failed', JSON.stringify({ slug, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'x-robots-tag': model.robots,
    'cache-control': status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-cache',
  });
  return new Response(request.method === 'HEAD' ? null : renderSavedViewShareHtml(model, redirectToApp), { status, headers });
}

function savedViewSlugFromPath(pathname: string) {
  const match = pathname.match(/^\/view\/([^/?#]+)/i);
  if (!match?.[1]) return null;
  try {
    return cleanSlug(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

async function readSavedViewDoc(slug: string, env: Env): Promise<Record<string, unknown> | null> {
  if (!env.FIREBASE_PROJECT_ID) return null;
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/lupiViews/${encodeURIComponent(slug)}`);
  if (env.FIREBASE_WEB_API_KEY) url.searchParams.set('key', env.FIREBASE_WEB_API_KEY);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Firestore REST ${response.status}`);
  const doc = await response.json() as { fields?: Record<string, unknown> };
  return firestoreFields(doc.fields ?? {});
}

function firestoreFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = firestoreValue(value);
  return out;
}

function firestoreValue(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if (isRecord(value.mapValue)) return firestoreFields(asRecord(value.mapValue.fields) ?? {});
  if (isRecord(value.arrayValue)) {
    const values = Array.isArray(value.arrayValue.values) ? value.arrayValue.values : [];
    return values.map(firestoreValue);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function buildSavedViewShareModel(slug: string, doc: Record<string, unknown>, publicOrigin: string) {
  const clean = cleanSlug(readString(doc.slug) || slug) || slug;
  const origin = normalizeOrigin(publicOrigin);
  const title = clip(cleanText(readString(doc.title) || titleFromSlug(clean)), 92);
  const molecule = asRecord(doc.molecule);
  const atomCount = typeof molecule?.atomCount === 'number' ? molecule.atomCount : null;
  const prefix = readString(molecule?.name) ? `${clip(cleanText(String(molecule?.name)), 72)}: ` : '';
  const stats = atomCount && atomCount > 0 ? `${new Intl.NumberFormat('en-US').format(Math.round(atomCount))} atoms in ` : '';
  const description = clip(`${prefix}${stats}a browser-shareable Lupi molecular view with a live 3D scene.`, 220);
  return {
    appUrl: `${origin}/#/view/${encodeURIComponent(clean)}`,
    description,
    imageAlt: `${title} in the Lupi molecular viewer.`,
    imageUrl: `${origin}${DEFAULT_SOCIAL_IMAGE}`,
    pageTitle: `${title} | Lupi`,
    robots: 'index,follow,max-image-preview:large',
    shareUrl: `${origin}/view/${encodeURIComponent(clean)}`,
    title,
  };
}

function buildMissingViewShareModel(slug: string, publicOrigin: string) {
  const clean = cleanSlug(slug) || 'saved-view';
  const origin = normalizeOrigin(publicOrigin);
  return {
    appUrl: origin,
    description: 'Open shareable molecular and materials scenes in the browser with Lupi.',
    imageAlt: 'Lupi molecular viewer title card from Lupine Science.',
    imageUrl: `${origin}${DEFAULT_SOCIAL_IMAGE}`,
    pageTitle: 'Lupi saved view not found',
    robots: 'noindex,nofollow,max-image-preview:large',
    shareUrl: `${origin}/view/${encodeURIComponent(clean)}`,
    title: 'Lupi saved view not found',
  };
}

function renderSavedViewShareHtml(model: ReturnType<typeof buildSavedViewShareModel>, redirectToApp: boolean) {
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: model.title,
    description: model.description,
    url: model.shareUrl,
    image: model.imageUrl,
    isPartOf: { '@type': 'WebApplication', name: 'Lupi', url: normalizeOrigin(new URL(model.shareUrl).origin) },
  }, null, 2).replace(/</g, '\\u003c');
  const redirectScript = redirectToApp ? `<script>(()=>{const ua=navigator.userAgent||'';const bot=/(bot|crawler|spider|slurp|preview|facebookexternalhit|linkedinbot|twitterbot|discordbot|telegrambot|whatsapp|pinterest)/i.test(ua);if(!bot)window.location.replace(${JSON.stringify(model.appUrl)});})();</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(model.pageTitle)}</title>
  <meta name="description" content="${escapeHtml(model.description)}">
  <meta name="robots" content="${escapeHtml(model.robots)}">
  <meta property="og:site_name" content="Lupi">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(model.title)}">
  <meta property="og:description" content="${escapeHtml(model.description)}">
  <meta property="og:url" content="${escapeHtml(model.shareUrl)}">
  <meta property="og:image" content="${escapeHtml(model.imageUrl)}">
  <meta property="og:image:alt" content="${escapeHtml(model.imageAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(model.title)}">
  <meta name="twitter:description" content="${escapeHtml(model.description)}">
  <meta name="twitter:image" content="${escapeHtml(model.imageUrl)}">
  <link rel="canonical" href="${escapeHtml(model.shareUrl)}">
  <script type="application/ld+json">${jsonLd}</script>
  ${redirectScript}
</head>
<body style="margin:0;background:#06080d;color:#f4efe5;font-family:Inter,ui-sans-serif,system-ui,sans-serif">
  <main style="min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box">
    <section style="width:min(620px,100%);border:1px solid rgba(244,239,229,.22);border-radius:8px;padding:20px;background:linear-gradient(145deg,rgba(6,8,8,.96),rgba(18,22,22,.94))">
      <h1>${escapeHtml(model.title)}</h1>
      <p>${escapeHtml(model.description)}</p>
      <a style="color:#120c05;background:#f2aa45;padding:12px 16px;border-radius:8px;font-weight:800;text-decoration:none" href="${escapeHtml(model.appUrl)}">Open in Lupi</a>
    </section>
  </main>
</body>
</html>`;
}

function cleanSlug(value: string): string {
  return value.trim().toLowerCase().replace(/['"`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function titleFromSlug(slug: string): string {
  return slug.split('-').filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ') || 'Lupi saved view';
}

function normalizeOrigin(value: string): string {
  return (value || DEFAULT_PUBLIC_ORIGIN).replace(/\/+$/, '');
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}...`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function normalizeElements(value: unknown): JsonValue | undefined {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value === 'string') return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return undefined;
}

function normalizeJsonScalar(value: unknown): JsonValue | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return typeof value === 'string' || typeof value === 'boolean' || value === null ? value : undefined;
}

function normalizeRecord(record: Record<string, unknown>): Record<string, JsonValue> {
  return compactRecord(record) as Record<string, JsonValue>;
}

function compactRecord(record: Record<string, unknown>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    const normalized = normalizeJson(value);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function normalizeJson(value: unknown): JsonValue | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeJson).filter((entry): entry is JsonValue => entry !== undefined);
  if (isRecord(value)) return compactRecord(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const source: BufferSource = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64ToUint8Array(base64: string) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
