/**
 * Protocol integration tests use the official MCP client and Streamable HTTP
 * transport. The network boundary and clock are injected. Structure/property
 * responses replay recorded fixtures (see test-fixtures/chatgpt/provenance.json);
 * name lookup and error replies are synthetic. The fixtures are not bundled
 * launch assets. This suite does not claim rendering in ChatGPT.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { PubChemMolecule } from '@atlas/core/pubchem';
import theanine3d from '../test-fixtures/chatgpt/cid-439378-3d.json';
import theanine2d from '../test-fixtures/chatgpt/cid-439378-2d.json';
import theanineProperties from '../test-fixtures/chatgpt/cid-439378-properties.json';
import carbonDioxide3d from '../test-fixtures/chatgpt/cid-280-3d.json';
import carbonDioxideProperties from '../test-fixtures/chatgpt/cid-280-properties.json';
import {
  CHATGPT_MCP_PATH,
  CHATGPT_UI_URI,
  CHATGPT_WIDGET_PATH,
  MoleculeService,
  handleChatGptMcp,
  type ChatGptEnv,
  type MoleculeServiceOptions,
} from './chatgpt';
import { OmolService } from './chatgptOmol';

const ENDPOINT = `https://lupi.live${CHATGPT_MCP_PATH}`;
const FIXTURE_HTML = '<!doctype html><html><head><meta name="lupi-widget" content="molecule-v3"></head><body>Protocol-test widget placeholder</body></html>';
const RETRIEVED_AT = '2026-09-29T20:00:00.000Z';
const NO_GEOMETRY = ['molecule', 'atoms', 'bonds', 'positions', 'geometry'];

type RpcMessage = {
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
};
type ToolResult = Awaited<ReturnType<Client['callTool']>>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function requestUrl(input: Parameters<typeof fetch>[0]) {
  return new URL(input instanceof Request ? input.url : String(input));
}

/** Mutable source replies model upstream changes; production parsing and
 * MoleculeService still run normally. Every request must stay at PubChem. */
function pubchemBoundary() {
  const state = {
    theanineRecord: structuredClone(theanine3d),
    cids: [439378],
    no3d: false,
    lookupStatus: 200,
  };
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = requestUrl(input);
    if (url.origin !== 'https://pubchem.ncbi.nlm.nih.gov') throw new Error(`Unexpected fetch origin: ${url.origin}`);
    if (url.pathname.includes('/compound/name/')) {
      if (state.lookupStatus !== 200) return jsonResponse({ Fault: { Code: 'PUGREST.NotFound' } }, state.lookupStatus);
      return jsonResponse({ IdentifierList: { CID: state.cids } });
    }
    if (url.pathname === '/rest/pug/compound/cid/439378/property/Title,MolecularFormula/JSON') return jsonResponse(theanineProperties);
    if (url.pathname === '/rest/pug/compound/cid/280/property/Title,MolecularFormula/JSON') return jsonResponse(carbonDioxideProperties);
    if (url.pathname === '/rest/pug/compound/cid/439378/record/JSON') {
      if (url.searchParams.get('record_type') === '2d') return jsonResponse(theanine2d);
      return state.no3d ? jsonResponse({ Fault: { Code: 'PUGREST.NotFound' } }, 404) : jsonResponse(state.theanineRecord);
    }
    if (url.pathname === '/rest/pug/compound/cid/280/record/JSON') return jsonResponse(carbonDioxide3d);
    throw new Error(`Unexpected PubChem request: ${url.href}`);
  });
  return { fetch: fetchMock, state };
}

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.restoreAllMocks();
});

async function connected(options: {
  upstream?: ReturnType<typeof pubchemBoundary>;
  serviceOptions?: MoleculeServiceOptions;
  initializeVersion?: string;
  widgetHtml?: string;
  env?: ChatGptEnv;
  omolService?: OmolService;
} = {}) {
  const upstream = options.upstream ?? pubchemBoundary();
  const serviceOptions: MoleculeServiceOptions = {
    fetch: upstream.fetch,
    now: () => new Date(RETRIEVED_AT),
    ...options.serviceOptions,
  };
  let service = new MoleculeService(serviceOptions);
  const assetsFetch = vi.fn(async (_request: Request) => new Response(options.widgetHtml ?? FIXTURE_HTML, {
    headers: { 'Content-Type': 'text/html' },
  }));
  const env = options.env ?? { WEB_ASSETS: { fetch: assetsFetch } };
  const exchanges: Array<{ request: Request; rpc?: RpcMessage; status: number; result?: RpcMessage }> = [];
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: async (input, init) => {
      let request = new Request(input, init);
      let rpc: RpcMessage | undefined;
      if (request.method === 'POST') {
        rpc = await request.clone().json() as RpcMessage;
        // Exercise protocol negotiation with the official client's own
        // initialize request; all other transport traffic is unmodified.
        if (rpc.method === 'initialize' && options.initializeVersion) {
          rpc.params = { ...rpc.params, protocolVersion: options.initializeVersion };
          request = new Request(request, { body: JSON.stringify(rpc) });
        }
      }
      const response = await handleChatGptMcp(request, env, service, options.omolService);
      const result = response.status === 202 ? undefined : await response.clone().json() as RpcMessage;
      exchanges.push({ request, rpc, status: response.status, result });
      return response;
    },
  });
  const client = new Client({ name: 'lupi-protocol-test', version: '1.0.0' });
  clients.push(client);
  await client.connect(transport);
  // Populate the SDK's advertised output-schema validators before tool calls.
  await client.listTools();
  return {
    client, upstream, exchanges, assetsFetch,
    restart(extraOptions: MoleculeServiceOptions = {}) { service = new MoleculeService({ ...serviceOptions, ...extraOptions }); },
  };
}

function summary(result: ToolResult) {
  expect(result).toHaveProperty('structuredContent');
  return result.structuredContent as Record<string, unknown>;
}

function sourceMolecule(result: ToolResult): PubChemMolecule {
  expect(result).toHaveProperty('_meta.molecule');
  return (result._meta as { molecule: PubChemMolecule }).molecule;
}

function noGeometry(result: unknown) {
  for (const key of NO_GEOMETRY) {
    expect(result).not.toHaveProperty(key);
    expect(result).not.toHaveProperty(`structuredContent.${key}`);
    expect(result).not.toHaveProperty(`_meta.${key}`);
  }
}

async function resolve(client: Client, query = 'L-theanine', cacheMode?: 'prefer-cache' | 'refresh') {
  const result = await client.callTool({ name: 'resolve_molecule', arguments: { query, ...(cacheMode ? { cacheMode } : {}) } });
  expect(result.isError).not.toBe(true);
  expect(summary(result).status).toBe('resolved');
  return result;
}

async function show(client: Client, structureRef: unknown, view?: Record<string, unknown>) {
  return client.callTool({ name: 'show_molecule', arguments: { structureRef, ...(view ? { view } : {}) } });
}

describe('ChatGPT MCP Streamable HTTP integration', () => {
  it.each(['2025-06-18', '2025-11-25'])('negotiates protocol %s and completes the SDK initialization sequence', async (initializeVersion) => {
    const { client, exchanges } = await connected({ initializeVersion });
    await client.listTools();
    const initialize = exchanges.find((entry) => entry.rpc?.method === 'initialize')!;
    expect(initialize.status).toBe(200);
    expect(initialize.result?.result).toMatchObject({
      protocolVersion: initializeVersion,
      serverInfo: { name: 'lupi-live', version: '0.3.0' },
      capabilities: { tools: {}, resources: {} },
    });
    expect(exchanges).toContainEqual(expect.objectContaining({ rpc: expect.objectContaining({ method: 'notifications/initialized' }), status: 202 }));
    const toolsRequest = exchanges.find((entry) => entry.rpc?.method === 'tools/list')!;
    expect(toolsRequest.request.headers.get('MCP-Protocol-Version')).toBe(initializeVersion);
    expect(toolsRequest.request.headers.get('Accept')).toContain('application/json');
    expect(toolsRequest.request.headers.get('Accept')).toContain('text/event-stream');
  });

  it('advertises OMol25 discovery and PubChem lookup with bounded read-only tools', async () => {
    const { client, upstream } = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['list_omol25_collections', 'open_omol25', 'resolve_molecule', 'search_omol25', 'show_molecule']);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true });
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      if (['open_omol25', 'resolve_molecule', 'show_molecule'].includes(tool.name)) expect(tool.outputSchema).toBeDefined();
    }
    const renderTool = tools.find((tool) => tool.name === 'show_molecule')!;
    expect(renderTool._meta).toMatchObject({ ui: { resourceUri: 'ui://lupi/molecule-v3.html' } });
    expect(renderTool.inputSchema.properties?.view).toMatchObject({ additionalProperties: false });
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it('serves the versioned widget resource with MIME, explicit CSP, and widget domain', async () => {
    const { client, assetsFetch } = await connected();
    const { resources } = await client.listResources();
    expect(resources).toEqual([expect.objectContaining({ uri: CHATGPT_UI_URI, mimeType: 'text/html;profile=mcp-app' })]);
    const result = await client.readResource({ uri: CHATGPT_UI_URI });
    expect(result.contents).toEqual([expect.objectContaining({
      uri: CHATGPT_UI_URI,
      mimeType: 'text/html;profile=mcp-app',
      text: FIXTURE_HTML,
      _meta: { ui: {
        domain: 'https://lupi.live',
        prefersBorder: true,
        csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
      } },
    })]);
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    expect(assetsFetch.mock.calls[0][0].url).toBe(`https://lupi.live${CHATGPT_WIDGET_PATH}`);
  });

  it('lists, browses, opens, and highlights a pinned OMol25 source row', async () => {
    const route = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/rows')) return jsonResponse({
        dataset: 'neutral-train', partial: false, matchedRows: 1,
        rows: [{ rowIndex: 7, formula: 'H2O', name: 'Water', atomCount: 3, elements: ['H', 'O'], configurationId: 'config-7', propertyId: 'property-7' }],
      });
      if (url.pathname.endsWith('/structures/7.xyz')) return new Response('3\nOMol25 neutral-train row=7 | bonds=not-provided\nO 0 0 0\nH 0.75 0.5 0\nH -0.75 0.5 0\n');
      throw new Error(`Unexpected OMol25 route: ${url.pathname}`);
    });
    const { client } = await connected({ omolService: new OmolService(route) });
    const collections = await client.callTool({ name: 'list_omol25_collections', arguments: {} });
    expect(collections.isError).not.toBe(true);
    expect((summary(collections).collections as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 'neutral-train', coverage: 'complete', indexedRows: 34_335_828 });

    const browsed = await client.callTool({ name: 'search_omol25', arguments: { collection: 'neutral-train', offset: 0, limit: 10, formula: 'H2O' } });
    expect(browsed.isError).not.toBe(true);
    expect(summary(browsed)).toMatchObject({ source: 'OMol25', coverage: 'complete', rows: [{ rowIndex: 7, formula: 'H2O' }] });
    const opened = await client.callTool({ name: 'open_omol25', arguments: { collection: 'neutral-train', rowIndex: 7 } });
    expect(opened.isError).not.toBe(true);
    const identity = summary(opened);
    expect(identity).toMatchObject({ source: 'OMol25', collection: 'neutral-train', rowIndex: 7, atomCount: 3, bondCount: 2, bondSource: 'inferred', sourceBondTopology: 'not-provided', bondRecipe: 'lupi-bonds.molecular.v1', contactCount: 0, bondOrders: 'not-estimated', atomIdKind: 'synthetic-row' });
    const molecule = (opened._meta as { molecule: { atoms: { ids: number[] }; bonds: { aid1: number[] } } }).molecule;
    expect(molecule.atoms.ids).toEqual([1, 2, 3]);
    expect(molecule.bonds.aid1).toEqual([]);
    const shown = await client.callTool({ name: 'show_molecule', arguments: { structureRef: identity.structureRef, view: { highlightElements: ['O'], showContacts: false } } });
    expect(shown.isError).not.toBe(true);
    expect(summary(shown)).toMatchObject({ source: 'OMol25', structureRef: identity.structureRef, bondCount: 2, bondRecipe: 'lupi-bonds.molecular.v1', view: { highlightAtomIds: [1], highlightElements: ['O'], showContacts: false } });
    expect(route).toHaveBeenCalledTimes(3);
  });

  it('rejects the generic website HTML when the dedicated widget marker is missing', async () => {
    const { client } = await connected({ widgetHtml: '<!doctype html><html><body>Lupi website fallback</body></html>' });
    await expect(client.readResource({ uri: CHATGPT_UI_URI })).rejects.toThrow(/widget is unavailable/i);
  });

  it.each([
    ['missing asset binding', {}],
    ['missing widget asset', { WEB_ASSETS: { fetch: async () => new Response('Missing', { status: 404 }) } }],
    ['oversized widget asset', { WEB_ASSETS: { fetch: async () => new Response(FIXTURE_HTML + ' '.repeat(5 * 1024 * 1024)) } }],
  ] as const)('returns an MCP resource error for %s', async (_label, env) => {
    const { client } = await connected({ env });
    await expect(client.readResource({ uri: CHATGPT_UI_URI })).rejects.toThrow(/widget|assets/i);
  });

  it('retrieves the recorded third-party atom/bond arrays and applies nitrogen highlighting to the same pinned compound', async () => {
    const { client, upstream } = await connected();
    const found = await resolve(client, 'L-theanine', 'refresh');
    expect(summary(found)).toMatchObject({
      cid: 439378, name: 'L-Theanine', formula: 'C7H14N2O3',
      source: 'PubChem', sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/439378',
      dimension: '3d', coordinateUnits: 'angstrom', atomCount: 26, bondCount: 25,
      bondSource: 'source-connection-table', cacheHit: false, retrievedAt: RETRIEVED_AT,
    });
    noGeometry(found);
    expect(summary(found).structureRef).toMatch(/^pubchem:439378:3d:[a-f0-9]{64}$/);
    const displayed = await show(client, summary(found).structureRef);
    const highlighted = await show(client, summary(found).structureRef, { highlightElements: ['N'] });
    expect(summary(highlighted)).toMatchObject({
      cid: 439378, structureRef: summary(found).structureRef,
      renderStatus: 'awaiting-component',
      view: { style: 'ball-and-stick', highlightElements: ['N'], highlightAtomIds: [4, 5] },
    });
    const record = theanine3d.PC_Compounds[0];
    const molecule = sourceMolecule(highlighted);
    expect(molecule.atoms.ids).toEqual(record.atoms.aid);
    expect(molecule.atoms.elements).toEqual(record.atoms.element);
    const conformer = record.coords[0].conformers[0];
    expect(molecule.atoms.positions).toEqual(record.coords[0].aid.flatMap((_, i) => [conformer.x[i], conformer.y[i], conformer.z[i]]));
    expect(molecule.bonds).toEqual(record.bonds);
    expect(molecule.bonds.order.filter((order) => order === 2)).toHaveLength(2);
    expect(sourceMolecule(displayed)).toEqual(molecule);
    expect(summary(displayed).view).toEqual({ style: 'ball-and-stick', highlightElements: [], highlightAtomIds: [] });
    expect(upstream.fetch).toHaveBeenCalledTimes(3);
    const nameRequest = requestUrl(upstream.fetch.mock.calls[0][0]);
    expect(nameRequest.pathname).toBe('/rest/pug/compound/name/L-theanine/cids/JSON');
    expect(nameRequest.searchParams.get('name_type')).toBe('complete');
    for (const [, init] of upstream.fetch.mock.calls) {
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('Cache-Control')).toBe('no-cache');
    }
  });

  it.each(['439378', 'cid:439378', 'PubChem CID 439378'])('resolves direct identifier %s without name lookup', async (query) => {
    const { client, upstream } = await connected();
    const found = await resolve(client, query);
    expect(summary(found).cid).toBe(439378);
    expect(upstream.fetch).toHaveBeenCalledTimes(2);
    expect(upstream.fetch.mock.calls.every(([input]) => !requestUrl(input).pathname.includes('/name/'))).toBe(true);
  });

  it('keeps two molecules and two independent highlight selections addressable at once', async () => {
    const { client, upstream } = await connected();
    const theanine = await resolve(client);
    const carbonDioxide = await resolve(client, 'cid:280');
    const first = await show(client, summary(theanine).structureRef, { highlightElements: ['N'] });
    const second = await show(client, summary(carbonDioxide).structureRef, { highlightElements: ['O'], style: 'spacefill' });
    const firstAgain = await show(client, summary(theanine).structureRef, { highlightAtomIds: [4] });
    expect(summary(first)).toMatchObject({ cid: 439378, view: { highlightAtomIds: [4, 5] } });
    expect(summary(second)).toMatchObject({ cid: 280, formula: 'CO2', dimension: '3d', coordinateUnits: 'angstrom', view: { style: 'spacefill', highlightAtomIds: [1, 2] } });
    expect(sourceMolecule(second).bonds.order).toEqual([2, 2]);
    expect(sourceMolecule(second).atoms.positions.every((value, index) => index % 3 !== 2 || value === 0)).toBe(true);
    expect(summary(firstAgain)).toMatchObject({ cid: 439378, view: { highlightElements: [], highlightAtomIds: [4] } });
    expect(summary(firstAgain).structureRef).toBe(summary(theanine).structureRef);
    expect(sourceMolecule(firstAgain)).toEqual(sourceMolecule(first));
    expect(upstream.fetch).toHaveBeenCalledTimes(5);
  });

  it('labels a successful source 2D fallback as depiction units and keeps source bonds', async () => {
    const upstream = pubchemBoundary();
    upstream.state.no3d = true;
    const { client } = await connected({ upstream });
    const found = await resolve(client);
    expect(summary(found)).toMatchObject({ dimension: '2d', coordinateUnits: 'depiction', atomCount: 26, bondCount: 25 });
    const displayed = await show(client, summary(found).structureRef);
    expect(sourceMolecule(displayed).bonds).toEqual(theanine2d.PC_Compounds[0].bonds);
    expect(sourceMolecule(displayed).atoms.positions.every((value, i) => i % 3 !== 2 || value === 0)).toBe(true);
  });
});

describe('pinned PubChem identity and cache behavior through MCP', () => {
  it('bypasses cached data on refresh and preserves the earlier pinned snapshot', async () => {
    const { client, upstream } = await connected();
    const original = await resolve(client);
    upstream.state.theanineRecord.PC_Compounds[0].coords[0].conformers[0].x[0] += 0.125;
    const cached = await resolve(client);
    expect(summary(cached)).toMatchObject({ cacheHit: true, structureRef: summary(original).structureRef });
    expect(upstream.fetch).toHaveBeenCalledTimes(3);
    const refreshed = await resolve(client, 'L-theanine', 'refresh');
    expect(summary(refreshed).cacheHit).toBe(false);
    expect(summary(refreshed).structureRef).not.toBe(summary(original).structureRef);
    expect(upstream.fetch).toHaveBeenCalledTimes(6);
    for (const [, init] of upstream.fetch.mock.calls.slice(3)) {
      expect(init?.cache).toBe('no-store');
      expect(new Headers(init?.headers).get('Cache-Control')).toBe('no-cache');
    }
    const oldView = await show(client, summary(original).structureRef);
    const newView = await show(client, summary(refreshed).structureRef);
    expect(sourceMolecule(oldView).atoms.positions[0]).toBe(theanine3d.PC_Compounds[0].coords[0].conformers[0].x[0]);
    expect(sourceMolecule(newView).atoms.positions[0]).toBe(sourceMolecule(oldView).atoms.positions[0] + 0.125);
  });

  it('expires cached records and refetches instead of silently extending their age', async () => {
    let clock = 0;
    const { client, upstream } = await connected({ serviceOptions: { clock: () => clock, cacheTtlMs: 10 } });
    const first = await resolve(client);
    clock = 9;
    expect(summary(await resolve(client)).cacheHit).toBe(true);
    clock = 10;
    const afterExpiry = await resolve(client);
    expect(summary(afterExpiry)).toMatchObject({ cacheHit: false, structureRef: summary(first).structureRef });
    expect(upstream.fetch).toHaveBeenCalledTimes(6);
  });

  it('rehydrates an exact reference after a service restart and a different retrieval timestamp', async () => {
    const { client, upstream, restart } = await connected();
    const found = await resolve(client);
    restart({ now: () => new Date('2026-09-30T01:00:00Z') });
    const result = await show(client, summary(found).structureRef, { highlightElements: ['N'] });
    expect(result.isError).not.toBe(true);
    expect(summary(result)).toMatchObject({
      structureRef: summary(found).structureRef, cacheHit: false,
      retrievedAt: '2026-09-30T01:00:00.000Z', view: { highlightAtomIds: [4, 5] },
    });
    expect(upstream.fetch).toHaveBeenCalledTimes(5);
  });

  it('refuses to substitute changed upstream geometry for a pinned reference after restart', async () => {
    const { client, upstream, restart } = await connected();
    const found = await resolve(client);
    upstream.state.theanineRecord.PC_Compounds[0].coords[0].conformers[0].x[0] += 0.125;
    restart();
    const result = await show(client, summary(found).structureRef);
    expect(result).toMatchObject({ isError: true, structuredContent: { status: 'error', code: 'structure_changed' } });
    noGeometry(result);
  });

  it('will not open a forged digest even when its CID is otherwise valid', async () => {
    const { client } = await connected();
    const result = await show(client, `pubchem:439378:3d:${'0'.repeat(64)}`);
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'structure_changed' } });
    noGeometry(result);
  });
});

describe('explicit failure states and bounded tool schemas', () => {
  it('caps distinct in-flight lookups at four, coalesces an existing query while full, and releases capacity', async () => {
    const recordedSource = pubchemBoundary();
    let releaseUpstream!: () => void;
    const upstreamGate = new Promise<void>((resolve) => { releaseUpstream = resolve; });
    const heldFetch = vi.fn<typeof fetch>(async (input, init) => {
      await upstreamGate;
      const cid = /\/compound\/cid\/(\d+)\//.exec(requestUrl(input).pathname)?.[1];
      if (cid === '439378' || cid === '280') return recordedSource.fetch(input, init);
      // Deliberate faults also exercise slot release when source retrieval
      // fails; no source geometry is invented for the other test CIDs.
      return jsonResponse({ Fault: { Code: 'PUGREST.ServerBusy' } }, 503);
    });
    const resolveSpy = vi.spyOn(MoleculeService.prototype, 'resolve');
    const { client } = await connected({ serviceOptions: { fetch: heldFetch } });
    const admitted = [439378, 280, 1, 2].map((cid) => client.callTool({
      name: 'resolve_molecule', arguments: { query: `cid:${cid}` },
    }));
    let duplicate: Promise<ToolResult> | undefined;
    try {
      // Each CID retrieval starts one structure request and one metadata
      // request. Hold all eight so no admission slot can finish early.
      await vi.waitFor(() => expect(heldFetch).toHaveBeenCalledTimes(8));
      duplicate = client.callTool({ name: 'resolve_molecule', arguments: { query: 'cid:439378' } });
      await vi.waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(5));
      expect(heldFetch).toHaveBeenCalledTimes(8);

      const blocked = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'cid:962' } });
      expect(blocked).toMatchObject({ isError: true, structuredContent: { status: 'error', code: 'busy' } });
      noGeometry(blocked);
      expect(heldFetch).toHaveBeenCalledTimes(8);

      releaseUpstream();
      const [theanine, carbonDioxide, failedOne, failedTwo, joined] = await Promise.all([...admitted, duplicate]);
      expect(summary(theanine)).toMatchObject({ status: 'resolved', cid: 439378 });
      expect(summary(carbonDioxide)).toMatchObject({ status: 'resolved', cid: 280 });
      expect(summary(joined)).toMatchObject({ status: 'resolved', structureRef: summary(theanine).structureRef });
      for (const failure of [failedOne, failedTwo]) {
        expect(failure).toMatchObject({ isError: true, structuredContent: { code: 'upstream_error' } });
      }
      expect(heldFetch).toHaveBeenCalledTimes(8);

      const retried = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'cid:962' } });
      expect(retried).toMatchObject({ isError: true, structuredContent: { code: 'upstream_error' } });
      expect(heldFetch).toHaveBeenCalledTimes(10);
      expect(heldFetch.mock.calls.slice(8).every(([input]) => requestUrl(input).pathname.includes('/cid/962/'))).toBe(true);
    } finally {
      releaseUpstream();
      await Promise.allSettled(duplicate ? [...admitted, duplicate] : admitted);
    }
  });

  it('asks for a CID when PubChem returns multiple candidates, without retrieving any candidate geometry', async () => {
    const upstream = pubchemBoundary();
    upstream.state.cids = [439378, 280];
    const { client } = await connected({ upstream });
    const result = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'ambiguous fixture' } });
    expect(result).toMatchObject({ structuredContent: { status: 'ambiguous', candidates: [
      { cid: 439378, sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/439378' },
      { cid: 280, sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/280' },
    ] } });
    expect(summary(result)).not.toHaveProperty('structureRef');
    noGeometry(result);
    expect(upstream.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports not-found without inventing a molecule or geometry', async () => {
    const upstream = pubchemBoundary();
    upstream.state.lookupStatus = 404;
    const { client } = await connected({ upstream });
    const result = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'nonexistent fixture compound' } });
    expect(result).toMatchObject({ isError: true, structuredContent: { status: 'error', code: 'not_found' } });
    noGeometry(result);
    expect(upstream.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns a finite timeout error even when the injected upstream ignores abort', async () => {
    const neverReturns = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const { client } = await connected({ serviceOptions: { fetch: neverReturns, timeoutMs: 10 } });
    const result = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'L-theanine' } });
    expect(result).toMatchObject({ isError: true, structuredContent: { status: 'error', code: 'timeout' } });
    noGeometry(result);
    expect(neverReturns).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unknown element', { highlightElements: ['Qq'] }],
    ['element absent from molecule', { highlightElements: ['Au'] }],
    ['absent source atom ID', { highlightAtomIds: [999] }],
  ] as const)('rejects %s without producing a misleading view', async (_label, view) => {
    const { client, upstream } = await connected();
    const found = await resolve(client);
    const result = await show(client, summary(found).structureRef, view as Record<string, unknown>);
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'invalid_view' } });
    noGeometry(result);
    expect(upstream.fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['resolve_molecule', { query: 'L-theanine', url: 'https://example.test/structure' }],
    ['resolve_molecule', { query: 'L-theanine', cacheMode: 'forever' }],
    ['resolve_molecule', { query: ' ' }],
    ['show_molecule', { structureRef: 'https://example.test/molecule' }],
    ['show_molecule', { structureRef: `pubchem:439378:3d:${'0'.repeat(64)}`, execute: 'delete' }],
    ['show_molecule', { structureRef: `pubchem:439378:3d:${'0'.repeat(64)}`, view: { script: 'alert(1)' } }],
    ['show_molecule', { structureRef: `pubchem:439378:3d:${'0'.repeat(64)}`, view: { highlightAtomIds: [0] } }],
    ['show_molecule', { structureRef: `pubchem:439378:3d:${'0'.repeat(64)}`, view: { highlightElements: ['nitrogen'] } }],
  ] as const)('enforces the %s input schema before network work: %j', async (name, args) => {
    const { client, upstream } = await connected();
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    noGeometry(result);
    expect(upstream.fetch).not.toHaveBeenCalled();
  });

  it('has no destructive tool implementation even when explicitly invoked', async () => {
    const { client, upstream } = await connected();
    await expect(client.callTool({ name: 'delete_saved_molecules', arguments: {} })).rejects.toMatchObject({
      code: -32602, message: expect.stringContaining('not found'),
    });
    expect(upstream.fetch).not.toHaveBeenCalled();
  });
});

describe('HTTP boundary controls', () => {
  it('allows approved origins and returns explicit CORS preflight headers', async () => {
    for (const origin of ['https://chatgpt.com', 'https://lupi.live', 'https://preview.example.test']) {
      const result = await handleChatGptMcp(new Request(ENDPOINT, { method: 'OPTIONS', headers: { Origin: origin } }), {
        CORS_ORIGINS: ' https://preview.example.test ',
      });
      expect(result.status).toBe(204);
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(result.headers.get('Access-Control-Allow-Headers')).toContain('MCP-Protocol-Version');
      expect(result.headers.get('Vary')).toBe('Origin');
      expect(result.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('rejects a foreign origin before parsing or processing a tool request', async () => {
    const result = await handleChatGptMcp(new Request(ENDPOINT, {
      method: 'POST', headers: { Origin: 'https://attacker.example.test', 'Content-Type': 'application/json' }, body: '{}',
    }));
    expect(result.status).toBe(403);
    expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(await result.json()).toMatchObject({ error: expect.stringContaining('Origin') });
  });

  it.each(['GET', 'DELETE', 'PUT', 'PATCH'])('refuses %s for a stateless endpoint with no server event stream', async (method) => {
    const result = await handleChatGptMcp(new Request(ENDPOINT, { method }));
    expect(result.status).toBe(405);
    expect(result.headers.get('Allow')).toBe('POST, OPTIONS');
  });

  it('rejects oversized declared lengths and actual untrusted body bytes', async () => {
    const declared = await handleChatGptMcp(new Request(ENDPOINT, {
      method: 'POST', headers: { 'Content-Length': '8193' }, body: '{}',
    }));
    expect(declared.status).toBe(413);
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4096));
        controller.enqueue(new Uint8Array(4097));
        controller.close();
      },
    });
    const actual = await handleChatGptMcp(new Request(ENDPOINT, {
      method: 'POST', body: streamed, duplex: 'half',
    } as RequestInit));
    expect(actual.status).toBe(413);
    expect(await actual.json()).toMatchObject({ error: expect.stringContaining('8192') });
  });

  it('lets the official transport reject malformed JSON and unsupported request content', async () => {
    const malformed = await handleChatGptMcp(new Request(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{invalid',
    }));
    expect(malformed.status).toBe(400);
    const unsupported = await handleChatGptMcp(new Request(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Accept: 'application/json, text/event-stream' }, body: '{}',
    }));
    expect(unsupported.status).toBe(415);
  });
});
