#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));
const docs = ['README.md', 'AGENTS.md', 'docs/operations.md', 'docs/release-checklist.md'];
let failed = false;

function fail(message) {
  console.error(`::error::${message}`);
  failed = true;
}

for (const file of docs) {
  const text = readFileSync(join(root, file), 'utf8');
  const commands = [...text.matchAll(/\bpnpm\s+([A-Za-z0-9:_-]+)/g)].map((m) => m[1]);
  for (const cmd of commands) {
    if (['install', 'dev', 'build', 'start', 'test', 'lint', 'run', '--filter'].includes(cmd) || /^\d+$/.test(cmd)) continue;
    if (!scripts.has(cmd)) fail(`${file} documents missing package.json script: ${cmd}`);
  }
}

const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
if (/19\s+lupi\.\*\s+tools|19-tool|19 tools/.test(agents)) {
  fail('AGENTS.md still references the retired 19-tool browser bridge contract.');
}
if (!/one of the 28 lupi\.\* browser bridge tools/.test(agents)) {
  fail('AGENTS.md must identify the current 28-tool browser bridge request contract.');
}

const wrangler = readFileSync(join(root, 'apps/mcp-worker/wrangler.toml'), 'utf8');
if (!/^name\s*=\s*"lupi-edge"/m.test(wrangler)) {
  fail('apps/mcp-worker/wrangler.toml must designate Cloudflare Worker lupi-edge.');
}
for (const file of ['README.md', 'docs/operations.md', 'docs/release-checklist.md']) {
  const text = readFileSync(join(root, file), 'utf8');
  if (!/lupi-edge/.test(text) || !/Cloudflare/.test(text)) {
    fail(`${file} must document Cloudflare lupi-edge as the production runtime.`);
  }
}

if (failed) process.exit(1);
console.log('Operational contract documentation matches package scripts and Cloudflare runtime expectations.');
