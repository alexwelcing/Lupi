import externalAssetPathConfig from '../../web/cloudflare-assets-exclude.json';
import {
  MAX_INLINE_BYTES_V1,
  MAX_RASTER_DIMENSION_V1,
  MIN_INLINE_BYTES_V1,
  MIN_RASTER_DIMENSION_V1,
  RENDER_ARTIFACT_SPEC_VERSION_V1,
  RENDER_CAPABILITY_VERSION_V1,
  RENDER_DELIVERY_VERSION_V1,
  RENDER_FORMAT_RULES_V1,
  RENDER_LAYER_REGISTRY_V1,
  RENDER_REQUEST_VERSION_V1,
  RenderArtifactValidationError,
  computeRenderRequestKeyV1,
  computeRenderSpecIdV1,
  getElementSpecBySymbol,
  validateRenderCapabilityV1,
  validateRenderRequestV1,
  type RenderCapabilityV1,
  type RenderRequestSpecV1,
} from '@atlas/core';

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
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      onlyIf?: { etagDoesNotMatch?: string };
    },
  ): Promise<unknown | null>;
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

interface WorkerVersionMetadata {
  id: string;
  tag: string;
  timestamp: string;
}

export interface Env {
  WEB_ASSETS?: FetcherLike;
  ASSETS?: R2BucketLike;
  /** Private, bearer-gated render receipts and bytes. Never bind this bucket
   * to a public custom domain. */
  RENDER_ASSETS?: R2BucketLike;
  DB?: D1DatabaseLike;
  RENDER_QUEUE?: QueueLike<LegacyRenderQueueMessage>;
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
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

type MoleculeInputType = 'name' | 'template' | 'smiles' | 'xyz' | 'description' | 'procedural';
type AssetFormat = 'png' | 'jpeg' | 'jpg' | 'webp' | 'glb' | 'usdz';

interface LegacyRenderMoleculeAssetArgs {
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

interface LegacyNormalizedRenderRequest {
  molecule: Required<Pick<LegacyRenderMoleculeAssetArgs['molecule'], 'inputType' | 'input'>> & Record<string, JsonValue>;
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

interface LegacyRenderQueueMessage {
  jobId: string;
  assetId: string;
  cacheKey: string;
  request: LegacyNormalizedRenderRequest;
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

const SERVER_VERSION = '2026-07-20.authenticated-render.1';
const LEGACY_RENDERER_VERSION = 'lupi-render-contract@2026-07-09';
const LEGACY_DEFAULT_MAX_INLINE_BYTES = 8 * 1024 * 1024;
const PRIVATE_RENDER_REQUEST_PROTOCOL = 'lupi.renderer-request.legacy-v0.1';
const PRIVATE_RENDER_RESPONSE_PROTOCOL = 'lupi.renderer-response.legacy-v0.1';
const PRIVATE_RENDER_JOB_PREFIX = 'render-v0/jobs/';
const PRIVATE_RENDER_ASSET_PREFIX = 'render-v0/assets/';
const PRIVATE_RENDER_MAX_DIMENSION = 2048;
const PRIVATE_RENDER_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const PRIVATE_RENDER_DEADLINE_MS = 90_000;
const PRIVATE_RENDER_JOB_ID_PATTERN = /^job-v0-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_RENDER_TEMPLATES = new Map([
  ['water', 'Water'],
  ['benzene', 'Benzene'],
  ['caffeine', 'Caffeine'],
]);
const DEFAULT_FIREBASE_AUTH_PROXY_HOST = 'shed-489901.firebaseapp.com';
const DEFAULT_PUBLIC_ORIGIN = 'https://lupi.live';
const DEFAULT_SOCIAL_IMAGE = '/og-lupi.png';
const MAX_ANALYTICS_BODY_BYTES = 16 * 1024;
const EXTERNAL_ASSET_PATHS = new Set(validateExternalAssetPaths(externalAssetPathConfig));
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

class RenderServiceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderServiceConfigurationError';
  }
}

class RendererProtocolError extends Error {
  jobId?: string;

  constructor(message: string, jobId?: string) {
    super(message);
    this.name = 'RendererProtocolError';
    this.jobId = jobId;
  }
}

/**
 * Submission capability for the pre-renderer edge seam. It intentionally
 * accepts only bounded opaque PNG atom renders. A future activated V1
 * renderer may widen formats, alpha modes, or layers only after proving them.
 */
export const EDGE_RENDER_CAPABILITY_V1: RenderCapabilityV1 = validateRenderCapabilityV1({
  version: RENDER_CAPABILITY_VERSION_V1,
  formats: {
    png: {
      enabled: true,
      alphaModes: ['opaque'],
      maxWidth: MAX_RASTER_DIMENSION_V1,
      maxHeight: MAX_RASTER_DIMENSION_V1,
    },
    jpeg: { enabled: false, alphaModes: [] },
    webp: { enabled: false, alphaModes: [] },
    glb: { enabled: false, alphaModes: [] },
    usdz: { enabled: false, alphaModes: [] },
  },
  layers: {
    background: false,
    atoms: true,
    vectorGlyphs: false,
    atomClusters: false,
    bonds: false,
    simulationCell: false,
    filterShell: false,
    moleculeShadow: false,
    contactShadows: false,
    ghostAtoms: false,
    annotations: false,
    knowledgeLabels: false,
    selectionMarkers: false,
    atomTrails: false,
    axes: false,
    scaleBar: false,
  },
});

const EDGE_RENDER_LAYER_IDS = Object.keys(RENDER_LAYER_REGISTRY_V1);
const EDGE_RENDER_LAYER_SCHEMA = Object.fromEntries(
  EDGE_RENDER_LAYER_IDS.map((layer): [string, JsonValue] => [
    layer,
    (layer === 'atoms'
      ? { const: true }
      : { const: false }) as JsonValue,
  ]),
);

const NUMBER_SCHEMA: JsonValue = { type: 'number' };
const TUPLE3_SCHEMA: JsonValue = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: NUMBER_SCHEMA,
};

const EDGE_RENDER_VIEW_SCHEMA_V1: JsonValue = {
  type: 'object',
  additionalProperties: false,
  required: ['camera', 'lighting', 'postprocess', 'atoms'],
  properties: {
    camera: {
      type: 'object',
      additionalProperties: false,
      required: ['position', 'target', 'fov'],
      properties: {
        position: TUPLE3_SCHEMA,
        target: TUPLE3_SCHEMA,
        fov: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 180 },
      },
    },
    lighting: {
      type: 'object',
      additionalProperties: false,
      required: [
        'ambient', 'directional', 'rim', 'keyAzimuth', 'keyElevation',
        'fillAzimuth', 'fillElevation', 'rimAzimuth', 'rimElevation',
        'fillColor', 'rimColor', 'environment',
      ],
      properties: {
        ambient: { type: 'number', minimum: 0, maximum: 4 },
        directional: { type: 'number', minimum: 0, maximum: 4 },
        rim: { type: 'number', minimum: 0, maximum: 4 },
        keyAzimuth: { type: 'number', minimum: -360, maximum: 360 },
        keyElevation: { type: 'number', minimum: -90, maximum: 90 },
        fillAzimuth: { type: 'number', minimum: -360, maximum: 360 },
        fillElevation: { type: 'number', minimum: -90, maximum: 90 },
        rimAzimuth: { type: 'number', minimum: -360, maximum: 360 },
        rimElevation: { type: 'number', minimum: -90, maximum: 90 },
        fillColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        rimColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        environment: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['preset'],
              properties: { preset: { const: 'none' } },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['preset', 'assetRevision', 'file', 'colorSpace'],
              properties: {
                preset: { enum: ['city', 'studio', 'dawn', 'night', 'warehouse', 'forest', 'apartment', 'park'] },
                assetRevision: { type: 'string', pattern: '^[0-9a-f]{40,64}$' },
                file: { type: 'string', minLength: 1 },
                colorSpace: { const: 'srgb-linear' },
              },
            },
          ],
        },
      },
    },
    postprocess: {
      type: 'object',
      additionalProperties: false,
      required: ['pipeline', 'toneMapping', 'multisampling', 'outputColorSpace'],
      properties: {
        pipeline: { const: 'raw-scene' },
        toneMapping: { const: 'none' },
        multisampling: { const: 0 },
        outputColorSpace: { const: 'srgb' },
      },
    },
    atoms: {
      type: 'object',
      additionalProperties: false,
      required: [
        'scale', 'hiddenTypes', 'typeScales', 'colorSource', 'colorMode',
        'colorProperty', 'colormap', 'uniformColor', 'elementColorOverrides',
        'materialPreset', 'roughness', 'polish', 'propertyRange', 'propertyEmissionStrength',
        'materialIntensity', 'texture', 'clearcoat',
      ],
      properties: {
        scale: { type: 'number', minimum: 0.1, maximum: 8 },
        hiddenTypes: {
          type: 'array',
          uniqueItems: true,
          items: { type: 'integer', minimum: 1, maximum: 255 },
        },
        typeScales: {
          type: 'object',
          propertyNames: { pattern: '^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$' },
          additionalProperties: { type: 'number', minimum: 0.1, maximum: 8 },
        },
        colorSource: { enum: ['colormap', 'element'] },
        colorMode: { enum: ['type', 'property', 'uniform'] },
        colorProperty: {
          oneOf: [
            { type: 'string', minLength: 1, maxLength: 64 },
            { type: 'null' },
          ],
        },
        colormap: {
          enum: [
            'viridis', 'inferno', 'coolwarm', 'plasma', 'magma', 'cividis', 'neon',
            'sunset', 'vaporwave', 'ocean', 'fire', 'ice', 'forest', 'cyberpunk',
            'autumn', 'grayscale', 'turbo',
          ],
        },
        uniformColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        elementColorOverrides: {
          type: 'object',
          propertyNames: { pattern: '^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$' },
          additionalProperties: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        },
        materialPreset: { enum: ['default', 'matte', 'metallic', 'glass', 'plastic'] },
        roughness: { type: 'number', minimum: -1, maximum: 1 },
        polish: { type: 'number', minimum: -1, maximum: 1 },
        propertyRange: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: NUMBER_SCHEMA,
        },
        propertyEmissionStrength: { type: 'number', minimum: 0, maximum: 1 },
        materialIntensity: { type: 'number', minimum: 0, maximum: 1 },
        texture: { enum: ['none', 'scratched', 'noise'] },
        clearcoat: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
  },
};

const RENDER_REQUEST_V1_INPUT_SCHEMA: JsonValue = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'spec', 'delivery'],
  properties: {
    version: { const: RENDER_REQUEST_VERSION_V1 },
    spec: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'source', 'format', 'width', 'height', 'alpha', 'frame', 'layers', 'view'],
      properties: {
        version: { const: RENDER_ARTIFACT_SPEC_VERSION_V1 },
        source: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'mediaType', 'contentDigest'],
              properties: {
                kind: { const: 'content' },
                mediaType: { type: 'string' },
                contentDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'uri'],
              properties: {
                kind: { const: 'reference' },
                uri: { type: 'string' },
                revision: { type: 'string' },
              },
            },
          ],
        },
        format: { type: 'string', enum: ['png'] },
        width: { type: 'integer', minimum: MIN_RASTER_DIMENSION_V1, maximum: MAX_RASTER_DIMENSION_V1 },
        height: { type: 'integer', minimum: MIN_RASTER_DIMENSION_V1, maximum: MAX_RASTER_DIMENSION_V1 },
        alpha: { type: 'string', enum: ['opaque'] },
        frame: { type: 'integer', minimum: 0 },
        layers: {
          type: 'object',
          additionalProperties: false,
          required: EDGE_RENDER_LAYER_IDS,
          properties: EDGE_RENDER_LAYER_SCHEMA,
        },
        view: EDGE_RENDER_VIEW_SCHEMA_V1,
      },
    },
    delivery: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'inline', 'maxInlineBytes', 'sync'],
      properties: {
        version: { const: RENDER_DELIVERY_VERSION_V1 },
        inline: { type: 'boolean' },
        maxInlineBytes: { type: 'integer', minimum: MIN_INLINE_BYTES_V1, maximum: MAX_INLINE_BYTES_V1 },
        sync: { type: 'boolean' },
        filename: { type: 'string' },
      },
    },
  },
};

const LEGACY_RENDER_REQUEST_INPUT_SCHEMA: JsonValue = {
  type: 'object',
  additionalProperties: false,
  required: ['molecule'],
  properties: {
    molecule: {
      type: 'object',
      additionalProperties: false,
      required: ['inputType'],
      anyOf: [{ required: ['input'] }, { required: ['name'] }],
      properties: {
        inputType: { type: 'string', enum: ['template', 'procedural'] },
        input: { type: 'string', minLength: 1, maxLength: 160 },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        atomCount: { type: 'integer', minimum: 1, maximum: 100000 },
        element: { type: 'string', pattern: '^[A-Z][a-z]?$' },
        lattice: { type: 'string', enum: ['sc', 'bcc', 'fcc'] },
        spacing: { type: 'number', minimum: 0.1, maximum: 20 },
      },
    },
    asset: {
      type: 'object',
      additionalProperties: false,
      properties: {
        format: { const: 'png' },
        width: { type: 'integer', minimum: 64, maximum: PRIVATE_RENDER_MAX_DIMENSION },
        height: { type: 'integer', minimum: 64, maximum: PRIVATE_RENDER_MAX_DIMENSION },
        transparent: { const: false },
        inline: { type: 'boolean' },
        maxInlineBytes: { type: 'integer', minimum: 1024, maximum: PRIVATE_RENDER_MAX_RESPONSE_BYTES },
      },
    },
    viewer: { type: 'object', maxProperties: 0 },
    sync: { const: true },
  },
};

const RENDER_REQUEST_INPUT_SCHEMA: JsonValue = {
  oneOf: [RENDER_REQUEST_V1_INPUT_SCHEMA, LEGACY_RENDER_REQUEST_INPUT_SCHEMA],
};

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
    description: 'Execute the authenticated legacy-v0 opaque-PNG profile, or validate a bounded RenderRequestV1 profile without claiming execution.',
    inputSchema: RENDER_REQUEST_INPUT_SCHEMA,
  },
  {
    name: 'lupi.get_render_job',
    description: 'Read authenticated render-job status from the private R2 receipt ledger, with legacy D1 compatibility.',
    inputSchema: {
      type: 'object',
      required: ['jobId'],
      properties: { jobId: { type: 'string', minLength: 1 } },
    },
  },
  {
    name: 'lupi.get_asset',
    description: 'Read bearer-gated asset metadata and a protected retrieval path by content-addressed assetId.',
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
    if (url.pathname === '/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(cors, ['GET', 'HEAD']);
      const response = json(statusPayload(env), { headers: cors });
      return getOrHeadResponse(request, response);
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

    if (isExternalAssetNamespace(url.pathname)) {
      return json({ error: 'External asset not found', path: url.pathname }, { status: 404, headers: cors });
    }

    if (url.pathname === '/mcp-manifest.json') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(cors, ['GET', 'HEAD']);
      return getOrHeadResponse(request, json(manifestPayload(), { headers: cors }));
    }

    if (url.pathname === '/mcp') {
      if (request.method !== 'POST') return methodNotAllowed(cors, ['POST']);
      let body: unknown;
      try {
        body = await readJsonRequestBody(request, 256 * 1024);
      } catch {
        return json(rpcError(null, -32700, 'Parse error'), { headers: cors });
      }
      const result = await handleJsonRpc(body, request, env, ctx);
      if (result === null) return new Response(null, { status: 204, headers: cors });
      return json(result, { headers: cors });
    }

    if (url.pathname === '/v1/render') {
      if (request.method !== 'POST') return methodNotAllowed(cors, ['POST']);
      if ((request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return json({ error: 'Content-Type must be application/json.' }, { status: 415, headers: cors });
      }
      await assertAuthorized(request, env);
      return json(await renderMoleculeAsset(await readJsonRequestBody(request, 256 * 1024), env, ctx), { headers: cors });
    }

    const provenanceMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/provenance$/);
    if (provenanceMatch) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(cors, ['GET', 'HEAD']);
      await assertAuthorized(request, env);
      const response = await readPrivateRenderProvenanceResponse(provenanceMatch[1], env, request.method === 'HEAD');
      return withCors(getOrHeadResponse(request, response), cors);
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
    if (jobMatch) {
      if (request.method !== 'GET') return methodNotAllowed(cors, ['GET']);
      await assertAuthorized(request, env);
      return json(await readJob(jobMatch[1], env), { headers: cors });
    }

    const privateArtifactMatch = url.pathname.match(/^\/v1\/artifacts\/(sha256-[a-f0-9]{64})\.png$/i);
    if (privateArtifactMatch) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(cors, ['GET', 'HEAD']);
      await assertAuthorized(request, env);
      const response = await readPrivateRenderAssetResponse(
        privateArtifactMatch[1].toLowerCase(),
        env,
        request.method === 'HEAD',
      );
      return withCors(getOrHeadResponse(request, response), cors);
    }

    const assetMatch = url.pathname.match(/^\/assets\/(sha256-[a-f0-9]{64})\.(png|jpe?g|webp|glb|usdz)$/i);
    if (assetMatch) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(cors, ['GET', 'HEAD']);
      await assertAuthorized(request, env);
      const response = await readAssetResponse(
        assetMatch[1],
        assetMatch[2] as AssetFormat | undefined,
        env,
        request.method === 'HEAD',
      );
      return withCors(getOrHeadResponse(request, response), cors);
    }

    if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
      return json({ error: 'API route not found', path: url.pathname }, { status: 404, headers: cors });
    }

    if (url.pathname.startsWith('/assets/sha256-')) {
      return json({ error: 'Asset route not found', path: url.pathname }, { status: 404, headers: cors });
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
    const status = message === 'Unauthorized'
      ? 401
      : error instanceof RenderServiceConfigurationError ? 503
        : error instanceof RendererProtocolError ? 502
          : error instanceof RenderArtifactValidationError ? 400 : 500;
    return json({
      error: message,
      ...(error instanceof RendererProtocolError && error.jobId ? { jobId: error.jobId } : {}),
    }, { status, headers: cors });
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
    const code = message === 'Unauthorized'
      ? -32001
      : error instanceof RenderServiceConfigurationError ? -32002
        : error instanceof RenderArtifactValidationError ? -32602 : -32000;
    return hasId ? rpcError(
      id,
      code,
      message,
      error instanceof RendererProtocolError && error.jobId ? { jobId: error.jobId } : undefined,
    ) : null;
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
      return await renderMoleculeAsset(args, env, ctx);
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
  input: unknown,
  env: Env,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void },
) {
  if (isRecord(input) && input.version === RENDER_REQUEST_VERSION_V1) {
    return renderArtifactRequestV1(input);
  }
  return renderPrivateLegacyMoleculeAsset(input as LegacyRenderMoleculeAssetArgs, env);
}

async function renderArtifactRequestV1(
  input: unknown,
) {
  const request = validateRenderRequestV1(input);
  assertEdgeRenderCapability(request.spec);
  const requestKey = await computeRenderRequestKeyV1(request);
  const format = request.spec.format;
  const specId = request.spec.source.kind === 'content'
    ? await computeRenderSpecIdV1(request.spec)
    : undefined;
  return {
    requestKey,
    ...(specId ? { specId } : {}),
    status: 'awaiting_renderer',
    renderer: {
      mode: 'contract-only',
      configured: false,
    },
    request,
    capability: EDGE_RENDER_CAPABILITY_V1,
    output: {
      format,
      mimeType: mimeForFormat(format),
    },
    next: {
      message: request.spec.source.kind === 'reference'
        ? 'The request is valid, but a renderer must resolve and digest the source before a specId can exist.'
        : 'The spec is finalized, but no activated renderer fingerprint exists; artifactKey, job, cache, and asset identities are intentionally withheld.',
    },
  };
}

async function renderPrivateLegacyMoleculeAsset(
  args: LegacyRenderMoleculeAssetArgs,
  env: Env,
) {
  assertPrivateRenderConfigured(env);
  const normalized = normalizePrivateLegacyRenderRequest(args);
  const requestHash = await sha256Hex(canonicalJson(normalizeJson(normalized)!));
  const jobId = `job-v0-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const baseJob = {
    version: 'lupi.render-job.legacy-v0.1',
    jobId,
    profile: 'legacy-v0-authenticated-png',
    requestKey: `legacy-request-sha256:${requestHash}`,
    status: 'rendering',
    request: normalized,
    createdAt: now,
    updatedAt: now,
  };
  await writePrivateRenderJob(env, baseJob);

  try {
    const rendererPayload = await callPrivateRenderer(env, jobId, normalized);
    const bytes = rendererPayload.bytes;
    const artifactHex = await sha256Hex(bytes);
    const artifactDigest = `sha256:${artifactHex}`;
    const assetId = `sha256-${artifactHex}`;
    const assetKey = privateRenderAssetKey(assetId);
    const existing = await env.RENDER_ASSETS!.head(assetKey);
    let cached = Boolean(existing);

    if (existing) {
      const existingDigest = existing.customMetadata?.sha256;
      if (existingDigest && existingDigest !== artifactDigest) {
        throw new RendererProtocolError('Private render asset identity conflict.', jobId);
      }
    } else {
      const stored = await env.RENDER_ASSETS!.put(assetKey, bytes, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          sha256: artifactDigest,
          byteLength: String(bytes.byteLength),
          width: String(rendererPayload.width),
          height: String(rendererPayload.height),
          jobId,
          profile: 'legacy-v0-authenticated-png',
        },
        onlyIf: { etagDoesNotMatch: '*' },
      });
      if (stored === null) cached = true;
    }

    const readback = await readPrivateRenderAssetBytes(assetId, env);
    const readbackDigest = `sha256:${await sha256Hex(readback)}`;
    if (readback.byteLength !== bytes.byteLength || readbackDigest !== artifactDigest) {
      throw new RendererProtocolError('Private R2 readback did not match the validated renderer bytes.', jobId);
    }

    const sidecarBase = {
      version: 'lupi.render-provenance.legacy-v0.1',
      profile: 'legacy-v0-authenticated-png',
      jobId,
      requestKey: baseJob.requestKey,
      assetId,
      artifactDigest,
      format: 'png',
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      width: rendererPayload.width,
      height: rendererPayload.height,
      request: normalized,
      renderer: {
        protocol: PRIVATE_RENDER_RESPONSE_PROTOCOL,
        browserReceipt: rendererPayload.browserReceipt,
        browserReceiptScope: 'pre-rgb-reencode-provenance-only',
      },
      validations: {
        canonicalBase64: true,
        pngSignature: true,
        pngCrc: true,
        dimensions: true,
        opaqueRgb8: true,
        mimeType: true,
        byteLength: true,
        artifactDigest: true,
        privateR2Readback: true,
      },
      createdAt: now,
      owner: 'authenticated-edge-service-principal',
    };
    const sidecarJson = canonicalJson(normalizeJson(sidecarBase)!);
    const sidecarDigest = `sha256:${await sha256Hex(sidecarJson)}`;
    const sidecarPut = await env.RENDER_ASSETS!.put(privateRenderSidecarKey(jobId), sidecarJson, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { sidecarDigest, assetId, artifactDigest },
      onlyIf: { etagDoesNotMatch: '*' },
    });
    if (sidecarPut === null) {
      throw new RendererProtocolError('Private render provenance identity conflict.', jobId);
    }
    const storedSidecar = await env.RENDER_ASSETS!.get(privateRenderSidecarKey(jobId));
    if (!storedSidecar) {
      throw new RendererProtocolError('Private render provenance was not readable after persistence.', jobId);
    }
    const storedSidecarBytes = await r2ObjectBytes(storedSidecar, 512 * 1024);
    const storedSidecarDigest = `sha256:${await sha256Hex(storedSidecarBytes)}`;
    if (storedSidecarDigest !== sidecarDigest) {
      throw new RendererProtocolError('Private render provenance readback did not match the persisted statement.', jobId);
    }

    const result = {
      ...baseJob,
      status: 'complete',
      updatedAt: new Date().toISOString(),
      cached,
      renderer: { mode: 'http', configured: true, protocol: PRIVATE_RENDER_RESPONSE_PROTOCOL },
      asset: {
        assetId,
        format: 'png',
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        width: rendererPayload.width,
        height: rendererPayload.height,
        sha256: artifactDigest,
        url: `/v1/artifacts/${assetId}.png`,
        sidecarUrl: `/v1/jobs/${jobId}/provenance`,
        dataBase64: normalized.asset.inline && bytes.byteLength <= normalized.asset.maxInlineBytes
          ? rendererPayload.dataBase64
          : undefined,
      },
      provenance: {
        sidecarDigest,
        browserReceiptScope: 'pre-rgb-reencode-provenance-only',
      },
    };
    await writePrivateRenderJob(env, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writePrivateRenderJob(env, {
      ...baseJob,
      status: 'failed',
      error: message.slice(0, 500),
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
    if (error instanceof RendererProtocolError) {
      if (!error.jobId) error.jobId = jobId;
      throw error;
    }
    throw new RendererProtocolError(message, jobId);
  }
}

function normalizePrivateLegacyRenderRequest(
  args: LegacyRenderMoleculeAssetArgs,
): LegacyNormalizedRenderRequest {
  if (!args || !isRecord(args)) {
    throw new RenderArtifactValidationError('$', 'legacy render request must be an object');
  }
  requireOnlyKeys(args, ['molecule', 'asset', 'viewer', 'sync'], '$');
  if (!isRecord(args.molecule)) {
    throw new RenderArtifactValidationError('$.molecule', 'must be an object');
  }
  requireOnlyKeys(
    args.molecule,
    ['inputType', 'input', 'name', 'atomCount', 'element', 'lattice', 'spacing'],
    '$.molecule',
  );
  const inputType = args.molecule.inputType;
  if (inputType !== 'template' && inputType !== 'procedural') {
    throw new RenderArtifactValidationError(
      '$.molecule.inputType',
      'the authenticated legacy-v0 lane supports only template or procedural inputs',
    );
  }
  let input = readString(args.molecule.input) ?? readString(args.molecule.name);
  if (!input || input.length > 160) {
    throw new RenderArtifactValidationError('$.molecule.input', 'must contain 1 through 160 characters');
  }
  if (inputType === 'template' && (
    args.molecule.atomCount !== undefined
    || args.molecule.element !== undefined
    || args.molecule.lattice !== undefined
    || args.molecule.spacing !== undefined
  )) {
    throw new RenderArtifactValidationError('$.molecule', 'template inputs cannot declare procedural fields');
  }
  if (inputType === 'template') {
    const canonicalTemplate = PRIVATE_RENDER_TEMPLATES.get(input.toLowerCase());
    if (!canonicalTemplate) {
      throw new RenderArtifactValidationError(
        '$.molecule.input',
        `must be one of the local templates: ${Array.from(PRIVATE_RENDER_TEMPLATES.values()).join(', ')}`,
      );
    }
    input = canonicalTemplate;
  }

  let atomCount: number | undefined;
  let spacing: number | undefined;
  if (inputType === 'procedural') {
    atomCount = strictInteger(args.molecule.atomCount ?? 5_000, 1, 100_000, '$.molecule.atomCount');
    const lattice = args.molecule.lattice;
    if (lattice !== undefined && lattice !== 'sc' && lattice !== 'bcc' && lattice !== 'fcc') {
      throw new RenderArtifactValidationError('$.molecule.lattice', 'must be sc, bcc, or fcc');
    }
    const element = args.molecule.element;
    if (
      element !== undefined
      && (typeof element !== 'string' || !/^[A-Z][a-z]?$/.test(element) || !getElementSpecBySymbol(element))
    ) {
      throw new RenderArtifactValidationError('$.molecule.element', 'must be a recognized element symbol');
    }
    if (args.molecule.spacing !== undefined) {
      spacing = strictNumber(args.molecule.spacing, 0.1, 20, '$.molecule.spacing');
    }
  }

  const asset = args.asset ?? {};
  if (!isRecord(asset)) throw new RenderArtifactValidationError('$.asset', 'must be an object');
  requireOnlyKeys(asset, ['format', 'width', 'height', 'transparent', 'inline', 'maxInlineBytes'], '$.asset');
  const format = asset.format ?? 'png';
  if (format !== 'png') {
    throw new RenderArtifactValidationError('$.asset.format', 'the authenticated legacy-v0 lane supports opaque PNG only');
  }
  if (asset.transparent === true) {
    throw new RenderArtifactValidationError('$.asset.transparent', 'transparent output is unsupported');
  }
  if (asset.inline !== undefined && typeof asset.inline !== 'boolean') {
    throw new RenderArtifactValidationError('$.asset.inline', 'must be a boolean');
  }
  const width = strictInteger(asset.width ?? 1024, 64, PRIVATE_RENDER_MAX_DIMENSION, '$.asset.width');
  const height = strictInteger(asset.height ?? width, 64, PRIVATE_RENDER_MAX_DIMENSION, '$.asset.height');
  const maxInlineBytes = strictInteger(
    asset.maxInlineBytes ?? LEGACY_DEFAULT_MAX_INLINE_BYTES,
    1024,
    PRIVATE_RENDER_MAX_RESPONSE_BYTES,
    '$.asset.maxInlineBytes',
  );
  if (args.sync === false) {
    throw new RenderArtifactValidationError('$.sync', 'the first authenticated renderer lane is synchronous only');
  }
  if (args.sync !== undefined && typeof args.sync !== 'boolean') {
    throw new RenderArtifactValidationError('$.sync', 'must be a boolean');
  }
  if (args.viewer !== undefined && (!isRecord(args.viewer) || Object.keys(args.viewer).length > 0)) {
    throw new RenderArtifactValidationError('$.viewer', 'viewer overrides are not supported by this bounded profile');
  }

  return {
    molecule: compactRecord({
      inputType,
      input,
      ...(inputType === 'procedural' ? {
        atomCount,
        element: args.molecule.element,
        lattice: args.molecule.lattice,
        spacing,
      } : {}),
    }) as LegacyNormalizedRenderRequest['molecule'],
    asset: {
      format: 'png',
      width,
      height,
      transparent: false,
      inline: asset.inline === true,
      maxInlineBytes,
    },
    viewer: {},
    rendererVersion: 'lupi-authenticated-png@2026-07-20',
  };
}

async function callPrivateRenderer(
  env: Env,
  jobId: string,
  request: LegacyNormalizedRenderRequest,
): Promise<{
  bytes: Uint8Array;
  dataBase64: string;
  width: number;
  height: number;
  browserReceipt: Record<string, JsonValue>;
}> {
  const endpoint = requirePrivateRendererEndpoint(env.RENDERER_ENDPOINT);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('renderer deadline exceeded'), PRIVATE_RENDER_DEADLINE_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      // Workers implement manual redirect handling but reject the browser-only
      // `error` mode. A 3xx remains fail-closed through the !response.ok check.
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.RENDERER_TOKEN}`,
      },
      body: JSON.stringify({
        protocol: PRIVATE_RENDER_REQUEST_PROTOCOL,
        jobId,
        request,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RendererProtocolError(`Renderer request failed: ${message}`, jobId);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new RendererProtocolError(`Renderer HTTP ${response.status}.`, jobId);
  }
  if ((response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new RendererProtocolError('Renderer response Content-Type must be application/json.', jobId);
  }
  const payload = await readJsonResponseBody(response, PRIVATE_RENDER_MAX_RESPONSE_BYTES);
  if (!isRecord(payload)) throw new RendererProtocolError('Renderer response must be an object.', jobId);
  try {
    requireOnlyKeys(payload, ['protocol', 'jobId', 'asset', 'browserReceipt'], '$renderer');
    if (payload.protocol !== PRIVATE_RENDER_RESPONSE_PROTOCOL) {
      throw new RendererProtocolError('Renderer response protocol mismatch.', jobId);
    }
    if (payload.jobId !== jobId) throw new RendererProtocolError('Renderer jobId mismatch.', jobId);
    if (!isRecord(payload.asset)) throw new RendererProtocolError('Renderer asset receipt is missing.', jobId);
    requireOnlyKeys(payload.asset, ['mimeType', 'width', 'height', 'byteLength', 'dataBase64'], '$renderer.asset');
    if (payload.asset.mimeType !== 'image/png') throw new RendererProtocolError('Renderer MIME must be image/png.', jobId);
    const width = strictInteger(payload.asset.width, 64, PRIVATE_RENDER_MAX_DIMENSION, '$renderer.asset.width');
    const height = strictInteger(payload.asset.height, 64, PRIVATE_RENDER_MAX_DIMENSION, '$renderer.asset.height');
    if (width !== request.asset.width || height !== request.asset.height) {
      throw new RendererProtocolError('Renderer dimensions do not match the request.', jobId);
    }
    if (typeof payload.asset.dataBase64 !== 'string') {
      throw new RendererProtocolError('Renderer dataBase64 is missing.', jobId);
    }
    const bytes = decodeCanonicalBase64(payload.asset.dataBase64, PRIVATE_RENDER_MAX_RESPONSE_BYTES);
    if (payload.asset.byteLength !== bytes.byteLength) {
      throw new RendererProtocolError('Renderer byteLength does not match decoded bytes.', jobId);
    }
    validateOpaqueRgbPng(bytes, width, height);
    const browserReceipt = sanitizeRendererBrowserReceipt(payload.browserReceipt);
    return { bytes, dataBase64: payload.asset.dataBase64, width, height, browserReceipt };
  } catch (error) {
    if (error instanceof RendererProtocolError) {
      if (!error.jobId) error.jobId = jobId;
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new RendererProtocolError(`Renderer response validation failed: ${message}`, jobId);
  }
}

function assertPrivateRenderConfigured(env: Env): void {
  if (!env.LUPI_MCP_SHARED_SECRET) {
    throw new RenderServiceConfigurationError('Protected render authentication is not configured.');
  }
  if (!env.RENDERER_ENDPOINT || !env.RENDERER_TOKEN || !env.RENDER_ASSETS) {
    throw new RenderServiceConfigurationError(
      'Authenticated PNG execution requires RENDERER_ENDPOINT, RENDERER_TOKEN, and private RENDER_ASSETS.',
    );
  }
}

function privateRenderConfigured(env: Env): boolean {
  return Boolean(
    env.LUPI_MCP_SHARED_SECRET
    && env.RENDERER_ENDPOINT
    && env.RENDERER_TOKEN
    && env.RENDER_ASSETS,
  );
}

function requirePrivateRendererEndpoint(value: string | undefined): string {
  if (!value) throw new RenderServiceConfigurationError('RENDERER_ENDPOINT is not configured.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RenderServiceConfigurationError('RENDERER_ENDPOINT is invalid.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new RenderServiceConfigurationError('RENDERER_ENDPOINT must use HTTPS outside localhost.');
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new RenderServiceConfigurationError('RENDERER_ENDPOINT must not contain credentials, a query, or a fragment.');
  }
  if (url.pathname !== '/render') {
    throw new RenderServiceConfigurationError('RENDERER_ENDPOINT must target the renderer /render route.');
  }
  return url.toString();
}

async function writePrivateRenderJob(env: Env, job: Record<string, unknown>): Promise<void> {
  if (!env.RENDER_ASSETS) throw new RenderServiceConfigurationError('Private render job storage is not configured.');
  await env.RENDER_ASSETS.put(privateRenderJobKey(String(job.jobId)), JSON.stringify(job), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      jobId: String(job.jobId),
      status: String(job.status ?? 'unknown'),
      profile: 'legacy-v0-authenticated-png',
    },
  });
}

async function readPrivateRenderJob(jobId: string, env: Env): Promise<Record<string, unknown>> {
  if (!PRIVATE_RENDER_JOB_ID_PATTERN.test(jobId)) {
    throw new RenderArtifactValidationError('$.jobId', 'invalid private render job id');
  }
  if (!env.RENDER_ASSETS) throw new RenderServiceConfigurationError('Private render job storage is not configured.');
  const object = await env.RENDER_ASSETS.get(privateRenderJobKey(jobId));
  if (!object) return { jobId, status: 'not_found' };
  const bytes = await r2ObjectBytes(object, 512 * 1024);
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(parsed) ? parsed : { jobId, status: 'invalid_receipt' };
  } catch {
    return { jobId, status: 'invalid_receipt' };
  }
}

async function readPrivateRenderAssetBytes(assetId: string, env: Env): Promise<Uint8Array> {
  if (!env.RENDER_ASSETS) throw new RenderServiceConfigurationError('Private render asset storage is not configured.');
  const object = await env.RENDER_ASSETS.get(privateRenderAssetKey(assetId));
  if (!object) throw new RendererProtocolError('Validated private render asset was not readable after persistence.');
  return r2ObjectBytes(object, PRIVATE_RENDER_MAX_RESPONSE_BYTES);
}

async function readPrivateRenderAssetResponse(assetId: string, env: Env, headOnly = false): Promise<Response> {
  if (!/^sha256-[a-f0-9]{64}$/.test(assetId)) {
    throw new RenderArtifactValidationError('$.assetId', 'invalid private render asset id');
  }
  if (!env.RENDER_ASSETS) throw new RenderServiceConfigurationError('Private render asset storage is not configured.');
  const object = headOnly
    ? await env.RENDER_ASSETS.head(privateRenderAssetKey(assetId))
    : await env.RENDER_ASSETS.get(privateRenderAssetKey(assetId));
  if (!object) return json({ error: 'Asset not found', assetId }, { status: 404 });
  const headers = privateRenderHeaders(object, assetId, 'image/png');
  const body = headOnly ? null : object.body ?? await object.arrayBuffer?.();
  return new Response(body, { headers });
}

async function readPrivateRenderProvenanceResponse(jobId: string, env: Env, headOnly = false): Promise<Response> {
  if (!PRIVATE_RENDER_JOB_ID_PATTERN.test(jobId)) {
    throw new RenderArtifactValidationError('$.jobId', 'invalid private render job id');
  }
  if (!env.RENDER_ASSETS) throw new RenderServiceConfigurationError('Private render provenance storage is not configured.');
  const object = headOnly
    ? await env.RENDER_ASSETS.head(privateRenderSidecarKey(jobId))
    : await env.RENDER_ASSETS.get(privateRenderSidecarKey(jobId));
  if (!object) return json({ error: 'Provenance not found', jobId }, { status: 404 });
  const headers = privateRenderHeaders(object, object.customMetadata?.sidecarDigest ?? jobId, 'application/json');
  const body = headOnly ? null : object.body ?? await object.arrayBuffer?.();
  return new Response(body, { headers });
}

function privateRenderHeaders(object: R2ObjectLike, etag: string, contentType: string): Headers {
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set('content-type', headers.get('content-type') || object.httpMetadata?.contentType || contentType);
  if (object.size !== undefined) headers.set('content-length', String(object.size));
  headers.set('etag', `"${etag}"`);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  return headers;
}

function privateRenderJobKey(jobId: string): string {
  return `${PRIVATE_RENDER_JOB_PREFIX}${jobId}.json`;
}

function privateRenderAssetKey(assetId: string): string {
  return `${PRIVATE_RENDER_ASSET_PREFIX}${assetId}.png`;
}

function privateRenderSidecarKey(jobId: string): string {
  return `${PRIVATE_RENDER_JOB_PREFIX}${jobId}.provenance.json`;
}

function sanitizeRendererBrowserReceipt(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) return {};
  const allowed = [
    'format', 'filename', 'mimeType', 'byteLength', 'width', 'height',
    'contractVersion', 'sourceContentDigest', 'specId', 'rendererFingerprint',
    'artifactKey', 'artifactDigest',
  ];
  return compactRecord(Object.fromEntries(
    allowed.filter((key) => Object.prototype.hasOwnProperty.call(value, key)).map((key) => [key, value[key]]),
  ));
}

function validateOpaqueRgbPng(bytes: Uint8Array, expectedWidth: number, expectedHeight: number): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 45 || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new RendererProtocolError('Renderer bytes are not a PNG.');
  }
  let offset = 8;
  let sawIhdr = false;
  let sawIend = false;
  let idatBytes = 0;
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32Be(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.byteLength) throw new RendererProtocolError('PNG chunk exceeds the response length.');
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const expectedCrc = readUint32Be(bytes, offset + 8 + length);
    const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (actualCrc !== expectedCrc) throw new RendererProtocolError(`PNG ${type} CRC mismatch.`);
    if (!sawIhdr) {
      if (type !== 'IHDR' || length !== 13) throw new RendererProtocolError('PNG must begin with a 13-byte IHDR.');
      const width = readUint32Be(bytes, offset + 8);
      const height = readUint32Be(bytes, offset + 12);
      const bitDepth = bytes[offset + 16];
      const colorType = bytes[offset + 17];
      const compression = bytes[offset + 18];
      const filter = bytes[offset + 19];
      const interlace = bytes[offset + 20];
      if (width !== expectedWidth || height !== expectedHeight) {
        throw new RendererProtocolError('PNG IHDR dimensions do not match the request.');
      }
      if (bitDepth !== 8 || colorType !== 2 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new RendererProtocolError('PNG must be non-interlaced 8-bit RGB with no alpha channel.');
      }
      sawIhdr = true;
    } else if (type === 'IHDR') {
      throw new RendererProtocolError('PNG contains more than one IHDR.');
    }
    if (type === 'IDAT') idatBytes += length;
    if (type === 'tRNS') throw new RendererProtocolError('Opaque PNG must not contain transparency metadata.');
    offset = chunkEnd;
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.byteLength) throw new RendererProtocolError('PNG IEND is malformed.');
      sawIend = true;
      break;
    }
  }
  if (!sawIhdr || !sawIend || idatBytes === 0) {
    throw new RendererProtocolError('PNG is missing required IHDR, image-data, or terminal chunks.');
  }
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  ) >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeCanonicalBase64(value: string, maxBytes: number): Uint8Array {
  if (value.length === 0 || value.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new RendererProtocolError('Renderer base64 payload exceeds the configured limit.');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new RendererProtocolError('Renderer dataBase64 is not canonical base64.');
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToUint8Array(value);
  } catch {
    throw new RendererProtocolError('Renderer dataBase64 could not be decoded.');
  }
  if (bytes.byteLength > maxBytes) throw new RendererProtocolError('Decoded renderer bytes exceed the configured limit.');
  if (uint8ArrayToBase64(bytes) !== value) throw new RendererProtocolError('Renderer dataBase64 is not canonical.');
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function r2ObjectBytes(object: R2ObjectLike, maxBytes: number): Promise<Uint8Array> {
  if (object.size !== undefined && object.size > maxBytes) {
    throw new RendererProtocolError('Stored render object exceeds the configured limit.');
  }
  const buffer = object.arrayBuffer
    ? await object.arrayBuffer()
    : object.body ? await new Response(object.body).arrayBuffer() : null;
  if (!buffer) throw new RendererProtocolError('Stored render object has no readable body.');
  if (buffer.byteLength > maxBytes) throw new RendererProtocolError('Stored render object exceeds the configured limit.');
  return new Uint8Array(buffer);
}

async function readJsonRequestBody(request: Request, maxBytes: number): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new RenderArtifactValidationError('$', 'request body exceeds the configured limit');
  }
  if (!request.body) return {};
  const bytes = await readStreamBounded(
    request.body,
    maxBytes,
    () => new RenderArtifactValidationError('$', 'request body exceeds the configured limit'),
  );
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RenderArtifactValidationError('$', 'request body is not valid JSON');
  }
}

async function readJsonResponseBody(response: Response, maxBytes: number): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new RendererProtocolError('Renderer response exceeds the configured limit.');
  }
  if (!response.body) throw new RendererProtocolError('Renderer response body is empty.');
  const bytes = await readStreamBounded(
    response.body,
    maxBytes,
    () => new RendererProtocolError('Renderer response exceeds the configured limit.'),
  );
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RendererProtocolError('Renderer response is not valid JSON.');
  }
}

async function readStreamBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  limitError: () => Error,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw limitError();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) throw new RenderArtifactValidationError(path, `contains unsupported field ${unknown[0]}`);
}

function strictInteger(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RenderArtifactValidationError(path, `must be an integer from ${min} through ${max}`);
  }
  return value;
}

function strictNumber(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RenderArtifactValidationError(path, `must be a finite number from ${min} through ${max}`);
  }
  return value;
}

async function renderLegacyMoleculeAsset(
  args: LegacyRenderMoleculeAssetArgs,
  env: Env,
  ctx: { waitUntil?: (promise: Promise<unknown>) => void },
) {
  const normalized = normalizeLegacyRenderRequest(args);
  const canonical = canonicalJson(normalizeJson(normalized) ?? {});
  const hash = await sha256Hex(canonical);
  const assetId = `sha256-${hash}`;
  const cacheKey = `${assetId}.${normalized.asset.format}`;
  const assetKey = assetObjectKey(assetId, normalized.asset.format);
  const jobId = `job-${hash.slice(0, 24)}`;
  const cached = env.ASSETS ? await env.ASSETS.head(assetKey) : null;

  if (cached) {
    const result = {
      jobId,
      assetId,
      cacheKey,
      status: 'complete',
      cached: true,
      profile: 'legacy-v0',
      asset: {
        format: normalized.asset.format,
        mimeType: cached.httpMetadata?.contentType ?? mimeForFormat(normalized.asset.format),
        byteLength: cached.size ?? Number(cached.customMetadata?.byteLength ?? 0),
        sha256: cached.customMetadata?.sha256 ?? hash,
        url: publicAssetUrl(assetId, normalized.asset.format, env),
      },
      request: normalized,
    };
    await upsertJob(env, { ...result, assetKey });
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
    profile: 'legacy-v0',
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
        ? 'The legacy control plane accepted the request, but no renderer backend or queue is configured.'
        : 'Legacy render job accepted. Poll lupi.get_render_job or fetch the returned asset URL after completion.',
    },
  };

  await upsertJob(env, { ...created, assetKey });

  if (rendererMode === 'queue' && env.RENDER_QUEUE) {
    const message: LegacyRenderQueueMessage = { jobId, assetId, cacheKey, request: normalized };
    const send = env.RENDER_QUEUE.send(message).catch(async (error) => {
      const failure = error instanceof Error ? error.message : String(error);
      await updateJobStatus(env, jobId, 'failed', failure);
      throw error;
    });
    if (ctx.waitUntil) ctx.waitUntil(send);
    else await send;
  }

  if (useSyncRenderer) {
    const rendered = await tryLegacySynchronousRenderer(env, {
      jobId,
      assetId,
      cacheKey,
      request: normalized,
      assetKey,
    });
    if (rendered) return rendered;
  }

  return created;
}

function normalizeLegacyRenderRequest(args: LegacyRenderMoleculeAssetArgs): LegacyNormalizedRenderRequest {
  if (!args || !isRecord(args) || !isRecord(args.molecule)) {
    throw new Error('lupi.render_molecule_asset requires a molecule object or a versioned RenderRequestV1.');
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
    }) as LegacyNormalizedRenderRequest['molecule'],
    asset: {
      format,
      width,
      height,
      transparent: Boolean(assetArgs.transparent),
      inline: Boolean(assetArgs.inline),
      maxInlineBytes: clampInt(
        readNumber(assetArgs.maxInlineBytes) ?? LEGACY_DEFAULT_MAX_INLINE_BYTES,
        1024,
        64 * 1024 * 1024,
      ),
    },
    viewer: isRecord(args.viewer) ? normalizeRecord(args.viewer) : {},
    rendererVersion: LEGACY_RENDERER_VERSION,
  };
}

async function tryLegacySynchronousRenderer(
  env: Env,
  job: {
    jobId: string;
    assetId: string;
    cacheKey: string;
    request: LegacyNormalizedRenderRequest;
    assetKey: string;
  },
) {
  if (!env.RENDERER_ENDPOINT) return null;
  let payload: { asset?: { dataBase64?: string; mimeType?: string; sha256?: string; byteLength?: number } };
  try {
    const response = await fetch(env.RENDERER_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.RENDERER_TOKEN ? { authorization: `Bearer ${env.RENDERER_TOKEN}` } : {}),
      },
      body: JSON.stringify({ jobId: job.jobId, assetId: job.assetId, request: job.request }),
    });
    if (!response.ok) return await markLegacyRenderFailed(env, job, `Renderer HTTP ${response.status}`);
    payload = await response.json() as typeof payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return await markLegacyRenderFailed(env, job, message);
  }
  const dataBase64 = payload.asset?.dataBase64;
  if (!dataBase64) return await markLegacyRenderFailed(env, job, 'Renderer response did not include asset.dataBase64');
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
    profile: 'legacy-v0',
    asset: {
      format: job.request.asset.format,
      mimeType,
      byteLength: bytes.byteLength,
      sha256,
      url: publicAssetUrl(job.assetId, job.request.asset.format, env),
      dataBase64: job.request.asset.inline && bytes.byteLength <= job.request.asset.maxInlineBytes
        ? dataBase64
        : undefined,
    },
    request: job.request,
  };
  await upsertJob(env, { ...result, assetKey: job.assetKey });
  return result;
}

async function markLegacyRenderFailed(
  env: Env,
  job: {
    jobId: string;
    assetId: string;
    cacheKey: string;
    request: LegacyNormalizedRenderRequest;
    assetKey: string;
  },
  error: string,
) {
  const result = {
    jobId: job.jobId,
    assetId: job.assetId,
    cacheKey: job.cacheKey,
    status: 'failed',
    cached: false,
    profile: 'legacy-v0',
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

function assertEdgeRenderCapability(spec: RenderRequestSpecV1): void {
  const formatCapability = EDGE_RENDER_CAPABILITY_V1.formats[spec.format];
  if (!formatCapability.enabled) {
    throw new RenderArtifactValidationError(
      '$.spec.format',
      `${spec.format} is unsupported by the edge request capability`,
    );
  }
  if (!formatCapability.alphaModes.includes(spec.alpha)) {
    throw new RenderArtifactValidationError(
      '$.spec.alpha',
      `${spec.alpha} is unsupported for ${spec.format} by the edge request capability`,
    );
  }
  if (!spec.layers.atoms) {
    throw new RenderArtifactValidationError(
      '$.spec.layers.atoms',
      'the edge RenderRequestV1 validation profile requires the atoms layer',
    );
  }
  if (RENDER_FORMAT_RULES_V1[spec.format].kind === 'raster') {
    if (spec.width! > formatCapability.maxWidth! || spec.height! > formatCapability.maxHeight!) {
      throw new RenderArtifactValidationError(
        '$.spec',
        `${spec.width}x${spec.height} exceeds the edge request capability`,
      );
    }
  }
  for (const layer of Object.keys(RENDER_LAYER_REGISTRY_V1) as Array<keyof typeof RENDER_LAYER_REGISTRY_V1>) {
    if (spec.layers[layer] && !EDGE_RENDER_CAPABILITY_V1.layers[layer]) {
      throw new RenderArtifactValidationError(
        `$.spec.layers.${layer}`,
        `enabled layer ${layer} is unsupported by the edge request capability`,
      );
    }
  }
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
  if (jobId.startsWith('job-v0-')) return readPrivateRenderJob(jobId, env);
  if (!env.DB) return { jobId, status: 'unknown', message: 'D1 binding DB is not configured.' };
  const row = await env.DB.prepare('SELECT * FROM render_jobs WHERE id = ?').bind(jobId).first<Record<string, unknown>>();
  return row ?? { jobId, status: 'not_found' };
}

async function readAssetMetadata(assetId: string, format: Exclude<AssetFormat, 'jpg'> | undefined, env: Env) {
  if (!assetId) throw new Error('assetId is required.');
  const safeFormat = format ?? 'png';
  if (/^sha256-[a-f0-9]{64}$/.test(assetId) && safeFormat === 'png' && env.RENDER_ASSETS) {
    const privateObject = await env.RENDER_ASSETS.head(privateRenderAssetKey(assetId));
    if (privateObject) {
      return {
        assetId,
        format: 'png',
        status: 'available',
        url: `/v1/artifacts/${assetId}.png`,
        authRequired: true,
        cacheControl: 'private, no-store',
        byteLength: privateObject.size ?? null,
        width: privateObject.customMetadata?.width ? Number(privateObject.customMetadata.width) : null,
        height: privateObject.customMetadata?.height ? Number(privateObject.customMetadata.height) : null,
        mimeType: 'image/png',
        sha256: privateObject.customMetadata?.sha256 ?? assetId.replace('sha256-', 'sha256:'),
      };
    }
  }
  const key = assetObjectKey(assetId, safeFormat);
  const object = env.ASSETS ? await env.ASSETS.head(key) : null;
  return {
    assetId,
    format: safeFormat,
    status: object ? 'available' : 'missing',
    url: object ? `/assets/${assetId}.${safeFormat}` : null,
    authRequired: true,
    byteLength: object?.size ?? null,
    mimeType: object?.httpMetadata?.contentType ?? mimeForFormat(safeFormat),
    sha256: object?.customMetadata?.sha256 ?? null,
  };
}

async function readAssetResponse(
  assetId: string,
  rawFormat: AssetFormat | undefined,
  env: Env,
  headOnly = false,
) {
  const format = normalizeFormat(rawFormat) ?? 'png';
  const key = assetObjectKey(assetId, format);
  const object = env.ASSETS
    ? headOnly ? await env.ASSETS.head(key) : await env.ASSETS.get(key)
    : null;
  if (!object) return json({ error: 'Asset not found', assetId, format }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set('content-type', headers.get('content-type') || object.httpMetadata?.contentType || mimeForFormat(format));
  if (object.size !== undefined) headers.set('content-length', String(object.size));
  headers.set('etag', `"${object.customMetadata?.sha256 ?? assetId}"`);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  const body = headOnly ? null : object.body ?? await object.arrayBuffer?.();
  return new Response(body, { headers });
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
  const release = env.CF_VERSION_METADATA;
  return {
    ready: true,
    name: 'lupi-cloudflare-edge',
    version: SERVER_VERSION,
    toolCount: MCP_TOOLS.length,
    agentNative: true,
    browserRequired: false,
    callerBrowserRequired: false,
    rendererBackendBrowserRequired: true,
    renderExecution: privateRenderConfigured(env),
    renderProfiles: {
      legacyV0: {
        execution: privateRenderConfigured(env),
        profile: 'legacy-v0-authenticated-png',
        authenticationRequired: true,
        moleculeInputs: ['template', 'procedural'],
        formats: ['png'],
      },
      renderRequestV1: {
        execution: false,
        validationOnly: true,
      },
    },
    renderRequestCapability: EDGE_RENDER_CAPABILITY_V1,
    ...(release ? {
      release: {
        id: release.id,
        tag: release.tag,
        timestamp: release.timestamp,
      },
    } : {}),
    bindings: {
      webAssets: Boolean(env.WEB_ASSETS),
      r2: Boolean(env.ASSETS),
      privateRenderAssets: Boolean(env.RENDER_ASSETS),
      d1: Boolean(env.DB),
      queue: Boolean(env.RENDER_QUEUE),
      rendererEndpoint: Boolean(env.RENDERER_ENDPOINT),
      rendererToken: Boolean(env.RENDERER_TOKEN),
      firebaseProject: Boolean(env.FIREBASE_PROJECT_ID),
      largeAssetProxy: Boolean(env.LUPI_LARGE_ASSET_BASE_URL || env.ASSET_BASE_URL),
      authRequired: true,
      authConfigured: Boolean(env.LUPI_MCP_SHARED_SECRET),
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
    renderProfiles: {
      legacyV0: {
        profile: 'legacy-v0-authenticated-png',
        authenticationRequired: true,
        executionConditionalOnBindings: true,
        moleculeInputs: ['template', 'procedural'],
        formats: ['png'],
        alphaModes: ['opaque'],
        retrieval: {
          job: '/v1/jobs/:jobId',
          provenance: '/v1/jobs/:jobId/provenance',
          artifact: '/v1/artifacts/:assetId.png',
        },
      },
      renderRequestV1: { validationOnly: true },
    },
    renderRequestCapability: EDGE_RENDER_CAPABILITY_V1,
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
  if (!secret) throw new RenderServiceConfigurationError('Protected MCP authentication is not configured.');
  const auth = request.headers.get('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!presented || !(await constantTimeSecretEqual(presented, secret))) throw new Error('Unauthorized');
}

async function constantTimeSecretEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: string | number | null, code: number, message: string, data?: Record<string, unknown>) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
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

function getOrHeadResponse(request: Request, response: Response) {
  return request.method === 'HEAD'
    ? new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
    : response;
}

function methodNotAllowed(cors: Headers, methods: string[]) {
  const headers = new Headers(cors);
  headers.set('allow', methods.join(', '));
  return json({ error: 'Method not allowed', allowedMethods: methods }, { status: 405, headers });
}

function corsHeaders(request: Request, env: Env) {
  const headers = new Headers();
  const origin = request.headers.get('origin') ?? '*';
  const allowed = env.CORS_ORIGINS?.split(',').map((entry) => entry.trim()).filter(Boolean);
  headers.set('access-control-allow-origin', !allowed?.length || allowed.includes(origin) ? origin : allowed[0]);
  headers.set('vary', 'origin');
  headers.set('access-control-allow-methods', 'GET,HEAD,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type,authorization,mcp-session-id');
  headers.set('access-control-expose-headers', 'content-type,etag,x-lupi-edge-executed');
  headers.set('x-lupi-edge-executed', '1');
  return headers;
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

export function validateExternalAssetPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('cloudflare-assets-exclude.json must contain at least one path.');
  }
  const paths = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.startsWith('gallery/') || entry.includes('..') || entry.includes('\\')) {
      throw new Error(`Invalid external asset path at index ${index}.`);
    }
    return entry;
  });
  if (new Set(paths).size !== paths.length) {
    throw new Error('cloudflare-assets-exclude.json contains duplicate paths.');
  }
  return paths;
}

function isExternalAssetPath(pathname: string) {
  return EXTERNAL_ASSET_PATHS.has(pathname.replace(/^\/+/, ''));
}

function isExternalAssetNamespace(pathname: string) {
  return pathname.startsWith('/gallery/curated/lupine_genesis.') || pathname.startsWith('/gallery/research/hfc/');
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
  out.set('x-lupi-asset-source', 'external-proxy');
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
  headers.set('x-lupi-asset-source', 'r2');

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

function readInputType(value: unknown, molecule: Record<string, unknown>): MoleculeInputType | undefined {
  if (
    value === 'name'
    || value === 'template'
    || value === 'smiles'
    || value === 'xyz'
    || value === 'description'
    || value === 'procedural'
  ) return value;
  if (molecule.atomCount !== undefined || molecule.lattice !== undefined) return 'procedural';
  if (molecule.smiles !== undefined) return 'smiles';
  if (molecule.xyz !== undefined) return 'xyz';
  return undefined;
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
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
