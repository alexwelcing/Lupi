import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAcceptedActionlintResult } from './run-actionlint.mjs';

const diagnostic = '.github/workflows/ci.yml:33:3: unexpected key "bogus" for "concurrency" section. expected one of "cancel-in-progress", "group" [syntax-check]';

test('a clean actionlint exit with no diagnostics is accepted', () => {
  assert.doesNotThrow(() => assertAcceptedActionlintResult({ status: 0, output: '' }));
  assert.doesNotThrow(() => assertAcceptedActionlintResult({ status: 0, output: '\n' }));
});

test('every actionlint diagnostic fails the run', () => {
  assert.throws(() => assertAcceptedActionlintResult({ status: 1, output: diagnostic }), /unexpected key "bogus"/);
  assert.throws(() => assertAcceptedActionlintResult({ status: 0, output: diagnostic }), /unexpected key "bogus"/);
});

test('an abnormal actionlint exit fails the run even without diagnostics', () => {
  assert.throws(() => assertAcceptedActionlintResult({ status: 1, output: '' }), /did not exit cleanly/);
  assert.throws(() => assertAcceptedActionlintResult({ status: null, signal: 'SIGKILL' }), /did not exit cleanly/);
});
