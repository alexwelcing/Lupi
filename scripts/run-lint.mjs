import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpmInvocation = process.platform === 'win32'
  ? { command: process.env.ComSpec ?? 'cmd.exe', prefix: ['/d', '/s', '/c', 'pnpm'] }
  : { command: 'pnpm', prefix: [] };

function runPnpm(args, { capture = false } = {}) {
  const result = spawnSync(pnpmInvocation.command, [...pnpmInvocation.prefix, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? '';
}

function normalizedRelativePath(absolutePath) {
  return relative(repositoryRoot, absolutePath).split(sep).join('/');
}

function isAppOrPackageWorkspace(absolutePath) {
  const normalized = normalizedRelativePath(absolutePath);
  return normalized.startsWith('apps/') || normalized.startsWith('packages/');
}

function findRunSummary(startedAt) {
  const runDirectory = join(repositoryRoot, '.turbo', 'runs');
  if (!existsSync(runDirectory)) {
    throw new Error('Turbo did not create .turbo/runs while --summarize was enabled.');
  }

  const summaries = readdirSync(runDirectory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(runDirectory, name))
    .filter((path) => statSync(path).mtimeMs >= startedAt - 1_000)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (summaries.length === 0) {
    throw new Error('Turbo finished without a fresh machine-readable run summary.');
  }
  return summaries[0];
}

const workspaceRecords = JSON.parse(
  runPnpm(['-r', 'list', '--depth', '-1', '--json'], { capture: true }),
);
const expectedWorkspaces = workspaceRecords
  .filter((workspace) => isAppOrPackageWorkspace(resolve(workspace.path)))
  .map((workspace) => ({
    name: workspace.name,
    path: normalizedRelativePath(resolve(workspace.path)),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

if (expectedWorkspaces.length === 0) {
  throw new Error('pnpm reported no apps/* or packages/* workspace packages.');
}

const names = new Set();
for (const workspace of expectedWorkspaces) {
  if (!workspace.name || names.has(workspace.name)) {
    throw new Error(`Workspace names must be present and unique: ${workspace.path}`);
  }
  names.add(workspace.name);
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, workspace.path, 'package.json'), 'utf8'));
  if (!manifest.scripts?.lint) {
    throw new Error(`Workspace ${workspace.name} (${workspace.path}) has no lint script.`);
  }
}

console.log(`[lint] workspace set: ${expectedWorkspaces.map(({ name }) => name).join(', ')}`);
const turboStartedAt = Date.now();
runPnpm([
  'turbo',
  'run',
  'lint',
  '--filter=./apps/**',
  '--filter=./packages/**',
  '--force',
  '--summarize',
]);

const summaryPath = findRunSummary(turboStartedAt);
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const executedLintPackages = new Set(
  (summary.tasks ?? [])
    .filter((task) => task.task === 'lint' && task.command !== '<NONEXISTENT>')
    .map((task) => task.package ?? task.taskId?.replace(/#lint$/, ''))
    .filter(Boolean),
);

const missing = expectedWorkspaces.filter(({ name }) => !executedLintPackages.has(name));
const unexpected = [...executedLintPackages].filter((name) => !names.has(name));
if (missing.length > 0 || unexpected.length > 0) {
  throw new Error(
    `Turbo lint coverage mismatch. Missing: ${missing.map(({ name, path }) => `${name} (${path})`).join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`,
  );
}
console.log(`[lint] Turbo summary covers all ${expectedWorkspaces.length} app/package workspaces.`);

const nonWorkspaceLanes = [
  ['tools', 'tools/**/*.{js,mjs,cjs,ts,tsx}'],
  ['scripts', 'scripts/**/*.{js,mjs,cjs,ts,tsx}'],
  ['Playwright and root test config', 'tests/**/*.{js,mjs,cjs,ts,tsx}', 'playwright.config.mjs', 'vitest.workspace.ts'],
  ['Cloud Functions', 'functions/src/**/*.{js,mjs,cjs,ts,tsx}'],
];

for (const [label, ...patterns] of nonWorkspaceLanes) {
  console.log(`[lint] non-workspace lane: ${label}`);
  runPnpm(['exec', 'eslint', '--no-warn-ignored', ...patterns]);
}
