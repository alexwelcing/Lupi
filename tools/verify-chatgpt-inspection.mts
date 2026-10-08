/** Deterministic browser acceptance with synthetic coordinate fixtures.
 * Uses the actual MCP server, SDK development host and production widget.
 * This is not a live OMol25 retrieval or an actual ChatGPT host test. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright';
import { PerspectiveCamera, Vector3 } from 'three';
import { handleChatGptMcp } from '../apps/mcp-worker/src/chatgpt';
import { OmolService } from '../apps/mcp-worker/src/chatgptOmol';
import { LANE_ARGS } from './lib/browser-lanes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.verify-artifacts/chatgpt-inspection');
await mkdir(output, { recursive: true });
const html = await readFile(join(root, 'apps/chatgpt-widget/dist/index.html'), 'utf8');
const hostHtml = (await readFile(join(root, 'tools/chatgpt-host/index.html'), 'utf8')).replace('Development MCP host</h1>', 'Fixture development MCP host</h1>');
const bundle = await build({ configFile: false, root: join(root, 'tools/chatgpt-host'), publicDir: false, logLevel: 'error', build: { write: false, target: 'es2022', minify: false, lib: { entry: join(root, 'tools/chatgpt-host/main.ts'), formats: ['es'] }, rollupOptions: { output: { inlineDynamicImports: true } } } });
const outputs = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((b) => 'output' in b ? b.output : []);
const entry = outputs.find((e) => e.type === 'chunk' && e.isEntry);
assert(entry?.type === 'chunk');
const atoms = ['Na -2.3 0 0', 'O 0 0 0', 'H 0.75 0.5 0', 'H -0.75 0.5 0', 'Fe 6 0 0', 'N 8.3 0 0'];
const xyz = `${atoms.length}\nOMol25 neutral-train row=7 | bonds=not-provided\n${atoms.join('\n')}\n`;
const omolService = new OmolService(async (request) => {
  const url = new URL(request.url);
  if (url.pathname.endsWith('/rows')) return Response.json({ dataset: 'neutral-train', partial: false, matchedRows: 1, rows: [{ rowIndex: 7, formula: 'fixture', name: 'Synthetic inspection fixture', atomCount: atoms.length, elements: ['Na', 'O', 'H', 'Fe', 'N'], configurationId: 'test-config', propertyId: 'test-property' }] });
  if (url.pathname.endsWith('/structures/7.xyz')) return new Response(xyz);
  throw new Error(`Unexpected fixture route: ${url.pathname}`);
});
const env = { WEB_ASSETS: { fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) } };
let origin = '';
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const c of incoming) { length += c.length; assert(length <= 16384); chunks.push(Buffer.from(c)); }
    const headers = new Headers();
    for (const [k, v] of Object.entries(incoming.headers)) if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const method = incoming.method ?? 'GET';
    const request = new Request(new URL(incoming.url ?? '/', origin), { method, headers, ...(method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
    const path = new URL(request.url).pathname;
    const response = path === '/chatgpt/mcp' ? await handleChatGptMcp(request, env, undefined, omolService)
      : path === '/' ? new Response(hostHtml, { headers: { 'content-type': 'text/html' } })
      : path === '/host.js' ? new Response(entry.code, { headers: { 'content-type': 'text/javascript' } })
      : new Response('Not found', { status: 404 });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) { outgoing.writeHead(500); outgoing.end(String(e)); }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
origin = `http://127.0.0.1:${address.port}`;
const checks: string[] = [];
const report: Record<string, unknown> = { host: 'SDK fixture development host', actualChatGpt: false, liveRetrieval: false, widgetSha256: createHash('sha256').update(html).digest('hex'), checks };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: LANE_ARGS.webgl2 });
  report.browserVersion = browser.version();
  for (const mobile of [false, true]) {
    const lane = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 1000 } : { width: 1280, height: 1100 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole('button', { name: 'Explore OMol25 first row', exact: true }).click();
    const locator = page.locator('iframe.widget').first();
    await locator.waitFor();
    await locator.scrollIntoViewIfNeeded();
    const frame = await (await locator.elementHandle())!.contentFrame();
    assert(frame);
    const state = () => frame.evaluate(() => (window as any).__lupiChatgpt.state());
    await frame.waitForFunction(() => (window as any).__lupiChatgpt?.state().ready, undefined, { timeout: 60000 });
    const initial = await state();
    assert.equal(initial.sourceBondCount, 0);
    assert.equal(initial.estimatedBondSummary.bondRecipe, 'lupi-bonds.molecular.v1');
    assert.equal(initial.estimatedBondSummary.contactCount, 1);
    assert.equal(initial.scene.bondInstanceCount, initial.expectedDrawnPairCount);
    checks.push(`${lane}: actual inferred graph rendered with source bonds empty`);
    const box = await frame.locator('canvas').boundingBox();
    assert(box);
    const camera = new PerspectiveCamera(36, box.width / box.height, 0.01, 1000);
    camera.position.fromArray(initial.camera.position);
    camera.lookAt(new Vector3().fromArray(initial.camera.target));
    camera.updateMatrixWorld();
    const p = new Vector3(8.3, 0, 0).project(camera);
    const point = { x: box.x + (p.x + 1) * box.width / 2, y: box.y + (1 - p.y) * box.height / 2 };
    const contextEvents = () => page.evaluate(() => (window as any).__lupiDevHost.state().events.filter((e: any) => e.direction === 'widget-model-context').length);
    const before = await contextEvents();
    if (!mobile) {
      await page.mouse.move(point.x, point.y);
      await frame.waitForFunction(() => (window as any).__lupiChatgpt.state().inspection?.atomId === 6);
      assert.equal(await contextEvents(), before);
      assert.equal(await frame.locator('.inspection-panel').getAttribute('data-pinned'), 'false');
      checks.push(`${lane}: pointer hover identifies actual atom without model context updates`);
      await locator.screenshot({ path: join(output, `${lane}-hover.png`) });
      await page.mouse.click(point.x, point.y);
    } else await page.touchscreen.tap(point.x, point.y);
    await frame.waitForFunction(() => document.querySelector('.inspection-panel[data-pinned="true"][data-inspected-id="6"]'));
    await page.waitForFunction(() => (window as any).__lupiDevHost.state().cards[0].context?.structuredContent?.inspection?.atomId === 6);
    assert.equal((await state()).structureRef, initial.structureRef);
    checks.push(`${lane}: actual ${mobile ? 'touch' : 'click'} pin sends same-structure inspection context`);
    await frame.getByRole('button', { name: 'Close details', exact: true }).click();
    await frame.locator('canvas').scrollIntoViewIfNeeded();
    const dragBox = await frame.locator('canvas').boundingBox();
    assert(dragBox);
    const x = dragBox.x + dragBox.width / 2, y = dragBox.y + dragBox.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 45, y + 20, { steps: 8 }); await page.mouse.up();
    assert.equal(await frame.locator('.inspection-panel').getAttribute('data-pinned'), 'false');
    checks.push(`${lane}: orbit drag does not pin inspection`);
    await frame.getByRole('combobox', { name: 'Inspect atom' }).selectOption('0');
    await frame.waitForFunction(() => (window as any).__lupiChatgpt.state().inspection?.atomId === 1);
    await frame.locator('.inspection-neighbors button').first().click();
    assert.equal((await state()).inspection.bondKind, 'ionicContact');
    assert.equal((await state()).inspection.sourceOrder, null);
    checks.push(`${lane}: accessible selection and neighbor inspection identify ionic contacts`);
    await frame.getByRole('checkbox', { name: /Ionic contacts/ }).uncheck();
    await frame.waitForFunction(() => (window as any).__lupiChatgpt.state().scene.bondInstanceCount === (window as any).__lupiChatgpt.state().expectedDrawnPairCount);
    assert.equal((await state()).inspection, null);
    assert.equal((await state()).scene.bondInstanceCount, initial.scene.bondInstanceCount - 1);
    checks.push(`${lane}: contact toggle changes rendered cylinders without changing source or estimate`);
    await frame.getByRole('combobox', { name: 'Inspect atom' }).selectOption('4');
    await page.keyboard.press('Escape');
    assert.equal((await state()).inspection, null);
    checks.push(`${lane}: Escape clears pinned details`);
    await frame.getByRole('combobox', { name: 'Inspect atom' }).selectOption('1');
    await locator.screenshot({ path: join(output, `${lane}-inspection.png`) });
    await writeFile(join(output, `${lane}-state.json`), JSON.stringify(await state(), null, 2));
    assert.deepEqual(errors, []);
    checks.push(`${lane}: no uncaught browser errors`);
    await context.close();
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.stack : String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
