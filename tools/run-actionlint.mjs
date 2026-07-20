#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_ROOT = resolve(ROOT, '.github', 'workflows');
const QUEUE_MAX_CONTROLLERS = new Set([
  'deploy-cloudflare.yml',
  'reconcile-cloudflare-deploy.yml',
]);
const STALE_QUEUE_DIAGNOSTIC = /^(.*[\\/])?([^\\/]+\.ya?ml):(\d+):(\d+): unexpected key "queue" for "concurrency" section\. expected one of "cancel-in-progress", "group" \[syntax-check\]$/;

export async function filterActionlintDiagnostics(output, { readSource = readFile } = {}) {
  const blocking = [];
  const suppressed = [];
  for (const line of String(output).split(/\r?\n/).filter(Boolean)) {
    const match = line.match(STALE_QUEUE_DIAGNOSTIC);
    if (!match || !QUEUE_MAX_CONTROLLERS.has(match[2])) {
      blocking.push(line);
      continue;
    }
    const sourcePath = resolve(ROOT, match[1] ?? '.github/workflows/', match[2]);
    const source = await readSource(sourcePath, 'utf8');
    const sourceLine = source.split(/\r?\n/)[Number(match[3]) - 1]?.trim();
    if (sourceLine !== 'queue: max') blocking.push(line);
    else suppressed.push(line);
  }
  return { blocking, suppressed };
}

export function assertAcceptedActionlintResult({ status, signal = null, blocking, suppressed }) {
  if (blocking.length > 0) throw new Error(blocking.join('\n'));
  if (status === 0) {
    if (suppressed.length !== 0) throw new Error('actionlint exited zero while emitting suppressed diagnostics');
    return;
  }
  if (!Number.isInteger(status) || signal) {
    throw new Error(`actionlint did not exit normally (status=${status}, signal=${signal ?? 'none'})`);
  }
  const names = suppressed.map((line) => line.match(STALE_QUEUE_DIAGNOSTIC)?.[2]).sort();
  const expected = [...QUEUE_MAX_CONTROLLERS].sort();
  if (suppressed.length !== expected.length || JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`actionlint nonzero exit is allowed only for the exact queue:max compatibility set; got ${JSON.stringify(names)}`);
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
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const { blocking, suppressed } = await filterActionlintDiagnostics(output);
  for (const line of suppressed) {
    console.error(`actionlint compatibility suppression (github.com queue:max): ${line}`);
  }
  assertAcceptedActionlintResult({
    status: result.status,
    signal: result.signal,
    blocking,
    suppressed,
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`run-actionlint: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
