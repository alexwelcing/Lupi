import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_PATH = resolve(ROOT, '.github', 'workflows', 'deploy-cloudflare.yml');

test('Cloudflare deploy injects the current Git SHA into Worker runtime vars', async () => {
  const workflow = parseDocument(await readFile(WORKFLOW_PATH, 'utf8')).toJS();
  const deployStep = workflow.jobs?.deploy?.steps?.find((step) => step.name === 'Deploy lupi-edge');

  assert.ok(deployStep, 'deploy workflow must include the Cloudflare deploy step');
  assert.equal(deployStep.env?.LUPI_BUILD_SHA, '${{ github.sha }}');
  assert.match(String(deployStep.run ?? ''), /--var "LUPI_BUILD_SHA:\$\{LUPI_BUILD_SHA\}"/);
});
