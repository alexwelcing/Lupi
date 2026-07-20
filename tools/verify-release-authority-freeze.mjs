import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RECEIPT_KIND = 'lupi-release-authority-freeze';
const PROJECTION_KIND = 'lupi-cloudflare-token-authority-projection';
const EXPECTED_REPOSITORY = 'alexwelcing/Lupi';
const EXPECTED_OWNER = 'alexwelcing';
const EXPECTED_OWNER_TYPE = 'User';
const EXPECTED_WORKFLOW_PATH = '.github/workflows/deploy-cloudflare.yml';
const EXPECTED_WORKFLOW_STATE = 'disabled_manually';
const LEGACY_SECRET_NAME = 'CLOUDFLARE_API_TOKEN';
const INTERLOCK_STATEMENT = 'Source merge is not permission to add or enable v2 write authority.';
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;
const FUTURE_SKEW_MS = 2 * 60 * 1000;
const RECEIPT_OBSERVATION_SPAN_MS = 30 * 60 * 1000;
const MAX_JSON_BYTES = 1024 * 1024;

const FORBIDDEN_FIELD_NAMES = new Set([
  'value',
  'secretvalue',
  'tokenvalue',
  'credential',
  'credentials',
  'password',
  'privatekey',
  'clientsecret',
  'accesstoken',
  'apitoken',
  'apikey',
  'authorizationheader',
]);

const CREDENTIAL_MARKERS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bgithub_pat_[A-Za-z0-9_]+\b/u,
  /\bgh[pousr]_[A-Za-z0-9_]+\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/iu,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
];

class FreezeValidationError extends Error {
  constructor(code, field = null) {
    super(field == null ? code : `${code} at ${field}`);
    this.name = 'FreezeValidationError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, field = null) {
  throw new FreezeValidationError(code, field);
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function expectClosedObject(value, field, keys) {
  if (!isPlainObject(value)) fail('expected-object', field);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('unknown-field', `${field}.${key}`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail('missing-field', `${field}.${key}`);
    }
  }
  return value;
}

function scanForSensitiveMaterial(value, field = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForSensitiveMaterial(entry, `${field}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      const normalized = key.replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
      if (FORBIDDEN_FIELD_NAMES.has(normalized)) {
        fail('forbidden-sensitive-field', `${field}.${key}`);
      }
      scanForSensitiveMaterial(entry, `${field}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && CREDENTIAL_MARKERS.some((marker) => marker.test(value))) {
    fail('credential-like-text', field);
  }
}

function expectString(value, field, { min = 1, max = 256, pattern = null } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail('expected-string', field);
  }
  if (/\p{Cc}/u.test(value)) fail('control-character', field);
  if (pattern != null && !pattern.test(value)) fail('invalid-format', field);
  return value;
}

function expectBoolean(value, field, expected = null) {
  if (typeof value !== 'boolean') fail('expected-boolean', field);
  if (expected != null && value !== expected) fail('wrong-boolean', field);
  return value;
}

function expectPositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) fail('expected-positive-integer', field);
  return value;
}

function expectEnum(value, field, allowed) {
  if (!allowed.includes(value)) fail('wrong-enum', field);
  return value;
}

function expectSha(value, field) {
  expectString(value, field, { pattern: /^[a-f0-9]{40}$/u });
  if (/^0{40}$/u.test(value)) fail('placeholder-sha', field);
  return value;
}

function expectSha256(value, field) {
  expectString(value, field, { pattern: /^[a-f0-9]{64}$/u });
  if (/^0{64}$/u.test(value)) fail('placeholder-sha256', field);
  return value;
}

function parseUtcTimestamp(value, field, nowMs) {
  expectString(value, field, {
    pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u,
  });
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail('invalid-timestamp', field);
  const normalized = value.includes('.') ? value : `${value.slice(0, -1)}.000Z`;
  if (new Date(parsed).toISOString() !== normalized) fail('invalid-timestamp', field);
  if (parsed > nowMs + FUTURE_SKEW_MS) fail('future-timestamp', field);
  return parsed;
}

function expectIdentifier(value, field) {
  return expectString(value, field, {
    min: 3,
    max: 160,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u,
  });
}

function expectSecretNames(value, field) {
  if (!Array.isArray(value)) fail('expected-array', field);
  const names = value.map((entry, index) => expectString(entry, `${field}[${index}]`, {
    max: 255,
    pattern: /^[A-Z][A-Z0-9_]*$/u,
  }));
  if (new Set(names).size !== names.length) fail('duplicate-secret-name', field);
  if (names.includes(LEGACY_SECRET_NAME)) fail('legacy-secret-present', field);
  return names;
}

function validateInventory(value, field, nowMs, overallObservedMs, options = {}) {
  const allowedKeys = options.includeName
    ? ['name', 'applicable', 'names', 'observedAt']
    : ['applicable', 'names', 'observedAt'];
  const inventory = expectClosedObject(value, field, allowedKeys);
  expectBoolean(inventory.applicable, `${field}.applicable`, true);
  const names = expectSecretNames(inventory.names, `${field}.names`);
  const observedMs = parseUtcTimestamp(inventory.observedAt, `${field}.observedAt`, nowMs);
  if (observedMs > overallObservedMs) fail('observation-after-receipt', `${field}.observedAt`);
  if (overallObservedMs - observedMs > RECEIPT_OBSERVATION_SPAN_MS) {
    fail('stale-receipt-observation', `${field}.observedAt`);
  }
  return { names, observedMs };
}

export function validateReleaseAuthorityFreezeReceipt(receipt, options = {}) {
  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : typeof options.now === 'number'
      ? options.now
      : Date.now();

  scanForSensitiveMaterial(receipt);
  const root = expectClosedObject(receipt, '$', [
    'schemaVersion',
    'kind',
    'repository',
    'authorization',
    'github',
    'cloudflare',
    'interlock',
  ]);

  if (root.schemaVersion !== 1) fail('wrong-schema-version', '$.schemaVersion');
  expectEnum(root.kind, '$.kind', [RECEIPT_KIND]);

  const repository = expectClosedObject(root.repository, '$.repository', [
    'fullName',
    'ownerType',
    'frozenBaseSha',
    'frozenBranchSha',
  ]);
  expectEnum(repository.fullName, '$.repository.fullName', [EXPECTED_REPOSITORY]);
  expectEnum(repository.ownerType, '$.repository.ownerType', [EXPECTED_OWNER_TYPE]);
  expectSha(repository.frozenBaseSha, '$.repository.frozenBaseSha');
  expectSha(repository.frozenBranchSha, '$.repository.frozenBranchSha');

  const authorization = expectClosedObject(root.authorization, '$.authorization', [
    'approver',
    'authorizedAt',
    'observedAt',
  ]);
  expectEnum(authorization.approver, '$.authorization.approver', [EXPECTED_OWNER]);
  const authorizedMs = parseUtcTimestamp(
    authorization.authorizedAt,
    '$.authorization.authorizedAt',
    nowMs,
  );
  const overallObservedMs = parseUtcTimestamp(
    authorization.observedAt,
    '$.authorization.observedAt',
    nowMs,
  );
  if (authorizedMs > overallObservedMs) fail('authorization-after-observation', '$.authorization');

  const github = expectClosedObject(root.github, '$.github', ['workflow', 'secretInventories']);
  const workflow = expectClosedObject(github.workflow, '$.github.workflow', [
    'id',
    'path',
    'state',
    'observedAt',
  ]);
  expectPositiveInteger(workflow.id, '$.github.workflow.id');
  expectEnum(workflow.path, '$.github.workflow.path', [EXPECTED_WORKFLOW_PATH]);
  expectEnum(workflow.state, '$.github.workflow.state', [EXPECTED_WORKFLOW_STATE]);
  const workflowObservedMs = parseUtcTimestamp(
    workflow.observedAt,
    '$.github.workflow.observedAt',
    nowMs,
  );
  if (workflowObservedMs > overallObservedMs) {
    fail('observation-after-receipt', '$.github.workflow.observedAt');
  }
  if (overallObservedMs - workflowObservedMs > RECEIPT_OBSERVATION_SPAN_MS) {
    fail('stale-receipt-observation', '$.github.workflow.observedAt');
  }

  const inventories = expectClosedObject(
    github.secretInventories,
    '$.github.secretInventories',
    ['repository', 'environments', 'organization'],
  );
  const repositoryInventory = validateInventory(
    inventories.repository,
    '$.github.secretInventories.repository',
    nowMs,
    overallObservedMs,
  );

  if (!Array.isArray(inventories.environments)) {
    fail('expected-array', '$.github.secretInventories.environments');
  }
  const environmentNames = new Set();
  const environments = inventories.environments.map((entry, index) => {
    const field = `$.github.secretInventories.environments[${index}]`;
    const environment = entry;
    const name = expectString(environment.name, `${field}.name`, { max: 255 });
    if (environmentNames.has(name)) fail('duplicate-environment', `${field}.name`);
    environmentNames.add(name);
    const validated = validateInventory(environment, field, nowMs, overallObservedMs, {
      includeName: true,
    });
    return { name, names: validated.names };
  });

  const organization = expectClosedObject(
    inventories.organization,
    '$.github.secretInventories.organization',
    ['applicable', 'ownerType', 'reason', 'names', 'observedAt'],
  );
  expectBoolean(organization.applicable, '$.github.secretInventories.organization.applicable', false);
  expectEnum(
    organization.ownerType,
    '$.github.secretInventories.organization.ownerType',
    [EXPECTED_OWNER_TYPE],
  );
  expectEnum(
    organization.reason,
    '$.github.secretInventories.organization.reason',
    ['repository-owner-is-user'],
  );
  const organizationNames = expectSecretNames(
    organization.names,
    '$.github.secretInventories.organization.names',
  );
  if (organizationNames.length !== 0) {
    fail('inapplicable-scope-has-secrets', '$.github.secretInventories.organization.names');
  }
  const organizationObservedMs = parseUtcTimestamp(
    organization.observedAt,
    '$.github.secretInventories.organization.observedAt',
    nowMs,
  );
  if (organizationObservedMs > overallObservedMs) {
    fail('observation-after-receipt', '$.github.secretInventories.organization.observedAt');
  }
  if (overallObservedMs - organizationObservedMs > RECEIPT_OBSERVATION_SPAN_MS) {
    fail('stale-receipt-observation', '$.github.secretInventories.organization.observedAt');
  }

  const cloudflare = expectClosedObject(root.cloudflare, '$.cloudflare', [
    'legacyToken',
    'projection',
  ]);
  const legacyToken = expectClosedObject(cloudflare.legacyToken, '$.cloudflare.legacyToken', [
    'identifier',
    'state',
    'revokedAt',
    'evidenceIdentifier',
  ]);
  const tokenIdentifier = expectIdentifier(
    legacyToken.identifier,
    '$.cloudflare.legacyToken.identifier',
  );
  expectEnum(legacyToken.state, '$.cloudflare.legacyToken.state', ['revoked']);
  const revokedMs = parseUtcTimestamp(
    legacyToken.revokedAt,
    '$.cloudflare.legacyToken.revokedAt',
    nowMs,
  );
  if (revokedMs > overallObservedMs) fail('revocation-after-observation', '$.cloudflare.legacyToken.revokedAt');
  const evidenceIdentifier = expectIdentifier(
    legacyToken.evidenceIdentifier,
    '$.cloudflare.legacyToken.evidenceIdentifier',
  );

  const projection = expectClosedObject(cloudflare.projection, '$.cloudflare.projection', [
    'sha256',
    'observedAt',
  ]);
  const projectionSha256 = expectSha256(projection.sha256, '$.cloudflare.projection.sha256');
  const projectionObservedMs = parseUtcTimestamp(
    projection.observedAt,
    '$.cloudflare.projection.observedAt',
    nowMs,
  );
  if (projectionObservedMs > overallObservedMs) {
    fail('observation-after-receipt', '$.cloudflare.projection.observedAt');
  }
  if (overallObservedMs - projectionObservedMs > RECEIPT_OBSERVATION_SPAN_MS) {
    fail('stale-receipt-observation', '$.cloudflare.projection.observedAt');
  }

  const interlock = expectClosedObject(root.interlock, '$.interlock', [
    'legacySecretName',
    'keepDisabledThroughPlan023Merge',
    'sourceMergeGrantsV2WriteAuthority',
    'statement',
  ]);
  expectEnum(interlock.legacySecretName, '$.interlock.legacySecretName', [LEGACY_SECRET_NAME]);
  expectBoolean(
    interlock.keepDisabledThroughPlan023Merge,
    '$.interlock.keepDisabledThroughPlan023Merge',
    true,
  );
  expectBoolean(
    interlock.sourceMergeGrantsV2WriteAuthority,
    '$.interlock.sourceMergeGrantsV2WriteAuthority',
    false,
  );
  expectEnum(interlock.statement, '$.interlock.statement', [INTERLOCK_STATEMENT]);

  return {
    repository: repository.fullName,
    ownerType: repository.ownerType,
    workflowId: workflow.id,
    workflowPath: workflow.path,
    workflowState: workflow.state,
    repositorySecretNames: repositoryInventory.names,
    environments,
    tokenIdentifier,
    tokenRevokedAt: legacyToken.revokedAt,
    evidenceIdentifier,
    projectionSha256,
    projectionObservedAt: projection.observedAt,
  };
}

export function validateCloudflareProjection(projection, options = {}) {
  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : typeof options.now === 'number'
      ? options.now
      : Date.now();
  const maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0 || maxAgeSeconds > 86400) {
    fail('invalid-max-age', '$options.maxAgeSeconds');
  }

  scanForSensitiveMaterial(projection);
  const root = expectClosedObject(projection, '$', [
    'schemaVersion',
    'kind',
    'observedAt',
    'inventoryComplete',
    'legacyToken',
  ]);
  if (root.schemaVersion !== 1) fail('wrong-schema-version', '$.schemaVersion');
  expectEnum(root.kind, '$.kind', [PROJECTION_KIND]);
  const observedMs = parseUtcTimestamp(root.observedAt, '$.observedAt', nowMs);
  if (nowMs - observedMs > maxAgeSeconds * 1000) fail('stale-projection', '$.observedAt');
  expectBoolean(root.inventoryComplete, '$.inventoryComplete', true);

  const token = expectClosedObject(root.legacyToken, '$.legacyToken', [
    'identifier',
    'state',
    'revokedAt',
    'evidenceIdentifier',
  ]);
  const identifier = expectIdentifier(token.identifier, '$.legacyToken.identifier');
  const state = expectEnum(token.state, '$.legacyToken.state', ['revoked', 'absent']);
  const evidenceIdentifier = expectIdentifier(
    token.evidenceIdentifier,
    '$.legacyToken.evidenceIdentifier',
  );
  let revokedAt = null;
  if (state === 'revoked') {
    revokedAt = token.revokedAt;
    const revokedMs = parseUtcTimestamp(revokedAt, '$.legacyToken.revokedAt', nowMs);
    if (revokedMs > observedMs) fail('revocation-after-observation', '$.legacyToken.revokedAt');
  } else if (token.revokedAt !== null) {
    fail('absent-token-revoked-at-must-be-null', '$.legacyToken.revokedAt');
  }

  return {
    observedAt: root.observedAt,
    identifier,
    state,
    revokedAt,
    evidenceIdentifier,
  };
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function readJsonFile(filePath, label) {
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    fail(`${label}-read-failed`);
  }
  if (bytes.length === 0 || bytes.length > MAX_JSON_BYTES) fail(`${label}-size-invalid`);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`${label}-invalid-json`);
  }
  return { bytes, value };
}

function defaultGithubApi(endpoint) {
  const executable = process.platform === 'win32' ? 'gh.exe' : 'gh';
  const result = spawnSync(executable, ['api', '--method', 'GET', endpoint], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail('github-api-command-failed');
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail('github-api-invalid-json');
  }
}

function withPage(endpoint, page) {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}per_page=100&page=${page}`;
}

async function fetchPaginated(githubApi, endpoint, arrayKey, itemLabel) {
  let expectedTotal = null;
  const items = [];
  for (let page = 1; page <= 1000; page += 1) {
    const response = await githubApi(withPage(endpoint, page));
    if (!isPlainObject(response)) fail('github-api-malformed-response', itemLabel);
    if (!Number.isSafeInteger(response.total_count) || response.total_count < 0) {
      fail('github-api-invalid-total-count', itemLabel);
    }
    if (!Array.isArray(response[arrayKey])) fail('github-api-missing-page-array', itemLabel);
    if (response[arrayKey].length > 100) fail('github-api-oversized-page', itemLabel);
    if (expectedTotal == null) expectedTotal = response.total_count;
    if (response.total_count !== expectedTotal) fail('github-api-changing-total-count', itemLabel);
    if (response[arrayKey].length === 0 && items.length < expectedTotal) {
      fail('github-api-missing-pagination', itemLabel);
    }
    items.push(...response[arrayKey]);
    if (items.length > expectedTotal) fail('github-api-count-overflow', itemLabel);
    if (items.length === expectedTotal) return items;
  }
  fail('github-api-pagination-limit', itemLabel);
}

function readRemoteName(item, field) {
  if (!isPlainObject(item)) fail('github-api-malformed-item', field);
  return expectString(item.name, `${field}.name`, { max: 255 });
}

function assertUnique(values, field) {
  if (new Set(values).size !== values.length) fail('github-api-duplicate-name', field);
}

function assertSameNames(actual, expected, field) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    actualSorted.length !== expectedSorted.length
    || actualSorted.some((entry, index) => entry !== expectedSorted[index])
  ) {
    fail('github-secret-inventory-mismatch', field);
  }
}

async function verifyGithubProjection(receipt, repo, githubApi) {
  const repository = await githubApi(`repos/${repo}`);
  if (!isPlainObject(repository) || !isPlainObject(repository.owner)) {
    fail('github-api-malformed-repository');
  }
  if (repository.full_name !== repo) fail('github-repository-mismatch');
  if (repository.owner.type !== EXPECTED_OWNER_TYPE) fail('github-owner-type-mismatch');

  const workflow = await githubApi(`repos/${repo}/actions/workflows/${receipt.workflowId}`);
  if (!isPlainObject(workflow)) fail('github-api-malformed-workflow');
  if (workflow.id !== receipt.workflowId) fail('github-workflow-id-mismatch');
  if (workflow.path !== receipt.workflowPath) fail('github-workflow-path-mismatch');
  if (workflow.state !== EXPECTED_WORKFLOW_STATE) fail('github-workflow-not-disabled');

  const repositorySecrets = await fetchPaginated(
    githubApi,
    `repos/${repo}/actions/secrets`,
    'secrets',
    'repository-secrets',
  );
  const repositoryNames = repositorySecrets.map((item, index) => (
    readRemoteName(item, `repository-secrets[${index}]`)
  ));
  assertUnique(repositoryNames, 'repository-secrets');
  if (repositoryNames.includes(LEGACY_SECRET_NAME)) fail('legacy-secret-live', 'repository-secrets');
  assertSameNames(repositoryNames, receipt.repositorySecretNames, 'repository-secrets');

  const remoteEnvironments = await fetchPaginated(
    githubApi,
    `repos/${repo}/environments`,
    'environments',
    'environments',
  );
  const environmentNames = remoteEnvironments.map((item, index) => (
    readRemoteName(item, `environments[${index}]`)
  ));
  assertUnique(environmentNames, 'environments');
  assertSameNames(environmentNames, receipt.environments.map((entry) => entry.name), 'environments');

  let environmentSecretCount = 0;
  for (const environment of receipt.environments) {
    const encoded = encodeURIComponent(environment.name);
    const remoteSecrets = await fetchPaginated(
      githubApi,
      `repos/${repo}/environments/${encoded}/secrets`,
      'secrets',
      'environment-secrets',
    );
    const remoteNames = remoteSecrets.map((item, index) => (
      readRemoteName(item, `environment-secrets[${index}]`)
    ));
    assertUnique(remoteNames, 'environment-secrets');
    if (remoteNames.includes(LEGACY_SECRET_NAME)) fail('legacy-secret-live', 'environment-secrets');
    assertSameNames(remoteNames, environment.names, 'environment-secrets');
    environmentSecretCount += remoteNames.length;
  }

  return {
    repositorySecretCount: repositoryNames.length,
    environmentCount: environmentNames.length,
    environmentSecretCount,
  };
}

function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

function safeFailureCheck(id, error) {
  const code = error instanceof FreezeValidationError ? error.code : 'unexpected-validation-failure';
  return check(id, false, code);
}

export async function verifyReleaseAuthorityFreeze(options) {
  const checks = [];
  const now = options.now ?? new Date();
  let receiptFile;
  let receipt;
  try {
    receiptFile = readJsonFile(options.receiptPath, 'receipt');
    receipt = validateReleaseAuthorityFreezeReceipt(receiptFile.value, { now });
    checks.push(check('receipt-schema', true, 'closed schema and freeze invariants pass'));
  } catch (error) {
    checks.push(safeFailureCheck('receipt-schema', error));
    return { ok: false, mode: options.liveGithub ? 'live' : 'local', checks };
  }

  const receiptSha256 = digest(receiptFile.bytes);
  if (!options.liveGithub) {
    checks.push(check('local-only', true, 'no external projection requested'));
    return { ok: true, mode: 'local', receiptSha256, checks };
  }

  if (options.repo !== EXPECTED_REPOSITORY || !options.cloudflareProjectionPath) {
    checks.push(check('live-arguments', false, 'live mode requires the exact repository and projection file'));
    return { ok: false, mode: 'live', receiptSha256, checks };
  }
  checks.push(check('live-arguments', true, 'live inputs are explicit'));

  try {
    const projectionFile = readJsonFile(options.cloudflareProjectionPath, 'cloudflare-projection');
    const projection = validateCloudflareProjection(projectionFile.value, {
      now,
      maxAgeSeconds: options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
    });
    if (digest(projectionFile.bytes) !== receipt.projectionSha256) {
      fail('cloudflare-projection-hash-mismatch');
    }
    if (projection.observedAt !== receipt.projectionObservedAt) {
      fail('cloudflare-projection-observation-mismatch');
    }
    if (projection.identifier !== receipt.tokenIdentifier) fail('cloudflare-token-id-mismatch');
    if (!['revoked', 'absent'].includes(projection.state)) fail('cloudflare-token-not-retired');
    if (projection.state === 'revoked' && projection.revokedAt !== receipt.tokenRevokedAt) {
      fail('cloudflare-revocation-time-mismatch');
    }
    if (projection.evidenceIdentifier !== receipt.evidenceIdentifier) {
      fail('cloudflare-evidence-id-mismatch');
    }
    checks.push(check('cloudflare-projection', true, 'fresh non-secret token retirement projection matches'));
  } catch (error) {
    checks.push(safeFailureCheck('cloudflare-projection', error));
  }

  if (checks.some((entry) => !entry.ok)) {
    return { ok: false, mode: 'live', receiptSha256, checks };
  }

  try {
    const github = await verifyGithubProjection(
      receipt,
      options.repo,
      options.githubApi ?? defaultGithubApi,
    );
    checks.push(check(
      'github-projection',
      true,
      `workflow disabled; ${github.repositorySecretCount} repository secrets, ${github.environmentCount} environments, ${github.environmentSecretCount} environment secrets checked`,
    ));
  } catch (error) {
    checks.push(safeFailureCheck('github-projection', error));
  }

  return {
    ok: checks.every((entry) => entry.ok),
    mode: 'live',
    receiptSha256,
    checks,
  };
}

function parseCliArgs(args) {
  const options = {
    receiptPath: null,
    liveGithub: false,
    repo: null,
    cloudflareProjectionPath: null,
    maxAgeSeconds: DEFAULT_MAX_AGE_SECONDS,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const readValue = (name) => {
      const equalsPrefix = `${name}=`;
      if (argument.startsWith(equalsPrefix)) return argument.slice(equalsPrefix.length);
      if (argument === name && args[index + 1] != null) {
        index += 1;
        return args[index];
      }
      return null;
    };

    let value = readValue('--receipt');
    if (value != null) {
      options.receiptPath = path.resolve(value);
      continue;
    }
    value = readValue('--repo');
    if (value != null) {
      options.repo = value;
      continue;
    }
    value = readValue('--cloudflare-projection');
    if (value != null) {
      options.cloudflareProjectionPath = path.resolve(value);
      continue;
    }
    value = readValue('--max-age-seconds');
    if (value != null) {
      options.maxAgeSeconds = Number(value);
      continue;
    }
    if (argument === '--live-github') {
      options.liveGithub = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      fail('unknown-cli-argument');
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/verify-release-authority-freeze.mjs --receipt=<path>
  node tools/verify-release-authority-freeze.mjs --receipt=<path> --live-github --repo=alexwelcing/Lupi --cloudflare-projection=<path>

Options:
  --receipt=<path>                  Non-secret freeze receipt
  --live-github                    Read current GitHub authority with gh api
  --repo=alexwelcing/Lupi           Exact repository for live verification
  --cloudflare-projection=<path>   Fresh non-secret Cloudflare token projection
  --max-age-seconds=<seconds>      Projection freshness limit (default 900)
  --json                            Emit a non-secret JSON summary
  --help                            Show this help`);
}

async function runCli() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    const failure = safeFailureCheck('cli', error);
    console.error(`FAIL ${failure.id}: ${failure.detail}`);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }
  if (!options.receiptPath) {
    console.error('FAIL cli: --receipt is required');
    process.exitCode = 1;
    return;
  }
  if (!options.liveGithub && (options.repo != null || options.cloudflareProjectionPath != null)) {
    console.error('FAIL cli: --repo and --cloudflare-projection require --live-github');
    process.exitCode = 1;
    return;
  }

  const result = await verifyReleaseAuthorityFreeze(options);
  if (options.json) {
    console.log(JSON.stringify(result));
  } else {
    for (const entry of result.checks) {
      console.log(`${entry.ok ? 'PASS' : 'FAIL'} ${entry.id}: ${entry.detail}`);
    }
    console.log(`${result.ok ? 'PASS' : 'FAIL'} release-authority-freeze (${result.mode})`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
