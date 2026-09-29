/** Public, read-only PubChem tools for the Lupi Live ChatGPT plugin.
 *
 * This route is independent of the legacy viewer/render control plane. A
 * structure reference pins source identity AND geometry; there is no global
 * "current molecule" shared between conversations or open cards.
 */
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { getAtomicNumberBySymbol, getElementSpec } from '@atlas/core/elements';
import {
  PubChemError,
  resolvePubChemMolecule,
  type PubChemFetchOptions,
  type PubChemMolecule,
} from '@atlas/core/pubchem';

// Cloudflare Workers do not allow runtime code generation.
z.config({ jitless: true });

export const CHATGPT_MCP_PATH = '/chatgpt/mcp';
export const CHATGPT_UI_URI = 'ui://lupi/molecule-v1.html';
export const CHATGPT_WIDGET_PATH = '/chatgpt-widget/index.html';
export const CHATGPT_VERSION = '0.1.0';
export const MAX_PLUGIN_ATOMS = 512;
export const MAX_PENDING_PLUGIN_LOOKUPS = 4;
const MAX_REQUEST_BYTES = 8192;
const MAX_WIDGET_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED_STRUCTURES = 64;
const MAX_CACHED_QUERIES = 128;
const STRUCTURE_REF = /^pubchem:([1-9]\d{0,9}):(3d|2d):([a-f0-9]{64})$/;
const WIDGET_MARKER = /<meta\s+name=["']lupi-widget["']\s+content=["']molecule-v1["']\s*\/?>/i;

export interface ChatGptEnv {
  WEB_ASSETS?: { fetch(request: Request): Promise<Response> };
  CORS_ORIGINS?: string;
}

export interface MoleculeView {
  style: 'ball-and-stick' | 'spacefill';
  highlightElements: string[];
  highlightAtomIds: number[];
}

type ViewInput = Partial<MoleculeView>;

class PluginError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PluginError';
  }
}

function asPubChemRef(query: string): { cid: number } | { name: string } {
  const clean = query.trim();
  if (!clean || clean.length > 200) throw new PluginError('invalid_input', 'Supply a PubChem compound name or CID of at most 200 characters.');
  const match = /^(?:pubchem\s+)?(?:cid\s*:?\s*)?(\d+)$/i.exec(clean);
  if (!match) return { name: clean };
  const cid = Number(match[1]);
  if (!Number.isSafeInteger(cid) || cid < 1 || cid > 2_147_483_647) {
    throw new PluginError('invalid_input', 'PubChem CID must be a positive 32-bit integer.');
  }
  return { cid };
}

/** The timestamp is evidence, not part of source identity. */
export async function moleculeStructureRef(molecule: PubChemMolecule): Promise<string> {
  const canonical = JSON.stringify({
    schemaVersion: molecule.schemaVersion,
    cid: molecule.cid,
    name: molecule.name,
    formula: molecule.formula,
    dimension: molecule.dimension,
    coordinateUnits: molecule.coordinateUnits,
    atoms: molecule.atoms,
    bonds: molecule.bonds,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `pubchem:${molecule.cid}:${molecule.dimension}:${hash}`;
}

function elementSummary(molecule: PubChemMolecule) {
  const counts = new Map<number, number>();
  for (const atomicNumber of molecule.atoms.elements) counts.set(atomicNumber, (counts.get(atomicNumber) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a - b).map(([atomicNumber, count]) => ({
    atomicNumber, symbol: getElementSpec(atomicNumber).symbol, count,
  }));
}

function moleculeSummary(molecule: PubChemMolecule, structureRef: string, cacheHit: boolean) {
  return {
    structureRef,
    cid: molecule.cid,
    name: molecule.name,
    formula: molecule.formula,
    source: 'PubChem' as const,
    sourceUrl: molecule.sourceUrl,
    recordUrl: molecule.recordUrl,
    retrievedAt: molecule.retrievedAt,
    dimension: molecule.dimension,
    coordinateUnits: molecule.coordinateUnits,
    atomCount: molecule.atoms.ids.length,
    bondCount: molecule.bonds.aid1.length,
    bondSource: 'source-connection-table' as const,
    elements: elementSummary(molecule),
    cacheHit,
    websiteUrl: `https://lupi.live/?molecule=cid:${molecule.cid}`,
  };
}

export function resolveMoleculeView(molecule: PubChemMolecule, input: ViewInput = {}): MoleculeView {
  const selected = new Set<number>();
  const sourceIds = new Set(molecule.atoms.ids);
  const elements = [...new Set(input.highlightElements ?? [])];
  for (const symbol of elements) {
    const atomicNumber = getAtomicNumberBySymbol(symbol);
    if (atomicNumber === undefined) throw new PluginError('invalid_view', `Unknown element symbol: ${symbol}. Use a chemical symbol such as N.`);
    const indices = molecule.atoms.elements.flatMap((element, index) => element === atomicNumber ? [index] : []);
    if (indices.length === 0) throw new PluginError('invalid_view', `${molecule.name} (CID ${molecule.cid}) has no ${symbol} atoms in this source record.`);
    for (const index of indices) selected.add(molecule.atoms.ids[index]);
  }
  for (const id of input.highlightAtomIds ?? []) {
    if (!sourceIds.has(id)) throw new PluginError('invalid_view', `Source atom ID ${id} is absent from PubChem CID ${molecule.cid}.`);
    selected.add(id);
  }
  return {
    style: input.style ?? 'ball-and-stick',
    highlightElements: elements,
    highlightAtomIds: [...selected].sort((a, b) => a - b),
  };
}

function textContent(text: string) { return [{ type: 'text' as const, text }]; }

function toolFailure(error: unknown) {
  const known = error instanceof PluginError || error instanceof PubChemError;
  const message = known ? error.message : 'The PubChem molecule could not be loaded. Please retry.';
  const code = known ? error.code : 'upstream_error';
  return {
    isError: true,
    content: textContent(message),
    structuredContent: { status: 'error' as const, code, message },
  };
}

export interface MoleculeServiceOptions extends PubChemFetchOptions {
  cacheTtlMs?: number;
  clock?: () => number;
}

/** Bounded, opportunistic public cache. References survive isolate restarts by
 * refetching the CID and comparing the complete source identity digest. */
export class MoleculeService {
  private readonly structures = new Map<string, { molecule: PubChemMolecule; expires: number }>();
  private readonly queries = new Map<string, string>();
  private readonly pending = new Map<string, Promise<Awaited<ReturnType<typeof resolvePubChemMolecule>>>>();
  private readonly clock: () => number;
  private readonly ttl: number;

  constructor(private readonly options: MoleculeServiceOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.ttl = options.cacheTtlMs ?? CACHE_TTL_MS;
  }

  private prune() {
    for (const [key, value] of this.structures) if (value.expires <= this.clock()) this.structures.delete(key);
    for (const [key, ref] of this.queries) if (!this.structures.has(ref)) this.queries.delete(key);
  }

  private get(ref: string) {
    this.prune();
    const entry = this.structures.get(ref);
    if (entry) { this.structures.delete(ref); this.structures.set(ref, entry); }
    return entry?.molecule;
  }

  private async remember(molecule: PubChemMolecule) {
    this.prune();
    const ref = await moleculeStructureRef(molecule);
    this.structures.set(ref, { molecule, expires: this.clock() + this.ttl });
    while (this.structures.size > MAX_CACHED_STRUCTURES) this.structures.delete(this.structures.keys().next().value!);
    return ref;
  }

  private async fetch(query: string, refresh: boolean) {
    const key = `${refresh ? 'refresh' : 'normal'}:${query.trim().toLowerCase()}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= MAX_PENDING_PLUGIN_LOOKUPS) {
      throw new PluginError('busy', 'Lupi is handling several PubChem lookups. Please retry shortly.');
    }
    // Requests use the public PubChem service only. The caller never supplies
    // a URL; cache refresh cannot turn this tool into an arbitrary fetcher.
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    const options: PubChemFetchOptions = {
      ...this.options,
      maxAtoms: MAX_PLUGIN_ATOMS,
      maxBonds: 2048,
      maxResponseBytes: 1024 * 1024,
      maxCandidates: 10,
      timeoutMs: this.options.timeoutMs ?? 30_000,
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (refresh) headers.set('Cache-Control', 'no-cache');
        return fetchImpl(input, { ...init, headers, ...(refresh ? { cache: 'no-store' as RequestCache } : {}) });
      },
    };
    const request = resolvePubChemMolecule(asPubChemRef(query), options);
    this.pending.set(key, request);
    try { return await request; } finally { this.pending.delete(key); }
  }

  async resolve(query: string, cacheMode: 'prefer-cache' | 'refresh' = 'prefer-cache') {
    try {
      const lookup = asPubChemRef(query);
      const key = 'cid' in lookup ? `cid:${lookup.cid}` : `name:${lookup.name.toLowerCase()}`;
      const cachedRef = this.queries.get(key);
      const cached = cacheMode !== 'refresh' && cachedRef ? this.get(cachedRef) : undefined;
      if (cached && cachedRef) return {
        content: textContent(`Resolved ${cached.name}, PubChem CID ${cached.cid}. Call show_molecule with the returned structureRef to open the interactive viewer.`),
        structuredContent: { status: 'resolved' as const, ...moleculeSummary(cached, cachedRef, true) },
      };
      const result = await this.fetch(query, cacheMode === 'refresh');
      if (result.status === 'ambiguous') return {
        content: textContent('PubChem returned multiple compound identities. Ask the user to choose a CID before calling show_molecule.'),
        structuredContent: {
          status: 'ambiguous' as const, query,
          candidates: result.cids.map((cid) => ({ cid, sourceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` })),
        },
      };
      const molecule = result.molecule;
      const ref = await this.remember(molecule);
      this.queries.set(key, ref);
      this.queries.set(`cid:${molecule.cid}`, ref);
      while (this.queries.size > MAX_CACHED_QUERIES) this.queries.delete(this.queries.keys().next().value!);
      return {
        content: textContent(`Resolved ${molecule.name}, PubChem CID ${molecule.cid}, ${molecule.dimension.toUpperCase()} source coordinates. Call show_molecule with the returned structureRef to open the interactive viewer.`),
        structuredContent: { status: 'resolved' as const, ...moleculeSummary(molecule, ref, false) },
      };
    } catch (error) { return toolFailure(error); }
  }

  async show(structureRef: string, input: ViewInput = {}) {
    try {
      const match = STRUCTURE_REF.exec(structureRef);
      if (!match) throw new PluginError('invalid_reference', 'Use the exact structureRef returned by resolve_molecule.');
      let molecule = this.get(structureRef);
      const cacheHit = Boolean(molecule);
      if (!molecule) {
        const result = await this.fetch(`cid:${match[1]}`, false);
        if (result.status !== 'resolved') throw new PluginError('invalid_reference', 'This reference no longer resolves to one compound. Resolve the PubChem CID again.');
        const currentRef = await moleculeStructureRef(result.molecule);
        if (currentRef !== structureRef) throw new PluginError('structure_changed', 'The current PubChem record differs from this pinned structure. Resolve the CID again before opening a new view.');
        molecule = result.molecule;
        await this.remember(molecule);
      }
      const view = resolveMoleculeView(molecule, input);
      return {
        content: textContent(`Prepared an interactive view of ${molecule.name}, PubChem CID ${molecule.cid}; ${molecule.atoms.ids.length} source atoms and ${molecule.bonds.aid1.length} source bonds. ${view.highlightAtomIds.length ? `Highlighted source atom IDs: ${view.highlightAtomIds.join(', ')}.` : 'No atoms highlighted.'}`),
        structuredContent: { status: 'shown' as const, ...moleculeSummary(molecule, structureRef, cacheHit), renderStatus: 'awaiting-component', view },
        // Geometry is for the component. The model receives identity, source,
        // dimensionality, counts, and selected source IDs in the summary.
        _meta: { molecule, view },
      };
    } catch (error) { return toolFailure(error); }
  }
}

const defaultService = new MoleculeService();

export interface CreatePluginServerOptions {
  service?: MoleculeService;
  loadWidgetHtml: () => Promise<string>;
}

const identityOutputSchema = z.object({
  structureRef: z.string().regex(STRUCTURE_REF),
  cid: z.number().int().positive(),
  name: z.string(),
  formula: z.string(),
  source: z.literal('PubChem'),
  sourceUrl: z.string().url(),
  recordUrl: z.string().url(),
  retrievedAt: z.string(),
  dimension: z.enum(['3d', '2d']),
  coordinateUnits: z.enum(['angstrom', 'depiction']),
  atomCount: z.number().int().min(1).max(MAX_PLUGIN_ATOMS),
  bondCount: z.number().int().min(0).max(2048),
  bondSource: z.literal('source-connection-table'),
  elements: z.array(z.object({ atomicNumber: z.number().int().min(1).max(118), symbol: z.string(), count: z.number().int().positive() })),
  cacheHit: z.boolean(),
  websiteUrl: z.string().url(),
}).strict();
const errorOutputSchema = z.object({ status: z.literal('error'), code: z.string(), message: z.string() }).strict();
const viewOutputSchema = z.object({
  style: z.enum(['ball-and-stick', 'spacefill']),
  highlightElements: z.array(z.string()),
  highlightAtomIds: z.array(z.number().int().positive()),
}).strict();
// Each branch has an object root. SDK v2 can consequently advertise this
// union to 2025 protocol clients without introducing a result wrapper.
const resolveOutputSchema = z.discriminatedUnion('status', [
  identityOutputSchema.extend({ status: z.literal('resolved') }),
  z.object({
    status: z.literal('ambiguous'), query: z.string(),
    candidates: z.array(z.object({ cid: z.number().int().positive(), sourceUrl: z.string().url() }).strict()).max(10),
  }).strict(),
  errorOutputSchema,
]);
const showOutputSchema = z.discriminatedUnion('status', [
  identityOutputSchema.extend({ status: z.literal('shown'), renderStatus: z.literal('awaiting-component'), view: viewOutputSchema }),
  errorOutputSchema,
]);

export function createPluginServer({ service = defaultService, loadWidgetHtml }: CreatePluginServerOptions) {
  const server = new McpServer({ name: 'lupi-live', version: CHATGPT_VERSION }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true };

  server.registerTool('resolve_molecule', {
    title: 'Find a molecule on PubChem',
    description: 'Resolve an exact molecule name or PubChem CID, retrieve source atoms and bonds, and return a pinned structure reference. Use for requests such as show L-theanine from PubChem, visualize a molecule in 3D, or open CID 439378. On resolved, call show_molecule to render it. Multiple CIDs require user clarification. Source coordinates may be 2D; do not describe those as a 3D conformer.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).describe('Exact compound name, decimal PubChem CID, or cid:439378.'),
      cacheMode: z.enum(['prefer-cache', 'refresh']).optional().describe('Use refresh for an explicitly fresh PubChem lookup; otherwise validated source records may be reused.'),
    }).strict(),
    outputSchema: resolveOutputSchema,
    annotations,
  }, async ({ query, cacheMode }) => service.resolve(query, cacheMode));

  registerAppTool(server, 'show_molecule', {
    title: 'Show an interactive molecule',
    description: 'Display the exact resolved PubChem structure in Lupi Live. Use the structureRef returned by resolve_molecule, and reuse that reference for follow-up highlights or display styles. Highlight elements using symbols such as N for nitrogen, or select stable PubChem atom IDs. Each result is a complete view; an earlier card need not change. Dragging and zooming are local to the viewer.',
    inputSchema: z.object({
      structureRef: z.string().regex(STRUCTURE_REF).max(100),
      view: z.object({
        style: z.enum(['ball-and-stick', 'spacefill']).optional(),
        highlightElements: z.array(z.string().regex(/^[A-Z][a-z]?$/)).max(12).optional(),
        highlightAtomIds: z.array(z.number().int().positive().max(2_147_483_647)).max(MAX_PLUGIN_ATOMS).optional(),
      }).strict().optional(),
    }).strict(),
    outputSchema: showOutputSchema,
    annotations,
    _meta: { ui: { resourceUri: CHATGPT_UI_URI } },
  }, async ({ structureRef, view }) => service.show(structureRef, view));

  registerAppResource(server, 'lupi-molecule-viewer', CHATGPT_UI_URI, {
    description: 'Interactive Lupi molecular viewer with PubChem source identity and local rotate, zoom, and atom highlighting.',
  }, async () => {
    const html = await loadWidgetHtml();
    if (!WIDGET_MARKER.test(html)) throw new Error('The Lupi molecule widget is unavailable. Build the ChatGPT widget with this release.');
    return { contents: [{
      uri: CHATGPT_UI_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: html,
      _meta: {
        ui: {
          domain: 'https://lupi.live',
          prefersBorder: true,
          csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
        },
      },
    }] };
  });
  return server;
}

async function loadWidget(env: ChatGptEnv) {
  if (!env.WEB_ASSETS) throw new Error('Lupi widget assets are unavailable.');
  const response = await env.WEB_ASSETS.fetch(new Request(`https://lupi.live${CHATGPT_WIDGET_PATH}`));
  if (!response.ok) throw new Error('Lupi widget assets are unavailable.');
  const html = await response.text();
  if (new TextEncoder().encode(html).length > MAX_WIDGET_BYTES) throw new Error('Lupi widget exceeds its resource size limit.');
  return html;
}

function responseJson(body: unknown, status: number, headers: Headers) {
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleChatGptMcp(request: Request, env: ChatGptEnv = {}, service = defaultService): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = new Set(['https://chatgpt.com', 'https://lupi.live', 'https://www.lupi.live', url.origin, ...(env.CORS_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean)]);
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin && !allowed.has(origin)) return responseJson({ error: 'Origin is not allowed.' }, 403, headers);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID');
  headers.set('Access-Control-Expose-Headers', 'MCP-Session-Id, MCP-Protocol-Version');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') {
    headers.set('Allow', 'POST, OPTIONS');
    return responseJson({ error: 'This stateless MCP endpoint accepts POST requests.' }, 405, headers);
  }

  // Read a bounded body before giving it to the SDK. Limit streaming bodies
  // as well as Content-Length; never trust the caller's declared size.
  let boundedRequest = request;
  if (request.method === 'POST') {
    if (Number(request.headers.get('Content-Length') ?? 0) > MAX_REQUEST_BYTES) return responseJson({ error: 'Request exceeds 8192 bytes.' }, 413, headers);
    if (request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > MAX_REQUEST_BYTES) { await reader.cancel(); return responseJson({ error: 'Request exceeds 8192 bytes.' }, 413, headers); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      boundedRequest = new Request(request.url, { method: request.method, headers: request.headers, body: bytes, signal: request.signal });
    }
  }

  const server = createPluginServer({ service, loadWidgetHtml: () => loadWidget(env) });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(boundedRequest);
    headers.forEach((value, key) => response.headers.set(key, value));
    return response;
  } finally {
    await server.close();
  }
}
