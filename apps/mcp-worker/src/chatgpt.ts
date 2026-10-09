/** Public, read-only OMol25 and PubChem tools for the Lupi Live ChatGPT plugin.
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
import { estimateOmol25Bonds, omol25BondSummary, type Omol25Molecule } from '@atlas/core/omol25/widget';
import { MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import {
  PubChemError,
  resolvePubChemMolecule,
  type PubChemFetchOptions,
  type PubChemMolecule,
} from '@atlas/core/pubchem';
import { OmolService, OMOL_STRUCTURE_REF } from './chatgptOmol';
import { OMOL_DATASETS } from './scienceData';
import { recommendMolecule } from './discovery';
import type { JevEnv } from './jev';
import { DISCOVERY_CATALOG_VERSION, DISCOVERY_MAX_CHARS, DISCOVERY_SCHEMA } from '@atlas/core/jev';

// Cloudflare Workers do not allow runtime code generation.
z.config({ jitless: true });

export const CHATGPT_MCP_PATH = '/chatgpt/mcp';
export const CHATGPT_UI_URI = 'ui://lupi/molecule-v3.html';
export const CHATGPT_WIDGET_PATH = '/chatgpt-widget/index.html';
export const CHATGPT_VERSION = '0.4.0';
export const MAX_PLUGIN_ATOMS = 1_000;
export const MAX_PENDING_PLUGIN_LOOKUPS = 4;
const MAX_REQUEST_BYTES = 8192;
const MAX_WIDGET_BYTES = 5 * 1024 * 1024;
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHED_STRUCTURES = 64;
const MAX_CACHED_QUERIES = 128;
const STRUCTURE_REF = /^pubchem:([1-9]\d{0,9}):(3d|2d):([a-f0-9]{64})$/;
const WIDGET_MARKER = /<meta\s+name=["']lupi-widget["']\s+content=["']molecule-v3["']\s*\/?>/i;

export interface ChatGptEnv extends JevEnv {
  WEB_ASSETS?: { fetch(request: Request): Promise<Response> };
  CORS_ORIGINS?: string;
}

export interface MoleculeView {
  style: 'ball-and-stick' | 'spacefill';
  highlightElements: string[];
  highlightAtomIds: number[];
  showContacts?: boolean;
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

function elementSummary(molecule: PubChemMolecule | Omol25Molecule) {
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

function omolSummary(molecule: Omol25Molecule, structureRef: string, cacheHit: boolean) {
  return {
    structureRef,
    source: 'OMol25' as const,
    collection: molecule.collection,
    rowIndex: molecule.rowIndex,
    repository: molecule.repository,
    coverage: molecule.coverage,
    configurationId: molecule.configurationId,
    propertyId: molecule.propertyId,
    name: molecule.name,
    formula: molecule.formula,
    sourceUrl: molecule.sourceUrl,
    recordUrl: molecule.recordUrl,
    websiteUrl: molecule.websiteUrl,
    retrievedAt: molecule.retrievedAt,
    dimension: molecule.dimension,
    coordinateUnits: molecule.coordinateUnits,
    atomCount: molecule.atoms.ids.length,
    atomIdKind: molecule.atomIdKind,
    ...omol25BondSummary(estimateOmol25Bonds(molecule)),
    chemistry: molecule.chemistry ?? null,
    elements: elementSummary(molecule),
    cacheHit,
  };
}

export function resolveMoleculeView(molecule: PubChemMolecule | Omol25Molecule, input: ViewInput = {}): MoleculeView {
  const selected = new Set<number>();
  const sourceIds = new Set(molecule.atoms.ids);
  const elements = [...new Set(input.highlightElements ?? [])];
  for (const symbol of elements) {
    const atomicNumber = getAtomicNumberBySymbol(symbol);
    if (atomicNumber === undefined) throw new PluginError('invalid_view', `Unknown element symbol: ${symbol}. Use a chemical symbol such as N.`);
    const indices = molecule.atoms.elements.flatMap((element, index) => element === atomicNumber ? [index] : []);
    if (indices.length === 0) throw new PluginError('invalid_view', `${molecule.name} has no ${symbol} atoms in this structure.`);
    for (const index of indices) selected.add(molecule.atoms.ids[index]);
  }
  for (const id of input.highlightAtomIds ?? []) {
    if (!sourceIds.has(id)) throw new PluginError('invalid_view', `Atom ID ${id} is absent from this structure.`);
    selected.add(id);
  }
  return {
    style: input.style ?? 'ball-and-stick',
    ...(input.showContacts !== undefined ? { showContacts: input.showContacts } : {}),
    highlightElements: elements,
    highlightAtomIds: [...selected].sort((a, b) => a - b),
  };
}

function textContent(text: string) { return [{ type: 'text' as const, text }]; }

function toolFailure(error: unknown) {
  const known = error instanceof PluginError || error instanceof PubChemError;
  const message = error instanceof Error ? error.message : 'The molecule could not be loaded. Please retry.';
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
const defaultOmolService = new OmolService();

function shownOmol(loaded: Awaited<ReturnType<OmolService['load']>>, input: ViewInput = {}) {
  const { molecule, structureRef, cacheHit } = loaded;
  const view = resolveMoleculeView(molecule, input);
  return {
    content: textContent(`Prepared an interactive view of OMol25 ${molecule.collection} row ${molecule.rowIndex}: ${molecule.formula}, ${molecule.atoms.ids.length} source-coordinate atoms. Bonds and contacts are estimated by lupi-bonds.molecular.v1, not supplied by OMol25. Bond orders are not estimated. Hover over atoms or bonds for details, or tap to pin them. Atom IDs are generated from this row order.`),
    structuredContent: {
      status: 'shown' as const,
      ...omolSummary(molecule, structureRef, cacheHit),
      renderStatus: 'awaiting-component' as const,
      view,
    },
    _meta: { molecule, view },
  };
}

export interface CreatePluginServerOptions {
  service?: MoleculeService;
  omolService?: OmolService;
  loadWidgetHtml: () => Promise<string>;
  discoveryEnv?: JevEnv;
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
const omolIdentityOutputSchema = z.object({
  structureRef: z.string().regex(OMOL_STRUCTURE_REF),
  source: z.literal('OMol25'),
  collection: z.string(),
  rowIndex: z.number().int().nonnegative(),
  repository: z.string(),
  coverage: z.enum(['complete', 'indexed-preview']),
  configurationId: z.string().nullable(),
  propertyId: z.string().nullable(),
  name: z.string(),
  formula: z.string(),
  sourceUrl: z.string().url(),
  recordUrl: z.string().url(),
  websiteUrl: z.string().url(),
  retrievedAt: z.string(),
  dimension: z.literal('3d'),
  coordinateUnits: z.literal('angstrom'),
  atomCount: z.number().int().min(1).max(MAX_PLUGIN_ATOMS),
  atomIdKind: z.literal('synthetic-row'),
  bondCount: z.number().int().nonnegative(),
  contactCount: z.number().int().nonnegative(),
  bondSource: z.literal('inferred'),
  sourceBondTopology: z.literal('not-provided'),
  bondRecipe: z.literal(MOLECULAR_RECIPE_ID),
  bondOrders: z.literal('not-estimated'),
  bondKinds: z.object({ covalent: z.number().int().nonnegative(), coordination: z.number().int().nonnegative(), ionicContact: z.number().int().nonnegative() }).strict(),
  bondEvidence: z.object({ long: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), nearMiss: z.number().int().nonnegative(), clashes: z.number().int().nonnegative(), fragments: z.number().int().nonnegative(), bridgingH: z.number().int().nonnegative(), ionCarbonClose: z.number().int().nonnegative() }).strict(),
  bondParameters: z.object({ tolerance: z.number(), contactMargin: z.number(), clashFloor: z.number(), longExcess: z.number() }).strict(),
  chemistry: z.object({ totalCharge: z.number().int().nullable(), spinMultiplicity: z.number().int().positive().nullable(), source: z.enum(['record', 'split-definition', 'unavailable']), domain: z.string().nullable() }).nullable(),
  elements: z.array(z.object({ atomicNumber: z.number().int().min(1).max(118), symbol: z.string(), count: z.number().int().positive() })),
  cacheHit: z.boolean(),
}).strict();
const errorOutputSchema = z.object({ status: z.literal('error'), code: z.string(), message: z.string() }).strict();
const viewOutputSchema = z.object({
  style: z.enum(['ball-and-stick', 'spacefill']),
  highlightElements: z.array(z.string()),
  highlightAtomIds: z.array(z.number().int().positive()),
  showContacts: z.boolean().optional(),
}).strict();
const discoveryOutputSchema = z.object({
  schema: z.literal(DISCOVERY_SCHEMA), catalogVersion: z.literal(DISCOVERY_CATALOG_VERSION),
  query: z.string().min(1).max(DISCOVERY_MAX_CHARS), status: z.enum(['matched', 'no-match']),
  method: z.enum(['exact', 'jev', 'unavailable', 'uncertain']), model: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(), note: z.string(),
  candidates: z.array(z.object({
    id: z.string(), name: z.string(), formula: z.string(), atoms: z.number().int().positive(),
    pubchemCid: z.number().int().positive(), aliases: z.array(z.string()), description: z.string(),
  }).strict()).max(1),
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
const showOutputSchema = z.union([
  identityOutputSchema.extend({ status: z.literal('shown'), renderStatus: z.literal('awaiting-component'), view: viewOutputSchema }),
  omolIdentityOutputSchema.extend({ status: z.literal('shown'), renderStatus: z.literal('awaiting-component'), view: viewOutputSchema }),
  errorOutputSchema,
]);

export function createPluginServer({ service = defaultService, omolService = defaultOmolService, loadWidgetHtml, discoveryEnv = {} }: CreatePluginServerOptions) {
  const server = new McpServer({ name: 'lupi-live', version: CHATGPT_VERSION }, { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true };

  server.registerTool('recommend_molecule', {
    title: 'Find a molecule from an everyday description',
    description: 'Match a name, formula, or everyday description to one of 12 known compounds shared with the native Lupi app. Exact names work without AI. Jev may recommend a listed compound with explicitly inferred confidence, or withhold a weak match. This is a small discovery catalogue, not a scientific property prediction or medical recommendation. For a match, pass the returned pubchemCid to resolve_molecule, then show_molecule with its exact structureRef. For broader research discovery use OMol25 tools.',
    inputSchema: z.object({ query: z.string().trim().min(1).max(DISCOVERY_MAX_CHARS) }).strict(),
    outputSchema: discoveryOutputSchema,
    annotations,
  }, async ({ query }) => {
    try {
      const result = await recommendMolecule(query, discoveryEnv);
      return { content: textContent(result.note), structuredContent: { ...result } };
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool('list_omol25_collections', {
    title: 'Explore the OMol25 molecule collections',
    description: 'Start here for Open Molecules 2025 discovery. Describe the complete 34.3-million-row neutral training collection, complete neutral validation collection, and explicitly limited indexed previews. OMol25 source records include 3D coordinates but no bond topology. Lupi estimates covalent bonds, coordination and ionic contacts using lupi-bonds.molecular.v1.',
    inputSchema: z.object({}).strict(),
    annotations,
  }, async () => {
    const result = omolService.list();
    return { content: textContent('OMol25 includes a complete public neutral training split and a smaller complete neutral validation split. Use search_omol25 to browse, then open_omol25 to view a row.'), structuredContent: { status: 'collections', ...result } };
  });

  server.registerTool('search_omol25', {
    title: 'Search and page through OMol25 molecules',
    description: 'Search or browse OMol25 source structures, defaulting to the complete 34.3-million-row neutral training collection. Use exact formula for formula search, query for general text, or neither to page. Return source row indexes; call open_omol25 with a chosen collection and rowIndex. Other collections marked indexed-preview do not cover every source record.',
    inputSchema: z.object({
      collection: z.enum(OMOL_DATASETS.map((dataset) => dataset.id) as [string, ...string[]]).default('neutral-train'),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(24).default(10),
      query: z.string().trim().min(1).max(120).optional(),
      formula: z.string().trim().min(1).max(80).optional(),
    }).strict(),
    annotations,
  }, async (input) => {
    try {
      const page = await omolService.browse(input);
      return {
        content: textContent(`Found ${page.rows.length} OMol25 ${page.collection} rows${page.partial ? ' in an indexed preview' : ''}. Choose a rowIndex and call open_omol25. Source bonds are not provided.`),
        structuredContent: { status: 'results', ...page },
      };
    } catch (error) { return toolFailure(error); }
  });

  registerAppTool(server, 'open_omol25', {
    title: 'Open an OMol25 molecule in the Lupi viewer',
    description: 'Open the exact OMol25 collection and rowIndex returned by search_omol25. Show its source 3D coordinates in an interactive Lupi card. Draw estimated covalent bonds as solid, coordination as dashed, and ionic contacts as dotted guides using lupi-bonds.molecular.v1. These are inferred, not source bonds or bond orders. Hover or tap atoms and bonds for details. Follow-up highlights may reuse the returned structureRef with show_molecule.',
    inputSchema: z.object({
      collection: z.enum(OMOL_DATASETS.map((dataset) => dataset.id) as [string, ...string[]]),
      rowIndex: z.number().int().nonnegative(),
      view: z.object({
        style: z.enum(['ball-and-stick', 'spacefill']).optional(),
        showContacts: z.boolean().optional().describe('Show dotted ionic contacts for OMol25 estimates; defaults to true. Contacts are not covalent bonds.'),
        highlightElements: z.array(z.string().regex(/^[A-Z][a-z]?$/)).max(12).optional(),
        highlightAtomIds: z.array(z.number().int().positive()).max(MAX_PLUGIN_ATOMS).optional(),
      }).strict().optional(),
    }).strict(),
    outputSchema: showOutputSchema,
    annotations,
    _meta: { ui: { resourceUri: CHATGPT_UI_URI } },
  }, async ({ collection, rowIndex, view }) => {
    try { return shownOmol(await omolService.load(collection, rowIndex), view); }
    catch (error) { return toolFailure(error); }
  });

  server.registerTool('resolve_molecule', {
    title: 'Resolve an exact compound on PubChem',
    description: 'Secondary lookup for a specific named compound or PubChem CID, such as L-theanine or CID 439378. Retrieve source atoms and bonds and return a pinned structure reference; then call show_molecule. For broad molecule discovery or OMol25 research structures, use list_omol25_collections and search_omol25 instead. Source coordinates may be 2D; do not describe those as a 3D conformer.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).describe('Exact compound name, decimal PubChem CID, or cid:439378.'),
      cacheMode: z.enum(['prefer-cache', 'refresh']).optional().describe('Use refresh for an explicitly fresh PubChem lookup; otherwise validated source records may be reused.'),
    }).strict(),
    outputSchema: resolveOutputSchema,
    annotations,
  }, async ({ query, cacheMode }) => service.resolve(query, cacheMode));

  registerAppTool(server, 'show_molecule', {
    title: 'Show an interactive molecule',
    description: 'Display an exact pinned OMol25 or PubChem structure in Lupi Live. Reuse the structureRef returned by open_omol25 or resolve_molecule for follow-up highlights and styles. OMol25 atom IDs are generated from row order; bonds and ionic contacts are explicitly inferred with lupi-bonds.molecular.v1, with no bond-order prediction. PubChem IDs and bonds remain source supplied. view.showContacts controls OMol25 ionic contacts. Each result is a complete view.',
    inputSchema: z.object({
      structureRef: z.string().regex(/^(?:pubchem:[1-9]\d{0,9}:(?:3d|2d):[a-f0-9]{64}|omol25:[a-z0-9-]+:\d+:[a-f0-9]{64})$/).max(160),
      view: z.object({
        style: z.enum(['ball-and-stick', 'spacefill']).optional(),
        showContacts: z.boolean().optional().describe('Show dotted ionic contacts for OMol25 estimates; defaults to true. Contacts are not covalent bonds.'),
        highlightElements: z.array(z.string().regex(/^[A-Z][a-z]?$/)).max(12).optional(),
        highlightAtomIds: z.array(z.number().int().positive().max(2_147_483_647)).max(MAX_PLUGIN_ATOMS).optional(),
      }).strict().optional(),
    }).strict(),
    outputSchema: showOutputSchema,
    annotations,
    _meta: { ui: { resourceUri: CHATGPT_UI_URI } },
  }, async ({ structureRef, view }) => {
    if (!OMOL_STRUCTURE_REF.test(structureRef)) return service.show(structureRef, view);
    try { return shownOmol(await omolService.fromRef(structureRef), view); }
    catch (error) { return toolFailure(error); }
  });

  registerAppResource(server, 'lupi-molecule-viewer', CHATGPT_UI_URI, {
    description: 'Interactive Lupi molecular viewer for OMol25 and PubChem source structures, with local rotate, zoom, and atom highlighting.',
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

export async function handleChatGptMcp(request: Request, env: ChatGptEnv = {}, service = defaultService, omolService = defaultOmolService): Promise<Response> {
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

  const server = createPluginServer({ service, omolService, loadWidgetHtml: () => loadWidget(env), discoveryEnv: env });
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
