import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  validateCloudflareProjection,
  validateReleaseAuthorityFreezeReceipt,
  verifyReleaseAuthorityFreeze,
} from './verify-release-authority-freeze.mjs';

const NOW = new Date('2026-07-19T20:00:00.000Z');
const BASE_SHA = 'a'.repeat(40);
const BRANCH_SHA = 'b'.repeat(40);
const TOKEN_IDENTIFIER = 'legacy-token-id-001';
const EVIDENCE_IDENTIFIER = 'cf-audit-20260719-001';
const WORKFLOW_ID = 123456;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function projectionFixture() {
  return {
    schemaVersion: 1,
    kind: 'lupi-cloudflare-token-authority-projection',
    observedAt: '2026-07-19T19:58:00.000Z',
    inventoryComplete: true,
    legacyToken: {
      identifier: TOKEN_IDENTIFIER,
      state: 'revoked',
      revokedAt: '2026-07-19T19:40:00.000Z',
      evidenceIdentifier: EVIDENCE_IDENTIFIER,
    },
  };
}

function receiptFixture(projectionBytes) {
  return {
    schemaVersion: 1,
    kind: 'lupi-release-authority-freeze',
    repository: {
      fullName: 'alexwelcing/Lupi',
      ownerType: 'User',
      frozenBaseSha: BASE_SHA,
      frozenBranchSha: BRANCH_SHA,
    },
    authorization: {
      approver: 'alexwelcing',
      authorizedAt: '2026-07-19T19:30:00.000Z',
      observedAt: '2026-07-19T19:59:00.000Z',
    },
    github: {
      workflow: {
        id: WORKFLOW_ID,
        path: '.github/workflows/deploy-cloudflare.yml',
        state: 'disabled_manually',
        observedAt: '2026-07-19T19:58:30.000Z',
      },
      secretInventories: {
        repository: {
          applicable: true,
          names: ['OTHER_SECRET'],
          observedAt: '2026-07-19T19:58:30.000Z',
        },
        environments: [
          {
            name: 'prod',
            applicable: true,
            names: ['RENDERER_ENDPOINT'],
            observedAt: '2026-07-19T19:58:30.000Z',
          },
        ],
        organization: {
          applicable: false,
          ownerType: 'User',
          reason: 'repository-owner-is-user',
          names: [],
          observedAt: '2026-07-19T19:58:30.000Z',
        },
      },
    },
    cloudflare: {
      legacyToken: {
        identifier: TOKEN_IDENTIFIER,
        state: 'revoked',
        revokedAt: '2026-07-19T19:40:00.000Z',
        evidenceIdentifier: EVIDENCE_IDENTIFIER,
      },
      projection: {
        sha256: sha256(projectionBytes),
        observedAt: '2026-07-19T19:58:00.000Z',
      },
    },
    interlock: {
      legacySecretName: 'CLOUDFLARE_API_TOKEN',
      keepDisabledThroughPlan023Merge: true,
      sourceMergeGrantsV2WriteAuthority: false,
      statement: 'Source merge is not permission to add or enable v2 write authority.',
    },
  };
}

function fixtureData() {
  const projection = projectionFixture();
  const projectionText = `${JSON.stringify(projection, null, 2)}\n`;
  const receipt = receiptFixture(Buffer.from(projectionText));
  return { projection, projectionText, receipt };
}

function createFiles(t, transform = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lupi-freeze-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = fixtureData();
  transform?.(data);
  data.projectionText = `${JSON.stringify(data.projection, null, 2)}\n`;
  data.receipt.cloudflare.projection.sha256 = sha256(Buffer.from(data.projectionText));
  data.receipt.cloudflare.projection.observedAt = data.projection.observedAt;
  const receiptPath = path.join(root, 'receipt.json');
  const projectionPath = path.join(root, 'projection.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(data.receipt, null, 2)}\n`);
  fs.writeFileSync(projectionPath, data.projectionText);
  return { ...data, receiptPath, projectionPath };
}

function expectValidationError(run, code) {
  assert.throws(run, (error) => error?.code === code, `expected ${code}`);
}

function page(items, url) {
  const pageNumber = Number(url.searchParams.get('page') ?? '1');
  const start = (pageNumber - 1) * 100;
  return items.slice(start, start + 100);
}

function githubFixture(options = {}) {
  const calls = [];
  const repositorySecrets = options.repositorySecrets ?? ['OTHER_SECRET'];
  const environments = options.environments ?? {
    prod: ['RENDERER_ENDPOINT'],
  };

  const githubApi = async (endpoint) => {
    calls.push(endpoint);
    const url = new URL(endpoint, 'https://api.github.test/');
    const pathname = decodeURIComponent(url.pathname.slice(1));

    if (pathname === 'repos/alexwelcing/Lupi') {
      return options.repositoryResponse ?? {
        full_name: 'alexwelcing/Lupi',
        owner: { type: options.ownerType ?? 'User' },
      };
    }
    if (pathname === `repos/alexwelcing/Lupi/actions/workflows/${WORKFLOW_ID}`) {
      return options.workflowResponse ?? {
        id: WORKFLOW_ID,
        path: '.github/workflows/deploy-cloudflare.yml',
        state: 'disabled_manually',
      };
    }
    if (pathname === 'repos/alexwelcing/Lupi/actions/secrets') {
      if (options.repositorySecretsResponse) return options.repositorySecretsResponse(url);
      return {
        total_count: repositorySecrets.length,
        secrets: page(repositorySecrets, url).map((name) => ({ name })),
      };
    }
    if (pathname === 'repos/alexwelcing/Lupi/environments') {
      const names = Object.keys(environments);
      return {
        total_count: names.length,
        environments: page(names, url).map((name) => ({ name })),
      };
    }
    const environmentMatch = pathname.match(
      /^repos\/alexwelcing\/Lupi\/environments\/(.+)\/secrets$/u,
    );
    if (environmentMatch) {
      const names = environments[environmentMatch[1]];
      if (!Array.isArray(names)) throw new Error('unexpected environment');
      return {
        total_count: names.length,
        secrets: page(names, url).map((name) => ({ name })),
      };
    }
    throw new Error('unexpected GitHub endpoint');
  };

  return { calls, githubApi };
}

test('valid local receipt passes without a GitHub runner', async (t) => {
  const fixture = createFiles(t);
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    now: NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(result.mode, 'local');
});

test('valid live receipt checks GitHub and Cloudflare projections without network', async (t) => {
  const fixture = createFiles(t);
  const github = githubFixture();
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'alexwelcing/Lupi',
    cloudflareProjectionPath: fixture.projectionPath,
    githubApi: github.githubApi,
    now: NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.equal(github.calls.length, 5);
  assert.ok(github.calls.every((endpoint) => endpoint.startsWith('repos/')));
});

for (const [label, mutate, code] of [
  ['schema version', (value) => { value.schemaVersion = 2; }, 'wrong-schema-version'],
  ['missing repository', (value) => { delete value.repository; }, 'missing-field'],
  ['owner type', (value) => { value.repository.ownerType = 'Organization'; }, 'wrong-enum'],
  ['workflow path', (value) => { value.github.workflow.path = '.github/workflows/other.yml'; }, 'wrong-enum'],
  ['workflow state', (value) => { value.github.workflow.state = 'active'; }, 'wrong-enum'],
  ['token state', (value) => { value.cloudflare.legacyToken.state = 'active'; }, 'wrong-enum'],
  ['interlock', (value) => { value.interlock.keepDisabledThroughPlan023Merge = false; }, 'wrong-boolean'],
  ['v2 authority', (value) => { value.interlock.sourceMergeGrantsV2WriteAuthority = true; }, 'wrong-boolean'],
]) {
  test(`invalid receipt rejects wrong ${label}`, () => {
    const { receipt } = fixtureData();
    mutate(receipt);
    expectValidationError(
      () => validateReleaseAuthorityFreezeReceipt(receipt, { now: NOW }),
      code,
    );
  });
}

test('receipt rejects future and internally stale observations', () => {
  const future = fixtureData().receipt;
  future.authorization.observedAt = '2026-07-19T20:10:00.000Z';
  expectValidationError(
    () => validateReleaseAuthorityFreezeReceipt(future, { now: NOW }),
    'future-timestamp',
  );

  const stale = fixtureData().receipt;
  stale.github.workflow.observedAt = '2026-07-19T18:00:00.000Z';
  expectValidationError(
    () => validateReleaseAuthorityFreezeReceipt(stale, { now: NOW }),
    'stale-receipt-observation',
  );
});

test('receipt rejects calendar-normalized timestamps', () => {
  const invalid = fixtureData().receipt;
  invalid.authorization.authorizedAt = '2026-02-30T19:30:00.000Z';
  expectValidationError(
    () => validateReleaseAuthorityFreezeReceipt(invalid, { now: NOW }),
    'invalid-timestamp',
  );
});

for (const [scope, mutate] of [
  ['repository', (value) => value.github.secretInventories.repository.names.push('CLOUDFLARE_API_TOKEN')],
  ['environment', (value) => value.github.secretInventories.environments[0].names.push('CLOUDFLARE_API_TOKEN')],
  ['organization', (value) => value.github.secretInventories.organization.names.push('CLOUDFLARE_API_TOKEN')],
]) {
  test(`legacy secret name at ${scope} scope is rejected`, () => {
    const { receipt } = fixtureData();
    mutate(receipt);
    expectValidationError(
      () => validateReleaseAuthorityFreezeReceipt(receipt, { now: NOW }),
      'legacy-secret-present',
    );
  });
}

test('organization scope must be inapplicable for a user-owned repository', () => {
  const { receipt } = fixtureData();
  receipt.github.secretInventories.organization.applicable = true;
  expectValidationError(
    () => validateReleaseAuthorityFreezeReceipt(receipt, { now: NOW }),
    'wrong-boolean',
  );
});

test('unknown and secret-value-like fields fail closed', () => {
  const unknown = fixtureData().receipt;
  unknown.github.workflow.extra = true;
  expectValidationError(
    () => validateReleaseAuthorityFreezeReceipt(unknown, { now: NOW }),
    'unknown-field',
  );

  const sensitive = fixtureData().receipt;
  sensitive.cloudflare.legacyToken.tokenValue = 'never-log-this-marker';
  expectValidationError(
    () => validateReleaseAuthorityFreezeReceipt(sensitive, { now: NOW }),
    'forbidden-sensitive-field',
  );
});

test('credential-like text is rejected even in an otherwise allowed field', () => {
  const { receipt } = fixtureData();
  receipt.cloudflare.legacyToken.identifier = [
    'ghp',
    'abcdefghijklmnopqrstuvwxyz012345',
  ].join('_');
  expectValidationError(
    () => validateReleaseAuthorityFreezeReceipt(receipt, { now: NOW }),
    'credential-like-text',
  );
});

test('live mode requires exact repository and Cloudflare projection arguments', async (t) => {
  const fixture = createFiles(t);
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'someone/else',
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.at(-1).id, 'live-arguments');
});

test('Cloudflare projection must be fresh and not in the future', () => {
  const stale = projectionFixture();
  stale.observedAt = '2026-07-19T19:00:00.000Z';
  expectValidationError(
    () => validateCloudflareProjection(stale, { now: NOW }),
    'stale-projection',
  );

  const future = projectionFixture();
  future.observedAt = '2026-07-19T20:10:00.000Z';
  expectValidationError(
    () => validateCloudflareProjection(future, { now: NOW }),
    'future-timestamp',
  );
});

test('Cloudflare projection rejects incomplete inventory and non-retired token state', () => {
  const incomplete = projectionFixture();
  incomplete.inventoryComplete = false;
  expectValidationError(
    () => validateCloudflareProjection(incomplete, { now: NOW }),
    'wrong-boolean',
  );

  const active = projectionFixture();
  active.legacyToken.state = 'active';
  expectValidationError(
    () => validateCloudflareProjection(active, { now: NOW }),
    'wrong-enum',
  );
});

for (const [label, transform, failureCode] of [
  ['token identifier', (data) => { data.projection.legacyToken.identifier = 'different-token-id'; }, 'cloudflare-token-id-mismatch'],
  ['evidence identifier', (data) => { data.projection.legacyToken.evidenceIdentifier = 'different-evidence-id'; }, 'cloudflare-evidence-id-mismatch'],
  ['revocation time', (data) => { data.projection.legacyToken.revokedAt = '2026-07-19T19:41:00.000Z'; }, 'cloudflare-revocation-time-mismatch'],
]) {
  test(`live projection rejects wrong ${label}`, async (t) => {
    const fixture = createFiles(t, transform);
    const result = await verifyReleaseAuthorityFreeze({
      receiptPath: fixture.receiptPath,
      liveGithub: true,
      repo: 'alexwelcing/Lupi',
      cloudflareProjectionPath: fixture.projectionPath,
      githubApi: githubFixture().githubApi,
      now: NOW,
    });
    assert.equal(result.ok, false);
    assert.match(result.checks.at(-1).detail, new RegExp(failureCode, 'u'));
  });
}

test('projection hash binds the exact file bytes', async (t) => {
  const fixture = createFiles(t);
  fs.appendFileSync(fixture.projectionPath, ' ');
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'alexwelcing/Lupi',
    cloudflareProjectionPath: fixture.projectionPath,
    githubApi: githubFixture().githubApi,
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.match(result.checks.at(-1).detail, /cloudflare-projection-hash-mismatch/u);
});

test('complete absent-token projection is accepted as current retirement proof', async (t) => {
  const fixture = createFiles(t, (data) => {
    data.projection.legacyToken.state = 'absent';
    data.projection.legacyToken.revokedAt = null;
  });
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'alexwelcing/Lupi',
    cloudflareProjectionPath: fixture.projectionPath,
    githubApi: githubFixture().githubApi,
    now: NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
});

test('live GitHub verification rejects wrong workflow id, path, and state', async (t) => {
  for (const workflowResponse of [
    { id: 999, path: '.github/workflows/deploy-cloudflare.yml', state: 'disabled_manually' },
    { id: WORKFLOW_ID, path: '.github/workflows/other.yml', state: 'disabled_manually' },
    { id: WORKFLOW_ID, path: '.github/workflows/deploy-cloudflare.yml', state: 'active' },
  ]) {
    const fixture = createFiles(t);
    const github = githubFixture({ workflowResponse });
    const result = await verifyReleaseAuthorityFreeze({
      receiptPath: fixture.receiptPath,
      liveGithub: true,
      repo: 'alexwelcing/Lupi',
      cloudflareProjectionPath: fixture.projectionPath,
      githubApi: github.githubApi,
      now: NOW,
    });
    assert.equal(result.ok, false);
    assert.equal(result.checks.at(-1).id, 'github-projection');
  }
});

test('live GitHub verification rejects wrong owner type', async (t) => {
  const fixture = createFiles(t);
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'alexwelcing/Lupi',
    cloudflareProjectionPath: fixture.projectionPath,
    githubApi: githubFixture({ ownerType: 'Organization' }).githubApi,
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.match(result.checks.at(-1).detail, /github-owner-type-mismatch/u);
});

for (const [label, options] of [
  ['repository', { repositorySecrets: ['OTHER_SECRET', 'CLOUDFLARE_API_TOKEN'] }],
  ['environment', { environments: { prod: ['RENDERER_ENDPOINT', 'CLOUDFLARE_API_TOKEN'] } }],
]) {
  test(`live GitHub verification rejects legacy secret at ${label} scope`, async (t) => {
    const fixture = createFiles(t);
    const result = await verifyReleaseAuthorityFreeze({
      receiptPath: fixture.receiptPath,
      liveGithub: true,
      repo: 'alexwelcing/Lupi',
      cloudflareProjectionPath: fixture.projectionPath,
      githubApi: githubFixture(options).githubApi,
      now: NOW,
    });
    assert.equal(result.ok, false);
    assert.match(result.checks.at(-1).detail, /legacy-secret-live/u);
  });
}

test('live GitHub verification compares complete environment inventory', async (t) => {
  const fixture = createFiles(t);
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'alexwelcing/Lupi',
    cloudflareProjectionPath: fixture.projectionPath,
    githubApi: githubFixture({ environments: { prod: ['RENDERER_ENDPOINT'], staging: [] } }).githubApi,
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.match(result.checks.at(-1).detail, /github-secret-inventory-mismatch/u);
});

test('GitHub pagination reads every page', async (t) => {
  const secretNames = Array.from({ length: 101 }, (_, index) => `SECRET_${index}`);
  const fixture = createFiles(t, (data) => {
    data.receipt.github.secretInventories.repository.names = secretNames;
  });
  const github = githubFixture({ repositorySecrets: secretNames });
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'alexwelcing/Lupi',
    cloudflareProjectionPath: fixture.projectionPath,
    githubApi: github.githubApi,
    now: NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result.checks));
  assert.ok(github.calls.some((endpoint) => endpoint.includes('page=2')));
});

test('missing GitHub pagination fails closed', async (t) => {
  const secretNames = Array.from({ length: 101 }, (_, index) => `SECRET_${index}`);
  const fixture = createFiles(t, (data) => {
    data.receipt.github.secretInventories.repository.names = secretNames;
  });
  const github = githubFixture({
    repositorySecretsResponse: (url) => ({
      total_count: 101,
      secrets: url.searchParams.get('page') === '1'
        ? secretNames.slice(0, 100).map((name) => ({ name }))
        : [],
    }),
  });
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'alexwelcing/Lupi',
    cloudflareProjectionPath: fixture.projectionPath,
    githubApi: github.githubApi,
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.match(result.checks.at(-1).detail, /github-api-missing-pagination/u);
});

test('malformed GitHub API response fails without echoing response data', async (t) => {
  const fixture = createFiles(t);
  const marker = 'do-not-echo-response-marker';
  const result = await verifyReleaseAuthorityFreeze({
    receiptPath: fixture.receiptPath,
    liveGithub: true,
    repo: 'alexwelcing/Lupi',
    cloudflareProjectionPath: fixture.projectionPath,
    githubApi: async () => ({ malformed: marker }),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(marker, 'u'));
});

test('CLI never echoes an accidental credential field value', (t) => {
  const fixture = createFiles(t);
  const marker = 'never-log-this-credential-marker';
  const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
  receipt.cloudflare.legacyToken.tokenValue = marker;
  fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const verifierPath = fileURLToPath(
    new URL('./verify-release-authority-freeze.mjs', import.meta.url),
  );
  const run = spawnSync(process.execPath, [verifierPath, `--receipt=${fixture.receiptPath}`], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.doesNotMatch(`${run.stdout}${run.stderr}`, new RegExp(marker, 'u'));
  assert.match(run.stdout, /forbidden-sensitive-field/u);
});

test('CLI never echoes a credential accidentally used as an unknown field name', (t) => {
  const fixture = createFiles(t);
  const marker = ['ghp', 'abcdefghijklmnopqrstuvwxyz012345'].join('_');
  const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, 'utf8'));
  receipt[marker] = true;
  fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const verifierPath = fileURLToPath(
    new URL('./verify-release-authority-freeze.mjs', import.meta.url),
  );
  const run = spawnSync(process.execPath, [verifierPath, `--receipt=${fixture.receiptPath}`], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.doesNotMatch(`${run.stdout}${run.stderr}`, new RegExp(marker, 'u'));
  assert.match(run.stdout, /unknown-field/u);
});

test('CLI JSON summary omits token and secret identifiers', (t) => {
  const fixture = createFiles(t);
  const verifierPath = fileURLToPath(
    new URL('./verify-release-authority-freeze.mjs', import.meta.url),
  );
  const run = spawnSync(
    process.execPath,
    [verifierPath, `--receipt=${fixture.receiptPath}`, '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, new RegExp(TOKEN_IDENTIFIER, 'u'));
  assert.doesNotMatch(run.stdout, /OTHER_SECRET|RENDERER_ENDPOINT/u);
  assert.equal(JSON.parse(run.stdout).ok, true);
});
