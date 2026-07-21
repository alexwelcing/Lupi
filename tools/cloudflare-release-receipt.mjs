#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'alexwelcing/Lupi';
const SHA40 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

export function parseWranglerNdjson(text) {
  assert.equal(typeof text, 'string', 'Wrangler NDJSON must be text');
  const records = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Wrangler NDJSON line ${index + 1} is invalid JSON: ${errorMessage(error)}`);
    }
    assertPlainObject(record, `Wrangler NDJSON line ${index + 1}`);
    records.push(record);
  }
  assert.ok(records.length > 0, 'Wrangler NDJSON is empty');
  return records;
}

export function extractVersionUpload(records, { expectedTag } = {}) {
  assert.ok(Array.isArray(records), 'records must be an array');
  const candidates = records.filter((record) => {
    const type = String(record.type ?? record.event ?? record.name ?? '').toLowerCase();
    return type.includes('version') && (type.includes('upload') || record.version_id || record.versionId);
  }).map((record) => ({
    versionId: record.version_id ?? record.versionId ?? record.version?.id,
    previewUrl: record.preview_url ?? record.previewUrl ?? record.version?.preview_url,
    tag: record.tag ?? record.version?.tag,
  })).filter((candidate) => candidate.versionId || candidate.previewUrl);
  assert.equal(candidates.length, 1, `expected one version-upload record, got ${candidates.length}`);
  const candidate = candidates[0];
  assertVersionId(candidate.versionId, 'candidate version ID');
  const preview = normalizeHttpsOrigin(candidate.previewUrl, 'candidate preview URL');
  assert.notEqual(preview.origin, 'https://lupi.live', 'candidate preview must be immutable and separate from the custom domain');
  assert.match(candidate.tag ?? '', SHA40, 'candidate tag must be a full Git SHA');
  if (expectedTag) assert.equal(candidate.tag, expectedTag, 'candidate tag does not match target SHA');
  return { versionId: candidate.versionId, previewOrigin: preview.origin, tag: candidate.tag };
}

export function validateSingleActiveDeployment(value) {
  assertPlainObject(value, 'active deployment');
  const versions = Array.isArray(value.versions)
    ? value.versions
    : Array.isArray(value.deployments)
      ? value.deployments
      : null;
  assert.ok(versions, 'active deployment versions are missing');
  assert.equal(versions.length, 1, `expected one active version, got ${versions.length}`);
  const entry = versions[0];
  assertPlainObject(entry, 'active version');
  const versionId = entry.version_id ?? entry.versionId ?? entry.id;
  const percentage = Number(entry.percentage ?? entry.traffic ?? entry.percent);
  assertVersionId(versionId, 'active version ID');
  assert.equal(percentage, 100, 'active version must receive exactly 100% traffic');
  return { versionId, percentage: 100, tag: entry.tag ?? null };
}

export function parseCloudflareDeploymentsEnvelope(value) {
  assertPlainObject(value, 'Cloudflare deployments response');
  assert.equal(value.success, true, 'Cloudflare deployments response was not successful');
  assertPlainObject(value.result, 'Cloudflare deployments result');
  assert.ok(Array.isArray(value.result.deployments), 'Cloudflare deployments result.deployments must be an array');
  assert.ok(value.result.deployments.length > 0, 'Cloudflare deployments list is empty');
  return value.result.deployments;
}

export function parseCloudflareVersionsEnvelope(value) {
  assertPlainObject(value, 'Cloudflare versions response');
  assert.equal(value.success, true, 'Cloudflare versions response was not successful');
  assertPlainObject(value.result, 'Cloudflare versions result');
  assert.ok(Array.isArray(value.result.items), 'Cloudflare versions result.items must be an array');
  return value.result.items;
}

export async function collectCloudflareVersionIds(fetchPage, { perPage = 100, maxPages = 100 } = {}) {
  assert.equal(typeof fetchPage, 'function', 'version-page reader must be a function');
  assert.ok(Number.isSafeInteger(perPage) && perPage >= 1 && perPage <= 100, 'perPage must be between 1 and 100');
  assert.ok(Number.isSafeInteger(maxPages) && maxPages >= 1, 'maxPages must be positive');
  const ids = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const items = parseCloudflareVersionsEnvelope(await fetchPage(page, perPage));
    for (const item of items) {
      assertPlainObject(item, `Cloudflare version on page ${page}`);
      assertVersionId(item.id, `Cloudflare version ID on page ${page}`);
      ids.push(item.id);
    }
    if (items.length < perPage) {
      assert.equal(new Set(ids).size, ids.length, 'Cloudflare version inventory contains duplicate IDs');
      return ids;
    }
  }
  throw new Error(`Cloudflare version pagination exceeded ${maxPages} pages`);
}

export function validateVersionInventory(value, { priorVersionId, phase }) {
  assertPlainObject(value, 'version inventory');
  assertExactKeys(value, ['complete', 'fetchedAt', 'schemaVersion', 'versionIds'], 'version inventory');
  assert.equal(value.schemaVersion, 'lupi-version-inventory-v1', 'unsupported version-inventory schema');
  assert.equal(value.complete, true, 'version inventory pagination is incomplete');
  assertIso(value.fetchedAt, 'version inventory fetchedAt');
  assert.ok(Array.isArray(value.versionIds) && value.versionIds.length > 0, 'versionIds must be non-empty');
  const ids = value.versionIds.map((id) => {
    assertVersionId(id, 'version inventory ID');
    return id;
  });
  assert.equal(new Set(ids).size, ids.length, 'version inventory contains duplicate IDs');
  const rank = ids.indexOf(priorVersionId) + 1;
  assert.ok(rank > 0, 'prior version is absent from the version inventory');
  const maxRank = phase === 'pre-upload' ? 99 : phase === 'post-upload' || phase === 'pre-promotion' || phase === 'pre-rollback' ? 100 : null;
  assert.ok(maxRank, `unsupported inventory phase ${phase}`);
  assert.ok(rank <= maxRank, `prior version rank ${rank} exceeds ${maxRank} during ${phase}`);
  return {
    schemaVersion: value.schemaVersion,
    fetchedAt: value.fetchedAt,
    complete: true,
    versionIds: ids,
    priorVersionId,
    priorRank: rank,
    phase,
    snapshotSha256: canonicalSha256(value),
  };
}

export function validateReleasePackage(value) {
  assertPlainObject(value, 'release package');
  assertExactKeys(value, [
    'assetManifest', 'bindingProjection', 'buildSha256', 'configSha256',
    'createdAt', 'files', 'lockSha256', 'packageSha256', 'repository',
    'runAttempt', 'runId', 'schemaVersion', 'sourceManifestSha256',
    'targetSha', 'toolchain', 'uploadConfigSha256', 'workflow',
    'wranglerIntegrity',
  ], 'release package');
  assert.equal(value.schemaVersion, 'lupi-release-package-v1', 'unsupported release-package schema');
  assertRepositoryAndSha(value);
  assertAttemptOne(value.runAttempt);
  assertNonEmpty(value.runId, 'release package runId');
  assertNonEmpty(value.workflow, 'release package workflow');
  assertIso(value.createdAt, 'release package createdAt');
  for (const field of ['buildSha256', 'configSha256', 'lockSha256', 'sourceManifestSha256', 'uploadConfigSha256']) assertSha256(value[field], field);
  assertPlainObject(value.toolchain, 'release package toolchain');
  assertPlainObject(value.bindingProjection, 'release package bindingProjection');
  assert.ok(Array.isArray(value.assetManifest), 'release package assetManifest must be an array');
  assert.ok(Array.isArray(value.files) && value.files.length > 0, 'release package files must be non-empty');
  const normalizedFiles = value.files.map((file) => validateDataFile(file));
  assert.equal(new Set(normalizedFiles.map((file) => file.path)).size, normalizedFiles.length, 'release package file paths must be unique');
  assertNonEmpty(value.wranglerIntegrity, 'Wrangler integrity');
  const projected = { ...value, packageSha256: undefined };
  assert.equal(value.packageSha256, canonicalSha256(projected), 'release package digest mismatch');
  return value;
}

export function validateRollbackContract(value) {
  assertPlainObject(value, 'rollback contract');
  assertExactKeys(value, [
    'commandMode', 'configFiles', 'environmentNames', 'expectedTestNames',
    'lockSha256', 'nodeVersion', 'pnpmVersion', 'preMutationReport',
    'repository', 'schemaVersion', 'sourceManifestSha256', 'targetSha',
    'testFiles', 'workerVersionId',
  ], 'rollback contract');
  assert.equal(value.schemaVersion, 'lupi-rollback-contract-v1', 'unsupported rollback-contract schema');
  assertRepositoryAndSha(value);
  assertVersionId(value.workerVersionId, 'rollback worker version ID');
  assert.ok([
    'legacy-deployed-smoke-v1',
    'full-ui-configless-v1',
    'full-ui-v1',
  ].includes(value.commandMode), 'rollback commandMode is not closed');
  assertNonEmpty(value.nodeVersion, 'rollback Node version');
  assertNonEmpty(value.pnpmVersion, 'rollback pnpm version');
  assertSha256(value.lockSha256, 'rollback lock SHA-256');
  assertSha256(value.sourceManifestSha256, 'rollback source manifest SHA-256');
  validateFileHashes(value.configFiles, 'rollback config files');
  validateFileHashes(value.testFiles, 'rollback test files');
  assert.ok(Array.isArray(value.environmentNames) && value.environmentNames.every(isNonEmptyString), 'rollback environmentNames are invalid');
  assert.ok(Array.isArray(value.expectedTestNames) && value.expectedTestNames.length > 0 && value.expectedTestNames.every(isNonEmptyString), 'rollback expectedTestNames are invalid');
  assertPlainObject(value.preMutationReport, 'rollback preMutationReport');
  assertExactKeys(value.preMutationReport, ['result', 'sha256'], 'rollback preMutationReport');
  assert.equal(value.preMutationReport.result, 'pass', 'rollback pre-mutation suite did not pass');
  assertSha256(value.preMutationReport.sha256, 'rollback preMutationReport SHA-256');
  return value;
}

export function validateReleaseIntent(value) {
  assertPlainObject(value, 'release intent');
  assertExactKeys(value, [
    'actor', 'boundedRollbackAuthorized', 'candidateContractSha256',
    'candidatePreviewOrigin', 'candidateVersionId', 'confirmationHash',
    'confirmationMode', 'createdAt', 'event', 'expectedPostureSha256',
    'packageSha256', 'postUploadInventorySha256', 'preUploadInventorySha256',
    'priorBaselineSha256', 'priorContractSha256', 'priorEligibilityRank',
    'priorVersionId', 'ref', 'repository', 'runAttempt', 'runId',
    'schemaVersion', 'targetSha', 'workflow', 'workerName', 'wranglerVersion',
  ], 'release intent');
  assert.equal(value.schemaVersion, 'lupi-release-intent-v1', 'unsupported release-intent schema');
  assertRepositoryAndSha(value);
  assert.equal(value.actor, 'alexwelcing', 'release actor is not the owner');
  assert.equal(value.event, 'workflow_dispatch', 'release event must be workflow_dispatch');
  assert.equal(value.ref, 'refs/heads/main', 'release ref must be main');
  assertAttemptOne(value.runAttempt);
  assert.equal(value.boundedRollbackAuthorized, true, 'bounded rollback consent is missing');
  assert.equal(value.confirmationMode, 'deploy-with-bounded-rollback-v1', 'release confirmation mode is invalid');
  assertSha256(value.confirmationHash, 'release confirmation hash');
  for (const field of [
    'candidateContractSha256', 'expectedPostureSha256', 'packageSha256',
    'postUploadInventorySha256', 'preUploadInventorySha256',
    'priorBaselineSha256', 'priorContractSha256',
  ]) assertSha256(value[field], field);
  assertVersionId(value.priorVersionId, 'intent prior version ID');
  assertVersionId(value.candidateVersionId, 'intent candidate version ID');
  assert.notEqual(value.priorVersionId, value.candidateVersionId, 'prior and candidate version IDs must differ');
  assert.ok(Number.isInteger(value.priorEligibilityRank) && value.priorEligibilityRank >= 1 && value.priorEligibilityRank <= 100, 'intent prior eligibility rank is invalid');
  normalizeHttpsOrigin(value.candidatePreviewOrigin, 'candidate preview origin');
  assertIso(value.createdAt, 'release intent createdAt');
  for (const field of ['runId', 'workflow', 'workerName', 'wranglerVersion']) assertNonEmpty(value[field], `release intent ${field}`);
  return value;
}

export function validateRootOutcome(value) {
  assertPlainObject(value, 'root outcome');
  const schema = value.schemaVersion;
  assert.ok([
    'lupi-legacy-genesis-outcome-v1',
    'lupi-release-outcome-v1',
    'lupi-release-reanchor-outcome-v1',
  ].includes(schema), `unsupported root-outcome schema ${schema}`);
  const common = [
    'activeVersionId', 'apiReportSha256', 'baseline', 'bundleSha256',
    'completedAt', 'controlPlaneSha256', 'repository', 'rollbackContract',
    'rollbackUiReportSha256', 'schemaVersion', 'sourceManifest', 'targetSha',
  ];
  const variant = schema === 'lupi-release-outcome-v1'
    ? ['intentSha256', 'packageSha256']
    : schema === 'lupi-release-reanchor-outcome-v1'
      ? ['authorization', 'versionInventorySha256']
      : ['genesisRunId', 'versionInventorySha256'];
  assertExactKeys(value, [...common, ...variant], 'root outcome');
  assertRepositoryAndSha(value);
  assertVersionId(value.activeVersionId, 'root active version ID');
  assertIso(value.completedAt, 'root outcome completedAt');
  for (const field of ['apiReportSha256', 'controlPlaneSha256', 'rollbackUiReportSha256']) assertSha256(value[field], field);
  validateRollbackContract(value.rollbackContract);
  assertPlainObject(value.baseline, 'root baseline');
  assertPlainObject(value.sourceManifest, 'root sourceManifest');
  if (schema === 'lupi-release-outcome-v1') {
    assertSha256(value.intentSha256, 'root intent SHA-256');
    assertSha256(value.packageSha256, 'root package SHA-256');
  } else if (schema === 'lupi-release-reanchor-outcome-v1') {
    validateAuthorization(value.authorization, 'reanchor');
    assertSha256(value.versionInventorySha256, 'reanchor version inventory SHA-256');
  } else {
    assertNonEmpty(value.genesisRunId, 'genesis run ID');
    assertSha256(value.versionInventorySha256, 'genesis version inventory SHA-256');
  }
  const projected = { ...value, bundleSha256: undefined };
  assert.equal(value.bundleSha256, canonicalSha256(projected), 'root outcome bundle digest mismatch');
  return value;
}

export function validateResolution(value) {
  assertPlainObject(value, 'release resolution');
  assertExactKeys(value, [
    'afterStateSha256', 'apiReportSha256', 'authorization',
    'beforeStateSha256', 'commandResultSha256', 'completedAt',
    'controlPlaneReportSha256', 'incidentSha256', 'intentSha256',
    'priorContractSha256', 'repository', 'resolutionMode',
    'rollbackUiReportSha256', 'schemaVersion', 'sourceRunAttempt',
    'sourceRunId', 'targetSha',
  ], 'release resolution');
  assert.equal(value.schemaVersion, 'lupi-release-resolution-v1', 'unsupported resolution schema');
  assertRepositoryAndSha(value);
  assert.ok(['bounded-release-rollback-v1', 'owner-reconcile-rollback-v1', 'verified-noop-v1'].includes(value.resolutionMode), 'resolution mode is invalid');
  assertAttemptOne(value.sourceRunAttempt);
  assertNonEmpty(value.sourceRunId, 'resolution source run ID');
  for (const field of [
    'afterStateSha256', 'apiReportSha256', 'beforeStateSha256',
    'controlPlaneReportSha256', 'intentSha256', 'priorContractSha256',
    'rollbackUiReportSha256',
  ]) assertSha256(value[field], field);
  if (value.resolutionMode === 'verified-noop-v1') {
    assert.equal(value.commandResultSha256, null, 'no-op resolution cannot have a command result');
  } else {
    assertSha256(value.commandResultSha256, 'resolution command result SHA-256');
  }
  if (value.resolutionMode === 'owner-reconcile-rollback-v1') assertSha256(value.incidentSha256, 'resolution incident SHA-256');
  else assert.equal(value.incidentSha256, null, 'incident linkage is legal only for independent recovery');
  validateAuthorization(value.authorization, value.resolutionMode === 'owner-reconcile-rollback-v1' ? 'rollback' : 'release');
  assertIso(value.completedAt, 'resolution completedAt');
  return value;
}

export function validateRollbackIncident(value) {
  assertPlainObject(value, 'rollback-required incident');
  assertExactKeys(value, [
    'candidateVersionId', 'createdAt', 'intentSha256', 'observedActiveVersionId',
    'priorVersionId', 'reconciliationRunAttempt', 'reconciliationRunId',
    'repository', 'schemaVersion', 'sourceRunAttempt', 'sourceRunId', 'targetSha',
  ], 'rollback-required incident');
  assert.equal(value.schemaVersion, 'lupi-rollback-required-v1', 'unsupported rollback-required schema');
  assertRepositoryAndSha(value);
  assertNonEmpty(value.sourceRunId, 'incident source run ID');
  assertAttemptOne(value.sourceRunAttempt);
  assertNonEmpty(value.reconciliationRunId, 'incident reconciliation run ID');
  assertAttemptOne(value.reconciliationRunAttempt);
  assertSha256(value.intentSha256, 'incident intent SHA-256');
  assertVersionId(value.priorVersionId, 'incident prior version ID');
  assertVersionId(value.candidateVersionId, 'incident candidate version ID');
  assertVersionId(value.observedActiveVersionId, 'incident observed active version ID');
  assert.equal(value.observedActiveVersionId, value.candidateVersionId, 'rollback incident is not observing the bound candidate');
  assert.notEqual(value.priorVersionId, value.candidateVersionId, 'incident prior and candidate versions must differ');
  assertIso(value.createdAt, 'incident createdAt');
  return value;
}

export function bindRollbackIncident(value, expected) {
  validateRollbackIncident(value);
  assertPlainObject(expected, 'rollback incident binding');
  for (const field of [
    'sourceRunId', 'sourceRunAttempt', 'reconciliationRunId', 'intentSha256',
    'priorVersionId', 'observedActiveVersionId',
  ]) {
    assert.equal(String(value[field]), String(expected[field]), `rollback incident ${field} does not match authorization`);
  }
  return value;
}

export function validateCheckpoint(value, { now = new Date(), minimumRemainingDays = 7 } = {}) {
  assertPlainObject(value, 'release checkpoint');
  assertExactKeys(value, [
    'activeRollbackBundle', 'activeRollbackBundleSha256', 'activeVersionId',
    'createdAt', 'expiresAt', 'lastTrustedRelease', 'parentSha256',
    'repository', 'runAttempt', 'runId', 'schemaVersion', 'targetSha',
  ], 'release checkpoint');
  assert.equal(value.schemaVersion, 'lupi-release-checkpoint-v1', 'unsupported checkpoint schema');
  assertRepositoryAndSha(value);
  assertAttemptOne(value.runAttempt);
  assertNonEmpty(value.runId, 'checkpoint run ID');
  assertVersionId(value.activeVersionId, 'checkpoint active version ID');
  assertIso(value.createdAt, 'checkpoint createdAt');
  assertIso(value.expiresAt, 'checkpoint expiresAt');
  assertSha256(value.parentSha256, 'checkpoint parent SHA-256');
  assertPlainObject(value.lastTrustedRelease, 'checkpoint lastTrustedRelease');
  validateRootOutcome(value.activeRollbackBundle);
  assert.equal(value.activeRollbackBundle.activeVersionId, value.activeVersionId, 'checkpoint active version does not match embedded bundle');
  assert.equal(value.activeRollbackBundleSha256, canonicalSha256(value.activeRollbackBundle), 'checkpoint embedded bundle digest mismatch');
  const current = now instanceof Date ? now : new Date(now);
  const created = new Date(value.createdAt);
  const expires = new Date(value.expiresAt);
  assert.ok(current.valueOf() - created.valueOf() <= 30 * 24 * 60 * 60 * 1000, 'checkpoint is older than 30 days');
  assert.ok(expires.valueOf() - current.valueOf() >= minimumRemainingDays * 24 * 60 * 60 * 1000, 'checkpoint expires too soon');
  return value;
}

export function decideReconciliation({ active, intent, outcome = null, resolution = null }) {
  const state = validateSingleActiveDeployment(active);
  validateReleaseIntent(intent);
  if (outcome) validateRootOutcome(outcome);
  if (resolution) validateResolution(resolution);
  if (resolution) {
    assert.equal(String(resolution.sourceRunId), String(intent.runId), 'resolution source run does not match intent');
    assert.equal(Number(resolution.sourceRunAttempt), Number(intent.runAttempt), 'resolution source attempt does not match intent');
    assert.equal(resolution.targetSha, intent.targetSha, 'resolution target does not match intent');
    assert.equal(resolution.priorContractSha256, intent.priorContractSha256, 'resolution prior contract does not match intent');
    assert.equal(state.versionId, intent.priorVersionId, 'resolved rollback requires the prior version to be active');
    return { decision: 'already-resolved', mutate: false, activeVersionId: state.versionId };
  }
  if (outcome) {
    assert.equal(outcome.activeVersionId, intent.candidateVersionId, 'outcome does not close the intent candidate');
    assert.equal(state.versionId, intent.candidateVersionId, 'trusted outcome exists but active state differs');
    return { decision: 'trusted-candidate-active', mutate: false, activeVersionId: state.versionId };
  }
  if (state.versionId === intent.priorVersionId) return { decision: 'prior-already-active-noop', mutate: false, activeVersionId: state.versionId };
  if (state.versionId === intent.candidateVersionId) return { decision: 'rollback-required', mutate: false, activeVersionId: state.versionId, priorVersionId: intent.priorVersionId };
  throw new Error(`third active version ${state.versionId}; no automatic decision is safe`);
}

export function validateAuthorization(value, expectedMode) {
  assertPlainObject(value, 'authorization');
  assertExactKeys(value, [
    'actor', 'confirmationHash', 'confirmationMode', 'currentMainProofSha256',
    'event', 'ref', 'runAttempt', 'runId', 'targetSha', 'workflow',
    'workflowSha256',
  ], 'authorization');
  assert.equal(value.actor, 'alexwelcing', 'authorization actor is not the owner');
  assert.equal(value.event, 'workflow_dispatch', 'authorization must be workflow_dispatch');
  assert.equal(value.ref, 'refs/heads/main', 'authorization ref must be main');
  assertAttemptOne(value.runAttempt);
  assert.match(value.targetSha ?? '', SHA40, 'authorization target SHA is invalid');
  assertSha256(value.confirmationHash, 'authorization confirmation hash');
  assertSha256(value.currentMainProofSha256, 'authorization current-main proof SHA-256');
  assertSha256(value.workflowSha256, 'authorization workflow SHA-256');
  assertNonEmpty(value.runId, 'authorization run ID');
  assertNonEmpty(value.workflow, 'authorization workflow');
  const allowed = {
    release: 'deploy-with-bounded-rollback-v1',
    rollback: 'owner-reconcile-rollback-v1',
    reanchor: 'owner-reanchor-v1',
    refresh: 'owner-refresh-checkpoint-v1',
  };
  assert.equal(value.confirmationMode, allowed[expectedMode], `authorization confirmation mode is not ${expectedMode}`);
  return value;
}

export function canonicalSha256(value) {
  return createHash('sha256').update(JSON.stringify(sortValue(value))).digest('hex');
}

function validateDataFile(value) {
  assertPlainObject(value, 'release package file');
  assertExactKeys(value, ['mode', 'path', 'sha256', 'size'], 'release package file');
  assertSafeRelativePath(value.path, 'release package file path');
  assertSha256(value.sha256, 'release package file SHA-256');
  assert.ok(Number.isSafeInteger(value.size) && value.size >= 0, 'release package file size is invalid');
  assert.match(String(value.mode), /^[0-7]{3,4}$/, 'release package file mode is invalid');
  return value;
}

function validateFileHashes(value, name) {
  assert.ok(Array.isArray(value) && value.length > 0, `${name} must be non-empty`);
  for (const file of value) {
    assertPlainObject(file, name);
    assertExactKeys(file, ['path', 'sha256'], name);
    assertSafeRelativePath(file.path, `${name} path`);
    assertSha256(file.sha256, `${name} SHA-256`);
  }
  assert.equal(new Set(value.map((file) => file.path)).size, value.length, `${name} paths must be unique`);
}

function assertRepositoryAndSha(value) {
  assert.equal(value.repository, REPOSITORY, `repository must be ${REPOSITORY}`);
  assert.match(value.targetSha ?? '', SHA40, 'targetSha must be a full Git SHA');
}

function assertAttemptOne(value) {
  assert.equal(Number(value), 1, 'runAttempt must be exactly 1');
}

function assertVersionId(value, name) {
  assert.match(value ?? '', VERSION_ID, `${name} is invalid`);
}

function assertSha256(value, name) {
  assert.match(value ?? '', SHA256, `${name} is invalid`);
}

function assertIso(value, name) {
  assert.match(value ?? '', ISO_DATE, `${name} is invalid`);
  assert.ok(Number.isFinite(Date.parse(value)), `${name} is invalid`);
}

function assertNonEmpty(value, name) {
  assert.ok(isNonEmptyString(value), `${name} is required`);
}

function assertSafeRelativePath(value, name) {
  assert.ok(isNonEmptyString(value), `${name} is required`);
  assert.ok(!value.startsWith('/') && !value.startsWith('\\') && !/^[A-Za-z]:/.test(value), `${name} must be relative`);
  assert.ok(!value.split(/[\\/]/).includes('..'), `${name} must not escape the package`);
  assert.ok(!value.includes('\0'), `${name} contains NUL`);
}

function normalizeHttpsOrigin(value, name) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', `${name} must use HTTPS`);
  assert.equal(url.username, '', `${name} must not contain credentials`);
  assert.equal(url.password, '', `${name} must not contain credentials`);
  assert.ok(url.pathname === '/' || url.pathname === '', `${name} must be an origin`);
  assert.equal(url.search, '', `${name} must not contain a query`);
  assert.equal(url.hash, '', `${name} must not contain a fragment`);
  url.pathname = '/';
  return url;
}

function assertExactKeys(value, expected, name) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${name} contains missing or extra fields`);
}

function assertPlainObject(value, name) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  try {
    const [command, file] = process.argv.slice(2);
    assertNonEmpty(command, 'command');
    assertNonEmpty(file, 'JSON/NDJSON path');
    const text = await readFile(file, 'utf8');
    let result;
    if (command === 'parse-ndjson') result = parseWranglerNdjson(text);
    else if (command === 'validate-intent') result = validateReleaseIntent(JSON.parse(text));
    else if (command === 'validate-checkpoint') result = validateCheckpoint(JSON.parse(text));
    else throw new Error(`unsupported command ${command}`);
    console.log(JSON.stringify({ ok: true, result }, null, 2));
  } catch (error) {
    console.error(`cloudflare-release-receipt: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
