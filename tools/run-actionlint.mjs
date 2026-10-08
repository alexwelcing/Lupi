#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_ROOT = resolve(ROOT, '.github', 'workflows');

export function assertAcceptedActionlintResult({ status, signal = null, output = '' }) {
  const diagnostics = String(output).split(/\r?\n/).filter(Boolean);
  if (diagnostics.length > 0) throw new Error(diagnostics.join('\n'));
  if (status !== 0 || signal) {
    throw new Error(`actionlint did not exit cleanly (status=${status}, signal=${signal ?? 'none'})`);
  }
}

async function main() {
  const names = (await readdir(WORKFLOW_ROOT))
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .map((name) => resolve(WORKFLOW_ROOT, name));
  const executable = process.env.ACTIONLINT_BIN || 'actionlint';
  const result = spawnSync(executable, ['-oneline', ...names], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  assertAcceptedActionlintResult({
    status: result.status,
    signal: result.signal,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`run-actionlint: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
