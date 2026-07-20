import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bindRollbackIncident,
  canonicalSha256,
  collectCloudflareVersionIds,
  decideReconciliation,
  extractVersionUpload,
  parseCloudflareDeploymentsEnvelope,
  parseCloudflareVersionsEnvelope,
  parseWranglerNdjson,
  validateCheckpoint,
  validateReleaseIntent,
  validateReleasePackage,
  validateResolution,
  validateRollbackIncident,
  validateRollbackContract,
  validateRootOutcome,
  validateSingleActiveDeployment,
  validateVersionInventory,
} from './cloudflare-release-receipt.mjs';

const TARGET_SHA = '0123456789abcdef0123456789abcdef01234567';
const HASH = 'a'.repeat(64);
const PRIOR = 'prior-version-001';
const CANDIDATE = 'candidate-version-002';

test('Wrangler NDJSON parser and version upload extraction are structured and unique', () => {
  const records = parseWranglerNdjson([
    JSON.stringify({ type: 'wrangler-start', command: 'versions upload' }),
    JSON.stringify({ type: 'version-upload', version_id: CANDIDATE, preview_url: 'https://candidate.example.workers.dev', tag: TARGET_SHA }),
    '',
  ].join('\n'));
  assert.equal(records.length, 2);
  assert.deepEqual(extractVersionUpload(records, { expectedTag: TARGET_SHA }), {
    versionId: CANDIDATE,
    previewOrigin: 'https://candidate.example.workers.dev',
    tag: TARGET_SHA,
  });
  assert.throws(() => parseWranglerNdjson('{broken'), /line 1/);
  assert.throws(() => extractVersionUpload([...records, records[1]]), /expected one/);
});

test('active deployment must be one version at exactly 100 percent', () => {
  assert.deepEqual(validateSingleActiveDeployment({ versions: [{ id: PRIOR, percentage: 100 }] }), {
    versionId: PRIOR,
    percentage: 100,
    tag: null,
  });
  assert.throws(() => validateSingleActiveDeployment({ versions: [
    { id: PRIOR, percentage: 50 },
    { id: CANDIDATE, percentage: 50 },
  ] }), /expected one active version/);
  assert.throws(() => validateSingleActiveDeployment({ versions: [{ id: PRIOR, percentage: 99 }] }), /100%/);
});

test('Cloudflare API envelopes use result.deployments and result.items exactly', async () => {
  const deployment = { versions: [{ version_id: PRIOR, percentage: 100 }] };
  assert.deepEqual(
    parseCloudflareDeploymentsEnvelope({ success: true, result: { deployments: [deployment] } }),
    [deployment],
  );
  assert.deepEqual(
    parseCloudflareVersionsEnvelope({ success: true, result: { items: [{ id: PRIOR }] } }),
    [{ id: PRIOR }],
  );
  for (const malformed of [
    { success: true, result: [deployment] },
    { success: true, result: { versions: [deployment] } },
    { success: false, result: { deployments: [deployment] } },
  ]) assert.throws(() => parseCloudflareDeploymentsEnvelope(malformed), /deployments|successful/);
  assert.throws(
    () => parseCloudflareVersionsEnvelope({ success: true, result: [{ id: PRIOR }] }),
    /versions result/,
  );

  const calls = [];
  const ids = await collectCloudflareVersionIds(async (page, perPage) => {
    calls.push([page, perPage]);
    const items = page === 1
      ? Array.from({ length: 100 }, (_, index) => ({ id: `version-${String(index + 1).padStart(3, '0')}` }))
      : [{ id: 'version-101' }];
    return { success: true, result: { items } };
  });
  assert.equal(ids.length, 101);
  assert.deepEqual(calls, [[1, 100], [2, 100]]);
  await assert.rejects(
    collectCloudflareVersionIds(async () => ({ success: true, result: { items: [{ id: PRIOR }, { id: PRIOR }] } }), { perPage: 3 }),
    /duplicate/,
  );
  await assert.rejects(
    collectCloudflareVersionIds(
      async () => ({ success: true, result: { items: [{ id: PRIOR }] } }),
      { perPage: 1, maxPages: 1 },
    ),
    /exceeded 1 pages/,
  );
});

test('rollback eligibility uses the conservative rank 99 pre-upload and rank 100 thereafter', () => {
  const rank99 = inventoryWithPriorAt(99);
  assert.equal(validateVersionInventory(rank99, { priorVersionId: PRIOR, phase: 'pre-upload' }).priorRank, 99);
  const rank100 = inventoryWithPriorAt(100);
  assert.throws(() => validateVersionInventory(rank100, { priorVersionId: PRIOR, phase: 'pre-upload' }), /exceeds 99/);
  assert.equal(validateVersionInventory(rank100, { priorVersionId: PRIOR, phase: 'post-upload' }).priorRank, 100);
  assert.equal(validateVersionInventory(rank100, { priorVersionId: PRIOR, phase: 'pre-promotion' }).priorRank, 100);
  assert.equal(validateVersionInventory(rank100, { priorVersionId: PRIOR, phase: 'pre-rollback' }).priorRank, 100);
  assert.throws(() => validateVersionInventory(inventoryWithPriorAt(101), { priorVersionId: PRIOR, phase: 'pre-rollback' }), /exceeds 100/);
  assert.throws(() => validateVersionInventory({ ...rank99, complete: false }, { priorVersionId: PRIOR, phase: 'pre-upload' }), /incomplete/);
});

test('release package is data-only, path-safe, and digest-bound', () => {
  const value = releasePackage();
  assert.equal(validateReleasePackage(value), value);
  const traversal = releasePackage();
  traversal.files[0].path = '../escape.mjs';
  traversal.packageSha256 = packageDigest(traversal);
  assert.throws(() => validateReleasePackage(traversal), /must not escape/);
  const tampered = releasePackage();
  tampered.files[0].sha256 = 'b'.repeat(64);
  assert.throws(() => validateReleasePackage(tampered), /digest mismatch/);
});

test('rollback contracts accept only closed modes and reject free-form command fields', () => {
  const value = rollbackContract();
  assert.equal(validateRollbackContract(value), value);
  assert.throws(() => validateRollbackContract({ ...rollbackContract(), commandMode: 'run-whatever' }), /not closed/);
  assert.throws(() => validateRollbackContract({ ...rollbackContract(), command: 'curl | sh' }), /missing or extra fields/);
  assert.throws(() => validateRollbackContract({ ...rollbackContract(), preMutationReport: { result: 'fail', sha256: HASH } }), /did not pass/);
});

test('release intent binds single owner, exact attempt, confirmation, package, contracts, and eligibility', () => {
  const value = releaseIntent();
  assert.equal(validateReleaseIntent(value), value);
  assert.throws(() => validateReleaseIntent({ ...value, actor: 'someone-else' }), /not the owner/);
  assert.throws(() => validateReleaseIntent({ ...value, runAttempt: 2 }), /exactly 1/);
  assert.throws(() => validateReleaseIntent({ ...value, boundedRollbackAuthorized: false }), /consent is missing/);
  assert.throws(() => validateReleaseIntent({ ...value, priorEligibilityRank: 101 }), /rank is invalid/);
  assert.throws(() => validateReleaseIntent({ ...value, candidateVersionId: PRIOR }), /must differ/);
});

test('normal, genesis, and re-anchor roots are mutually schema-bound and hash complete bundles', () => {
  const normal = rootOutcome('lupi-release-outcome-v1');
  assert.equal(validateRootOutcome(normal), normal);
  const genesis = rootOutcome('lupi-legacy-genesis-outcome-v1');
  assert.equal(validateRootOutcome(genesis), genesis);
  const reanchor = rootOutcome('lupi-release-reanchor-outcome-v1');
  assert.equal(validateRootOutcome(reanchor), reanchor);
  assert.throws(() => validateRootOutcome({ ...normal, bundleSha256: HASH }), /bundle digest mismatch/);
  const wrongAuth = rootOutcome('lupi-release-reanchor-outcome-v1');
  wrongAuth.authorization = authorization('rollback');
  wrongAuth.bundleSha256 = rootDigest(wrongAuth);
  assert.throws(() => validateRootOutcome(wrongAuth), /not reanchor/);
});

test('self-contained checkpoint validates embedded root, digest, age, and remaining retention', () => {
  const now = new Date('2026-07-19T20:00:00.000Z');
  const checkpoint = checkpointFixture();
  assert.equal(validateCheckpoint(checkpoint, { now }), checkpoint);
  assert.throws(() => validateCheckpoint({ ...checkpoint, activeRollbackBundleSha256: HASH }, { now }), /embedded bundle digest mismatch/);
  assert.throws(() => validateCheckpoint({ ...checkpoint, createdAt: '2026-06-01T00:00:00.000Z' }, { now }), /older than 30 days/);
  assert.throws(() => validateCheckpoint({ ...checkpoint, expiresAt: '2026-07-24T00:00:00.000Z' }, { now }), /expires too soon/);
});

test('independent resolution requires incident-bound owner authorization; no-op has no command', () => {
  const rollback = resolutionFixture('owner-reconcile-rollback-v1');
  assert.equal(validateResolution(rollback), rollback);
  assert.throws(() => validateResolution({ ...rollback, incidentSha256: null }), /incident SHA-256/);
  const noOp = resolutionFixture('verified-noop-v1');
  assert.equal(validateResolution(noOp), noOp);
  assert.throws(() => validateResolution({ ...noOp, commandResultSha256: HASH }), /cannot have a command/);
});

test('rollback incidents bind failed run, intent, rollback target, and observed candidate', () => {
  const incident = rollbackIncidentFixture();
  assert.equal(validateRollbackIncident(incident), incident);
  assert.equal(bindRollbackIncident(incident, {
    sourceRunId: incident.sourceRunId,
    sourceRunAttempt: incident.sourceRunAttempt,
    reconciliationRunId: incident.reconciliationRunId,
    intentSha256: incident.intentSha256,
    priorVersionId: incident.priorVersionId,
    observedActiveVersionId: incident.observedActiveVersionId,
  }), incident);
  for (const [field, value] of [
    ['sourceRunId', '999'],
    ['intentSha256', 'b'.repeat(64)],
    ['priorVersionId', 'other-prior-999'],
    ['observedActiveVersionId', 'other-candidate-999'],
  ]) {
    assert.throws(() => bindRollbackIncident(incident, {
      sourceRunId: incident.sourceRunId,
      sourceRunAttempt: incident.sourceRunAttempt,
      reconciliationRunId: incident.reconciliationRunId,
      intentSha256: incident.intentSha256,
      priorVersionId: incident.priorVersionId,
      observedActiveVersionId: incident.observedActiveVersionId,
      [field]: value,
    }), new RegExp(field));
  }
  assert.throws(
    () => validateRollbackIncident({ ...incident, observedActiveVersionId: 'third-version-999' }),
    /not observing the bound candidate/,
  );
});

test('reconciliation is read-only: trusted, no-op, rollback-required, or hard stop', () => {
  const intent = releaseIntent();
  assert.equal(decideReconciliation({ active: active(PRIOR), intent }).decision, 'prior-already-active-noop');
  assert.equal(decideReconciliation({ active: active(CANDIDATE), intent }).decision, 'rollback-required');
  assert.equal(decideReconciliation({ active: active(CANDIDATE), intent, outcome: rootOutcome('lupi-release-outcome-v1') }).decision, 'trusted-candidate-active');
  assert.equal(decideReconciliation({ active: active(PRIOR), intent, resolution: resolutionFixture('verified-noop-v1') }).decision, 'already-resolved');
  assert.throws(
    () => decideReconciliation({ active: active(CANDIDATE), intent, resolution: resolutionFixture('bounded-release-rollback-v1') }),
    /requires the prior version to be active/,
  );
  assert.throws(
    () => decideReconciliation({
      active: active(PRIOR),
      intent,
      resolution: { ...resolutionFixture('bounded-release-rollback-v1'), sourceRunId: '999' },
    }),
    /source run does not match intent/,
  );
  assert.throws(() => decideReconciliation({ active: active('third-version-999'), intent }), /third active version/);
  assert.throws(() => decideReconciliation({ active: { versions: [
    { id: PRIOR, percentage: 50 },
    { id: CANDIDATE, percentage: 50 },
  ] }, intent }), /expected one active version/);
});

function inventoryWithPriorAt(rank) {
  const ids = Array.from({ length: rank }, (_, index) => `version-${String(index + 1).padStart(3, '0')}`);
  ids[rank - 1] = PRIOR;
  return {
    schemaVersion: 'lupi-version-inventory-v1',
    fetchedAt: '2026-07-19T20:00:00.000Z',
    complete: true,
    versionIds: ids,
  };
}

function releasePackage() {
  const value = {
    schemaVersion: 'lupi-release-package-v1',
    repository: 'alexwelcing/Lupi',
    targetSha: TARGET_SHA,
    workflow: 'deploy-cloudflare.yml',
    runId: '44',
    runAttempt: 1,
    createdAt: '2026-07-19T20:00:00.000Z',
    toolchain: { node: '24.4.1', pnpm: '10.13.1', wrangler: '4.110.0' },
    lockSha256: HASH,
    sourceManifestSha256: HASH,
    buildSha256: HASH,
    configSha256: HASH,
    uploadConfigSha256: HASH,
    bindingProjection: { WEB_ASSETS: true, ASSETS: true },
    assetManifest: [{ path: 'assets/index.js', sha256: HASH }],
    files: [{ path: 'worker/index.mjs', size: 42, mode: '0644', sha256: HASH }],
    wranglerIntegrity: 'sha512-fixed',
    packageSha256: '',
  };
  value.packageSha256 = packageDigest(value);
  return value;
}

function packageDigest(value) {
  return canonicalSha256({ ...value, packageSha256: undefined });
}

function rollbackContract() {
  return {
    schemaVersion: 'lupi-rollback-contract-v1',
    repository: 'alexwelcing/Lupi',
    targetSha: TARGET_SHA,
    workerVersionId: PRIOR,
    nodeVersion: '24.4.1',
    pnpmVersion: '10.13.1',
    lockSha256: HASH,
    sourceManifestSha256: HASH,
    configFiles: [{ path: 'playwright.config.ts', sha256: HASH }],
    testFiles: [{ path: 'tests/ui/lupi.spec.ts', sha256: HASH }],
    commandMode: 'full-ui-v1',
    environmentNames: ['UI_TEST_URL', 'UI_TEST_EXPECT_HEALTH'],
    expectedTestNames: ['public viewer smoke'],
    preMutationReport: { result: 'pass', sha256: HASH },
  };
}

function releaseIntent() {
  return {
    schemaVersion: 'lupi-release-intent-v1',
    repository: 'alexwelcing/Lupi',
    workflow: 'deploy-cloudflare.yml',
    event: 'workflow_dispatch',
    actor: 'alexwelcing',
    ref: 'refs/heads/main',
    runId: '44',
    runAttempt: 1,
    targetSha: TARGET_SHA,
    confirmationMode: 'deploy-with-bounded-rollback-v1',
    confirmationHash: HASH,
    boundedRollbackAuthorized: true,
    workerName: 'lupi-edge',
    priorVersionId: PRIOR,
    candidateVersionId: CANDIDATE,
    candidatePreviewOrigin: 'https://candidate.example.workers.dev',
    priorBaselineSha256: HASH,
    priorContractSha256: HASH,
    candidateContractSha256: HASH,
    packageSha256: HASH,
    preUploadInventorySha256: HASH,
    postUploadInventorySha256: HASH,
    priorEligibilityRank: 100,
    expectedPostureSha256: HASH,
    createdAt: '2026-07-19T20:00:00.000Z',
    wranglerVersion: '4.110.0',
  };
}

function rootOutcome(schemaVersion) {
  const value = {
    schemaVersion,
    repository: 'alexwelcing/Lupi',
    targetSha: TARGET_SHA,
    activeVersionId: schemaVersion === 'lupi-release-outcome-v1' ? CANDIDATE : PRIOR,
    completedAt: '2026-07-19T20:10:00.000Z',
    controlPlaneSha256: HASH,
    apiReportSha256: HASH,
    rollbackUiReportSha256: HASH,
    baseline: { schemaVersion: 'lupi-public-baseline-v1' },
    rollbackContract: rollbackContract(),
    sourceManifest: { sha256: HASH, files: [] },
    bundleSha256: '',
    ...(schemaVersion === 'lupi-release-outcome-v1' ? { intentSha256: HASH, packageSha256: HASH } : {}),
    ...(schemaVersion === 'lupi-legacy-genesis-outcome-v1' ? { genesisRunId: '44', versionInventorySha256: HASH } : {}),
    ...(schemaVersion === 'lupi-release-reanchor-outcome-v1' ? { authorization: authorization('reanchor'), versionInventorySha256: HASH } : {}),
  };
  value.bundleSha256 = rootDigest(value);
  return value;
}

function rootDigest(value) {
  return canonicalSha256({ ...value, bundleSha256: undefined });
}

function authorization(mode) {
  const names = {
    release: 'deploy-with-bounded-rollback-v1',
    rollback: 'owner-reconcile-rollback-v1',
    reanchor: 'owner-reanchor-v1',
    refresh: 'owner-refresh-checkpoint-v1',
  };
  return {
    workflow: 'reconcile-cloudflare-deploy.yml',
    workflowSha256: HASH,
    runId: '55',
    runAttempt: 1,
    targetSha: TARGET_SHA,
    ref: 'refs/heads/main',
    actor: 'alexwelcing',
    event: 'workflow_dispatch',
    confirmationMode: names[mode],
    confirmationHash: HASH,
    currentMainProofSha256: HASH,
  };
}

function checkpointFixture() {
  const bundle = rootOutcome('lupi-release-outcome-v1');
  return {
    schemaVersion: 'lupi-release-checkpoint-v1',
    repository: 'alexwelcing/Lupi',
    targetSha: TARGET_SHA,
    runId: '66',
    runAttempt: 1,
    createdAt: '2026-07-19T20:00:00.000Z',
    expiresAt: '2026-10-17T20:00:00.000Z',
    parentSha256: HASH,
    activeVersionId: CANDIDATE,
    lastTrustedRelease: { runId: '44', runAttempt: 1, createdAt: '2026-07-19T19:00:00.000Z' },
    activeRollbackBundle: bundle,
    activeRollbackBundleSha256: canonicalSha256(bundle),
  };
}

function resolutionFixture(mode) {
  const ownerRollback = mode === 'owner-reconcile-rollback-v1';
  return {
    schemaVersion: 'lupi-release-resolution-v1',
    repository: 'alexwelcing/Lupi',
    targetSha: TARGET_SHA,
    sourceRunId: '44',
    sourceRunAttempt: 1,
    resolutionMode: mode,
    intentSha256: HASH,
    incidentSha256: ownerRollback ? HASH : null,
    authorization: authorization(ownerRollback ? 'rollback' : 'release'),
    beforeStateSha256: HASH,
    commandResultSha256: mode === 'verified-noop-v1' ? null : HASH,
    afterStateSha256: HASH,
    priorContractSha256: HASH,
    controlPlaneReportSha256: HASH,
    apiReportSha256: HASH,
    rollbackUiReportSha256: HASH,
    completedAt: '2026-07-19T20:15:00.000Z',
  };
}

function rollbackIncidentFixture() {
  return {
    schemaVersion: 'lupi-rollback-required-v1',
    repository: 'alexwelcing/Lupi',
    targetSha: TARGET_SHA,
    sourceRunId: '44',
    sourceRunAttempt: 1,
    reconciliationRunId: '55',
    reconciliationRunAttempt: 1,
    intentSha256: HASH,
    priorVersionId: PRIOR,
    candidateVersionId: CANDIDATE,
    observedActiveVersionId: CANDIDATE,
    createdAt: '2026-07-19T20:12:00.000Z',
  };
}

function active(versionId) {
  return { versions: [{ id: versionId, percentage: 100 }] };
}
