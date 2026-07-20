#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REPORT_SCHEMA = 'lupi-live-verification-report-v1';
const BASELINE_SCHEMA = 'lupi-public-baseline-v1';
const CUSTOM_DOMAIN = 'https://lupi.live';
const EDGE_TOOL_COUNT = 6;
const BROWSER_TOOL_COUNT = 28;
const RANGE_PATH = '/gallery/curated/lupine_genesis.glimbin';
const POSTURE_KEYS = [
  'webAssets',
  'r2',
  'd1',
  'queue',
  'rendererEndpoint',
  'firebaseProject',
  'largeAssetProxy',
];

export function usage() {
  return `verify-cloudflare-live.mjs

Usage:
  pnpm verify:cloudflare-live -- --url=https://lupi.live --label=postpromotion-custom-domain \\
    --require-custom-domain --expect-web-assets=true --expect-r2=true \\
    --expect-d1=false --expect-queue=false --expect-renderer-endpoint=false \\
    --expect-firebase-project=true --expect-large-asset-proxy=true \\
    --expect-auth-required=false --expect-render-execution=false \\
    --expect-build-sha=<40-hex-sha> --expect-worker-version-id=<version-id>

Options:
  --url=<origin>                         Exact origin to verify.
  --label=<label>                        Stable report label.
  --retries=<count>                      Attempts per check (default: 4).
  --retry-delay=<ms>                     Delay between attempts (default: 2500).
  --timeout=<ms>                         Timeout per request (default: 15000).
  --view-slug=<slug>                     Verify one public /view/:slug route.
  --require-custom-domain                Require exactly https://lupi.live.
  --expect-entry-from=<origin>           Require entry path and bytes to match this origin.
  --expect-build-sha=<40-hex-sha>        Required release tag/build identity.
  --expect-worker-version-id=<id>        Required Cloudflare Worker version ID.
  --expect-web-assets=<true|false>        Required binding posture.
  --expect-r2=<true|false>               Required binding posture.
  --expect-d1=<true|false>               Required binding posture.
  --expect-queue=<true|false>            Required binding posture.
  --expect-renderer-endpoint=<true|false> Required binding posture.
  --expect-firebase-project=<true|false>  Required binding posture.
  --expect-large-asset-proxy=<true|false> Required binding posture.
  --expect-auth-required=<true|false>     Required public auth posture.
  --expect-render-execution=<true|false>  Required render-execution posture.
  --capture-prior-baseline               Emit a normal prior baseline in the JSON report.
  --capture-legacy-prior-baseline        One-rollout metadata-less legacy capture.
  --legacy-prior-version-id=<id>         Independently proven legacy control-plane ID.
  --expect-prior-baseline=<json-path>     Replay an already validated baseline.
  --allow-legacy-prior-metadata-absence  Legal only with a legacy baseline replay.
  --json                                 Emit one machine-readable report.
  --help                                 Show this help.

The verifier is read-only. It sends no credentials and performs no render or
analytics write.`;
}

export function parseCommandLine(argv, env = process.env) {
  const raw = parseArgs(argv);
  if (raw.help === true || raw.h === true) return { help: true };

  const url = normalizeOrigin(raw.url ?? env.VERIFY_URL ?? CUSTOM_DOMAIN, 'url');
  const options = {
    url: url.origin,
    label: requiredLabel(raw.label ?? 'cloudflare-live'),
    retries: positiveInteger(raw.retries ?? 4, 'retries'),
    retryDelay: nonNegativeInteger(raw['retry-delay'] ?? 2500, 'retry-delay'),
    timeout: positiveInteger(raw.timeout ?? env.VERIFY_TIMEOUT ?? 15000, 'timeout'),
    json: parseSwitch(raw.json, 'json'),
    requireCustomDomain: parseSwitch(raw['require-custom-domain'], 'require-custom-domain'),
    viewSlug: optionalSlug(raw['view-slug']),
    expectEntryFrom: raw['expect-entry-from'] === undefined
      ? null
      : normalizeOrigin(raw['expect-entry-from'], 'expect-entry-from').origin,
    expectBuildSha: optionalString(raw['expect-build-sha']),
    expectWorkerVersionId: optionalString(raw['expect-worker-version-id']),
    expectAuthRequired: requiredBoolean(raw['expect-auth-required'], 'expect-auth-required'),
    expectRenderExecution: requiredBoolean(raw['expect-render-execution'], 'expect-render-execution'),
    expectedBindings: Object.fromEntries(POSTURE_KEYS.map((key) => {
      const cliKey = camelToKebab(key);
      return [key, requiredBoolean(raw[`expect-${cliKey}`], `expect-${cliKey}`)];
    })),
    capturePriorBaseline: parseSwitch(raw['capture-prior-baseline'], 'capture-prior-baseline'),
    captureLegacyPriorBaseline: parseSwitch(raw['capture-legacy-prior-baseline'], 'capture-legacy-prior-baseline'),
    legacyPriorVersionId: optionalString(raw['legacy-prior-version-id']),
    expectPriorBaselinePath: optionalString(raw['expect-prior-baseline']),
    allowLegacyPriorMetadataAbsence: parseSwitch(
      raw['allow-legacy-prior-metadata-absence'],
      'allow-legacy-prior-metadata-absence',
    ),
  };
  validateOptions(options);
  return options;
}

export async function verifyCloudflareLive(options, dependencies = {}) {
  validateOptions(options, { allowTestBaselineOrigin: dependencies.allowTestBaselineOrigin === true });
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  assert.equal(typeof fetchImpl, 'function', 'fetch is not available');
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const readFileImpl = dependencies.readFile ?? readFile;
  const checks = [];
  const observations = {};
  const baseUrl = normalizeOrigin(options.url, 'url');

  async function request(target, init = {}) {
    const url = target instanceof URL ? target : new URL(target, baseUrl);
    const response = await fetchImpl(url, {
      ...init,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeout),
    });
    assert.ok(response.status < 300 || response.status >= 400, `redirect is not allowed: HTTP ${response.status}`);
    return response;
  }

  async function check(name, operation) {
    let lastError;
    for (let attempt = 1; attempt <= options.retries; attempt += 1) {
      try {
        const detail = await operation();
        checks.push({ name, ok: true, attempts: attempt, detail });
        return detail;
      } catch (error) {
        lastError = error;
        if (attempt < options.retries) await sleep(options.retryDelay);
      }
    }
    checks.push({ name, ok: false, attempts: options.retries, error: errorMessage(lastError) });
    return null;
  }

  await check('health', async () => {
    const response = await request('/health');
    assert.equal(response.status, 200, `expected HTTP 200, got ${response.status}`);
    const health = await response.json();
    observations.health = projectAndValidateHealth(health, options);
    return {
      toolCount: observations.health.toolCount,
      release: observations.health.release ?? null,
      bindings: observations.health.bindings,
    };
  });

  await check('root-entry', async () => {
    observations.entry = await readEntry(baseUrl, request);
    return observations.entry;
  });

  await check('edge-manifest', async () => {
    const response = await request('/mcp-manifest.json');
    assert.equal(response.status, 200, `expected HTTP 200, got ${response.status}`);
    observations.edgeTools = manifestToolNames(await response.json(), EDGE_TOOL_COUNT);
    assert.ok(observations.edgeTools.includes('lupi.render_molecule_asset'), 'lupi.render_molecule_asset is missing');
    return { count: observations.edgeTools.length };
  });

  await check('browser-manifest', async () => {
    const response = await request('/browser-mcp-manifest.json');
    assert.equal(response.status, 200, `expected HTTP 200, got ${response.status}`);
    observations.browserTools = manifestToolNames(await response.json(), BROWSER_TOOL_COUNT);
    assert.ok(observations.browserTools.includes('lupi.export_asset'), 'lupi.export_asset is missing');
    assert.ok(observations.browserTools.includes('lupi.set_frame'), 'lupi.set_frame is missing');
    return { count: observations.browserTools.length };
  });

  await check('mcp-auth-and-tools', async () => {
    const initialize = await request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'lupi-live-initialize',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'lupi-live-verifier', version: '1.0.0' },
        },
      }),
    });
    if (options.expectAuthRequired) {
      assert.ok(initialize.status === 401 || initialize.status === 403,
        `expected credential-free 401/403, got ${initialize.status}`);
      observations.mcp = { authRequired: true, credentialFreeStatus: initialize.status, toolCount: null };
      return observations.mcp;
    }
    assert.equal(initialize.status, 200, `initialize expected HTTP 200, got ${initialize.status}`);
    assertJsonRpcSuccess(await initialize.json(), 'lupi-live-initialize');

    const list = await request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'lupi-live-tools', method: 'tools/list', params: {} }),
    });
    assert.equal(list.status, 200, `tools/list expected HTTP 200, got ${list.status}`);
    const body = await list.json();
    assertJsonRpcSuccess(body, 'lupi-live-tools');
    assert.ok(Array.isArray(body.result?.tools), 'tools/list result.tools is not an array');
    assert.equal(body.result.tools.length, EDGE_TOOL_COUNT, `expected ${EDGE_TOOL_COUNT} MCP tools`);
    observations.mcp = { authRequired: false, credentialFreeStatus: 200, toolCount: body.result.tools.length };
    return observations.mcp;
  });

  await check('range-delivery', async () => {
    const response = await request(RANGE_PATH, { headers: { range: 'bytes=0-15' } });
    assert.equal(response.status, 206, `expected HTTP 206, got ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.byteLength, 16, `expected 16 bytes, got ${bytes.byteLength}`);
    const contentRange = response.headers.get('content-range');
    const contentLength = response.headers.get('content-length');
    assert.match(contentRange ?? '', /^bytes 0-15\/\d+$/, 'invalid or missing Content-Range');
    assert.equal(contentLength, '16', 'Content-Length must be exactly 16');
    const source = response.headers.get('x-lupi-asset-source');
    const legacyMode = options.captureLegacyPriorBaseline || options.allowLegacyPriorMetadataAbsence;
    if (legacyMode) {
      assert.equal(source, null, 'legacy baseline permits only the historical missing source marker');
    } else {
      assert.equal(source, 'r2', 'x-lupi-asset-source must be r2');
    }
    observations.asset = {
      path: RANGE_PATH,
      status: 206,
      contentRange,
      contentLength: 16,
      byteLength: bytes.byteLength,
      assetSource: source,
      r2DeliveryProven: source === 'r2',
    };
    return observations.asset;
  });

  if (options.viewSlug) {
    await check('saved-view', async () => {
      const response = await request(`/view/${encodeURIComponent(options.viewSlug)}`);
      assert.equal(response.status, 200, `expected HTTP 200, got ${response.status}`);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i, 'saved view is not HTML');
      const html = await response.text();
      assert.match(html, /<!doctype html|<html\b/i, 'saved-view response body is not HTML');
      observations.savedView = { slug: options.viewSlug, status: 200 };
      return observations.savedView;
    });
  }

  if (options.expectEntryFrom) {
    await check('entry-parity', async () => {
      const comparisonBase = normalizeOrigin(options.expectEntryFrom, 'expect-entry-from');
      const comparisonRequest = async (path, init = {}) => {
        const response = await fetchImpl(new URL(path, comparisonBase), {
          ...init,
          cache: 'no-store',
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeout),
        });
        assert.ok(response.status < 300 || response.status >= 400,
          `comparison redirect is not allowed: HTTP ${response.status}`);
        return response;
      };
      const comparison = await readEntry(comparisonBase, comparisonRequest);
      assert.deepEqual(observations.entry, comparison,
        `entry mismatch: ${JSON.stringify({ actual: observations.entry, expected: comparison })}`);
      return { origin: comparisonBase.origin, ...comparison };
    });
  }

  let expectedBaseline = null;
  if (options.expectPriorBaselinePath) {
    await check('prior-baseline-input', async () => {
      const parsed = JSON.parse(await readFileImpl(options.expectPriorBaselinePath, 'utf8'));
      expectedBaseline = validateBaseline(parsed, {
        allowTestOrigin: dependencies.allowTestBaselineOrigin === true,
      });
      if (options.allowLegacyPriorMetadataAbsence) {
        assert.equal(expectedBaseline.mode, 'legacy', 'legacy metadata absence requires a legacy baseline');
      } else {
        assert.equal(expectedBaseline.mode, 'normal', 'normal replay requires a normal baseline');
      }
      return { mode: expectedBaseline.mode, capturedAt: expectedBaseline.capturedAt };
    });
  }

  const prerequisiteFailures = () => checks.filter((entry) => !entry.ok && entry.name !== 'prior-baseline-compare');
  let baseline = null;
  if (options.capturePriorBaseline || options.captureLegacyPriorBaseline || options.expectPriorBaselinePath) {
    await check(options.expectPriorBaselinePath ? 'prior-baseline-compare' : 'prior-baseline-capture', async () => {
      assert.equal(prerequisiteFailures().length, 0, 'cannot create/compare a baseline after a failed check');
      const projection = createProjection(observations);
      const mode = options.captureLegacyPriorBaseline || options.allowLegacyPriorMetadataAbsence ? 'legacy' : 'normal';
      baseline = {
        schemaVersion: BASELINE_SCHEMA,
        mode,
        capturedAt: now().toISOString(),
        origin: baseUrl.origin,
        priorReleaseMetadataPresent: mode === 'normal',
        ...(mode === 'legacy' ? { controlPlaneVersionId: options.legacyPriorVersionId ?? expectedBaseline?.controlPlaneVersionId } : {}),
        projection,
      };
      validateBaseline(baseline, {
        allowTestOrigin: dependencies.allowTestBaselineOrigin === true,
      });
      if (expectedBaseline) {
        assert.equal(baseUrl.origin, expectedBaseline.origin, 'baseline origin does not match');
        assert.deepEqual(projection, expectedBaseline.projection, 'public fingerprint differs from prior baseline');
        baseline = expectedBaseline;
      }
      return { mode: baseline.mode, projectionSha256: sha256Json(baseline.projection) };
    });
  }

  const report = {
    schemaVersion: REPORT_SCHEMA,
    generatedAt: now().toISOString(),
    label: options.label,
    url: baseUrl.origin,
    ok: checks.every((entry) => entry.ok),
    checks,
    observations,
    ...(baseline ? { baseline } : {}),
  };
  return report;
}

function validateOptions(options, { allowTestBaselineOrigin = false } = {}) {
  assert.ok(options && typeof options === 'object', 'options are required');
  const url = normalizeOrigin(options.url, 'url');
  requiredLabel(options.label);
  positiveInteger(options.retries, 'retries');
  nonNegativeInteger(options.retryDelay, 'retry-delay');
  positiveInteger(options.timeout, 'timeout');
  assert.equal(typeof options.expectAuthRequired, 'boolean', 'expect-auth-required must be explicit');
  assert.equal(typeof options.expectRenderExecution, 'boolean', 'expect-render-execution must be explicit');
  assert.deepEqual(Object.keys(options.expectedBindings ?? {}).sort(), [...POSTURE_KEYS].sort(),
    'every expected binding posture must be explicit');
  for (const key of POSTURE_KEYS) assert.equal(typeof options.expectedBindings[key], 'boolean', `expectedBindings.${key} must be boolean`);
  if (options.expectRenderExecution && !options.expectAuthRequired) {
    assert.fail('render execution cannot be expected while auth is not required');
  }
  if (options.requireCustomDomain) assert.equal(url.origin, CUSTOM_DOMAIN, `custom domain must be ${CUSTOM_DOMAIN}`);
  if (options.viewSlug) optionalSlug(options.viewSlug);
  if (options.expectEntryFrom) normalizeOrigin(options.expectEntryFrom, 'expect-entry-from');

  const captureCount = Number(Boolean(options.capturePriorBaseline)) + Number(Boolean(options.captureLegacyPriorBaseline));
  assert.ok(captureCount <= 1, 'baseline capture modes are mutually exclusive');
  assert.ok(!(captureCount && options.expectPriorBaselinePath), 'capture and replay modes are mutually exclusive');
  const baselineMode = captureCount > 0 || Boolean(options.expectPriorBaselinePath);
  if (baselineMode && !allowTestBaselineOrigin) {
    assert.equal(url.origin, CUSTOM_DOMAIN, `baseline mode requires ${CUSTOM_DOMAIN}`);
    assert.equal(options.requireCustomDomain, true, 'baseline mode requires --require-custom-domain');
    assert.equal(options.json, true, 'baseline mode requires --json');
  }

  if (options.captureLegacyPriorBaseline) {
    assert.ok(options.legacyPriorVersionId, 'legacy capture requires --legacy-prior-version-id');
    assert.equal(options.expectBuildSha, null, 'legacy capture must omit --expect-build-sha');
    assert.equal(options.expectWorkerVersionId, null, 'legacy capture must omit --expect-worker-version-id');
  } else if (options.allowLegacyPriorMetadataAbsence) {
    assert.ok(options.expectPriorBaselinePath, 'legacy metadata absence is legal only for baseline replay');
    assert.equal(options.capturePriorBaseline, false, 'legacy replay cannot capture a normal baseline');
    assert.equal(options.expectBuildSha, null, 'legacy replay must omit --expect-build-sha');
    assert.equal(options.expectWorkerVersionId, null, 'legacy replay must omit --expect-worker-version-id');
  } else {
    assert.match(options.expectBuildSha ?? '', /^[a-f0-9]{40}$/i, 'expect-build-sha must be a full 40-hex SHA');
    assert.ok(options.expectWorkerVersionId, 'expect-worker-version-id is required');
  }
  if (options.legacyPriorVersionId && !options.captureLegacyPriorBaseline) {
    assert.fail('legacy-prior-version-id is legal only for legacy capture');
  }
}

function projectAndValidateHealth(value, options) {
  assertPlainObject(value, 'health');
  assert.equal(value.ready, true, 'health.ready is not true');
  assert.equal(value.toolCount, EDGE_TOOL_COUNT, `health.toolCount must be ${EDGE_TOOL_COUNT}`);
  assert.equal(value.browserRequired, false, 'health.browserRequired must be false');
  assert.equal(value.agentNative, true, 'health.agentNative must be true');
  assert.equal(typeof value.name, 'string', 'health.name must be a string');
  assert.equal(typeof value.version, 'string', 'health.version must be a string');
  assert.equal(value.renderExecution, options.expectRenderExecution, 'health.renderExecution posture mismatch');
  assertPlainObject(value.bindings, 'health.bindings');
  const bindings = {};
  for (const key of POSTURE_KEYS) {
    assert.equal(value.bindings[key], options.expectedBindings[key], `health.bindings.${key} posture mismatch`);
    bindings[key] = value.bindings[key];
  }
  assert.equal(value.bindings.authRequired, options.expectAuthRequired, 'health.bindings.authRequired posture mismatch');
  bindings.authRequired = value.bindings.authRequired;
  if (value.renderExecution && !value.bindings.authRequired) {
    assert.fail('render execution is enabled without required authentication');
  }

  const legacyMode = options.captureLegacyPriorBaseline || options.allowLegacyPriorMetadataAbsence;
  let release;
  if (legacyMode) {
    assert.equal(value.release, undefined, 'legacy mode requires absent health.release');
  } else {
    assertPlainObject(value.release, 'health.release');
    assert.equal(value.release.id, options.expectWorkerVersionId, 'Worker version ID mismatch');
    assert.equal(value.release.tag, options.expectBuildSha, 'release tag/build SHA mismatch');
    assert.match(value.release.tag, /^[a-f0-9]{40}$/i, 'release tag must be a full SHA');
    assert.equal(typeof value.release.timestamp, 'string', 'release timestamp must be a string');
    assert.ok(Number.isFinite(Date.parse(value.release.timestamp)), 'release timestamp must be ISO-compatible');
    release = { id: value.release.id, tag: value.release.tag, timestamp: value.release.timestamp };
  }
  return {
    ready: true,
    name: value.name,
    version: value.version,
    toolCount: value.toolCount,
    agentNative: true,
    browserRequired: false,
    renderExecution: value.renderExecution,
    bindings,
    ...(release ? { release } : {}),
  };
}

async function readEntry(baseUrl, request) {
  const root = await request('/');
  assert.equal(root.status, 200, `root expected HTTP 200, got ${root.status}`);
  const html = await root.text();
  assert.match(html, /\bid=["']root["']/i, 'root HTML does not contain id="root"');
  const path = entryPath(html, baseUrl);
  const entry = await request(path);
  assert.equal(entry.status, 200, `entry expected HTTP 200, got ${entry.status}`);
  const bytes = new Uint8Array(await entry.arrayBuffer());
  assert.ok(bytes.byteLength > 0, 'entry asset is empty');
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function entryPath(html, baseUrl) {
  const matches = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  for (const match of matches) {
    const url = new URL(match[1], baseUrl);
    assert.equal(url.origin, baseUrl.origin, 'entry script must remain same-origin');
    if (/^\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(url.pathname)) return url.pathname;
  }
  assert.fail('hashed Vite /assets/index-*.js entry was not found');
}

function manifestToolNames(manifest, expectedCount) {
  assertPlainObject(manifest, 'manifest');
  assert.ok(Array.isArray(manifest.tools), 'manifest.tools is not an array');
  const names = manifest.tools.map((tool) => {
    assertPlainObject(tool, 'manifest tool');
    assert.equal(typeof tool.name, 'string', 'manifest tool name is not a string');
    return tool.name;
  });
  assert.equal(new Set(names).size, names.length, 'manifest has duplicate tool names');
  assert.equal(names.length, expectedCount, `expected ${expectedCount} tools, got ${names.length}`);
  return names.toSorted();
}

function assertJsonRpcSuccess(body, expectedId) {
  assertPlainObject(body, 'JSON-RPC response');
  assert.equal(body.jsonrpc, '2.0', 'jsonrpc must be 2.0');
  assert.equal(body.id, expectedId, 'JSON-RPC id mismatch');
  assert.equal(body.error, undefined, 'JSON-RPC response contains an error');
  assertPlainObject(body.result, 'JSON-RPC result');
}

function createProjection(observations) {
  for (const key of ['health', 'entry', 'edgeTools', 'browserTools', 'mcp', 'asset']) {
    assert.notEqual(observations[key], undefined, `missing ${key} observation`);
  }
  return {
    health: observations.health,
    edgeTools: observations.edgeTools,
    browserTools: observations.browserTools,
    mcp: observations.mcp,
    asset: observations.asset,
    entry: observations.entry,
  };
}

export function validateBaseline(value, { allowTestOrigin = false } = {}) {
  assertPlainObject(value, 'baseline');
  assert.equal(value.schemaVersion, BASELINE_SCHEMA, `unsupported baseline schema: ${value.schemaVersion}`);
  assert.ok(value.mode === 'normal' || value.mode === 'legacy', 'baseline mode must be normal or legacy');
  if (allowTestOrigin) normalizeOrigin(value.origin, 'baseline origin');
  else assert.equal(value.origin, CUSTOM_DOMAIN, `baseline origin must be ${CUSTOM_DOMAIN}`);
  assert.ok(Number.isFinite(Date.parse(value.capturedAt)), 'baseline capturedAt is invalid');
  const expectedTop = value.mode === 'legacy'
    ? ['capturedAt', 'controlPlaneVersionId', 'mode', 'origin', 'priorReleaseMetadataPresent', 'projection', 'schemaVersion']
    : ['capturedAt', 'mode', 'origin', 'priorReleaseMetadataPresent', 'projection', 'schemaVersion'];
  assertExactKeys(value, expectedTop, 'baseline');
  assert.equal(value.priorReleaseMetadataPresent, value.mode === 'normal', 'baseline metadata-presence mismatch');
  if (value.mode === 'legacy') assert.ok(nonEmptyString(value.controlPlaneVersionId), 'legacy control-plane version ID is required');
  assertPlainObject(value.projection, 'baseline.projection');
  assertExactKeys(value.projection, ['asset', 'browserTools', 'edgeTools', 'entry', 'health', 'mcp'], 'baseline.projection');
  assertPlainObject(value.projection.health, 'baseline.projection.health');
  assertPlainObject(value.projection.asset, 'baseline.projection.asset');
  assertPlainObject(value.projection.entry, 'baseline.projection.entry');
  assertPlainObject(value.projection.mcp, 'baseline.projection.mcp');
  assert.ok(Array.isArray(value.projection.edgeTools), 'baseline edgeTools must be an array');
  assert.ok(Array.isArray(value.projection.browserTools), 'baseline browserTools must be an array');
  assert.equal(value.projection.edgeTools.length, EDGE_TOOL_COUNT, 'baseline edge tool count mismatch');
  assert.equal(value.projection.browserTools.length, BROWSER_TOOL_COUNT, 'baseline browser tool count mismatch');
  assert.match(value.projection.entry.path ?? '', /^\/assets\/index-[A-Za-z0-9_-]+\.js$/, 'baseline entry path is invalid');
  assert.match(value.projection.entry.sha256 ?? '', /^[a-f0-9]{64}$/i, 'baseline entry SHA-256 is invalid');
  if (value.mode === 'legacy') {
    assert.equal(value.projection.health.release, undefined, 'legacy baseline cannot contain release metadata');
    assert.equal(value.projection.asset.assetSource, null, 'legacy baseline asset source must be null');
    assert.equal(value.projection.asset.r2DeliveryProven, false, 'legacy baseline cannot claim R2 proof');
  } else {
    assertPlainObject(value.projection.health.release, 'normal baseline release');
    assert.match(value.projection.health.release.tag ?? '', /^[a-f0-9]{40}$/i, 'normal baseline release tag is invalid');
    assert.ok(nonEmptyString(value.projection.health.release.id), 'normal baseline version ID is required');
    assert.equal(value.projection.asset.assetSource, 'r2', 'normal baseline asset source must be r2');
    assert.equal(value.projection.asset.r2DeliveryProven, true, 'normal baseline must prove R2 delivery');
  }
  return value;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    assert.ok(arg.startsWith('--'), `unexpected positional argument: ${arg}`);
    const equals = arg.indexOf('=');
    const key = arg.slice(2, equals === -1 ? undefined : equals);
    assert.ok(key, 'empty option name');
    assert.equal(parsed[key], undefined, `duplicate option --${key}`);
    if (equals !== -1) {
      parsed[key] = arg.slice(equals + 1);
    } else if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
      parsed[key] = argv[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  const allowed = new Set([
    'help', 'h', 'url', 'label', 'retries', 'retry-delay', 'timeout', 'json',
    'require-custom-domain', 'view-slug', 'expect-entry-from', 'expect-build-sha',
    'expect-worker-version-id', 'expect-auth-required', 'expect-render-execution',
    'capture-prior-baseline', 'capture-legacy-prior-baseline',
    'legacy-prior-version-id', 'expect-prior-baseline',
    'allow-legacy-prior-metadata-absence',
    ...POSTURE_KEYS.map((key) => `expect-${camelToKebab(key)}`),
  ]);
  for (const key of Object.keys(parsed)) assert.ok(allowed.has(key), `unknown option --${key}`);
  return parsed;
}

function normalizeOrigin(value, name) {
  assert.ok(nonEmptyString(value), `${name} is required`);
  const url = new URL(value);
  assert.equal(url.username, '', `${name} must not contain credentials`);
  assert.equal(url.password, '', `${name} must not contain credentials`);
  assert.equal(url.search, '', `${name} must not contain a query`);
  assert.equal(url.hash, '', `${name} must not contain a fragment`);
  assert.ok(url.pathname === '/' || url.pathname === '', `${name} must be an origin without a path`);
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  assert.ok(url.protocol === 'https:' || (url.protocol === 'http:' && local), `${name} must use HTTPS (HTTP is test-local only)`);
  url.pathname = '/';
  return url;
}

function parseSwitch(value, name) {
  if (value === undefined) return false;
  if (value === true || value === 'true') return true;
  if (value === 'false') return false;
  assert.fail(`${name} must be a boolean switch`);
}

function requiredBoolean(value, name) {
  if (value === 'true' || value === true) return true;
  if (value === 'false') return false;
  assert.fail(`${name} must be explicitly true or false`);
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  assert.ok(Number.isInteger(parsed) && parsed > 0, `${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  assert.ok(Number.isInteger(parsed) && parsed >= 0, `${name} must be a non-negative integer`);
  return parsed;
}

function optionalSlug(value) {
  if (value === undefined || value === null || value === '') return null;
  assert.ok(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'view-slug is invalid');
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') return null;
  assert.ok(typeof value === 'string', 'option value must be a string');
  return value;
}

function requiredLabel(value) {
  assert.ok(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value), 'label is invalid');
  return value;
}

function camelToKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertPlainObject(value, name) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
}

function assertExactKeys(value, expected, name) {
  assert.deepEqual(Object.keys(value).toSorted(), [...expected].toSorted(), `${name} contains missing or extra fields`);
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  try {
    const options = parseCommandLine(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const report = await verifyCloudflareLive(options);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const check of report.checks) {
        console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.ok ? '' : `: ${check.error}`}`);
      }
      console.log(`${report.ok ? 'PASS' : 'FAIL'} ${report.label} ${report.url}`);
    }
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`verify-cloudflare-live: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
