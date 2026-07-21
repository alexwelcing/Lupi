import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify } from 'yaml';
import { scanWorkflowSources } from './cloudflare-release-authority.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_ROOT = resolve(ROOT, '.github', 'workflows');
const FULL_SHA_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/i;
const WRITE_TOKEN = 'LUPI_CLOUDFLARE_WRITE_TOKEN_V2';
const READ_TOKEN = 'LUPI_CLOUDFLARE_READ_TOKEN_V2';
const SHARED_CONCURRENCY_GROUP = 'lupi-cloudflare-production';
const WRANGLER_VERSION = '4.110.0';
const WRANGLER_LOCK_SHA256 = '036615b8e80663617f476cd3a9f7d2f7dc7d858be7b38777b75ca1b9f0f5e9b0';
const WORKER_FIRST_ROUTES = [
  '/health',
  '/mcp',
  '/mcp-manifest.json',
  '/v1',
  '/v1/*',
  '/assets/sha256-*',
  '/collectAnalytics',
  '/api/analytics',
  '/__/auth/*',
  '/__/firebase/*',
  '/view/*',
  '/gallery/curated/lupine_genesis.*',
  '/gallery/research/hfc/*',
];

const CONTROLLERS = Object.freeze({
  'deploy-cloudflare.yml': {
    events: ['workflow_dispatch'],
    scan: 'authority-scan',
    roles: {
      'authority-scan': 'none',
      'release-package': 'none',
      'release-admission': 'read',
      'prior-rollback-verify': 'none',
      'version-upload': 'write',
      'candidate-verify': 'none',
      'receipt-collation': 'none',
      promote: 'write',
      'public-verify': 'none',
      'release-rollback': 'write',
      'rollback-control-verify': 'read',
      'rollback-ui-verify': 'none',
      'rollback-resolution': 'none',
    },
  },
  'reconcile-cloudflare-deploy.yml': {
    events: ['schedule', 'workflow_dispatch', 'workflow_run'],
    scan: 'reconcile-authority-scan',
    roles: {
      'reconcile-authority-scan': 'none',
      'reconcile-scan': 'read',
      'reconcile-verify': 'read',
      'reanchor-control': 'reanchor',
      'reconcile-rollback': 'write',
      checkpoint: 'none',
      'reconcile-ui-verify': 'none',
      'reanchor-reconstruct': 'none',
    },
  },
});

const ENVIRONMENT_FOR_ROLE = Object.freeze({
  none: null,
  read: 'lupi-production-read-v2',
  write: 'lupi-production-write-v2',
  reanchor: 'lupi-production-reanchor-v2',
});

test('every workflow YAML parses and the closed-world authority scanner accepts the tree', async () => {
  const fixture = await loadFixture();
  assert.ok(Object.keys(fixture.workflows).length >= 4, 'expected every repository workflow YAML to be parsed');
  const result = scanWorkflowSources(fixture.sources, scanMetadata());
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

test('CI, deploy, and reconciliation preserve the blocking release contract', async () => {
  const { workflows } = await loadFixture();
  assertWorkflowContract(workflows);
});

test('Turbo forwards the exact Cloudflare web build environment to Vite', async () => {
  const turbo = JSON.parse(await readFile(resolve(ROOT, 'turbo.json'), 'utf8'));
  const forwarded = turbo.tasks?.build?.env ?? [];
  for (const name of [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID',
    'VITE_LUPI_MCP_ENDPOINT',
    'VITE_LUPI_ANALYTICS_URL',
    'VITE_LUPI_BUILD_SHA',
  ]) assert.ok(forwarded.includes(name), `Turbo build env is missing ${name}`);
});

test('credential-bearing Wrangler runtime is fully lockfile-pinned', async () => {
  const packageText = await readFile(resolve(ROOT, '.github', 'wrangler-runtime', 'package-lock.json'), 'utf8');
  const repositoryBytes = packageText.replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(repositoryBytes).digest('hex'), WRANGLER_LOCK_SHA256);
  const lock = JSON.parse(packageText);
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].dependencies.wrangler, WRANGLER_VERSION);
  assert.equal(lock.packages['node_modules/wrangler'].version, WRANGLER_VERSION);
  for (const [path, value] of Object.entries(lock.packages)) {
    if (!path || value.link) continue;
    assert.match(value.version ?? '', /^\d+\.\d+\.\d+/, `${path} must resolve an exact version`);
    assert.match(value.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, `${path} must use the npm registry archive`);
    assert.match(value.integrity ?? '', /^sha512-/, `${path} must carry an archive integrity`);
  }
});

test('static assets use a closed selective Worker-first route contract', async () => {
  const config = await readFile(resolve(ROOT, 'apps', 'mcp-worker', 'wrangler.toml'), 'utf8');
  const staticHeaders = await readFile(resolve(ROOT, 'apps', 'web', 'public', '_headers'), 'utf8');
  const match = /run_worker_first\s*=\s*\[([\s\S]*?)\]/.exec(config);
  assert.ok(match, 'wrangler.toml must declare a run_worker_first route array');
  const routes = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  assert.deepEqual(routes, WORKER_FIRST_ROUTES);
  assert.ok(!routes.includes('/assets/*'), 'broad /assets/* would intercept hashed Vite bundles');
  assert.equal(matchesAnyWorkerRoute('/assets/index-example.js', routes), false);
  assert.equal(matchesAnyWorkerRoute('/fonts/lupi.woff2', routes), false);
  assert.equal(matchesAnyWorkerRoute('/materials/clean-energy', routes), false);
  assert.equal(matchesAnyWorkerRoute('/browser-mcp-manifest.json', routes), false);
  assert.equal(matchesAnyWorkerRoute('/v1', routes), true, 'bare /v1 must remain Worker-first');
  assert.match(staticHeaders, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/,
    'hashed assets must retain an immutable browser-cache policy');
  assert.match(staticHeaders, /\/browser-mcp-manifest\.json\s+Access-Control-Allow-Origin: \*/,
    'the asset-first browser manifest must remain publicly fetchable cross-origin');

  const externalPaths = JSON.parse(await readFile(resolve(ROOT, 'apps', 'web', 'cloudflare-assets-exclude.json'), 'utf8'));
  assert.ok(Array.isArray(externalPaths) && externalPaths.length > 0);
  for (const path of externalPaths) {
    assert.equal(matchesAnyWorkerRoute(`/${path}`, routes), true, `${path} is missing a Worker-first route`);
  }
});

test('current-source and pinned-controller proofs require selective routing', async () => {
  const { workflows } = await loadFixture();
  for (const [workflowName, jobId] of [
    ['deploy-cloudflare.yml', 'candidate-verify'],
    ['deploy-cloudflare.yml', 'public-verify'],
  ]) {
    const job = workflows[workflowName].jobs[jobId];
    const liveStep = (job.steps ?? []).find((step) => String(step.run ?? '').includes('verify:cloudflare-live'));
    assert.ok(liveStep, `${workflowName}/${jobId} is missing live verification`);
    const run = String(liveStep.run);
    assert.doesNotMatch(run, /pnpm verify:cloudflare-live --(?:\s|\\)/,
      `${workflowName}/${jobId} must use pnpm 9-compatible argument forwarding`);
    assert.match(run, /--expect-selective-routing=true\b/,
      `${workflowName}/${jobId} must require selective routing`);
  }

  for (const [workflowName, jobId] of [
    ['deploy-cloudflare.yml', 'rollback-ui-verify'],
    ['reconcile-cloudflare-deploy.yml', 'reanchor-reconstruct'],
    ['reconcile-cloudflare-deploy.yml', 'reconcile-ui-verify'],
  ]) {
    const job = workflows[workflowName].jobs[jobId];
    const liveStep = (job.steps ?? []).find((step) => String(step.run ?? '').includes('verify-cloudflare-live'));
    assert.ok(liveStep, `${workflowName}/${jobId} is missing live verification`);
    const run = String(liveStep.run);
    assert.match(run, /node authority\/controller\/verify-cloudflare-live\.mjs\b/,
      `${workflowName}/${jobId} must use the authority-pinned live verifier`);
    assert.match(run, /--expect-selective-routing=true\b/,
      `${workflowName}/${jobId} must require selective routing`);
    assert.doesNotMatch(run, /pnpm verify:cloudflare-live\b/,
      `${workflowName}/${jobId} must not execute the historical checkout verifier`);
    assert.doesNotMatch(run, /selective_routing_args|verify:cloudflare-live --help/,
      `${workflowName}/${jobId} must not negotiate historical verifier capability`);
  }

  for (const [workflowName, authorityJobId] of [
    ['deploy-cloudflare.yml', 'authority-scan'],
    ['reconcile-cloudflare-deploy.yml', 'reconcile-authority-scan'],
  ]) {
    const job = workflows[workflowName].jobs[authorityJobId];
    const bundleStep = (job.steps ?? []).find((step) => String(step.run ?? '').includes('controller-manifest.json'));
    assert.ok(bundleStep, `${workflowName}/${authorityJobId} is missing its controller bundle`);
    const run = String(bundleStep.run);
    assert.match(run, /copyFile\('tools\/verify-cloudflare-live\.mjs',\s*'[^']*authority\/controller\/verify-cloudflare-live\.mjs'\)/,
      `${workflowName}/${authorityJobId} must bundle the current live verifier`);
    assert.match(run, /const liveVerifier = await readFile\('[^']*authority\/controller\/verify-cloudflare-live\.mjs'\)/,
      `${workflowName}/${authorityJobId} must read the bundled verifier preimage`);
    assert.match(run, /liveVerifierSha256:\s*createHash\('sha256'\)\.update\(liveVerifier\)\.digest\('hex'\)/,
      `${workflowName}/${authorityJobId} must hash the bundled verifier in its manifest`);
  }
});

test('release and recovery proofs preserve the authenticated renderer posture', async () => {
  const { workflows } = await loadFixture();
  const proofJobs = [
    ['deploy-cloudflare.yml', 'candidate-verify'],
    ['deploy-cloudflare.yml', 'public-verify'],
    ['deploy-cloudflare.yml', 'rollback-ui-verify'],
    ['reconcile-cloudflare-deploy.yml', 'reanchor-reconstruct'],
    ['reconcile-cloudflare-deploy.yml', 'reconcile-ui-verify'],
  ];

  for (const [workflowName, jobId] of proofJobs) {
    const job = workflows[workflowName].jobs[jobId];
    const liveStep = (job.steps ?? []).find((step) => String(step.run ?? '').includes('cloudflare-live'));
    assert.ok(liveStep, `${workflowName}/${jobId} is missing live verification`);
    const run = String(liveStep.run);
    for (const flag of [
      '--expect-renderer-endpoint=true',
      '--expect-auth-required=true',
      '--expect-render-execution=true',
    ]) {
      assert.ok(run.includes(flag), `${workflowName}/${jobId} must preserve ${flag}`);
    }
  }

  const collation = String(
    stepNamed(
      workflows['deploy-cloudflare.yml'].jobs['receipt-collation'],
      'Collate and validate durable pre-mutation intent',
    ).run ?? '',
  );
  for (const field of ['rendererEndpoint: true', 'authRequired: true', 'renderExecution: true']) {
    assert.ok(collation.includes(field), `release intent must preserve ${field}`);
  }
});

test('the authority scanner rejects mutated trigger, dependency, action, and token boundaries', async () => {
  const { workflows } = await loadFixture();
  const cases = [
    {
      name: 'extra deploy trigger',
      code: 'event-contract-mismatch',
      mutate(value) { value['deploy-cloudflare.yml'].on.push = { branches: ['main'] }; },
    },
    {
      name: 'credentialed job without a direct authority scan need',
      code: 'authority-scan-dependency-missing',
      mutate(value) {
        value['deploy-cloudflare.yml'].jobs['version-upload'].needs = asArray(
          value['deploy-cloudflare.yml'].jobs['version-upload'].needs,
        ).filter((item) => item !== 'authority-scan');
      },
    },
    {
      name: 'mutable action in a write job',
      code: 'write-action-not-full-sha',
      mutate(value) {
        const step = value['deploy-cloudflare.yml'].jobs['version-upload'].steps.find((item) => item.uses);
        step.uses = 'actions/download-artifact@v4';
      },
    },
    {
      name: 'checkout in a write job',
      code: 'write-checkout',
      mutate(value) {
        value['deploy-cloudflare.yml'].jobs.promote.steps.unshift({ uses: 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5' });
      },
    },
    {
      name: 'write token at job scope',
      code: 'write-secret-at-job-scope',
      mutate(value) {
        value['deploy-cloudflare.yml'].jobs.promote.env = {
          CLOUDFLARE_API_TOKEN: '${{ secrets.LUPI_CLOUDFLARE_WRITE_TOKEN_V2 }}',
        };
      },
    },
    {
      name: 'write token leaks into bootstrap',
      code: 'write-secret-step-count',
      mutate(value) {
        const bootstrap = stepNamed(value['deploy-cloudflare.yml'].jobs.promote, 'Bootstrap integrity-pinned Wrangler');
        bootstrap.env = { CLOUDFLARE_API_TOKEN: '${{ secrets.LUPI_CLOUDFLARE_WRITE_TOKEN_V2 }}' };
      },
    },
  ];

  for (const item of cases) {
    const mutated = structuredClone(workflows);
    item.mutate(mutated);
    const result = scanWorkflowSources(toSources(mutated), scanMetadata());
    assert.ok(
      result.findings.some((finding) => finding.code === item.code),
      `${item.name} did not produce ${item.code}: ${JSON.stringify(result.findings, null, 2)}`,
    );
  }
});

test('contract mutations fail closed across CI, release ordering, evidence, and recovery envelopes', async () => {
  const { workflows } = await loadFixture();
  const cases = [
    {
      name: 'CI path coverage',
      pattern: /CI pull_request paths must include \.github\/workflows\/\*\.yml/,
      mutate(value) {
        value['ci.yml'].on.pull_request.paths = value['ci.yml'].on.pull_request.paths.filter((path) => path !== '.github/workflows/*.yml');
      },
    },
    {
      name: 'single pnpm version authority',
      pattern: /pnpm setup must defer to packageManager/,
      mutate(value) {
        const step = value['ci.yml'].jobs['build-test'].steps.find((candidate) => actionName(candidate.uses) === 'pnpm/action-setup');
        step.with = { version: 9 };
      },
    },
    {
      name: 'shared queue-max concurrency',
      pattern: /shared queue-max concurrency/,
      mutate(value) { value['deploy-cloudflare.yml'].concurrency.group = 'drifted-controller'; },
    },
    {
      name: 'package before upload',
      pattern: /version-upload must directly need release-package/,
      mutate(value) {
        value['deploy-cloudflare.yml'].jobs['version-upload'].needs = asArray(
          value['deploy-cloudflare.yml'].jobs['version-upload'].needs,
        ).filter((item) => item !== 'release-package');
      },
    },
    {
      name: 'fully locked Wrangler runtime',
      pattern: /must install only from the full Wrangler runtime lock/,
      mutate(value) {
        const step = stepNamed(value['deploy-cloudflare.yml'].jobs.promote, 'Bootstrap integrity-pinned Wrangler');
        step.run = String(step.run).replace('npm ci --ignore-scripts --omit=dev', 'npm install --ignore-scripts');
      },
    },
    {
      name: 'parser-backed checkpoint admission',
      pattern: /checkpoint admission must execute the shared checkpoint validator/,
      mutate(value) {
        const step = stepNamed(value['deploy-cloudflare.yml'].jobs['release-admission'], 'Validate authority and checkpoint data before reading Cloudflare');
        step.run = String(step.run).replace('validateCheckpoint(value);', "assert.match(value.bundleSha256 ?? '', /^[a-f0-9]{64}$/i);");
      },
    },
    {
      name: 'official Cloudflare deployments envelope',
      pattern: /deploy admission must read Cloudflare result\.deployments/,
      mutate(value) {
        const step = stepNamed(value['deploy-cloudflare.yml'].jobs['release-admission'], 'Read active deployment and complete version inventory');
        step.run = String(step.run).replace('deployments.result?.deployments?.[0]', 'deployments.result?.[0]');
      },
    },
    {
      name: 'retained candidate-upload preimage',
      pattern: /clean upload must retain the full candidate-upload preimage/,
      mutate(value) {
        value['deploy-cloudflare.yml'].jobs['version-upload'].steps = value['deploy-cloudflare.yml'].jobs['version-upload'].steps
          .filter((step) => !String(step.with?.name ?? '').startsWith('candidate-upload-v1-'));
      },
    },
    {
      name: 'intent before promote',
      pattern: /promote must directly need receipt-collation/,
      mutate(value) {
        value['deploy-cloudflare.yml'].jobs.promote.needs = asArray(value['deploy-cloudflare.yml'].jobs.promote.needs)
          .filter((item) => item !== 'receipt-collation');
      },
    },
    {
      name: 'candidate/public separation',
      pattern: /candidate verification cannot depend on promotion/,
      mutate(value) { value['deploy-cloudflare.yml'].jobs['candidate-verify'].needs.push('promote'); },
    },
    {
      name: 'rollback state re-read',
      pattern: /rollback must re-read live state before mutation/,
      mutate(value) {
        const step = tokenStep(value['deploy-cloudflare.yml'].jobs['release-rollback'], WRITE_TOKEN);
        step.run = String(step.run).replace(/^\s*current=.*deployments status.*$/m, '');
      },
    },
    {
      name: '90-day chain evidence',
      pattern: /controller artifacts must be retained for 90 days/,
      mutate(value) {
        const upload = actionSteps(value['deploy-cloudflare.yml']).find((entry) => actionName(entry.step.uses) === 'actions/upload-artifact');
        upload.step.with['retention-days'] = 7;
      },
    },
    {
      name: 'exact owner source string',
      pattern: /owner dispatch assertion/,
      mutate(value) {
        const step = stepNamed(value['deploy-cloudflare.yml'].jobs['authority-scan'], 'Validate exact owner dispatch and current main');
        step.run = String(step.run).replace("assert.equal(process.env.GITHUB_ACTOR, 'alexwelcing'", "assert.equal(process.env.GITHUB_ACTOR, 'someone-else'");
      },
    },
    {
      name: 'manual rollback envelope',
      pattern: /reconcile-rollback must be manual-only/,
      mutate(value) { value['reconcile-cloudflare-deploy.yml'].jobs['reconcile-rollback'].if = '${{ always() }}'; },
    },
    {
      name: 'prior-run incident retrieval',
      pattern: /manual rollback must download the exact incident-producing run/,
      mutate(value) {
        const step = value['reconcile-cloudflare-deploy.yml'].jobs['reconcile-rollback'].steps
          .find((candidate) => candidate.with?.['run-id'] === '${{ inputs.incident_run_id }}');
        step.with['run-id'] = '${{ github.run_id }}';
      },
    },
    {
      name: 'failed promotion remains rollback eligible',
      pattern: /failed promotion must remain rollback-eligible/,
      mutate(value) {
        value['deploy-cloudflare.yml'].jobs['release-rollback'].if = "${{ always() && needs.promote.result == 'success' && needs.public-verify.result != 'success' }}";
      },
    },
    {
      name: 'rootless reanchor path',
      pattern: /reanchor must have a rootless path/,
      mutate(value) { delete value['reconcile-cloudflare-deploy.yml'].jobs['reconcile-scan'].if; },
    },
    {
      name: 'post-resolution checkpoint identity',
      pattern: /checkpoint must use post-resolution active identity/,
      mutate(value) {
        const step = stepNamed(value['reconcile-cloudflare-deploy.yml'].jobs.checkpoint, 'Carry complete active rollback bundle into fresh checkpoint');
        step.env.ACTIVE_VERSION_ID = '${{ needs.reconcile-scan.outputs.active_version_id }}';
      },
    },
    {
      name: 'read-only re-anchor',
      pattern: /reanchor-control must remain read-only/,
      mutate(value) {
        stepNamed(value['reconcile-cloudflare-deploy.yml'].jobs['reanchor-control'], undefined).run = 'wrangler rollback forbidden-version';
      },
    },
  ];

  for (const item of cases) {
    const mutated = structuredClone(workflows);
    item.mutate(mutated);
    assert.throws(() => assertWorkflowContract(mutated), item.pattern, item.name);
  }
});

function assertWorkflowContract(workflows) {
  assert.ok(workflows['ci.yml'], 'ci.yml is required');
  for (const name of Object.keys(CONTROLLERS)) assert.ok(workflows[name], `${name} is required`);
  assertCiContract(workflows['ci.yml']);
  for (const [name, contract] of Object.entries(CONTROLLERS)) {
    assertControllerContract(name, workflows[name], contract);
  }
  assertDeployContract(workflows['deploy-cloudflare.yml']);
  assertReconcileContract(workflows['reconcile-cloudflare-deploy.yml']);
}

function assertCiContract(workflow) {
  assert.deepEqual(eventNames(workflow), ['pull_request', 'push', 'workflow_dispatch']);
  assert.deepEqual(asArray(workflow.on.push.branches), ['main']);
  const requiredPaths = [
    'apps/**', 'packages/**', 'functions/**', 'tools/**', 'tests/**', 'scripts/**',
    'package.json', 'pnpm-lock.yaml', 'playwright.config.mjs', 'eslint.config.*',
    '.github/workflows/*.yml', '.github/workflows/*.yaml',
    '.github/wrangler-runtime/**',
  ];
  for (const event of ['pull_request', 'push']) {
    const paths = asArray(workflow.on[event].paths);
    for (const path of requiredPaths) {
      assert.ok(paths.includes(path), `CI ${event} paths must include ${path}`);
    }
  }

  const job = workflow.jobs?.['build-test'];
  assert.ok(job, 'CI build-test job is required');
  assert.notEqual(job['continue-on-error'], true, 'CI build-test cannot continue on error');
  const commands = [
    'pnpm verify:product-contract',
    'pnpm lint',
    'pnpm verify:workflows',
    'pnpm audit --prod --audit-level high',
    'node --test tools/verify-cloudflare-live.test.mjs',
    'node --test tools/cloudflare-release-receipt.test.mjs',
    'node --test tools/cloudflare-release-authority.test.mjs',
    'node --test tools/cloudflare-release-workflow.test.mjs',
    'node --test tools/build-cloudflare-release-package.test.mjs',
    'pnpm build',
    'pnpm test',
    'npm audit --omit=dev --audit-level=high',
    'pnpm cloudflare:test',
    'pnpm test:ui',
  ];
  for (const command of commands) {
    const step = job.steps.find((candidate) => runLines(candidate).includes(command));
    assert.ok(step, `CI blocking gate is missing: ${command}`);
    assert.notEqual(step['continue-on-error'], true, `CI gate cannot continue on error: ${command}`);
    assert.equal(step.if, undefined, `CI gate cannot be conditional: ${command}`);
  }
  assertFullShaActions('ci.yml', workflow);
  assertManifestPnpmAuthority('ci.yml', workflow);
}

function assertControllerContract(name, workflow, contract) {
  assert.deepEqual(eventNames(workflow), [...contract.events].sort(), `${name} has the wrong exact triggers`);
  assert.equal(workflow.concurrency?.group, SHARED_CONCURRENCY_GROUP, `${name} must use shared queue-max concurrency`);
  assert.equal(workflow.concurrency?.queue, 'max', `${name} must use shared queue-max concurrency`);
  assert.equal(workflow.concurrency?.['cancel-in-progress'], false, `${name} must use shared queue-max concurrency`);
  assert.deepEqual(Object.keys(workflow.jobs ?? {}).sort(), Object.keys(contract.roles).sort(), `${name} job allowlist drifted`);

  for (const [jobId, role] of Object.entries(contract.roles)) {
    const job = workflow.jobs[jobId];
    assert.equal(environmentName(job.environment), ENVIRONMENT_FOR_ROLE[role], `${name}/${jobId} environment role mismatch`);
    const expectedV2Secrets = role === 'write' ? [WRITE_TOKEN] : (role === 'read' || role === 'reanchor' ? [READ_TOKEN] : []);
    assert.deepEqual(v2Secrets(job), expectedV2Secrets, `${name}/${jobId} secret role mismatch`);
    if (jobId !== contract.scan) {
      assert.ok(asArray(job.needs).includes(contract.scan), `${name}/${jobId} must directly need ${contract.scan}`);
    }
    if (role === 'write') assertCleanWriteJob(name, jobId, job);
    if (role === 'reanchor') {
      assert.doesNotMatch(jobText(job), cloudflareMutationPattern(), `${name}/${jobId} must remain read-only`);
    }
  }

  assertFullShaActions(name, workflow);
  assertManifestPnpmAuthority(name, workflow);
  const uploads = actionSteps(workflow).filter((entry) => actionName(entry.step.uses) === 'actions/upload-artifact');
  assert.ok(uploads.length > 0, `${name} must retain chain artifacts`);
  for (const { step } of uploads) {
    assert.equal(step.with?.['retention-days'], 90, `${name} controller artifacts must be retained for 90 days`);
    assert.equal(step.with?.['if-no-files-found'], 'error', `${name} chain artifact upload must fail when evidence is absent`);
  }
}

function assertManifestPnpmAuthority(workflowName, workflow) {
  const setupSteps = actionSteps(workflow).filter((entry) => actionName(entry.step.uses) === 'pnpm/action-setup');
  for (const { step } of setupSteps) {
    assert.equal(step.with?.version, undefined, `${workflowName} pnpm setup must defer to packageManager`);
  }
}

function assertCleanWriteJob(workflowName, jobId, job) {
  assert.equal(job.env, undefined, `${workflowName}/${jobId} cannot hold a job-scope token`);
  assert.equal(job.defaults, undefined, `${workflowName}/${jobId} cannot set repository execution defaults`);
  for (const step of job.steps ?? []) {
    assert.ok(!String(step.uses ?? '').startsWith('actions/checkout@'), `${workflowName}/${jobId} cannot checkout repository source`);
    assert.equal(step['working-directory'], undefined, `${workflowName}/${jobId} cannot execute in the repository`);
    if (step.name !== 'Bootstrap integrity-pinned Wrangler') {
      assert.doesNotMatch(
        String(step.run ?? ''),
        /\b(?:pnpm|yarn|bun)\b|\bnpm\s+(?:ci|install|run|test)\b|\bnode\s+(?:tools|scripts|apps|packages)\//i,
        `${workflowName}/${jobId} cannot install, build, test, or execute repository code`,
      );
    }
  }

  const bootstrapIndex = (job.steps ?? []).findIndex((step) => step.name === 'Bootstrap integrity-pinned Wrangler');
  assert.ok(bootstrapIndex >= 0, `${workflowName}/${jobId} requires the safe Wrangler bootstrap`);
  const bootstrap = job.steps[bootstrapIndex];
  const bootstrapText = jobText(bootstrap);
  assert.ok(bootstrapText.includes('node_modules/wrangler/package.json'), `${workflowName}/${jobId} must verify the Wrangler version`);
  assert.ok(bootstrapText.includes(`= ${WRANGLER_VERSION}`), `${workflowName}/${jobId} must require exact Wrangler ${WRANGLER_VERSION}`);
  assert.ok(bootstrapText.includes(WRANGLER_LOCK_SHA256), `${workflowName}/${jobId} bootstrap must verify the full runtime lock`);
  assert.match(bootstrapText, /authority\/controller\/wrangler-runtime\/package-lock\.json/);
  assert.match(bootstrapText, /npm ci --ignore-scripts --omit=dev/, `${workflowName}/${jobId} must install only from the full Wrangler runtime lock`);
  assert.match(bootstrapText, /RUNNER_TEMP/);
  assert.ok(!bootstrapText.includes(WRITE_TOKEN), `${workflowName}/${jobId} bootstrap cannot receive the write token`);

  const tokenSteps = (job.steps ?? []).filter((step) => jobText(step).includes(WRITE_TOKEN));
  assert.equal(tokenSteps.length, 1, `${workflowName}/${jobId} write token must occur in exactly one step`);
  const mutation = tokenSteps[0];
  const mutationIndex = job.steps.indexOf(mutation);
  assert.ok(mutationIndex > bootstrapIndex, `${workflowName}/${jobId} token mutation must follow safe bootstrap`);
  assert.equal(mutation.env?.CLOUDFLARE_API_TOKEN, '${{ secrets.LUPI_CLOUDFLARE_WRITE_TOKEN_V2 }}');
  assert.match(String(mutation.run ?? ''), cloudflareMutationPattern(), `${workflowName}/${jobId} token step must contain the mutation`);
  assert.doesNotMatch(String(mutation.run ?? ''), /npm\s+(?:pack|install)|\b(?:pnpm|yarn|bun)\b/i, `${workflowName}/${jobId} bootstrap and token mutation must stay separate`);
}

function assertDeployContract(workflow) {
  const inputs = workflow.on.workflow_dispatch?.inputs ?? {};
  assert.deepEqual(Object.keys(inputs).sort(), [
    'checkpoint_artifact', 'checkpoint_run_id', 'checkpoint_sha256', 'confirmation',
    'cutover_receipt_sha256', 'target_sha',
  ]);
  for (const [name, input] of Object.entries(inputs)) {
    assert.equal(input.required, true, `deploy input ${name} must be required`);
    assert.equal(input.type, 'string', `deploy input ${name} must be a string`);
  }
  assert.equal(inputs.confirmation.description, 'DEPLOY <target_sha> WITH BOUNDED ROLLBACK');

  const authority = stepNamed(workflow.jobs['authority-scan'], 'Validate exact owner dispatch and current main');
  const authorityRun = String(authority.run ?? '');
  for (const [snippet, label] of [
    ["assert.equal(process.env.GITHUB_ACTOR, 'alexwelcing'", 'owner dispatch assertion'],
    ["assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch'", 'dispatch event assertion'],
    ["assert.equal(process.env.GITHUB_REF, 'refs/heads/main'", 'current-main ref assertion'],
    ['assert.equal(target, process.env.GITHUB_SHA', 'immutable workflow SHA assertion'],
    ['assert.equal(process.env.CONFIRMATION, `DEPLOY ${target} WITH BOUNDED ROLLBACK`)', 'typed confirmation assertion'],
    ['https://api.github.com/repos/alexwelcing/Lupi/branches/main', 'current-main API source'],
    ["assert.equal(body?.commit?.sha, target, 'queued release target is no longer current main')", 'queued current-main assertion'],
  ]) {
    assert.ok(authorityRun.includes(snippet), `deploy authority step is missing exact ${label}`);
  }

  const jobs = workflow.jobs;
  const admissionText = jobText(jobs['release-admission']);
  const checkpointAdmissionRun = String(stepNamed(jobs['release-admission'], 'Validate authority and checkpoint data before reading Cloudflare').run ?? '');
  assert.match(checkpointAdmissionRun, /validateCheckpoint\(value\);/, 'checkpoint admission must execute the shared checkpoint validator');
  assert.doesNotMatch(admissionText, /value\.bundleSha256/);
  assert.match(admissionText, /result\?\.deployments\?\.\[0\]/, 'deploy admission must read Cloudflare result.deployments');
  assert.match(admissionText, /result\?\.items/, 'deploy admission must read Cloudflare result.items');
  assert.doesNotMatch(admissionText, /result_info/);
  assert.ok(asArray(jobs['version-upload'].needs).includes('release-package'), 'version-upload must directly need release-package');
  assert.ok(asArray(jobs['receipt-collation'].needs).includes('candidate-verify'), 'intent collation must follow candidate verification');
  assert.ok(asArray(jobs.promote.needs).includes('receipt-collation'), 'promote must directly need receipt-collation');
  assert.ok(asArray(jobs['public-verify'].needs).includes('promote'), 'public verification must follow promotion');
  assert.ok(!asArray(jobs['candidate-verify'].needs).includes('promote'), 'candidate verification cannot depend on promotion');

  const candidateUploadArtifacts = actionSteps(workflow).filter(({ step }) => (
    actionName(step.uses) === 'actions/upload-artifact'
    && String(step.with?.name).startsWith('candidate-upload-v1-')
  ));
  assert.equal(candidateUploadArtifacts.length, 1, 'clean upload must retain the full candidate-upload preimage');
  assert.equal(candidateUploadArtifacts[0].jobId, 'version-upload');
  const candidateText = jobText(jobs['candidate-verify']);
  const collationText = jobText(jobs['receipt-collation']);
  assert.match(candidateText, /postUploadInventory/);
  assert.match(candidateText, /POST_UPLOAD_INVENTORY_SHA256/);
  assert.match(collationText, /candidate-upload-v1-/);
  assert.match(collationText, /post-upload inventory digest does not match retained candidate-upload evidence/);

  assertStepOrder(jobs['release-package'], [
    (step) => step.name === 'Bootstrap checksum-pinned actionlint',
    (step) => runLines(step).includes('pnpm verify:workflows'),
    (step) => step.name === 'Verify production web configuration was compiled',
    (step) => step.name === 'Build closed data-only release package',
    (step) => actionName(step.uses) === 'actions/upload-artifact' && String(step.with?.name).startsWith('release-package-v1-'),
  ], 'release package must be built before upload as evidence');
  const actionlintBootstrap = stepNamed(jobs['release-package'], 'Bootstrap checksum-pinned actionlint');
  assert.match(String(actionlintBootstrap.run), /actionlint_\$\{version\}_linux_amd64\.tar\.gz/);
  assert.match(String(actionlintBootstrap.run), /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
  assert.match(String(actionlintBootstrap.run), /sha256sum --check --strict/);
  const releaseGate = stepNamed(jobs['release-package'], 'Run every source-side release gate');
  assert.equal(releaseGate.env?.LUPI_FIREBASE_WEB_API_KEY, '${{ secrets.LUPI_FIREBASE_WEB_API_KEY }}');
  assert.match(String(releaseGate.run), /VITE_FIREBASE_API_KEY="\$LUPI_FIREBASE_WEB_API_KEY" pnpm build/);
  const releaseCommands = runLines(releaseGate);
  assert.ok(
    releaseCommands.indexOf('pnpm test') < releaseCommands.indexOf('VITE_FIREBASE_API_KEY="$LUPI_FIREBASE_WEB_API_KEY" pnpm build'),
    'the production-configured web build must run after tests that can rebuild the workspace',
  );
  assert.equal(
    releaseCommands.at(-1),
    'VITE_FIREBASE_API_KEY="$LUPI_FIREBASE_WEB_API_KEY" pnpm build',
    'the production-configured build must be the final source-side command before bundle verification',
  );
  const compiledConfig = stepNamed(jobs['release-package'], 'Verify production web configuration was compiled');
  assert.equal(compiledConfig.env?.LUPI_FIREBASE_WEB_API_KEY, '${{ secrets.LUPI_FIREBASE_WEB_API_KEY }}');
  for (const [name, value] of Object.entries({
    VITE_FIREBASE_AUTH_DOMAIN: 'lupi.live',
    VITE_FIREBASE_PROJECT_ID: 'shed-489901',
    VITE_LUPI_MCP_ENDPOINT: '/mcp',
    VITE_LUPI_ANALYTICS_URL: '/collectAnalytics',
  })) assert.equal(workflow.env?.[name], value, `Cloudflare production env is missing ${name}`);
  assert.match(String(compiledConfig.run), /bundle\.includes\(value\)/);

  const priorReplay = stepNamed(jobs['prior-rollback-verify'], 'Reproduce predecessor rollback suite against current public traffic');
  const priorPnpmSetup = (jobs['prior-rollback-verify'].steps ?? []).find(
    (step) => actionName(step.uses) === 'pnpm/action-setup',
  );
  assert.equal(
    priorPnpmSetup?.with?.package_json_file,
    'predecessor/package.json',
    'predecessor replay must resolve pnpm from its nested checkout',
  );
  assert.equal(priorReplay.env?.UI_TEST_EXPECT_HEALTH, '${{ steps.prior.outputs.expect_health }}');
  assert.match(String(priorReplay.run), /full-ui-configless-v1\|full-ui-v1\) pnpm test:ui/);
  const rollbackReplay = stepNamed(jobs['rollback-ui-verify'], 'Verify restored predecessor with its own frozen suite');
  assert.equal(rollbackReplay.env?.UI_TEST_EXPECT_HEALTH, '${{ steps.source.outputs.expect_health }}');
  assert.match(String(rollbackReplay.run), /full-ui-configless-v1\|full-ui-v1\) pnpm test:ui/);

  for (const jobId of ['candidate-verify', 'public-verify']) {
    const step = (jobs[jobId].steps ?? []).find((candidate) => candidate.env?.UI_TEST_EXPECT_HEALTH !== undefined);
    assert.equal(step?.env?.UI_TEST_EXPECT_HEALTH, 'true', `${jobId} must require healthy saved views`);
  }
  assertStepOrder(jobs['version-upload'], [
    (step) => actionName(step.uses) === 'actions/download-artifact' && String(step.with?.name).startsWith('release-package-v1-'),
    (step) => step.name === 'Validate the data-only payload without executing it',
    (step) => step.name === 'Bootstrap integrity-pinned Wrangler',
    (step) => jobText(step).includes(WRITE_TOKEN),
  ], 'package-before-upload ordering drifted');

  const publicText = jobText(jobs['public-verify']);
  assert.match(candidateText, /candidate_preview_origin/);
  assert.doesNotMatch(candidateText, /--url=https:\/\/lupi\.live/);
  assert.match(publicText, /--url=https:\/\/lupi\.live/);
  assert.match(publicText, /--require-custom-domain/);
  assert.match(publicText, /promotion-control-v1-/);
  assert.match(publicText, /source-manifest\.json/);
  assert.match(publicText, /ui-proof\.json/);

  assertStepOrder(jobs.promote, [
    (step) => actionName(step.uses) === 'actions/download-artifact' && String(step.with?.name).startsWith('release-intent-v1-'),
    (step) => step.name === 'Validate immutable release intent',
    (step) => step.name === 'Bootstrap integrity-pinned Wrangler',
    (step) => jobText(step).includes(WRITE_TOKEN),
  ], 'intent-before-promote ordering drifted');

  const rollbackMutation = tokenStep(jobs['release-rollback'], WRITE_TOKEN);
  const rollbackRun = String(rollbackMutation.run ?? '');
  const stateRead = rollbackRun.indexOf('deployments status');
  const rollback = rollbackRun.search(/\bwrangler["']?\s+versions\s+deploy\b|\/wrangler"?\s+versions\s+deploy\b/);
  assert.ok(stateRead >= 0 && rollback > stateRead, 'rollback must re-read live state before mutation');
  assert.match(rollbackRun, /split\/third state forbids automatic rollback/);
  assert.match(rollbackRun, /pre-rollback inventory contains duplicate version IDs/);
  assert.match(rollbackRun, /prior version rank \$\{priorRank\} is not rollback-eligible/);
  assert.doesNotMatch(rollbackRun, /\bwrangler["']?\s+rollback\b|\/wrangler"?\s+rollback\b/, 'rollback must not invoke Wrangler secret-mutating rollback');
  const resolutionText = jobText(jobs['rollback-resolution']);
  for (const binding of [
    'bounded-rollback-command-v1-',
    'bounded-rollback-control-v1-',
    'bounded-rollback-ui-v1-',
    'bounded-release-rollback-v1',
    'validateResolution',
  ]) assert.ok(resolutionText.includes(binding), `bounded rollback resolution is missing ${binding}`);
  const rollbackIf = String(jobs['release-rollback'].if ?? '');
  assert.match(rollbackIf, /needs\.promote\.result == 'failure'/, 'failed promotion must remain rollback-eligible');
  assert.doesNotMatch(rollbackIf, /needs\.promote\.result == 'success'\s*&&/, 'rollback cannot require promote success');
}

function assertReconcileContract(workflow) {
  assert.deepEqual(workflow.on.schedule, [{ cron: '17 7 * * 1' }]);
  assert.deepEqual(asArray(workflow.on.workflow_run?.workflows), ['Cloudflare production']);
  assert.deepEqual(asArray(workflow.on.workflow_run?.types), ['completed']);
  const inputs = workflow.on.workflow_dispatch?.inputs ?? {};
  assert.deepEqual(Object.keys(inputs).sort(), [
    'active_build_sha', 'active_fingerprint_sha256', 'active_version_id', 'confirmation',
    'incident_run_id', 'incident_sha256', 'intent_sha256', 'mode', 'prior_version_id', 'source_run_attempt',
    'source_run_id', 'target_sha',
  ]);
  assert.equal(inputs.mode.required, true);
  assert.equal(inputs.mode.type, 'choice');
  assert.deepEqual(inputs.mode.options, ['refresh-checkpoint', 'reconcile-rollback', 'reanchor']);
  assert.equal(inputs.target_sha.required, true);
  assert.equal(inputs.target_sha.type, 'string');
  assert.equal(inputs.confirmation.required, true);
  assert.equal(inputs.confirmation.type, 'string');

  const jobs = workflow.jobs;
  const rollbackIf = String(jobs['reconcile-rollback'].if ?? '');
  assert.equal(
    rollbackIf,
    "${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'reconcile-rollback' }}",
    'reconcile-rollback must be manual-only',
  );
  const reanchorEnvelope = "${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'reanchor' }}";
  assert.equal(String(jobs['reanchor-control'].if ?? ''), reanchorEnvelope, 'reanchor-control must be manual-only');
  assert.equal(String(jobs['reanchor-reconstruct'].if ?? ''), reanchorEnvelope, 'reanchor-reconstruct must be manual-only');

  const mutationJobs = Object.entries(jobs).filter(([, job]) => cloudflareMutationPattern().test(jobText(job)));
  assert.deepEqual(mutationJobs.map(([jobId]) => jobId), ['reconcile-rollback'], 'automatic reconciliation and re-anchor must remain read-only');
  assert.doesNotMatch(jobText(jobs['reanchor-control']), cloudflareMutationPattern(), 'reanchor-control must remain read-only');
  const rollbackRun = String(tokenStep(jobs['reconcile-rollback'], WRITE_TOKEN).run ?? '');
  const stateRead = rollbackRun.indexOf('deployments status');
  const rollback = rollbackRun.search(/\bwrangler["']?\s+versions\s+deploy\b|\/wrangler"?\s+versions\s+deploy\b/);
  assert.ok(stateRead >= 0 && rollback > stateRead, 'reconciliation rollback must re-read live state before mutation');
  assert.match(rollbackRun, /split\/third state forbids rollback/);
  assert.match(rollbackRun, /pre-reconciliation inventory contains duplicate version IDs/);
  assert.doesNotMatch(rollbackRun, /\bwrangler["']?\s+rollback\b|\/wrangler"?\s+rollback\b/, 'manual rollback must not invoke Wrangler secret-mutating rollback');
  const rollbackJobText = jobText(jobs['reconcile-rollback']);
  for (const binding of [
    'inputs.incident_run_id',
    'inputs.source_run_id',
    'bindRollbackIncident',
    'intentSha256',
    'observedActiveVersionId',
    'current trusted root no longer names the authorized rollback target',
    "sourceRun.name, 'Cloudflare production'",
    "incidentRun.name, 'Reconcile Cloudflare production'",
  ]) assert.match(rollbackJobText, new RegExp(binding.replaceAll('.', '\\.')), `rollback incident binding is missing ${binding}`);
  const rollbackDownloads = (jobs['reconcile-rollback'].steps ?? []).filter((step) => actionName(step.uses) === 'actions/download-artifact');
  const currentScanDownload = rollbackDownloads.find((step) => (
    String(step.with?.name).startsWith('reconciliation-scan-v1-')
    && step.with?.path === 'current-scan'
    && step.with?.['run-id'] === undefined
  ));
  const incidentDownload = rollbackDownloads.find((step) => step.with?.['run-id'] === '${{ inputs.incident_run_id }}');
  const intentDownload = rollbackDownloads.find((step) => String(step.with?.name).startsWith('release-intent-v1-'));
  assert.ok(currentScanDownload, 'manual rollback must consume the same-run trusted-root scan');
  assert.equal(incidentDownload?.with?.['run-id'], '${{ inputs.incident_run_id }}', 'manual rollback must download the exact incident-producing run');
  assert.equal(intentDownload?.with?.['run-id'], '${{ inputs.source_run_id }}', 'manual rollback must download the exact failed release intent');

  assert.equal(
    String(jobs['reconcile-scan'].if ?? ''),
    "${{ github.event_name != 'workflow_dispatch' || inputs.mode != 'reanchor' }}",
    'reanchor must have a rootless path that skips retained-root scan',
  );
  const scanText = jobText(jobs['reconcile-scan']);
  for (const binding of [
    'actions/artifacts?per_page=100&page=',
    'artifact.digest',
    'run.conclusion',
    'run.head_repository?.full_name',
    'validateCheckpoint',
    'validateRootOutcome',
    'release-resolution-v1-',
    'source-run-provenance.json',
    'rollback may have mutated before failing',
    'decideReconciliation',
  ]) assert.ok(scanText.includes(binding), `trusted-root/source reconciliation is missing ${binding}`);

  const checkpoint = jobs.checkpoint;
  const checkpointIf = String(checkpoint.if ?? '');
  assert.match(checkpointIf, /needs\.reanchor-reconstruct\.result == 'success'/, 'reanchor reconstruction must gate checkpoint creation');
  assert.match(checkpointIf, /needs\.reconcile-rollback\.result == 'success'/, 'manual rollback success must gate its checkpoint');
  const checkpointText = jobText(checkpoint);
  assert.match(checkpointText, /reanchor-reconstruction-v1-/, 'checkpoint must consume reanchor reconstruction evidence');
  assert.match(checkpointText, /needs\.reconcile-verify\.outputs\.verified_active_version_id/, 'checkpoint must use post-resolution active identity');
  assert.doesNotMatch(checkpointText, /ACTIVE_VERSION_ID[^}]*needs\.reconcile-scan\.outputs\.active_version_id/, 'checkpoint cannot use pre-resolution active identity');

  const reanchorText = jobText(jobs['reanchor-reconstruct']);
  assert.match(reanchorText, /release-reanchor-outcome\.json/);
  assert.match(reanchorText, /canonicalSha256\(report\.baseline\.projection\)/, 'reanchor must verify the owner fingerprint');
  assert.match(reanchorText, /validateRootOutcome\(outcome\)/, 'reanchor must emit a parser-valid root');
  assert.match(reanchorText, /LUPI_CONFIGLESS_PREDECESSOR_SHA/);
  assert.match(reanchorText, /full-ui-configless-v1/);
  assert.match(reanchorText, /ROLLBACK_COMMAND_MODE/);
  const reconciliationUi = stepNamed(jobs['reconcile-ui-verify'], 'Run exact active source UI suite');
  assert.equal(
    reconciliationUi.env?.UI_TEST_EXPECT_HEALTH,
    "${{ needs.reconcile-scan.outputs.rollback_command_mode == 'full-ui-v1' && 'true' || 'false' }}",
  );
  assert.match(String(reconciliationUi.run), /full-ui-configless-v1\|full-ui-v1\) pnpm test:ui/);

  const authorityText = jobText(jobs['reconcile-authority-scan']);
  for (const [snippet, label] of [
    ["assert.equal(process.env.GITHUB_ACTOR, 'alexwelcing');", 'owner assertion'],
    ["assert.equal(process.env.GITHUB_REF, 'refs/heads/main');", 'current-main ref assertion'],
    ["assert.equal(process.env.TARGET_SHA, mainSha, 'queued controller is stale');", 'queued current-main assertion'],
    ['assert.equal(process.env.CONFIRMATION, `REFRESH ${process.env.TARGET_SHA}`);', 'refresh confirmation'],
    ['assert.equal(process.env.CONFIRMATION, `ROLLBACK ${process.env.PRIOR_VERSION_ID}`);', 'rollback confirmation'],
    ['assert.equal(process.env.CONFIRMATION, `REANCHOR ${process.env.ACTIVE_VERSION_ID}`);', 're-anchor confirmation'],
    ["assert.equal(process.env.GITHUB_SHA, mainSha, 'automatic controller source is stale');", 'automatic current-main assertion'],
    ["if (process.env.GITHUB_EVENT_NAME === 'workflow_run')", 'workflow-run envelope'],
    ["assert.equal(source.repository?.full_name, 'alexwelcing/Lupi');", 'workflow-run repository assertion'],
    ["assert.equal(source.name, 'Cloudflare production');", 'workflow-run source assertion'],
    ["assert.equal(source.head_branch, 'main');", 'workflow-run main assertion'],
  ]) {
    assert.ok(authorityText.includes(snippet), `reconciliation is missing exact ${label}`);
  }
}

async function loadFixture() {
  const names = (await readdir(WORKFLOW_ROOT)).filter((name) => /\.ya?ml$/i.test(name)).sort();
  assert.ok(names.length > 0, 'no workflow YAML files found');
  const sources = {};
  const workflows = {};
  for (const name of names) {
    const source = await readFile(resolve(WORKFLOW_ROOT, name), 'utf8');
    const document = parseDocument(source, { maxAliasCount: 0, uniqueKeys: true });
    assert.deepEqual(document.errors, [], `${name} has YAML parse errors`);
    const value = document.toJS({ maxAliasCount: 0 });
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} workflow root must be an object`);
    sources[name] = source;
    workflows[name] = value;
  }
  return { sources, workflows };
}

function scanMetadata() {
  return {
    mode: 'current',
    repository: 'alexwelcing/Lupi',
    targetSha: 'a'.repeat(40),
    workflow: 'cloudflare-release-workflow.test.mjs',
    runId: 'fixture',
    runAttempt: '1',
  };
}

function toSources(workflows) {
  return Object.fromEntries(Object.entries(workflows).map(([name, workflow]) => [name, stringify(workflow)]));
}

function eventNames(workflow) {
  return Object.keys(workflow.on ?? {}).sort();
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function environmentName(environment) {
  if (typeof environment === 'string') return environment;
  return environment?.name ?? null;
}

function jobText(value) {
  return JSON.stringify(value ?? {});
}

function v2Secrets(job) {
  const values = [...jobText(job).matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
  return [...new Set(values.filter((name) => name === WRITE_TOKEN || name === READ_TOKEN))].sort();
}

function runLines(step) {
  return String(step?.run ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function actionName(uses) {
  return String(uses ?? '').split('@')[0];
}

function actionSteps(workflow) {
  return Object.entries(workflow.jobs ?? {}).flatMap(([jobId, job]) => (
    (job.steps ?? []).filter((step) => step.uses).map((step) => ({ jobId, step }))
  ));
}

function assertFullShaActions(name, workflow) {
  for (const { jobId, step } of actionSteps(workflow)) {
    assert.match(String(step.uses), FULL_SHA_ACTION, `${name}/${jobId} action must be pinned to a full commit SHA`);
  }
}

function stepNamed(job, name) {
  const steps = job?.steps ?? [];
  const step = name === undefined ? steps.find((candidate) => candidate.run) : steps.find((candidate) => candidate.name === name);
  assert.ok(step, `missing step ${name ?? '<first run step>'}`);
  return step;
}

function tokenStep(job, token) {
  const steps = (job?.steps ?? []).filter((step) => jobText(step).includes(token));
  assert.equal(steps.length, 1, `expected one ${token} step`);
  return steps[0];
}

function assertStepOrder(job, predicates, message) {
  const indexes = predicates.map((predicate) => (job.steps ?? []).findIndex(predicate));
  assert.ok(indexes.every((index) => index >= 0), `${message}: missing step`);
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b), message);
  assert.equal(new Set(indexes).size, indexes.length, message);
}

function matchesAnyWorkerRoute(path, routes) {
  return routes.some((pattern) => {
    const expression = pattern
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${expression}$`).test(path);
  });
}

function cloudflareMutationPattern() {
  return /\b(?:wrangler["']?\s+(?:versions\s+(?:upload|deploy)|rollback|deploy|secret\s+put)|versions\s+(?:upload|deploy))\b/i;
}
