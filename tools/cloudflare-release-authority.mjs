#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const SCHEMA = 'lupi-release-authority-scan-v1';
const HISTORY_SCHEMA = 'lupi-release-history-authority-v1';
const RERUN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const ENVIRONMENTS = Object.freeze({
  write: 'lupi-production-write-v2',
  read: 'lupi-production-read-v2',
  reanchor: 'lupi-production-reanchor-v2',
});

const SECRETS = Object.freeze({
  write: 'LUPI_CLOUDFLARE_WRITE_TOKEN_V2',
  read: 'LUPI_CLOUDFLARE_READ_TOKEN_V2',
});

const CURRENT_CONTRACT = Object.freeze({
  'deploy-cloudflare.yml': {
    events: ['workflow_dispatch'],
    authorityScan: 'authority-scan',
    jobs: {
      'authority-scan': 'none',
      'release-package': 'none',
      'prior-rollback-verify': 'none',
      'candidate-verify': 'none',
      'public-verify': 'none',
      'rollback-ui-verify': 'none',
      'rollback-resolution': 'none',
      'receipt-collation': 'none',
      'release-admission': 'read',
      'rollback-control-verify': 'read',
      'version-upload': 'write',
      promote: 'write',
      'release-rollback': 'write',
    },
  },
  'reconcile-cloudflare-deploy.yml': {
    events: ['schedule', 'workflow_dispatch', 'workflow_run'],
    authorityScan: 'reconcile-authority-scan',
    jobs: {
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

const MUTATION_PATTERN = /\bwrangler["']?\s+(?:versions\s+(?:upload|deploy)|rollback|deploy|secret\s+put)\b/i;
const INSTALL_BUILD_TEST_PATTERN = /\b(?:pnpm|npm|yarn|bun)\s+(?:install|ci|test|run\s+(?:build|test|lint)|build)|\b(?:vite|turbo|tsc)\b/i;
const WRANGLER_VERSION = '4.110.0';
const WRANGLER_LOCK_SHA256 = '036615b8e80663617f476cd3a9f7d2f7dc7d858be7b38777b75ca1b9f0f5e9b0';
const DYNAMIC_ENVIRONMENT_PATTERN = /\$\{\{[\s\S]*\}\}/;
const COMPUTED_SECRET_PATTERN = /\bsecrets\s*\[|toJSON\s*\(\s*secrets\s*\)/i;
const LITERAL_SECRET_PATTERN = /secrets\.([A-Za-z_][A-Za-z0-9_]*)/g;
const FULL_SHA_ACTION_PATTERN = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([a-f0-9]{40})$/i;

export async function scanCurrentWorkflowTree(root, metadata = {}, dependencies = {}) {
  const read = dependencies.readFile ?? readFile;
  const list = dependencies.readdir ?? readdir;
  const workflowRoot = resolve(root, '.github', 'workflows');
  const names = (await list(workflowRoot)).filter((name) => /\.ya?ml$/i.test(name)).sort();
  assert.ok(names.length > 0, 'no workflow YAML files found');
  const sources = {};
  for (const name of names) sources[name] = await read(resolve(workflowRoot, name), 'utf8');
  return scanWorkflowSources(sources, { ...metadata, mode: 'current' });
}

export function scanWorkflowSources(sources, metadata = {}) {
  assertPlainObject(sources, 'workflow sources');
  const mode = metadata.mode ?? 'current';
  assert.ok(mode === 'current' || mode === 'historical', 'scan mode must be current or historical');
  const files = [];
  const findings = [];

  for (const name of Object.keys(sources).sort()) {
    const source = sources[name];
    assert.equal(typeof source, 'string', `${name} source must be a string`);
    const sha256 = digest(source);
    const parsed = parseWorkflow(source, name, findings);
    files.push({ path: `.github/workflows/${name}`, sha256 });
    if (!parsed) continue;
    if (mode === 'current') analyzeCurrentWorkflow(name, parsed, findings);
    else analyzeHistoricalWorkflow(name, parsed, findings);
  }

  if (mode === 'current') {
    for (const required of Object.keys(CURRENT_CONTRACT)) {
      if (!(required in sources)) addFinding(findings, required, null, 'required-controller-missing', `${required} is required`);
    }
  }

  const projection = {
    schemaVersion: SCHEMA,
    mode,
    repository: metadata.repository ?? null,
    targetSha: metadata.targetSha ?? null,
    workflow: metadata.workflow ?? null,
    runId: metadata.runId ?? null,
    runAttempt: metadata.runAttempt ?? null,
    files,
    findings: findings.toSorted(compareFindings),
  };
  projection.ok = projection.findings.length === 0;
  projection.projectionSha256 = digest(stableJson(projection));
  return projection;
}

export async function scanHistoricalRerunnableRuns(options, dependencies = {}) {
  assert.match(options.repository ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'repository must be owner/name');
  assert.ok(typeof options.token === 'string' && options.token.length > 0, 'GitHub token is required');
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? (() => new Date());
  const apiBase = dependencies.apiBase ?? 'https://api.github.com';
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${options.token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'lupi-release-authority-scan',
  };
  const runs = [];
  let page = 1;
  let pagesComplete = false;
  while (!pagesComplete) {
    const response = await fetchImpl(`${apiBase}/repos/${options.repository}/actions/runs?per_page=100&page=${page}`, { headers });
    assert.equal(response.status, 200, `GitHub runs page ${page} returned HTTP ${response.status}`);
    const body = await response.json();
    assert.ok(Array.isArray(body.workflow_runs), `GitHub runs page ${page} is malformed`);
    runs.push(...body.workflow_runs);
    pagesComplete = body.workflow_runs.length < 100;
    page += 1;
    assert.ok(page <= 1000, 'GitHub runs pagination exceeded safety bound');
  }

  const observedAt = now();
  assert.ok(observedAt instanceof Date && Number.isFinite(observedAt.valueOf()), 'now() must return a valid Date');
  const eligible = runs.filter((run) => isStillRerunnable(run, observedAt));
  const snapshots = [];
  const findings = [];
  for (const run of eligible.toSorted((a, b) => Number(a.id) - Number(b.id))) {
    try {
      const workflowPath = normalizeRunWorkflowPath(run.path);
      assert.match(run.head_sha ?? '', /^[a-f0-9]{40}$/i, 'run head_sha is not a full SHA');
      const contentUrl = `${apiBase}/repos/${options.repository}/contents/${workflowPath}?ref=${run.head_sha}`;
      const response = await fetchImpl(contentUrl, { headers });
      assert.equal(response.status, 200, `workflow snapshot returned HTTP ${response.status}`);
      const body = await response.json();
      assert.equal(body.encoding, 'base64', 'workflow snapshot encoding is not base64');
      assert.ok(typeof body.content === 'string', 'workflow snapshot content is missing');
      assert.match(body.sha ?? '', /^[a-f0-9]{40}$/i, 'workflow snapshot blob SHA is invalid');
      const source = Buffer.from(body.content.replace(/\s/g, ''), 'base64').toString('utf8');
      const fileName = workflowPath.split('/').at(-1);
      const scan = scanWorkflowSources({ [fileName]: source }, {
        mode: 'historical',
        repository: options.repository,
        targetSha: run.head_sha,
        runId: run.id,
        runAttempt: run.run_attempt,
      });
      snapshots.push({
        runId: run.id,
        runAttempt: run.run_attempt,
        event: run.event,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        headSha: run.head_sha,
        workflowPath,
        blobSha: body.sha,
        sourceSha256: digest(source),
        scanSha256: scan.projectionSha256,
        ok: scan.ok,
      });
      for (const finding of scan.findings) findings.push({ runId: run.id, ...finding });
    } catch (error) {
      findings.push({
        runId: run.id ?? null,
        file: run.path ?? null,
        job: null,
        code: 'historical-snapshot-unprovable',
        message: errorMessage(error),
      });
    }
  }

  const projection = {
    schemaVersion: HISTORY_SCHEMA,
    repository: options.repository,
    observedAt: observedAt.toISOString(),
    rerunWindowDays: 30,
    pagesFetched: page - 1,
    totalRunsScanned: runs.length,
    rerunnableRunsScanned: eligible.length,
    snapshots,
    findings: findings.toSorted(compareHistoricalFindings),
  };
  projection.ok = projection.findings.length === 0 && projection.snapshots.length === eligible.length;
  projection.projectionSha256 = digest(stableJson(projection));
  return projection;
}

function analyzeCurrentWorkflow(name, workflow, findings) {
  const contract = CURRENT_CONTRACT[name];
  const jobs = workflow.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) {
    addFinding(findings, name, null, 'jobs-invalid', 'workflow.jobs must be an object');
    return;
  }

  rejectGlobalDynamicAuthority(name, workflow, findings);
  if (!contract) {
    for (const [jobId, job] of Object.entries(jobs)) {
      const environment = environmentName(job?.environment);
      if (environment.dynamic) addFinding(findings, name, jobId, 'dynamic-environment', 'environment name must be literal');
      if (Object.values(ENVIRONMENTS).includes(environment.value)) {
        addFinding(findings, name, jobId, 'v2-authority-outside-controller', `v2 environment ${environment.value} is forbidden here`);
      }
      const text = stableJson(job);
      for (const secret of literalSecrets(text)) {
        if (Object.values(SECRETS).includes(secret)) addFinding(findings, name, jobId, 'v2-secret-outside-controller', `${secret} is forbidden here`);
      }
    }
    return;
  }

  const events = workflowEvents(workflow.on);
  if (!sameSet(events, contract.events)) {
    addFinding(findings, name, null, 'event-contract-mismatch', `events must be exactly ${contract.events.join(', ')}`);
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    const role = contract.jobs[jobId];
    if (!role) {
      addFinding(findings, name, jobId, 'unclassified-controller-job', 'controller job is not in the closed allowlist');
      continue;
    }
    analyzeCurrentJob(name, jobId, job, role, contract, findings);
  }
  for (const jobId of Object.keys(contract.jobs)) {
    if (!(jobId in jobs)) addFinding(findings, name, jobId, 'required-job-missing', 'required controller job is missing');
  }
}

function analyzeCurrentJob(file, jobId, job, role, contract, findings) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    addFinding(findings, file, jobId, 'job-invalid', 'job must be an object');
    return;
  }
  const environment = environmentName(job.environment);
  if (job.uses) addFinding(findings, file, jobId, 'controller-reusable-workflow', 'controller jobs cannot delegate to reusable workflows');
  if (environment.dynamic) addFinding(findings, file, jobId, 'dynamic-environment', 'environment name must be literal');
  const expectedEnvironment = role === 'none' ? null : ENVIRONMENTS[role];
  if (environment.value !== expectedEnvironment) {
    addFinding(findings, file, jobId, 'environment-role-mismatch', `expected ${expectedEnvironment ?? 'no environment'}, got ${environment.value ?? 'none'}`);
  }

  const text = stableJson(job);
  const secrets = literalSecrets(text);
  const allowedSecrets = role === 'write' ? [SECRETS.write] : (role === 'read' || role === 'reanchor' ? [SECRETS.read] : []);
  for (const secret of secrets) {
    if (Object.values(SECRETS).includes(secret) && !allowedSecrets.includes(secret)) {
      addFinding(findings, file, jobId, 'secret-role-mismatch', `${secret} is not allowed for ${role}`);
    }
  }
  if (role !== 'none' && !needsJob(job.needs, contract.authorityScan)) {
    addFinding(findings, file, jobId, 'authority-scan-dependency-missing', `job must need ${contract.authorityScan}`);
  }
  if (role === 'write' && !secrets.includes(SECRETS.write)) {
    addFinding(findings, file, jobId, 'write-secret-missing', `write job must use ${SECRETS.write}`);
  }
  if ((role === 'read' || role === 'reanchor') && !secrets.includes(SECRETS.read)) {
    addFinding(findings, file, jobId, 'read-secret-missing', `read job must use ${SECRETS.read}`);
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const mutating = steps.some((step) => MUTATION_PATTERN.test(String(step?.run ?? '')));
  if (mutating && role !== 'write') addFinding(findings, file, jobId, 'mutation-outside-write-role', 'Cloudflare mutation is restricted to write jobs');
  if (role === 'write') analyzeCleanWriteJob(file, jobId, job, steps, findings);
  else analyzeAuthorityActions(file, jobId, steps, role !== 'none', findings);
  if (role === 'reanchor' && mutating) addFinding(findings, file, jobId, 'reanchor-mutation', 're-anchor must remain read-only');
}

function analyzeCleanWriteJob(file, jobId, job, steps, findings) {
  if (job.uses) addFinding(findings, file, jobId, 'write-reusable-workflow', 'write job cannot call a reusable workflow');
  if (/GITHUB_(?:ENV|PATH)/i.test(stableJson(job))) {
    addFinding(findings, file, jobId, 'write-runner-state-channel', 'write job cannot use GITHUB_ENV or GITHUB_PATH');
  }
  for (const step of steps) {
    const text = stableJson(step);
    if (step?.uses) {
      const uses = String(step.uses);
      if (/^\.\.?\//.test(uses)) addFinding(findings, file, jobId, 'write-local-action', 'write job cannot execute a local action');
      const match = FULL_SHA_ACTION_PATTERN.exec(uses);
      if (!match) addFinding(findings, file, jobId, 'write-action-not-full-sha', `${uses} is not pinned to a full commit SHA`);
      else if (!['actions/download-artifact', 'actions/upload-artifact'].includes(match[1])) {
        addFinding(findings, file, jobId, 'write-action-not-allowlisted', `${match[1]} is not allowlisted in a write job`);
      }
    }
    if (/actions\/checkout@/i.test(text)) addFinding(findings, file, jobId, 'write-checkout', 'write job cannot checkout source');
    if (INSTALL_BUILD_TEST_PATTERN.test(String(step?.run ?? '')) && !isClosedWranglerBootstrap(step)) {
      addFinding(findings, file, jobId, 'write-install-build-test', 'write job cannot run repository install/build/test');
    }
    if (/\b(?:node|python|bash|pwsh|powershell)\s+[^\s]*(?:artifact|package|payload)/i.test(text)) {
      addFinding(findings, file, jobId, 'write-artifact-execution', 'write job cannot execute candidate artifact code');
    }
  }

  if (stableJson(job.env ?? {}).includes(SECRETS.write)) {
    addFinding(findings, file, jobId, 'write-secret-at-job-scope', 'write token must be scoped only to the final mutation step');
  }
  const tokenSteps = steps.filter((step) => stableJson(step).includes(SECRETS.write));
  if (tokenSteps.length !== 1) {
    addFinding(findings, file, jobId, 'write-secret-step-count', 'write token must appear in exactly one step');
  } else {
    const tokenStep = tokenSteps[0];
    const tokenIndex = steps.indexOf(tokenStep);
    const tokenText = stableJson(tokenStep);
    if (!MUTATION_PATTERN.test(String(tokenStep?.run ?? ''))) {
      addFinding(findings, file, jobId, 'write-secret-without-mutation', 'write token step must contain the closed Wrangler mutation');
    }
    if (!/CLOUDFLARE_API_TOKEN/i.test(tokenText)) {
      addFinding(findings, file, jobId, 'write-secret-env-name', 'write token must be exposed only as CLOUDFLARE_API_TOKEN');
    }
    for (const [index, step] of steps.entries()) {
      if (String(step?.uses ?? '').startsWith('actions/upload-artifact@') && index <= tokenIndex) {
        addFinding(findings, file, jobId, 'write-evidence-upload-order', 'write-job evidence upload must follow the closed mutation step');
      }
    }
  }
}

function isClosedWranglerBootstrap(step) {
  const name = String(step?.name ?? '');
  const run = String(step?.run ?? '');
  const text = stableJson(step);
  if (name !== 'Bootstrap integrity-pinned Wrangler') return false;
  if (!run.includes('node_modules/wrangler/package.json') || !run.includes(`= ${WRANGLER_VERSION}`)) return false;
  if (!run.includes(WRANGLER_LOCK_SHA256)) return false;
  if (!/npm\s+ci\b/.test(run) || !/--ignore-scripts\b/.test(run) || !/--omit=dev\b/.test(run)) return false;
  if (!/authority\/controller\/wrangler-runtime\/package-lock\.json/.test(run)) return false;
  if (!/RUNNER_TEMP/.test(run)) return false;
  if (/pnpm\s+install|yarn\s+install|bun\s+install|npm\s+install|npm\s+run|pnpm\s+run/i.test(run)) return false;
  if (text.includes(SECRETS.write) || /CLOUDFLARE_API_TOKEN/i.test(text)) return false;
  return true;
}

function analyzeAuthorityActions(file, jobId, steps, authorityPath, findings) {
  if (!authorityPath) return;
  const allowed = new Set(['actions/download-artifact', 'actions/upload-artifact']);
  for (const step of steps) {
    if (!step?.uses) continue;
    const uses = String(step.uses);
    if (/^\.\.?\//.test(uses)) addFinding(findings, file, jobId, 'authority-local-action', 'authority path cannot execute a local action');
    const match = FULL_SHA_ACTION_PATTERN.exec(uses);
    if (!match) addFinding(findings, file, jobId, 'authority-action-not-full-sha', `${uses} is not pinned to a full commit SHA`);
    else if (!allowed.has(match[1])) addFinding(findings, file, jobId, 'authority-action-not-allowlisted', `${match[1]} is not allowlisted on an authority path`);
  }
}

function analyzeHistoricalWorkflow(name, workflow, findings) {
  const jobs = workflow.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) {
    addFinding(findings, name, null, 'historical-jobs-invalid', 'historical workflow.jobs is invalid');
    return;
  }
  for (const [jobId, job] of Object.entries(jobs)) {
    const environment = environmentName(job?.environment);
    const reachesFreshAuthority = environment.dynamic || Object.values(ENVIRONMENTS).includes(environment.value);
    if (!reachesFreshAuthority) continue;
    if (environment.dynamic) addFinding(findings, name, jobId, 'historical-dynamic-environment', 'rerunnable job can select a fresh environment dynamically');
    const text = stableJson(job);
    if (COMPUTED_SECRET_PATTERN.test(text) || hasInheritedSecrets(job)) {
      addFinding(findings, name, jobId, 'historical-dynamic-secret', 'rerunnable authority path has computed, broad, or inherited secret access');
    }
    if (job?.uses) {
      addFinding(findings, name, jobId, 'historical-reusable-authority', 'rerunnable fresh-authority path delegates to a reusable workflow');
    }
    for (const uses of actionUses(job)) {
      if (/^\.\.?\//.test(uses) || !FULL_SHA_ACTION_PATTERN.test(uses)) {
        addFinding(findings, name, jobId, 'historical-mutable-authority-action', `${uses} is mutable or locally indirect on a fresh-authority path`);
      }
    }
  }
}

function rejectGlobalDynamicAuthority(name, workflow, findings) {
  const jobs = workflow.jobs ?? {};
  for (const [jobId, job] of Object.entries(jobs)) {
    const environment = environmentName(job?.environment);
    if (environment.dynamic) addFinding(findings, name, jobId, 'dynamic-environment', 'dynamic environment expressions are forbidden repository-wide');
    const text = stableJson(job);
    if (COMPUTED_SECRET_PATTERN.test(text)) addFinding(findings, name, jobId, 'computed-secret', 'computed or broad secret access is forbidden');
    if (hasInheritedSecrets(job)) addFinding(findings, name, jobId, 'inherited-secrets', 'secrets: inherit is forbidden');
  }
}

function parseWorkflow(source, name, findings) {
  const document = parseDocument(source, { maxAliasCount: 0, uniqueKeys: true });
  for (const error of document.errors) addFinding(findings, name, null, 'yaml-parse-error', error.message);
  if (document.errors.length > 0) return null;
  const workflow = document.toJS({ maxAliasCount: 0 });
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    addFinding(findings, name, null, 'workflow-invalid', 'workflow root must be an object');
    return null;
  }
  return workflow;
}

function environmentName(environment) {
  if (environment === undefined || environment === null) return { value: null, dynamic: false };
  const value = typeof environment === 'string' ? environment : environment?.name;
  if (typeof value !== 'string') return { value: null, dynamic: true };
  return { value, dynamic: DYNAMIC_ENVIRONMENT_PATTERN.test(value) };
}

function workflowEvents(on) {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String).sort();
  if (on && typeof on === 'object') return Object.keys(on).sort();
  return [];
}

function literalSecrets(text) {
  return [...text.matchAll(LITERAL_SECRET_PATTERN)].map((match) => match[1]).filter((value, index, all) => all.indexOf(value) === index);
}

function hasInheritedSecrets(job) {
  return job?.secrets === 'inherit' || Object.values(job ?? {}).some((value) => value === 'inherit' && stableJson(job).includes('secrets'));
}

function actionUses(job) {
  const values = [];
  if (typeof job?.uses === 'string') values.push(job.uses);
  for (const step of Array.isArray(job?.steps) ? job.steps : []) if (typeof step?.uses === 'string') values.push(step.uses);
  return values;
}

function needsJob(needs, target) {
  if (typeof needs === 'string') return needs === target;
  return Array.isArray(needs) && needs.includes(target);
}

function normalizeRunWorkflowPath(value) {
  assert.ok(typeof value === 'string', 'run workflow path is missing');
  const path = value.split('@')[0].replace(/^\/+/, '');
  assert.match(path, /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/i, 'run workflow path is invalid');
  return path;
}

function isStillRerunnable(run, now) {
  const created = Date.parse(run.created_at);
  const updated = Date.parse(run.updated_at ?? run.created_at);
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return true;
  const conservativeAnchor = Math.max(created, updated);
  return now.valueOf() <= conservativeAnchor + RERUN_WINDOW_MS;
}

function addFinding(findings, file, job, code, message) {
  findings.push({ file, job, code, message });
}

function sameSet(a, b) {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function compareFindings(a, b) {
  return `${a.file}\0${a.job ?? ''}\0${a.code}\0${a.message}`.localeCompare(`${b.file}\0${b.job ?? ''}\0${b.code}\0${b.message}`);
}

function compareHistoricalFindings(a, b) {
  return `${a.runId ?? ''}\0${a.file ?? ''}\0${a.job ?? ''}\0${a.code}`.localeCompare(`${b.runId ?? ''}\0${b.file ?? ''}\0${b.job ?? ''}\0${b.code}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

function assertPlainObject(value, name) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseCli(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    assert.ok(item.startsWith('--'), `unexpected argument ${item}`);
    const [key, inline] = item.slice(2).split('=', 2);
    const value = inline ?? argv[++index];
    assert.ok(value && !value.startsWith('--'), `--${key} requires a value`);
    assert.equal(values[key], undefined, `duplicate --${key}`);
    values[key] = value;
  }
  return values;
}

async function main() {
  try {
    const args = parseCli(process.argv.slice(2));
    const metadata = {
      repository: args.repo ?? null,
      targetSha: args['target-sha'] ?? null,
      workflow: args.workflow ?? null,
      runId: args['run-id'] ?? null,
      runAttempt: args['run-attempt'] ?? null,
    };
    const current = await scanCurrentWorkflowTree(args.root ?? process.cwd(), metadata);
    let history = null;
    if (args['live-history'] === 'true') {
      history = await scanHistoricalRerunnableRuns({
        repository: args.repo,
        token: process.env.GITHUB_TOKEN,
      });
    }
    const output = { current, ...(history ? { history } : {}), ok: current.ok && (!history || history.ok) };
    console.log(JSON.stringify(output, null, 2));
    if (!output.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`cloudflare-release-authority: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
