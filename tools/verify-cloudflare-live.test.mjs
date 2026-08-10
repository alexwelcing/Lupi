import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import {
  parseCommandLine,
  validateBaseline,
  verifyCloudflareLive,
} from './verify-cloudflare-live.mjs';

const BUILD_SHA = '0123456789abcdef0123456789abcdef01234567';
const VERSION_ID = '4f94c8c7-0fef-4d7f-ae75-430c44e84542';
const openServers = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map(({ server }) => new Promise((resolve) => server.close(resolve))));
  openServers.clear();
});

test('complete normal verification passes without an external request', async () => {
  const fixture = await createFixture();
  const report = await verifyCloudflareLive(normalOptions(fixture.origin));
  assert.equal(report.ok, true);
  assert.equal(report.observations.health.release.id, VERSION_ID);
  assert.equal(report.observations.asset.r2DeliveryProven, true);
  assert.equal(report.observations.entry.cacheControl, 'public, max-age=31536000, immutable');
  assert.equal(report.observations.entry.cfCacheStatus, 'HIT');
  assert.equal(report.observations.entry.edgeExecuted, null);
  assert.equal(report.observations.routing.healthGet, '1');
  assert.equal(report.observations.routing.browserManifest, null);
  assert.equal(typeof report.observations.entry.timingMs.root, 'number');
  assert.equal(typeof report.observations.entry.timingMs.asset, 'number');
  assert.deepEqual([...fixture.hosts], ['127.0.0.1']);
});

test('hashed entry must be publicly cacheable and expose an ETag', async () => {
  const fixture = await createFixture({ entryCacheControl: 'private, no-store', entryEtag: null });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'root-entry'), /shared static caching|ETag/);
});

test('Cloudflare static-asset cache evidence is mandatory for the hashed entry', async () => {
  for (const entryCfCacheStatus of [null, 'BYPASS', 'DYNAMIC']) {
    const fixture = await createFixture({ entryCfCacheStatus });
    const report = await verifyCloudflareLive(normalOptions(fixture.origin));
    assert.equal(report.ok, false);
    assert.match(failed(report, 'root-entry'), /CF-Cache-Status|static-asset delivery/);
    await closeFixture(fixture);
  }
});

test('selective routing requires Worker markers only on dynamic routes', async () => {
  const missingDynamic = await createFixture({ dynamicMarker: null });
  const missingReport = await verifyCloudflareLive(normalOptions(missingDynamic.origin));
  assert.equal(missingReport.ok, false);
  assert.match(failed(missingReport, 'health'), /must execute Worker code/);
  await closeFixture(missingDynamic);

  const markedStatic = await createFixture({ staticMarker: '1' });
  const markedReport = await verifyCloudflareLive(normalOptions(markedStatic.origin));
  assert.equal(markedReport.ok, false);
  assert.match(failed(markedReport, 'root-entry'), /must remain asset-first/);
});

test('bad health and binding drift fail closed', async () => {
  const fixture = await createFixture({ health: { ready: false } });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin, {
    expectedBindings: { ...expectedBindings(), d1: true },
  }));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'health'), /ready|d1/);
});

test('wrong edge and browser tool counts are reported separately', async () => {
  const fixture = await createFixture({ edgeToolCount: 6, browserToolCount: 29 });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'edge-manifest'), /expected 7 tools/);
  assert.match(failed(report, 'browser-manifest'), /expected 30 tools/);
});

test('required assessment and native Gallery tools fail closed when counts still match', async () => {
  const missingEdgeAssessment = await createFixture({ omitEdgeAssessment: true });
  const edgeReport = await verifyCloudflareLive(normalOptions(missingEdgeAssessment.origin));
  assert.equal(edgeReport.ok, false);
  assert.match(failed(edgeReport, 'edge-manifest'), /edge lupi\.assess_asset is missing/);
  await closeFixture(missingEdgeAssessment);

  const missingGallery = await createFixture({ omitGalleryTool: true });
  const galleryReport = await verifyCloudflareLive(normalOptions(missingGallery.origin));
  assert.equal(galleryReport.ok, false);
  assert.match(failed(galleryReport, 'browser-manifest'), /lupi\.open_gallery_example is missing/);
  await closeFixture(missingGallery);

  const missingBrowserAssessment = await createFixture({ omitBrowserAssessment: true });
  const browserReport = await verifyCloudflareLive(normalOptions(missingBrowserAssessment.origin));
  assert.equal(browserReport.ok, false);
  assert.match(failed(browserReport, 'browser-manifest'), /browser lupi\.assess_asset is missing/);
});

test('JSON-RPC initialize or tools/list failure is not a Live API pass', async () => {
  const fixture = await createFixture({ rpcFailure: true });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'mcp-auth-and-tools'), /error/);
});

test('authenticated posture keeps MCP discovery public and rejects protected calls', async () => {
  const fixture = await createFixture({ authRequired: true, rendererEndpoint: true, renderExecution: true });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin, {
    expectAuthRequired: true,
    expectRenderExecution: true,
    expectedBindings: { ...expectedBindings(), rendererEndpoint: true },
  }));
  assert.equal(report.ok, true);
  assert.equal(report.observations.mcp.credentialFreeStatus, 200);
  assert.equal(report.observations.mcp.toolCount, 7);
  assert.equal(report.observations.mcp.protectedCallCode, -32001);
});

test('range response requires 16 bytes, exact metadata, and an R2 source marker', async () => {
  const fixture = await createFixture({ assetSource: 'external-proxy', contentLength: '15' });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'range-delivery'), /16 bytes|Content-Length|r2/);
});

test('reported execution/auth mismatch fails even when other posture is correct', async () => {
  const fixture = await createFixture({ renderExecution: true, authRequired: false });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'health'), /renderExecution|authentication/);
});

test('build SHA and Worker version identity are both mandatory', async () => {
  const fixture = await createFixture({ releaseTag: 'f'.repeat(40), versionId: 'wrong-version' });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'health'), /version ID|tag\/build SHA/);
});

test('entry parity compares normalized path and bytes', async () => {
  const publicFixture = await createFixture();
  const candidate = await createFixture({ entryBytes: 'different candidate bytes' });
  const report = await verifyCloudflareLive(normalOptions(publicFixture.origin, {
    expectEntryFrom: candidate.origin,
  }));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'entry-parity'), /entry mismatch/);
});

test('entry parity rejects a different hashed path even with identical bytes', async () => {
  const publicFixture = await createFixture();
  const candidate = await createFixture({ entryPath: '/assets/index-other.js' });
  const report = await verifyCloudflareLive(normalOptions(publicFixture.origin, {
    expectEntryFrom: candidate.origin,
  }));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'entry-parity'), /entry mismatch/);
});

test('invalid origins, credentials, paths, queries, and custom-domain substitutions reject', () => {
  const required = postureArgs();
  for (const value of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com/?query=1',
    'https://example.com/#fragment',
  ]) {
    assert.throws(() => parseCommandLine([`--url=${value}`, ...required]), /url/);
  }
  assert.throws(() => parseCommandLine([
    '--url=https://candidate.example.com',
    '--require-custom-domain',
    ...required,
  ]), /custom domain/);
});

test('normal baseline capture and exact replay succeed', async () => {
  const fixture = await createFixture();
  const captured = await verifyCloudflareLive(normalOptions(fixture.origin, {
    capturePriorBaseline: true,
    json: true,
  }), { allowTestBaselineOrigin: true });
  assert.equal(captured.ok, true);
  assert.equal(captured.baseline.mode, 'normal');
  validateBaseline(captured.baseline, { allowTestOrigin: true });

  const replay = await verifyCloudflareLive(normalOptions(fixture.origin, {
    expectPriorBaselinePath: 'baseline.json',
    json: true,
  }), {
    allowTestBaselineOrigin: true,
    readFile: async () => JSON.stringify(captured.baseline),
  });
  assert.equal(replay.ok, true);
});

test('normal baseline replay detects changed health, manifest, or entry bytes', async () => {
  const source = await createFixture();
  const captured = await verifyCloudflareLive(normalOptions(source.origin, {
    capturePriorBaseline: true,
    json: true,
  }), { allowTestBaselineOrigin: true });
  await closeFixture(source);

  const changed = await createFixture({ serverVersion: 'changed', entryBytes: 'changed', edgeToolSuffix: '-changed' });
  const replay = await verifyCloudflareLive(normalOptions(changed.origin, {
    expectPriorBaselinePath: 'baseline.json',
    json: true,
  }), {
    allowTestBaselineOrigin: true,
    readFile: async () => JSON.stringify({ ...captured.baseline, origin: changed.origin }),
  });
  assert.equal(replay.ok, false);
  assert.match(failed(replay, 'prior-baseline-compare'), /fingerprint differs/);
});

test('malformed baseline and unsupported fields reject', async () => {
  const fixture = await createFixture();
  const report = await verifyCloudflareLive(normalOptions(fixture.origin, {
    expectPriorBaselinePath: 'baseline.json',
    json: true,
  }), {
    allowTestBaselineOrigin: true,
    readFile: async () => JSON.stringify({ schemaVersion: 'wrong', extra: true }),
  });
  assert.equal(report.ok, false);
  assert.match(failed(report, 'prior-baseline-input'), /unsupported baseline schema/);
});

test('capture modes and replay are mutually exclusive', () => {
  assert.throws(() => parseCommandLine([
    '--url=https://lupi.live', '--require-custom-domain', '--json',
    '--capture-prior-baseline', '--capture-legacy-prior-baseline',
    '--legacy-prior-version-id=legacy', ...postureArgs(),
  ]), /mutually exclusive/);
  assert.throws(() => parseCommandLine([
    '--url=https://lupi.live', '--require-custom-domain', '--json',
    '--capture-prior-baseline', '--expect-prior-baseline=baseline.json',
    ...postureArgs(),
  ]), /mutually exclusive/);
});

test('legacy capture records delivery-only evidence and replays without an R2 claim', async () => {
  const fixture = await createFixture({ releasePresent: false, assetSource: null });
  const legacyOptions = normalOptions(fixture.origin, {
    expectBuildSha: null,
    expectWorkerVersionId: null,
    captureLegacyPriorBaseline: true,
    legacyPriorVersionId: 'legacy-control-plane-version',
    json: true,
  });
  const captured = await verifyCloudflareLive(legacyOptions, { allowTestBaselineOrigin: true });
  assert.equal(captured.ok, true);
  assert.equal(captured.baseline.mode, 'legacy');
  assert.equal(captured.baseline.projection.asset.assetSource, null);
  assert.equal(captured.baseline.projection.asset.r2DeliveryProven, false);

  const replay = await verifyCloudflareLive(normalOptions(fixture.origin, {
    expectBuildSha: null,
    expectWorkerVersionId: null,
    expectPriorBaselinePath: 'legacy.json',
    allowLegacyPriorMetadataAbsence: true,
    json: true,
  }), {
    allowTestBaselineOrigin: true,
    readFile: async () => JSON.stringify(captured.baseline),
  });
  assert.equal(replay.ok, true);
});

test('legacy mode rejects a source marker or newly missing metadata in normal mode', async () => {
  const markedLegacy = await createFixture({ releasePresent: false, assetSource: 'r2' });
  const legacy = await verifyCloudflareLive(normalOptions(markedLegacy.origin, {
    expectBuildSha: null,
    expectWorkerVersionId: null,
    captureLegacyPriorBaseline: true,
    legacyPriorVersionId: 'legacy',
    json: true,
  }), { allowTestBaselineOrigin: true });
  assert.equal(legacy.ok, false);
  assert.match(failed(legacy, 'range-delivery'), /historical missing source marker/);

  const missingNormal = await createFixture({ releasePresent: false });
  const normal = await verifyCloudflareLive(normalOptions(missingNormal.origin));
  assert.equal(normal.ok, false);
  assert.match(failed(normal, 'health'), /health.release/);
});

test('legacy bootstrap is restricted to the production custom domain', () => {
  assert.throws(() => parseCommandLine([
    '--url=https://candidate.workers.dev', '--json',
    '--capture-legacy-prior-baseline', '--legacy-prior-version-id=legacy',
    ...legacyPostureArgs(),
  ]), /requires https:\/\/lupi.live/);
});

test('optional saved-view route must return HTML', async () => {
  const fixture = await createFixture({ savedViewStatus: 404 });
  const report = await verifyCloudflareLive(normalOptions(fixture.origin, { viewSlug: 'known-view' }));
  assert.equal(report.ok, false);
  assert.match(failed(report, 'saved-view'), /HTTP 200/);
});

function normalOptions(origin, overrides = {}) {
  return {
    url: origin,
    label: 'fixture',
    retries: 1,
    retryDelay: 0,
    timeout: 3000,
    json: false,
    requireCustomDomain: false,
    viewSlug: null,
    expectEntryFrom: null,
    expectBuildSha: BUILD_SHA,
    expectWorkerVersionId: VERSION_ID,
    expectAuthRequired: false,
    expectRenderExecution: false,
    expectSelectiveRouting: true,
    expectedBindings: expectedBindings(),
    capturePriorBaseline: false,
    captureLegacyPriorBaseline: false,
    legacyPriorVersionId: null,
    expectPriorBaselinePath: null,
    allowLegacyPriorMetadataAbsence: false,
    ...overrides,
  };
}

function expectedBindings() {
  return {
    webAssets: true,
    r2: true,
    d1: false,
    queue: false,
    rendererEndpoint: false,
    firebaseProject: true,
    largeAssetProxy: true,
  };
}

function postureArgs() {
  return [
    '--expect-web-assets=true', '--expect-r2=true', '--expect-d1=false',
    '--expect-queue=false', '--expect-renderer-endpoint=false',
    '--expect-firebase-project=true', '--expect-large-asset-proxy=true',
    '--expect-auth-required=false', '--expect-render-execution=false',
    '--expect-selective-routing=true',
    `--expect-build-sha=${BUILD_SHA}`, `--expect-worker-version-id=${VERSION_ID}`,
  ];
}

function legacyPostureArgs() {
  return postureArgs().filter((arg) => !arg.startsWith('--expect-build-sha=') && !arg.startsWith('--expect-worker-version-id='));
}

function failed(report, name) {
  const entry = report.checks.find((candidate) => candidate.name === name);
  assert.ok(entry, `missing check ${name}`);
  assert.equal(entry.ok, false, `${name} unexpectedly passed`);
  return entry.error;
}

async function closeFixture(fixture) {
  if (!openServers.has(fixture)) return;
  await new Promise((resolve) => fixture.server.close(resolve));
  openServers.delete(fixture);
}

async function createFixture(overrides = {}) {
  const hosts = new Set();
  const edgeTools = makeTools(overrides.edgeToolCount ?? 7, 'edge', overrides.edgeToolSuffix ?? '');
  if (edgeTools.length >= 2) {
    edgeTools[0] = { name: 'lupi.render_molecule_asset' };
    edgeTools[1] = { name: overrides.omitEdgeAssessment ? 'edge-missing-assessment' : 'lupi.assess_asset' };
  }
  const browserTools = makeTools(overrides.browserToolCount ?? 30, 'browser');
  if (browserTools.length >= 4) {
    browserTools[0] = { name: 'lupi.export_asset' };
    browserTools[1] = { name: 'lupi.set_frame' };
    browserTools[2] = { name: overrides.omitGalleryTool ? 'browser-missing-gallery' : 'lupi.open_gallery_example' };
    browserTools[3] = { name: overrides.omitBrowserAssessment ? 'browser-missing-assessment' : 'lupi.assess_asset' };
  }
  const entryPath = overrides.entryPath ?? '/assets/index-test.js';
  const server = createServer(async (request, response) => {
    hosts.add(request.headers.host?.split(':')[0] ?? '');
    const url = new URL(request.url, 'http://fixture.invalid');
    const dynamicRoute = url.pathname === '/health' || url.pathname === '/mcp-manifest.json' ||
      url.pathname === '/mcp' || url.pathname === '/gallery/curated/lupine_genesis.glimbin' ||
      url.pathname === '/v1' || url.pathname.startsWith('/view/');
    const staticRoute = url.pathname === '/' || url.pathname === entryPath ||
      url.pathname === '/browser-mcp-manifest.json' || url.pathname === '/materials/clean-energy';
    if (dynamicRoute && overrides.dynamicMarker !== null) {
      response.setHeader('x-lupi-edge-executed', overrides.dynamicMarker ?? '1');
    }
    if (staticRoute && overrides.staticMarker !== undefined && overrides.staticMarker !== null) {
      response.setHeader('x-lupi-edge-executed', overrides.staticMarker);
    }
    if (url.pathname === '/health') {
      const base = {
        ready: true,
        name: 'lupi-cloudflare-edge',
        version: overrides.serverVersion ?? '0.3.0',
        toolCount: 7,
        agentNative: true,
        browserRequired: false,
        renderExecution: overrides.renderExecution ?? false,
        bindings: {
          webAssets: true,
          r2: true,
          d1: false,
          queue: false,
          rendererEndpoint: overrides.rendererEndpoint ?? false,
          firebaseProject: true,
          largeAssetProxy: true,
          authRequired: overrides.authRequired ?? false,
        },
        ...(overrides.releasePresent === false ? {} : {
          release: {
            id: overrides.versionId ?? VERSION_ID,
            tag: overrides.releaseTag ?? BUILD_SHA,
            timestamp: '2026-07-19T20:30:00.000Z',
          },
        }),
        ...(overrides.health ?? {}),
      };
      return json(response, base);
    }
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><div id="root"></div><script type="module" src="${entryPath}"></script>`);
      return;
    }
    if (url.pathname === entryPath) {
      response.setHeader('content-type', 'text/javascript');
      response.setHeader('cache-control', overrides.entryCacheControl ?? 'public, max-age=31536000, immutable');
      if (overrides.entryEtag !== null) response.setHeader('etag', overrides.entryEtag ?? '"fixture-entry"');
      if (overrides.entryCfCacheStatus !== null) response.setHeader('cf-cache-status', overrides.entryCfCacheStatus ?? 'HIT');
      response.end(overrides.entryBytes ?? 'console.log("fixture")');
      return;
    }
    if (url.pathname === '/materials/clean-energy') {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><div id="root"></div>');
      return;
    }
    if (url.pathname === '/v1') {
      response.statusCode = 404;
      return json(response, { error: 'API route not found', path: '/v1' });
    }
    if (url.pathname === '/mcp-manifest.json') return json(response, { tools: edgeTools });
    if (url.pathname === '/browser-mcp-manifest.json') return json(response, { tools: browserTools });
    if (url.pathname === '/mcp') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const rpc = JSON.parse(body);
      if (overrides.rpcFailure) return json(response, { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: 'fixture failure' } });
      if (rpc.method === 'tools/list') return json(response, { jsonrpc: '2.0', id: rpc.id, result: { tools: edgeTools } });
      if (rpc.method === 'tools/call' && overrides.authRequired) {
        return json(response, { jsonrpc: '2.0', id: rpc.id, error: { code: -32001, message: 'Unauthorized' } });
      }
      return json(response, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: {} } });
    }
    if (url.pathname === '/gallery/curated/lupine_genesis.glimbin') {
      response.statusCode = 206;
      response.setHeader('content-range', 'bytes 0-15/64');
      response.setHeader('content-length', overrides.contentLength ?? '16');
      if (overrides.assetSource !== null) response.setHeader('x-lupi-asset-source', overrides.assetSource ?? 'r2');
      response.end(Buffer.alloc(16, 7));
      return;
    }
    if (url.pathname.startsWith('/view/')) {
      response.statusCode = overrides.savedViewStatus ?? 200;
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><html><body>saved</body></html>');
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const fixture = { server, origin: `http://127.0.0.1:${address.port}`, hosts };
  openServers.add(fixture);
  return fixture;
}

function makeTools(count, prefix, suffix = '') {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}.${index}${suffix}` }));
}

function json(response, value) {
  response.statusCode ||= 200;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(value));
}
