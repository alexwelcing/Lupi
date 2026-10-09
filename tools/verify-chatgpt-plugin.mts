#!/usr/bin/env node
/** Release evidence for the Lupi plugin's local SDK integration. Live OMol25
 * and PubChem responses are required. A successful run is not a ChatGPT installation test. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Client, StreamableHTTPClientTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { chromium, type Page, type Frame, type BrowserContext } from 'playwright';
import { CHATGPT_UI_URI } from '../apps/mcp-worker/src/chatgpt';
import { DEFAULT_BOND_TOLERANCE, MOLECULAR_RECIPE_ID } from '../packages/core/src/bonds/index';
import { estimateOmol25Bonds, omol25BondSummary, type Omol25Molecule } from '../packages/core/src/omol25/widget';
import { LANE_ARGS, chromiumExecutable } from './lib/browser-lanes.mjs';
import { gitEvidence, REPO_ROOT, runStamp, startChatGptDevServer } from './serve-chatgpt-plugin.mts';

const argumentsMap = Object.fromEntries(process.argv.slice(2).map((item) => {
  const [key, ...parts] = item.replace(/^--/, '').split('=');
  return [key, parts.length ? parts.join('=') : true];
}));
if (argumentsMap.help) {
  console.log(`Verify the real local MCP + OMol25 + PubChem + iframe viewer path.
Usage: pnpm chatgpt:verify [--backend=both|webgpu|webgl2] [--profile=both|desktop|mobile]
       [--no-browser] [--skip-no-gpu] [--executable=/path/to/chromium] [--port=0]
Build the widget first. All live requests and responses, screenshots, SDK bridge
events and the report are saved in .verify-artifacts/chatgpt/<timestamp>.
Mobile means Chromium touch/viewport emulation; actual ChatGPT and physical mobile
devices must be tested separately. No gallery or fixture fallback is available.`);
  process.exit(0);
}

const artifactRoot = resolve(typeof argumentsMap.output === 'string' ? argumentsMap.output : join(REPO_ROOT, '.verify-artifacts/chatgpt', runStamp()));
const selectedBackend = String(argumentsMap.backend ?? 'both');
const selectedProfile = String(argumentsMap.profile ?? 'both');
assert(['both', 'webgpu', 'webgl2'].includes(selectedBackend), 'backend must be both, webgpu, or webgl2');
assert(['both', 'desktop', 'mobile'].includes(selectedProfile), 'profile must be both, desktop, or mobile');
const checks: Array<{ name: string; passed: boolean; detail?: unknown }> = [];
const report: Record<string, any> = {
  schemaVersion: 'lupi.chatgpt-local-acceptance.v1', startedAt: new Date().toISOString(),
  ...gitEvidence(), artifactRoot,
  host: 'Development MCP host', actualChatGpt: { status: 'not-tested', installation: 'not-performed', publication: 'not-performed' },
  upstream: 'Live OMol25 Dataset Viewer rows and PubChem PUG REST requests',
  checks, browserLanes: [],
};
function check(name: string, condition: unknown, detail?: unknown) {
  const passed = Boolean(condition);
  checks.push({ name, passed, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  assert(passed, name);
}
function objectResult(result: CallToolResult): Record<string, any> { return (result.structuredContent ?? {}) as Record<string, any>; }
function digest(value: Uint8Array) { return createHash('sha256').update(value).digest('hex'); }
async function saveJson(name: string, value: unknown) { await writeFile(join(artifactRoot, name), `${JSON.stringify(value, null, 2)}\n`); }
await mkdir(artifactRoot, { recursive: true });

let server: Awaited<ReturnType<typeof startChatGptDevServer>> | undefined;
let client: Client | undefined;
try {
  server = await startChatGptDevServer({ port: Number(argumentsMap.port ?? 0), evidenceDirectory: join(artifactRoot, 'http') });
  report.url = server.origin;
  client = new Client({ name: 'Lupi local release verifier', version: '0.1.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.origin}/chatgpt/mcp`)));
  report.serverInfo = client.getServerVersion();
  report.serverCapabilities = client.getServerCapabilities();
  check('Official SDK completes Streamable HTTP initialization', report.serverInfo?.name === 'lupi-live', report.serverInfo);
  const toolList = await client.listTools();
  await saveJson('tools.json', toolList);
  check('The public adapter exposes OMol25 discovery and PubChem lookup',
    JSON.stringify(toolList.tools.map((tool) => tool.name).sort()) === JSON.stringify(['list_omol25_collections', 'open_omol25', 'resolve_molecule', 'search_omol25', 'show_molecule']));
  const showTool = toolList.tools.find((tool) => tool.name === 'show_molecule')!;
  const ui = showTool._meta?.ui as { resourceUri?: string } | undefined;
  check('show_molecule advertises the current versioned MCP App resource', ui?.resourceUri === CHATGPT_UI_URI, { actual: ui?.resourceUri, expected: CHATGPT_UI_URI });
  const openTool = toolList.tools.find((tool) => tool.name === 'open_omol25')!;
  check('open_omol25 advertises the same current MCP App resource', (openTool._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri === CHATGPT_UI_URI);
  const resources = await client.listResources();
  check('The UI resource is discoverable', resources.resources.some((resource) => resource.uri === ui!.resourceUri));
  const resource = await client.readResource({ uri: ui!.resourceUri! });
  const htmlResource = resource.contents.find((content) => content.mimeType === 'text/html;profile=mcp-app' && 'text' in content);
  check('resources/read supplies a self-contained MCP App HTML document',
    htmlResource && 'text' in htmlResource && /name=["']lupi-widget["']/.test(String(htmlResource.text)));
  if (htmlResource && 'text' in htmlResource) {
    const html = String(htmlResource.text);
    report.widget = { bytes: Buffer.byteLength(html), sha256: digest(Buffer.from(html)), metadata: htmlResource._meta };
    check('The UI needs no external script or stylesheet URLs', !/<script\b[^>]*\bsrc=|<link\b[^>]*\brel=["']stylesheet["']/i.test(html));
  }

  const collections = await client.callTool({ name: 'list_omol25_collections', arguments: {} }) as CallToolResult;
  const catalog = objectResult(collections);
  check('OMol25 complete neutral training and preview coverage are advertised',
    !collections.isError && catalog.source === 'OMol25'
      && catalog.collections.some((item: any) => item.id === 'neutral-train' && item.coverage === 'complete' && item.indexedRows === 34_335_828)
      && catalog.collections.some((item: any) => item.coverage === 'indexed-preview'));
  const omolRows = await client.callTool({ name: 'search_omol25', arguments: { collection: 'neutral-train', offset: 0, limit: 3 } }) as CallToolResult;
  const omolPage = objectResult(omolRows);
  check('Live OMol25 neutral training browse returns source row identities',
    !omolRows.isError && omolPage.source === 'OMol25' && Array.isArray(omolPage.rows) && omolPage.rows.length > 0
      && Number.isInteger(omolPage.rows[0].rowIndex), omolPage);
  const chosenOmolRow = omolPage.rows[0].rowIndex as number;
  const omolOpened = await client.callTool({ name: 'open_omol25', arguments: { collection: 'neutral-train', rowIndex: chosenOmolRow } }) as CallToolResult;
  const omolIdentity = objectResult(omolOpened);
  const omolMolecule = omolOpened._meta?.molecule as Omol25Molecule | undefined;
  await saveJson('omol25-opened.json', omolOpened);
  check('Live OMol25 source coordinates retain empty original bond arrays',
    !omolOpened.isError && omolIdentity.source === 'OMol25' && omolIdentity.rowIndex === chosenOmolRow
      && omolMolecule?.atoms.ids.length > 0 && omolMolecule?.bondTopology === 'not-provided'
      && omolMolecule?.bonds.aid1.length === 0 && omolMolecule?.bonds.aid2.length === 0
      && omolMolecule?.bonds.order.length === 0, omolIdentity);
  const expectedOmolSummary = omol25BondSummary(estimateOmol25Bonds(omolMolecule!));
  check('OMol25 advertises the shared Molecular v1 recipe and default tolerance',
    omolIdentity.bondRecipe === MOLECULAR_RECIPE_ID
      && omolIdentity.bondParameters?.tolerance === DEFAULT_BOND_TOLERANCE, omolIdentity);
  check('OMol25 model-visible inference matches every shared recipe summary field',
    Object.entries(expectedOmolSummary).every(([key, value]) => isDeepStrictEqual(omolIdentity[key], value)),
    { actual: omolIdentity, expected: expectedOmolSummary });
  check('OMol25 chemical bonds exclude ionic contacts and never invent bond orders',
    omolIdentity.bondSource === 'inferred' && omolIdentity.sourceBondTopology === 'not-provided'
      && omolIdentity.bondCount === omolIdentity.bondKinds.covalent + omolIdentity.bondKinds.coordination
      && omolIdentity.contactCount === omolIdentity.bondKinds.ionicContact
      && omolIdentity.bondOrders === 'not-estimated');
  report.omol25Retrieval = {
    structureRef: omolIdentity.structureRef, rowIndex: chosenOmolRow,
    atomCount: omolMolecule!.atoms.ids.length, summary: expectedOmolSummary,
  };

  const lookupStartedAt = Date.now();
  const resolved = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'L-theanine', cacheMode: 'refresh' } }) as CallToolResult;
  await saveJson('l-theanine-resolved.json', resolved);
  const identity = objectResult(resolved);
  check('Fresh L-theanine lookup returns PubChem CID 439378', !resolved.isError && identity.status === 'resolved' && identity.cid === 439378, identity);
  check('Launch retrieval bypasses Lupi cache and has a current retrieval timestamp', identity.cacheHit === false && Date.parse(identity.retrievedAt) >= lookupStartedAt, { retrievedAt: identity.retrievedAt, cacheHit: identity.cacheHit });
  const shown = await client.callTool({ name: 'show_molecule', arguments: { structureRef: identity.structureRef } }) as CallToolResult;
  await saveJson('l-theanine-shown.json', shown);
  const molecule = shown._meta?.molecule as any;
  check('L-theanine source structure has 26 atoms and 25 bonds', molecule?.atoms.ids.length === 26 && molecule?.bonds.aid1.length === 25, { atoms: molecule?.atoms.ids.length, bonds: molecule?.bonds.aid1.length });
  check('Retrieved conformer explicitly identifies 3D angstrom coordinates', molecule?.dimension === '3d' && molecule.coordinateUnits === 'angstrom');
  const nitrogenIds = molecule.atoms.ids.filter((_id: number, index: number) => molecule.atoms.elements[index] === 7);
  check('Nitrogen atoms keep PubChem source IDs 4 and 5', JSON.stringify(nitrogenIds) === '[4,5]', nitrogenIds);
  const launchFetches = server.recorder.entries.filter((entry) => entry.kind === 'pubchem');
  const recordEntry = launchFetches.find((entry) => entry.request.url.includes('/cid/439378/record/JSON') && entry.request.url.includes('record_type=3d'));
  check('A live upstream 3D record request returned HTTP 200', recordEntry?.response?.status === 200, recordEntry);
  const raw = JSON.parse(await readFile(join(server.recorder.directory, recordEntry!.response!.file), 'utf8'));
  const source = raw.PC_Compounds[0];
  check('Every source bond endpoint and order survives the server/widget boundary',
    JSON.stringify(molecule.bonds) === JSON.stringify({ aid1: source.bonds.aid1, aid2: source.bonds.aid2, order: source.bonds.order }));
  check('Source atom identifiers and elements survive the server/widget boundary',
    JSON.stringify(molecule.atoms.ids) === JSON.stringify(source.atoms.aid) && JSON.stringify(molecule.atoms.elements) === JSON.stringify(source.atoms.element));
  const sourceCoordinates = source.coords.find((coordinates: any) => coordinates.type.includes(2));
  const conformer = sourceCoordinates.conformers[0];
  const sourcePositions = molecule.atoms.ids.flatMap((id: number) => {
    const index = sourceCoordinates.aid.indexOf(id);
    assert(index >= 0, `Source coordinate AID ${id} is present`);
    return [conformer.x[index], conformer.y[index], conformer.z[index]];
  });
  check('Every transmitted coordinate equals the fetched PubChem conformer coordinate', JSON.stringify(molecule.atoms.positions) === JSON.stringify(sourcePositions));
  check('Refresh applies no-store/no-cache to every live launch request', launchFetches.length >= 3 && launchFetches.every((entry) => entry.request.cache === 'no-store' && entry.request.headers['cache-control'] === 'no-cache'), launchFetches.map((entry) => ({ url: entry.request.url, cache: entry.request.cache, status: entry.response?.status })));
  report.launchRetrieval = { cid: identity.cid, structureRef: identity.structureRef, retrievedAt: identity.retrievedAt, dimension: identity.dimension, atomCount: identity.atomCount, bondCount: identity.bondCount, nitrogenIds, atomIds: molecule.atoms.ids, atomicNumbers: molecule.atoms.elements, bonds: molecule.bonds, requestIds: launchFetches.map((entry) => entry.id), uncached: true };

  const direct = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'PubChem CID 439378' } }) as CallToolResult;
  check('Direct CID lookup preserves the same pinned record', objectResult(direct).structureRef === identity.structureRef);
  const highlighted = await client.callTool({ name: 'show_molecule', arguments: { structureRef: identity.structureRef, view: { highlightElements: ['N'] } } }) as CallToolResult;
  await saveJson('l-theanine-highlighted.json', highlighted);
  check('Server follow-up highlights only nitrogen IDs 4 and 5 on the same CID', objectResult(highlighted).cid === 439378 && JSON.stringify(objectResult(highlighted).view?.highlightAtomIds) === '[4,5]');
  check('A highlight leaves the complete source geometry unchanged', JSON.stringify(highlighted._meta?.molecule) === JSON.stringify(molecule));

  // The verifier itself can otherwise exceed PubChem's shared request pace
  // while performing several fresh records back-to-back.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const co2 = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'carbon dioxide', cacheMode: 'refresh' } }) as CallToolResult;
  const co2Identity = objectResult(co2);
  check('A second live PubChem lookup resolves carbon dioxide CID 280', !co2.isError && co2Identity.cid === 280 && co2Identity.cacheHit === false, co2Identity);
  const co2Shown = await client.callTool({ name: 'show_molecule', arguments: { structureRef: co2Identity.structureRef } }) as CallToolResult;
  await saveJson('carbon-dioxide-shown.json', co2Shown);
  const co2Molecule = co2Shown._meta?.molecule as any;
  check('Carbon dioxide retains 3 source atoms and 2 double bonds', co2Molecule?.atoms.ids.length === 3 && JSON.stringify(co2Molecule.bonds.order) === '[2,2]');
  check('A source-declared 3D linear structure stays 3D with zero Z coordinates', co2Molecule?.dimension === '3d' && co2Molecule.atoms.positions.filter((_value: number, index: number) => index % 3 === 2).every((value: number) => value === 0));

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const missing = await client.callTool({ name: 'resolve_molecule', arguments: { query: 'lupi-plugin-no-such-compound-20260929-7v4s8', cacheMode: 'refresh' } }) as CallToolResult;
  await saveJson('not-found.json', missing);
  check('A nonexistent PubChem name produces not_found without geometry', missing.isError && objectResult(missing).code === 'not_found' && !missing._meta?.molecule, missing);
  let deleteRejected = false;
  try {
    const absent = await client.callTool({ name: 'delete_all_molecules', arguments: {} }) as CallToolResult;
    deleteRejected = absent.isError === true;
    await saveJson('unsupported-delete.json', absent);
  } catch (cause) {
    deleteRejected = true;
    await saveJson('unsupported-delete.json', { rejected: true, error: cause instanceof Error ? cause.message : String(cause) });
  }
  check('No destructive delete tool is exposed or executed', deleteRejected);

  if (!argumentsMap['no-browser']) {
    const backends = selectedBackend === 'both' ? ['webgpu', 'webgl2'] as const : [selectedBackend as 'webgpu' | 'webgl2'];
    const profiles = selectedProfile === 'both' ? ['desktop', 'mobile'] as const : [selectedProfile as 'desktop' | 'mobile'];
    for (const backend of backends) for (const profile of profiles) await verifyBrowserLane(server.origin, backend, profile);
    if (!argumentsMap['skip-no-gpu']) await verifyBrowserLane(server.origin, 'noGpu', 'desktop');
  } else report.browserStatus = 'not-run (--no-browser)';
} catch (cause) {
  report.fatalError = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
  console.error(report.fatalError);
} finally {
  if (client) await client.close().catch(() => undefined);
  if (server) { await server.recorder.flush(); report.httpRequests = server.recorder.entries; await server.close(); }
  report.finishedAt = new Date().toISOString();
  report.passed = !report.fatalError && checks.every((item) => item.passed) && report.browserLanes.every((lane: any) => lane.passed);
  await saveJson('report.json', report);
  console.log(`\n${report.passed ? 'PASS' : 'FAIL'} local SDK acceptance evidence: ${join(artifactRoot, 'report.json')}`);
  console.log('Actual ChatGPT installation, ChatGPT iframe behavior, physical mobile devices and public publication remain untested.');
  if (!report.passed) process.exitCode = 1;
}

async function widgetState(frame: Frame): Promise<any> {
  return frame.evaluate(() => (window as any).__lupiChatgpt?.state());
}
async function settleCamera(frame: Frame) {
  // The existing viewer uses damped controls. Wait for successive coordinates
  // to settle before comparing camera and canvas output.
  let previous = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    const current = JSON.stringify((await widgetState(frame))?.camera?.position?.map((number: number) => Math.round(number * 10_000)));
    if (attempt > 2 && current === previous) return;
    previous = current;
    await frame.waitForTimeout(100);
  }
}
async function waitForCard(page: Page, index: number, fallback = false): Promise<Frame> {
  const iframe = page.locator('iframe.widget').nth(index);
  await iframe.waitFor({ state: 'attached', timeout: 45_000 });
  // Browsers throttle animation frames in offscreen iframes. Interaction
  // evidence concerns the card the user is actually viewing.
  await iframe.scrollIntoViewIfNeeded();
  const frame = await (await iframe.elementHandle())!.contentFrame();
  if (!frame) throw new Error(`Molecule iframe ${index} has no content frame.`);
  await frame.waitForFunction((unavailable) => {
    const state = (window as any).__lupiChatgpt?.state();
    return unavailable ? document.querySelector('.viewport[data-render-state="unavailable"]') && state?.cid : state?.ready && state?.rendererBackend && state?.camera;
  }, fallback, { timeout: 60_000 });
  return frame;
}
async function dragMolecule(page: Page, context: BrowserContext, frame: Frame, mobile: boolean) {
  const box = await frame.locator('canvas').boundingBox();
  if (!box) throw new Error('Molecule canvas has no visible bounds.');
  const start = { x: box.x + box.width * 0.43, y: box.y + box.height * 0.45 };
  const end = { x: start.x + Math.min(120, box.width * 0.25), y: start.y + 45 };
  if (mobile) {
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, id: 1 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up();
  }
  await settleCamera(frame);
}

async function verifyBrowserLane(origin: string, backend: 'webgpu' | 'webgl2' | 'noGpu', profile: 'desktop' | 'mobile') {
  const name = `${backend}-${profile}`;
  const directory = join(artifactRoot, name);
  await mkdir(directory, { recursive: true });
  const lane: Record<string, any> = { name, backendRequested: backend, profile, physicalDevice: false, host: 'Development MCP host', checks: [], console: [], pageErrors: [], remoteRequests: [], passed: false };
  report.browserLanes.push(lane);
  const laneCheck = (label: string, condition: unknown, detail?: unknown) => {
    lane.checks.push({ name: label, passed: Boolean(condition), ...(detail !== undefined ? { detail } : {}) });
    check(`${name}: ${label}`, condition, detail);
  };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let page: Page | undefined;
  try {
    const executablePath = chromiumExecutable(typeof argumentsMap.executable === 'string' ? argumentsMap.executable : undefined);
    browser = await chromium.launch({ headless: true, args: LANE_ARGS[backend], ...(executablePath ? { executablePath } : {}) });
    lane.browserVersion = browser.version(); lane.executable = executablePath ?? 'Playwright-managed Chromium';
    const mobile = profile === 'mobile';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 1100 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) lane.console.push({ type: message.type(), text: message.text() }); });
    page.on('pageerror', (cause) => { lane.pageErrors.push({ message: cause.message, stack: cause.stack }); console.error(`${name} page error: ${cause.message}`); });
    page.on('request', (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) lane.remoteRequests.push({ url: request.url(), method: request.method() }); });
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__lupiDevHost?.state().connected === true);
    laneCheck('The page explicitly identifies itself as a development host', await page.getByRole('heading', { name: 'Development MCP host', exact: true }).isVisible());
    const renderStart = performance.now();
    await page.getByRole('button', { name: 'Show molecule', exact: true }).click();
    const frame = await waitForCard(page, 0, backend === 'noGpu');
    lane[backend === 'noGpu' ? 'initialLookupToFallbackMs' : 'initialLookupToInteractiveMs'] = Math.round(performance.now() - renderStart);
    const initialReadyAt = Date.now();
    const initialShowAt = await page.evaluate(() => (window as any).__lupiDevHost.state().events.find((event: any) => event.direction === 'host-to-server' && event.message?.params?.name === 'show_molecule')?.at);
    lane[backend === 'noGpu' ? 'initialRenderToolToFallbackMs' : 'initialRenderToolToInteractiveMs'] = initialShowAt ? initialReadyAt - Date.parse(initialShowAt) : null;
    const initialState = await widgetState(frame);
    lane.initialState = initialState;
    laneCheck('The iframe receives the same source molecule CID and counts', initialState.cid === 439378 && initialState.atomCount === 26 && initialState.bondCount === 25, initialState);
    laneCheck('The iframe preserves pinned identity, source atom IDs, elements and bond orders', initialState.structureRef === report.launchRetrieval.structureRef && JSON.stringify(initialState.atomIds) === JSON.stringify(report.launchRetrieval.atomIds) && JSON.stringify(initialState.atomicNumbers) === JSON.stringify(report.launchRetrieval.atomicNumbers) && JSON.stringify(initialState.bonds) === JSON.stringify(report.launchRetrieval.bonds));
    laneCheck('The iframe bridge completes ui/initialize', await frame.locator('main[data-host="connected"]').count() === 1);
    laneCheck('PubChem attribution is visible in the card', await frame.getByRole('link', { name: /PubChem CID 439378/ }).first().isVisible());
    if (backend === 'noGpu') {
      laneCheck('Unavailable graphics produce the honest source-linked state', await frame.getByRole('heading', { name: 'Interactive graphics are unavailable here' }).isVisible());
      laneCheck('Unavailable graphics never claim a ready renderer', initialState.ready === false && !initialState.rendererBackend);
      await page.locator('iframe.widget').first().screenshot({ path: join(directory, 'unavailable-card.png') });
    } else {
      laneCheck('The requested rendering backend actually starts', initialState.rendererBackend === backend, { actual: initialState.rendererBackend });
      laneCheck('The actual scene contains all source atoms and bonds', initialState.scene?.atomLayerInstanceCounts.includes(26) && initialState.scene?.bondInstanceCount === 25, initialState.scene);
      await settleCamera(frame);
      const before = await widgetState(frame);
      const beforeCanvas = await frame.locator('canvas').screenshot({ path: join(directory, 'initial-canvas.png') });
      await page.locator('iframe.widget').first().screenshot({ path: join(directory, 'initial-card.png') });
      await dragMolecule(page, context, frame, mobile);
      const rotated = await widgetState(frame);
      const rotatedCanvas = await frame.locator('canvas').screenshot({ path: join(directory, 'rotated-canvas.png') });
      laneCheck(`${mobile ? 'Touch' : 'Pointer'} dragging rotates the actual scene`, JSON.stringify(before.camera.position) !== JSON.stringify(rotated.camera.position) && digest(beforeCanvas) !== digest(rotatedCanvas), { before: before.camera, after: rotated.camera });
      const zoomButton = frame.getByRole('button', { name: 'Zoom in', exact: true });
      if (mobile) await zoomButton.tap(); else await zoomButton.click();
      await settleCamera(frame);
      const zoomed = await widgetState(frame);
      const zoomedCanvas = await frame.locator('canvas').screenshot({ path: join(directory, 'zoomed-canvas.png') });
      const distance = (camera: any) => Math.hypot(...camera.position.map((position: number, index: number) => position - camera.target[index]));
      laneCheck('Zoom changes camera distance and visible molecule pixels', distance(zoomed.camera) < distance(rotated.camera) && digest(rotatedCanvas) !== digest(zoomedCanvas), { before: distance(rotated.camera), after: distance(zoomed.camera) });
      await frame.getByRole('button', { name: /N\s*2/ }).click();
      await frame.waitForFunction(() => JSON.stringify((window as any).__lupiChatgpt?.state().view.highlightAtomIds) === '[4,5]');
      await page.waitForFunction(() => (window as any).__lupiDevHost.state().cards[0].context?.structuredContent?.view?.highlightAtomIds.join(',') === '4,5');
      laneCheck('Local nitrogen highlighting updates source-aware model context', (await widgetState(frame)).cid === 439378);
      await page.locator('iframe.widget').first().screenshot({ path: join(directory, 'nitrogen-card.png') });
      await frame.getByRole('button', { name: 'Reset view and clear atom highlights', exact: true }).click();
      await settleCamera(frame);
      const reset = await widgetState(frame);
      const closeVector = (first: number[], second: number[]) => first.every((value, index) => Math.abs(value - second[index]) < 0.05);
      laneCheck('Reset clears highlights and restores the initial camera', reset.view.highlightAtomIds.length === 0 && closeVector(reset.camera.position, before.camera.position) && closeVector(reset.camera.target, before.camera.target), { initial: before.camera, reset: reset.camera });
      if (!mobile) {
        await page.getByRole('button', { name: 'Highlight nitrogen in selected card', exact: true }).click();
        const followup = await waitForCard(page, 1);
        const followupReadyAt = Date.now();
        const followupShowAt = await page.evaluate(() => (window as any).__lupiDevHost.state().events.filter((event: any) => event.direction === 'host-to-server' && event.message?.params?.name === 'show_molecule').at(-1)?.at);
        lane.cachedFollowupToolToInteractiveMs = followupShowAt ? followupReadyAt - Date.parse(followupShowAt) : null;
        const followupState = await widgetState(followup);
        laneCheck('A server follow-up opens a complete card with the same pinned identity', followupState.structureRef === initialState.structureRef && JSON.stringify(followupState.view.highlightAtomIds) === '[4,5]');
        await page.getByRole('button', { name: 'Show carbon dioxide', exact: true }).click();
        const co2 = await waitForCard(page, 2);
        laneCheck('Two distinct open compounds retain separate identities', (await widgetState(co2)).cid === 280 && (await widgetState(frame)).cid === 439378 && (await widgetState(followup)).cid === 439378);
        await page.locator('.card-wrap').nth(1).getByRole('button', { name: 'Select for follow-up' }).click();
        await page.getByRole('button', { name: 'Reopen selected result', exact: true }).click();
        const reopened = await waitForCard(page, 3);
        const reopenedState = await widgetState(reopened);
        laneCheck('A reopened local iframe restores identity and highlight from a full tool result', reopenedState.structureRef === initialState.structureRef && JSON.stringify(reopenedState.view.highlightAtomIds) === '[4,5]');
        await page.locator('iframe.widget').nth(3).screenshot({ path: join(directory, 'reopened-card.png') });
      }
      if (!mobile) {
        await page.getByRole('button', { name: 'Explore OMol25 first row', exact: true }).click();
        const omolFrame = await waitForCard(page, 4);
        const omolState = await widgetState(omolFrame);
        const expectedSummary = report.omol25Retrieval.summary;
        const visibleContacts = omolState.view.showContacts === false ? 0 : expectedSummary.contactCount;
        const expectedDrawnPairs = omolState.view.style === 'spacefill' ? 0 : expectedSummary.bondCount + visibleContacts;
        laneCheck('OMol25 source identity and empty source bond arrays survive inferred rendering',
          omolState.source === 'OMol25' && omolState.collection === 'neutral-train'
            && omolState.structureRef === report.omol25Retrieval.structureRef
            && omolState.rowIndex === report.omol25Retrieval.rowIndex
            && omolState.atomCount === report.omol25Retrieval.atomCount
            && omolState.sourceBondCount === 0
            && isDeepStrictEqual(omolState.bonds, { aid1: [], aid2: [], order: [] }), omolState);
        laneCheck('OMol25 iframe inference matches the server and shared Molecular v1 recipe',
          isDeepStrictEqual(omolState.estimatedBondSummary, expectedSummary)
            && omolState.bondCount === expectedSummary.bondCount, omolState.estimatedBondSummary);
        laneCheck('OMol25 renders all atoms and only visible inferred connections',
          omolState.scene?.atomLayerInstanceCounts.includes(omolState.atomCount)
            && omolState.expectedDrawnPairCount === expectedDrawnPairs
            && omolState.scene?.bondInstanceCount === expectedDrawnPairs, omolState.scene);
        laneCheck('OMol25 estimates are explicitly labeled in the visible card',
          await omolFrame.getByText('Estimated · Molecular v1', { exact: true }).isVisible());
        await omolFrame.getByText('Source & structure details', { exact: true }).click();
        laneCheck('OMol25 source identity and bond-order limitations are visible in details',
          await omolFrame.locator('.source-details').getByText(/Coordinates come from the OMol25 source row; atom IDs are generated from row order\./).isVisible()
            && /Bond orders are not estimated\./.test(await omolFrame.locator('.source-details').innerText()));
        const contacts = omolFrame.getByRole('checkbox', { name: /Ionic contacts/ });
        await contacts.uncheck();
        await omolFrame.waitForFunction(() => {
          const state = (window as any).__lupiChatgpt.state();
          return state.view.showContacts === false && state.scene.bondInstanceCount === state.estimatedBondSummary.bondCount;
        });
        const withoutContacts = await widgetState(omolFrame);
        laneCheck('Hiding ionic contacts changes only rendered connections, not source or chemical counts',
          withoutContacts.structureRef === omolState.structureRef
            && isDeepStrictEqual(withoutContacts.bonds, omolState.bonds)
            && isDeepStrictEqual(withoutContacts.estimatedBondSummary, expectedSummary)
            && withoutContacts.bondCount === expectedSummary.bondCount
            && withoutContacts.expectedDrawnPairCount === expectedSummary.bondCount
            && withoutContacts.scene.bondInstanceCount === expectedSummary.bondCount);
        await contacts.check();
        await omolFrame.waitForFunction(() => {
          const state = (window as any).__lupiChatgpt.state();
          return state.view.showContacts === true && state.scene.bondInstanceCount === state.estimatedBondSummary.bondCount + state.estimatedBondSummary.contactCount;
        });
        laneCheck('Showing ionic contacts restores chemical bonds plus separate contacts',
          (await widgetState(omolFrame)).scene.bondInstanceCount === expectedSummary.bondCount + expectedSummary.contactCount);
        await page.locator('iframe.widget').nth(4).screenshot({ path: join(directory, 'omol25-card.png') });
      }
      lane.finalState = await widgetState(frame);
    }
    laneCheck('The self-contained iframe makes no remote asset or API requests', lane.remoteRequests.length === 0, lane.remoteRequests);
    laneCheck('The browser reports no uncaught page errors', lane.pageErrors.length === 0, lane.pageErrors);
    lane.bridgeState = await page.evaluate(() => (window as any).__lupiDevHost.state());
    await writeFile(join(directory, 'sdk-bridge.json'), `${JSON.stringify(lane.bridgeState, null, 2)}\n`);
    const events = lane.bridgeState.events as any[];
    laneCheck('SDK bridge records initialize, tool input, and tool result messages', ['ui/initialize', 'ui/notifications/tool-input', 'ui/notifications/tool-result'].every((method) => events.some((event) => event.message?.method === method)));
    delete lane.bridgeState;
    await page.screenshot({ path: join(directory, 'development-host.png'), fullPage: false });
    lane.passed = true;
  } catch (cause) {
    lane.error = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
    console.error(`FAIL ${name}: ${lane.error}`);
    if (page) {
      await page.screenshot({ path: join(directory, 'failure.png'), fullPage: false }).catch(() => undefined);
      lane.hostState = await page.evaluate(() => (window as any).__lupiDevHost?.state()).catch(() => null);
      lane.frameStates = await Promise.all(page.frames().map(async (frame) => ({ url: frame.url(), state: await widgetState(frame).catch(() => null), text: await frame.locator('body').innerText().catch(() => '') })));
    }
  } finally {
    if (browser) await browser.close();
    await writeFile(join(directory, 'lane-report.json'), `${JSON.stringify(lane, null, 2)}\n`);
  }
}
