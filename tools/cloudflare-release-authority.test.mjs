import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  scanHistoricalRerunnableRuns,
  scanWorkflowSources,
} from './cloudflare-release-authority.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const ACTION_SHA = '1111111111111111111111111111111111111111';
const WRANGLER_LOCK_SHA256 = '036615b8e80663617f476cd3a9f7d2f7dc7d858be7b38777b75ca1b9f0f5e9b0';

test('closed current controller fixtures pass with literal authority and full-SHA actions', () => {
  const result = scanWorkflowSources(validCurrentSources(), currentMetadata());
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.match(result.projectionSha256, /^[a-f0-9]{64}$/);
});

test('dynamic environment expressions are rejected even when the v2 name is absent', () => {
  const sources = validCurrentSources();
  sources['deploy-viewer.yml'] = workflow([
    'on: workflow_dispatch',
    'jobs:',
    '  deploy:',
    "    environment: '${{ inputs.environment }}'",
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo safe',
  ]);
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'dynamic-environment'));
});

test('computed and inherited secrets are rejected', () => {
  const sources = validCurrentSources();
  sources['deploy-viewer.yml'] = workflow([
    'on: workflow_dispatch',
    'jobs:',
    '  computed:',
    '    runs-on: ubuntu-latest',
    '    env:',
    "      VALUE: '${{ secrets[inputs.secret_name] }}'",
    '    steps:',
    '      - run: echo safe',
    '  inherited:',
    `    uses: example/reusable/.github/workflows/call.yml@${ACTION_SHA}`,
    '    secrets: inherit',
  ]);
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.ok(result.findings.some((finding) => finding.code === 'computed-secret'));
  assert.ok(result.findings.some((finding) => finding.code === 'inherited-secrets'));
});

test('v2 environment and secret references outside the controllers are rejected', () => {
  const sources = validCurrentSources();
  sources['deploy-viewer.yml'] = workflow([
    'on: workflow_dispatch',
    'jobs:',
    '  steal:',
    '    environment: lupi-production-write-v2',
    '    runs-on: ubuntu-latest',
    '    steps:',
    "      - run: echo '${{ secrets.LUPI_CLOUDFLARE_WRITE_TOKEN_V2 }}'",
  ]);
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.ok(result.findings.some((finding) => finding.code === 'v2-authority-outside-controller'));
  assert.ok(result.findings.some((finding) => finding.code === 'v2-secret-outside-controller'));
});

test('authority actions must use full immutable SHAs', () => {
  const sources = validCurrentSources();
  sources['deploy-cloudflare.yml'] = sources['deploy-cloudflare.yml'].replace(
    `actions/download-artifact@${ACTION_SHA}`,
    'actions/download-artifact@v4',
  );
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.ok(result.findings.some((finding) => finding.code === 'write-action-not-full-sha'));
});

test('write jobs reject checkout, install, runner-state channels, and local actions', () => {
  const sources = validCurrentSources();
  sources['deploy-cloudflare.yml'] = sources['deploy-cloudflare.yml'].replace(
    `      - uses: actions/download-artifact@${ACTION_SHA}`,
    [
      `      - uses: actions/checkout@${ACTION_SHA}`,
      '      - uses: ./local-action',
      "      - run: echo unsafe >> $GITHUB_PATH",
      '      - run: pnpm install',
      `      - uses: actions/download-artifact@${ACTION_SHA}`,
    ].join('\n'),
  );
  const result = scanWorkflowSources(sources, currentMetadata());
  for (const code of ['write-checkout', 'write-local-action', 'write-runner-state-channel', 'write-install-build-test']) {
    assert.ok(result.findings.some((finding) => finding.code === code), `missing ${code}`);
  }
});

test('write jobs allow only the exact isolated integrity-pinned Wrangler bootstrap', () => {
  const sources = validCurrentSources();
  sources['deploy-cloudflare.yml'] = sources['deploy-cloudflare.yml'].replace(
    `      - uses: actions/download-artifact@${ACTION_SHA}`,
    [
      '      - name: Bootstrap integrity-pinned Wrangler',
      '        run: |',
      `          expected='${WRANGLER_LOCK_SHA256}'`,
      '          root="$RUNNER_TEMP/lupi-wrangler"',
      '          cp authority/controller/wrangler-runtime/package-lock.json "$root/runtime/package-lock.json"',
      '          npm ci --ignore-scripts --omit=dev --prefix "$root/runtime"',
      '          test "$(node -p "require(\'$root/runtime/node_modules/wrangler/package.json\').version")" = 4.110.0',
      `      - uses: actions/download-artifact@${ACTION_SHA}`,
    ].join('\n'),
  );
  const accepted = scanWorkflowSources(sources, currentMetadata());
  assert.equal(accepted.ok, true, JSON.stringify(accepted.findings, null, 2));

  const tampered = structuredClone(sources);
  tampered['deploy-cloudflare.yml'] = tampered['deploy-cloudflare.yml'].replace(
    'Bootstrap integrity-pinned Wrangler',
    'Bootstrap unclassified Wrangler',
  );
  const rejected = scanWorkflowSources(tampered, currentMetadata());
  assert.ok(
    rejected.findings.some((finding) => finding.code === 'write-install-build-test'),
    JSON.stringify(rejected.findings, null, 2),
  );
});

test('write token is rejected at job scope or in more than one step', () => {
  const sources = validCurrentSources();
  sources['deploy-cloudflare.yml'] = sources['deploy-cloudflare.yml'].replace(
    '  version-upload:\n    runs-on: ubuntu-latest',
    [
      '  version-upload:',
      '    runs-on: ubuntu-latest',
      '    env:',
      "      BAD: '${{ secrets.LUPI_CLOUDFLARE_WRITE_TOKEN_V2 }}'",
    ].join('\n'),
  );
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.ok(result.findings.some((finding) => finding.code === 'write-secret-at-job-scope'));

  const duplicated = validCurrentSources();
  duplicated['deploy-cloudflare.yml'] = duplicated['deploy-cloudflare.yml'].replace(
    "      - run: C:/tool/wrangler versions upload worker.mjs --no-bundle",
    [
      "      - run: C:/tool/wrangler versions upload worker.mjs --no-bundle",
      '        env:',
      "          CLOUDFLARE_API_TOKEN: '${{ secrets.LUPI_CLOUDFLARE_WRITE_TOKEN_V2 }}'",
      '      - run: C:/tool/wrangler versions upload worker.mjs --no-bundle',
    ].join('\n'),
  );
  const duplicatedResult = scanWorkflowSources(duplicated, currentMetadata());
  assert.ok(duplicatedResult.findings.some((finding) => finding.code === 'write-secret-step-count'));
});

test('write-job evidence uploads are allowed only after the closed mutation step', () => {
  const sources = validCurrentSources();
  sources['deploy-cloudflare.yml'] = sources['deploy-cloudflare.yml'].replace(
    `actions/download-artifact@${ACTION_SHA}`,
    `actions/upload-artifact@${ACTION_SHA}`,
  );
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.ok(
    result.findings.some((finding) => finding.code === 'write-evidence-upload-order'),
    JSON.stringify(result.findings, null, 2),
  );
});

test('rollback evidence text is not mistaken for a Cloudflare mutation', () => {
  const sources = validCurrentSources();
  sources['deploy-cloudflare.yml'] = sources['deploy-cloudflare.yml'].replace(
    '      - run: echo no-secret',
    '      - run: echo "validate rollback contract and prior package"',
  );
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

test('credentialed jobs must depend on the no-secret authority scan', () => {
  const sources = validCurrentSources();
  sources['deploy-cloudflare.yml'] = sources['deploy-cloudflare.yml'].replace(
    '    needs: authority-scan\n    environment: lupi-production-read-v2',
    '    environment: lupi-production-read-v2',
  );
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.ok(result.findings.some((finding) => finding.code === 'authority-scan-dependency-missing'));
});

test('Cloudflare mutation in read-only or re-anchor jobs is rejected', () => {
  const sources = validCurrentSources();
  sources['deploy-cloudflare.yml'] = sources['deploy-cloudflare.yml'].replace(
    '      - run: wrangler deployments status --json',
    '      - run: wrangler versions deploy candidate@100%',
  );
  const result = scanWorkflowSources(sources, currentMetadata());
  assert.ok(result.findings.some((finding) => finding.code === 'mutation-outside-write-role'));
});

test('historical literal unrelated environment does not make a mutable action fresh-authority reachable', () => {
  const result = scanWorkflowSources({
    'old.yml': workflow([
      'on: workflow_dispatch',
      'jobs:',
      '  deploy:',
      '    environment: prod',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: cloudflare/wrangler-action@v4',
    ]),
  }, { mode: 'historical' });
  assert.equal(result.ok, true);
});

test('historical dynamic environment plus mutable/local authority action fails', () => {
  const result = scanWorkflowSources({
    'old.yml': workflow([
      'on: workflow_dispatch',
      'jobs:',
      '  deploy:',
      "    environment: '${{ inputs.environment }}'",
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: cloudflare/wrangler-action@v4',
    ]),
  }, { mode: 'historical' });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'historical-dynamic-environment'));
  assert.ok(result.findings.some((finding) => finding.code === 'historical-mutable-authority-action'));
});

test('historical dynamic environment cannot delegate even to a SHA-pinned reusable workflow', () => {
  const result = scanWorkflowSources({
    'old.yml': workflow([
      'on: workflow_dispatch',
      'jobs:',
      '  deploy:',
      "    environment: '${{ inputs.environment }}'",
      `    uses: example/release/.github/workflows/deploy.yml@${ACTION_SHA}`,
      '    secrets: inherit',
    ]),
  }, { mode: 'historical' });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'historical-reusable-authority'));
  assert.ok(result.findings.some((finding) => finding.code === 'historical-dynamic-secret'));
});

test('historical scan paginates, binds exact blobs, and includes the rerun boundary', async () => {
  const now = new Date('2026-07-19T20:00:00.000Z');
  const oldRuns = Array.from({ length: 100 }, (_, index) => runFixture(index + 1, '2026-05-01T00:00:00.000Z'));
  const boundary = runFixture(101, '2026-06-19T20:00:00.000Z');
  const source = workflow([
    'on: workflow_dispatch',
    'jobs:',
    '  deploy:',
    '    environment: prod',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: cloudflare/wrangler-action@v4',
  ]);
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/actions/runs') && parsed.searchParams.get('page') === '1') return response({ workflow_runs: oldRuns });
    if (parsed.pathname.endsWith('/actions/runs') && parsed.searchParams.get('page') === '2') return response({ workflow_runs: [boundary] });
    if (String(url).includes('/contents/')) return response({ encoding: 'base64', content: Buffer.from(source).toString('base64'), sha: '2'.repeat(40) });
    return new Response('not found', { status: 404 });
  };
  const result = await scanHistoricalRerunnableRuns({
    repository: 'alexwelcing/Lupi',
    token: 'not-logged',
  }, { fetch, now: () => now, apiBase: 'https://api.fixture.invalid' });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.totalRunsScanned, 101);
  assert.equal(result.rerunnableRunsScanned, 1);
  assert.equal(result.snapshots[0].blobSha, '2'.repeat(40));
  assert.ok(calls.some((url) => url.includes(`ref=${SHA}`)));
});

test('missing or malformed historical snapshot is a fail-closed finding', async () => {
  const recent = runFixture(9, '2026-07-19T19:00:00.000Z');
  const fetch = async (url) => {
    if (String(url).includes('actions/runs')) return response({ workflow_runs: [recent] });
    return new Response('missing', { status: 404 });
  };
  const result = await scanHistoricalRerunnableRuns({
    repository: 'alexwelcing/Lupi',
    token: 'not-logged',
  }, { fetch, now: () => new Date('2026-07-19T20:00:00.000Z'), apiBase: 'https://api.fixture.invalid' });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].code, 'historical-snapshot-unprovable');
});

test('invalid YAML and missing controllers fail closed', () => {
  const result = scanWorkflowSources({ 'broken.yml': 'jobs: [\n' }, currentMetadata());
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((finding) => finding.code === 'yaml-parse-error'));
  assert.ok(result.findings.some((finding) => finding.code === 'required-controller-missing'));
});

function validCurrentSources() {
  return {
    'ci.yml': workflow(['on: [push, pull_request]', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo test']),
    'deploy-viewer.yml': workflow(['on: workflow_dispatch', 'jobs:', '  deploy:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo viewer']),
    'deploy-cloudflare.yml': deployController(),
    'reconcile-cloudflare-deploy.yml': reconcileController(),
  };
}

function deployController() {
  const lines = ['on: workflow_dispatch', 'jobs:'];
  addNoSecret(lines, 'authority-scan');
  for (const id of ['release-package', 'prior-rollback-verify', 'candidate-verify', 'public-verify', 'rollback-ui-verify', 'rollback-resolution', 'receipt-collation']) addNoSecret(lines, id);
  addCredentialed(lines, 'release-admission', 'read', 'wrangler deployments status --json');
  addCredentialed(lines, 'rollback-control-verify', 'read', 'wrangler deployments status --json');
  addCredentialed(lines, 'version-upload', 'write', 'C:/tool/wrangler versions upload worker.mjs --no-bundle');
  addCredentialed(lines, 'promote', 'write', 'C:/tool/wrangler versions deploy candidate@100%');
  addCredentialed(lines, 'release-rollback', 'write', 'C:/tool/wrangler versions deploy prior-version@100%');
  return workflow(lines);
}

function reconcileController() {
  const lines = [
    'on:',
    '  schedule:',
    "    - cron: '0 7 * * 1'",
    '  workflow_dispatch:',
    '  workflow_run:',
    "    workflows: ['Cloudflare production']",
    "    types: ['completed']",
    'jobs:',
  ];
  addNoSecret(lines, 'reconcile-authority-scan');
  for (const id of ['checkpoint', 'reconcile-ui-verify', 'reanchor-reconstruct']) addNoSecret(lines, id, 'reconcile-authority-scan');
  addCredentialed(lines, 'reconcile-scan', 'read', 'wrangler deployments status --json', 'reconcile-authority-scan');
  addCredentialed(lines, 'reconcile-verify', 'read', 'wrangler deployments status --json', 'reconcile-authority-scan');
  addCredentialed(lines, 'reanchor-control', 'reanchor', 'wrangler deployments status --json', 'reconcile-authority-scan');
  addCredentialed(lines, 'reconcile-rollback', 'write', 'C:/tool/wrangler versions deploy prior-version@100%', 'reconcile-authority-scan');
  return workflow(lines);
}

function addNoSecret(lines, id, needs = null) {
  lines.push(`  ${id}:`, '    runs-on: ubuntu-latest');
  if (needs) lines.push(`    needs: ${needs}`);
  lines.push('    steps:', '      - run: echo no-secret');
}

function addCredentialed(lines, id, role, command, authorityScan = 'authority-scan') {
  const environment = role === 'write'
    ? 'lupi-production-write-v2'
    : role === 'reanchor'
      ? 'lupi-production-reanchor-v2'
      : 'lupi-production-read-v2';
  const secret = role === 'write' ? 'LUPI_CLOUDFLARE_WRITE_TOKEN_V2' : 'LUPI_CLOUDFLARE_READ_TOKEN_V2';
  lines.push(
    `  ${id}:`,
    '    runs-on: ubuntu-latest',
    `    needs: ${authorityScan}`,
    `    environment: ${environment}`,
    '    steps:',
  );
  if (role === 'write') lines.push(`      - uses: actions/download-artifact@${ACTION_SHA}`);
  lines.push(
    `      - run: ${command}`,
    '        env:',
    `          CLOUDFLARE_API_TOKEN: '\${{ secrets.${secret} }}'`,
  );
}

function workflow(lines) {
  return `${lines.join('\n')}\n`;
}

function currentMetadata() {
  return { mode: 'current', repository: 'alexwelcing/Lupi', targetSha: SHA, runId: '44', runAttempt: '1' };
}

function runFixture(id, timestamp) {
  return {
    id,
    run_attempt: 1,
    event: 'workflow_dispatch',
    created_at: timestamp,
    updated_at: timestamp,
    head_sha: SHA,
    path: '.github/workflows/deploy-cloudflare.yml',
  };
}

function response(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
