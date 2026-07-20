import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAcceptedActionlintResult, filterActionlintDiagnostics } from './run-actionlint.mjs';

const queueDiagnostic = '.github/workflows/deploy-cloudflare.yml:33:3: unexpected key "queue" for "concurrency" section. expected one of "cancel-in-progress", "group" [syntax-check]';

test('only the documented github.com queue:max actionlint schema lag is suppressed', async () => {
  const queueSource = `${'\n'.repeat(32)}  queue: max\n`;
  const accepted = await filterActionlintDiagnostics(queueDiagnostic, { readSource: async () => queueSource });
  assert.deepEqual(accepted.blocking, []);
  assert.deepEqual(accepted.suppressed, [queueDiagnostic]);

  const wrongValue = await filterActionlintDiagnostics(queueDiagnostic, {
    readSource: async () => `${'\n'.repeat(32)}  queue: something-else\n`,
  });
  assert.deepEqual(wrongValue.blocking, [queueDiagnostic]);

  const unknownController = queueDiagnostic.replace('deploy-cloudflare.yml', 'other.yml');
  const unsupportedKey = '.github/workflows/deploy-cloudflare.yml:34:3: unexpected key "bogus" for "concurrency" section. expected one of "cancel-in-progress", "group" [syntax-check]';
  const rejected = await filterActionlintDiagnostics(`${unknownController}\n${unsupportedKey}`, {
    readSource: async () => queueSource,
  });
  assert.deepEqual(rejected.blocking, [unknownController, unsupportedKey]);
  assert.deepEqual(rejected.suppressed, []);
});

test('a nonzero actionlint exit is accepted only for both expected queue:max diagnostics', () => {
  const reconcile = queueDiagnostic
    .replace('deploy-cloudflare.yml', 'reconcile-cloudflare-deploy.yml')
    .replace(':33:', ':62:');
  assert.doesNotThrow(() => assertAcceptedActionlintResult({
    status: 1,
    blocking: [],
    suppressed: [queueDiagnostic, reconcile],
  }));
  assert.throws(() => assertAcceptedActionlintResult({
    status: 1,
    blocking: [],
    suppressed: [queueDiagnostic],
  }), /exact queue:max compatibility set/);
  assert.throws(() => assertAcceptedActionlintResult({
    status: null,
    signal: 'SIGKILL',
    blocking: [],
    suppressed: [queueDiagnostic, reconcile],
  }), /did not exit normally/);
  assert.throws(() => assertAcceptedActionlintResult({
    status: 1,
    blocking: ['different schema error'],
    suppressed: [queueDiagnostic, reconcile],
  }), /different schema error/);
});
