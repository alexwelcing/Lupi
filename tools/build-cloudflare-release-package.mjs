#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants, createReadStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  canonicalSha256,
  validateReleasePackage,
} from './cloudflare-release-receipt.mjs';

const MANIFEST_NAME = 'release-package.json';
const UPLOAD_CONFIG_PATH = 'wrangler.toml';
const REPOSITORY = 'alexwelcing/Lupi';
const WORKFLOW = 'deploy-cloudflare.yml';
const WORKER_NAME = 'lupi-edge';
const WRANGLER_VERSION = '4.110.0';
const SHA40 = /^[a-f0-9]{40}$/i;
const SRI_SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const SAFE_BINDING = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_WORKER_NAME = /^[a-z0-9][a-z0-9_-]*$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._-]+$/;

const TOP_LEVEL_CONFIG_KEYS = new Set([
  'name',
  'main',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'preview_urls',
  'keep_vars',
  'assets',
  'version_metadata',
  'vars',
  'r2_buckets',
]);

const BUILD_FLAGS = new Set([
  'worker-outdir',
  'worker-entry',
  'assets-dir',
  'output-dir',
  'repository',
  'workflow',
  'run-id',
  'run-attempt',
  'target-sha',
  'wrangler-integrity',
  'config',
  'lock-file',
  'created-at',
  'node-version',
  'pnpm-version',
  'wrangler-version',
]);

export async function buildReleasePackage(options) {
  const workerRoot = path.resolve(required(options.workerOutdir, 'worker-outdir'));
  const assetsRoot = path.resolve(required(options.assetsDir, 'assets-dir'));
  const outputRoot = path.resolve(required(options.outputDir, 'output-dir'));
  const configPath = path.resolve(options.config ?? 'apps/mcp-worker/wrangler.toml');
  const lockPath = path.resolve(options.lockFile ?? 'pnpm-lock.yaml');

  assert.equal(options.repository, REPOSITORY, `repository must be ${REPOSITORY}`);
  assert.equal(options.workflow, WORKFLOW, `workflow must be ${WORKFLOW}`);
  assertNonEmpty(options.runId, 'run-id');
  assert.equal(Number(options.runAttempt), 1, 'run-attempt must be exactly 1');
  assert.match(options.targetSha ?? '', SHA40, 'target-sha must be a full Git SHA');
  assertSha512Sri(options.wranglerIntegrity, 'wrangler-integrity');
  const createdAt = options.createdAt ?? new Date().toISOString();
  assertIsoDate(createdAt, 'created-at');
  const toolchain = {
    node: options.nodeVersion ?? process.versions.node,
    pnpm: options.pnpmVersion ?? await detectPnpmVersion(),
    wrangler: options.wranglerVersion ?? WRANGLER_VERSION,
  };
  for (const [name, version] of Object.entries(toolchain)) assertNonEmpty(version, `${name} version`);
  assert.equal(toolchain.wrangler, WRANGLER_VERSION, `Wrangler version must be ${WRANGLER_VERSION}`);

  await assertOutputTargetIsEmptyAndUnlinked(outputRoot);
  const [workerFiles, assetFiles, sourceConfigText, lockBytes] = await Promise.all([
    inspectTree(workerRoot, 'Wrangler worker outdir'),
    inspectTree(assetsRoot, 'web assets directory'),
    readRegularUnlinkedFile(configPath, 'Wrangler source config'),
    readRegularUnlinkedFile(lockPath, 'pnpm lockfile'),
  ]);
  assert.ok(workerFiles.length > 0, 'Wrangler worker outdir is empty');
  assert.ok(assetFiles.length > 0, 'web assets directory is empty');
  assertNoPathOverlap(outputRoot, workerRoot, 'worker outdir');
  assertNoPathOverlap(outputRoot, assetsRoot, 'assets directory');

  const sourceConfig = parseClosedWranglerToml(sourceConfigText.toString('utf8'));
  await assertDeclaredAssetsMatch(sourceConfig, configPath, assetsRoot);
  const workerEntry = selectWorkerEntry(workerFiles, options.workerEntry);
  const uploadConfig = buildClosedUploadConfig(sourceConfig, workerEntry);
  validateClosedUploadConfig(uploadConfig);
  const bindingProjection = bindingProjectionFromConfig(uploadConfig);

  await mkdir(outputRoot, { recursive: true });
  await copyInspectedFiles(workerFiles, workerRoot, outputRoot, 'worker');
  await copyInspectedFiles(assetFiles, assetsRoot, outputRoot, 'assets');

  const uploadConfigBytes = Buffer.from(serializeClosedWranglerToml(uploadConfig));
  await writeDataFile(outputRoot, UPLOAD_CONFIG_PATH, uploadConfigBytes);

  const allDataFiles = await inspectTree(outputRoot, 'release package output');
  for (const file of allDataFiles) {
    assert.equal(Number.parseInt(file.mode, 8) & 0o111, 0, `release payload file is executable: ${file.path}`);
  }
  const files = allDataFiles.map(toDescriptor);
  const workerDescriptors = descriptorsUnder(allDataFiles, 'worker/');
  const assetManifest = descriptorsUnder(allDataFiles, 'assets/').map(({ path: filePath, sha256: digest, size }) => ({
    path: filePath,
    sha256: digest,
    size,
  }));
  const lockSha256 = sha256(lockBytes);
  const configSha256 = sha256(sourceConfigText);
  const buildSha256 = canonicalSha256(buildManifestProjection(workerDescriptors));
  const uploadConfigSha256 = sha256(uploadConfigBytes);
  const sourceManifestSha256 = canonicalSha256(sourceManifestProjection({
    repository: options.repository,
    targetSha: options.targetSha,
    lockSha256,
    configSha256,
    buildSha256,
    uploadConfigSha256,
    assetManifest,
  }));

  const manifest = {
    schemaVersion: 'lupi-release-package-v1',
    repository: options.repository,
    targetSha: options.targetSha,
    workflow: options.workflow,
    runId: String(options.runId),
    runAttempt: Number(options.runAttempt),
    createdAt,
    toolchain,
    lockSha256,
    sourceManifestSha256,
    buildSha256,
    configSha256,
    uploadConfigSha256,
    bindingProjection,
    assetManifest,
    files,
    wranglerIntegrity: options.wranglerIntegrity,
    packageSha256: '',
  };
  manifest.packageSha256 = canonicalSha256({ ...manifest, packageSha256: undefined });
  validateReleasePackage(manifest);
  await writeDataFile(outputRoot, MANIFEST_NAME, jsonBytes(manifest));
  await verifyReleasePackage(outputRoot);
  return manifest;
}

export async function verifyReleasePackage(packageDir) {
  const packageRoot = path.resolve(required(packageDir, 'package-dir'));
  await assertUnlinkedDirectory(packageRoot, 'release package directory');
  const manifestBytes = await readRegularUnlinkedFile(path.join(packageRoot, MANIFEST_NAME), 'release package manifest');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`release package manifest is invalid JSON: ${errorMessage(error)}`);
  }
  validateReleasePackage(manifest);

  const scanned = await inspectTree(packageRoot, 'release package directory');
  const actualDataFiles = scanned.filter((file) => file.path !== MANIFEST_NAME);
  const unexpectedManifest = scanned.filter((file) => file.path === MANIFEST_NAME);
  assert.equal(unexpectedManifest.length, 1, 'release package must contain exactly one root manifest');
  const actualDescriptors = actualDataFiles.map(toDescriptor);
  assert.deepEqual(manifest.files, actualDescriptors, 'release package file inventory does not match the downloaded payload');
  assert.deepEqual([...manifest.files].map((file) => file.path), [...manifest.files].map((file) => file.path).sort(), 'release package files must be sorted');
  for (const file of actualDataFiles) {
    assert.equal(Number.parseInt(file.mode, 8) & 0o111, 0, `release payload file is executable: ${file.path}`);
    assert.ok(isAllowedPayloadPath(file.path), `release payload contains an unclassified file: ${file.path}`);
  }

  const uploadConfigBytes = await readAttestedFile(packageRoot, actualDataFiles, UPLOAD_CONFIG_PATH);
  const uploadConfig = parseClosedWranglerToml(uploadConfigBytes.toString('utf8'));
  validateClosedUploadConfig(uploadConfig);
  assert.equal(manifest.uploadConfigSha256, sha256(uploadConfigBytes), 'upload config digest mismatch');
  assert.deepEqual(manifest.bindingProjection, bindingProjectionFromConfig(uploadConfig), 'binding projection does not match upload config');
  const entryPath = uploadConfig.main;
  assert.ok(actualDataFiles.some((file) => file.path === entryPath), 'upload config main is absent from the payload');

  const workerDescriptors = descriptorsUnder(actualDataFiles, 'worker/');
  const assetDescriptors = descriptorsUnder(actualDataFiles, 'assets/');
  assert.equal(
    manifest.buildSha256,
    canonicalSha256(buildManifestProjection(workerDescriptors)),
    'build digest does not match worker payload',
  );

  const expectedAssets = assetDescriptors.map(({ path: filePath, sha256: digest, size }) => ({
    path: filePath,
    sha256: digest,
    size,
  }));
  assert.deepEqual(manifest.assetManifest, expectedAssets, 'asset manifest does not match packaged web assets');
  assert.equal(
    manifest.sourceManifestSha256,
    canonicalSha256(sourceManifestProjection({
      repository: manifest.repository,
      targetSha: manifest.targetSha,
      lockSha256: manifest.lockSha256,
      configSha256: manifest.configSha256,
      buildSha256: manifest.buildSha256,
      uploadConfigSha256: manifest.uploadConfigSha256,
      assetManifest: manifest.assetManifest,
    })),
    'source manifest projection digest mismatch',
  );
  return manifest;
}

export function parseClosedWranglerToml(text) {
  assert.equal(typeof text, 'string', 'Wrangler config must be text');
  const result = {};
  let current = result;
  let currentName = 'root';
  for (const [lineIndex, originalLine] of text.split(/\r?\n/).entries()) {
    const line = stripTomlComment(originalLine).trim();
    if (!line) continue;
    const arrayTable = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (arrayTable) {
      assert.equal(arrayTable[1], 'r2_buckets', `unsupported Wrangler array table on line ${lineIndex + 1}`);
      result.r2_buckets ??= [];
      const table = {};
      result.r2_buckets.push(table);
      current = table;
      currentName = 'r2_buckets';
      continue;
    }
    const table = /^\[([^\]]+)\]$/.exec(line);
    if (table) {
      assert.ok(['assets', 'version_metadata', 'vars'].includes(table[1]), `unsupported Wrangler table [${table[1]}]`);
      assert.equal(result[table[1]], undefined, `duplicate Wrangler table [${table[1]}]`);
      result[table[1]] = {};
      current = result[table[1]];
      currentName = table[1];
      continue;
    }
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
    assert.ok(assignment, `unsupported Wrangler syntax on line ${lineIndex + 1}`);
    assert.equal(current[assignment[1]], undefined, `duplicate Wrangler key ${currentName}.${assignment[1]}`);
    current[assignment[1]] = parseTomlValue(assignment[2], lineIndex + 1);
  }
  validateSourceConfig(result);
  return result;
}

export function validateClosedUploadConfig(value) {
  assertPlainObject(value, 'upload config');
  assertNoExecutableConfigKeys(value);
  for (const key of Object.keys(value)) assert.ok(TOP_LEVEL_CONFIG_KEYS.has(key), `upload config contains unsupported key ${key}`);
  for (const key of ['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'keep_vars', 'assets']) {
    assert.notEqual(value[key], undefined, `upload config is missing ${key}`);
  }
  assert.match(value.name, SAFE_WORKER_NAME, 'upload config worker name is invalid');
  assert.equal(value.name, WORKER_NAME, `upload config worker name must be ${WORKER_NAME}`);
  assertSafeRelativePath(value.main, 'upload config main');
  assert.equal(value.main, 'worker/index.js', 'upload config main must be worker/index.js');
  assert.match(value.compatibility_date, /^\d{4}-\d{2}-\d{2}$/, 'upload config compatibility_date is invalid');
  for (const key of ['workers_dev', 'preview_urls', 'keep_vars']) assert.equal(typeof value[key], 'boolean', `${key} must be boolean`);
  if (value.compatibility_flags !== undefined) {
    assert.ok(Array.isArray(value.compatibility_flags) && value.compatibility_flags.every(isNonEmptyString), 'compatibility_flags are invalid');
  }

  validateAssets(value.assets, true);
  if (value.version_metadata !== undefined) validateVersionMetadata(value.version_metadata);
  if (value.vars !== undefined) validateVars(value.vars);
  if (value.r2_buckets !== undefined) validateR2Buckets(value.r2_buckets);
  assertUniqueBindings(value);
  return value;
}

export function serializeClosedWranglerToml(value) {
  validateClosedUploadConfig(value);
  const lines = [];
  for (const key of [
    'name', 'main', 'compatibility_date', 'compatibility_flags',
    'workers_dev', 'preview_urls', 'keep_vars',
  ]) {
    if (value[key] !== undefined) lines.push(`${key} = ${tomlLiteral(value[key])}`);
  }
  appendTomlTable(lines, 'assets', value.assets, [
    'directory', 'binding', 'not_found_handling', 'run_worker_first',
  ]);
  if (value.version_metadata !== undefined) {
    appendTomlTable(lines, 'version_metadata', value.version_metadata, ['binding']);
  }
  if (value.vars !== undefined) {
    appendTomlTable(lines, 'vars', value.vars, Object.keys(value.vars).sort());
  }
  for (const bucket of value.r2_buckets ?? []) {
    lines.push('', '[[r2_buckets]]');
    for (const key of ['binding', 'bucket_name', 'jurisdiction']) {
      if (bucket[key] !== undefined) lines.push(`${key} = ${tomlLiteral(bucket[key])}`);
    }
  }
  const text = `${lines.join('\n')}\n`;
  assert.deepEqual(parseClosedWranglerToml(text), value, 'closed Wrangler TOML did not round-trip');
  return text;
}

function buildClosedUploadConfig(source, workerEntry) {
  const config = {
    name: source.name,
    main: `worker/${workerEntry}`,
    compatibility_date: source.compatibility_date,
    workers_dev: source.workers_dev,
    preview_urls: source.preview_urls,
    keep_vars: source.keep_vars,
    assets: { ...source.assets, directory: 'assets' },
  };
  for (const key of ['compatibility_flags', 'version_metadata', 'vars', 'r2_buckets']) {
    if (source[key] !== undefined) config[key] = structuredClone(source[key]);
  }
  return config;
}

function bindingProjectionFromConfig(config) {
  const projection = {};
  if (config.assets) {
    const { directory: _directory, ...assets } = config.assets;
    projection.assets = assets;
  }
  for (const key of ['version_metadata', 'vars', 'r2_buckets']) {
    if (config[key] !== undefined) projection[key] = structuredClone(config[key]);
  }
  return sortValue(projection);
}

function validateSourceConfig(value) {
  assertPlainObject(value, 'Wrangler source config');
  assertNoExecutableConfigKeys(value);
  for (const key of Object.keys(value)) assert.ok(TOP_LEVEL_CONFIG_KEYS.has(key), `Wrangler source config contains unsupported key ${key}`);
  for (const key of ['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'keep_vars', 'assets']) {
    assert.notEqual(value[key], undefined, `Wrangler source config is missing ${key}`);
  }
  assert.match(value.name, SAFE_WORKER_NAME, 'Wrangler worker name is invalid');
  assert.equal(value.name, WORKER_NAME, `Wrangler worker name must be ${WORKER_NAME}`);
  assert.equal(typeof value.main, 'string', 'Wrangler source main must be a string');
  assert.match(value.compatibility_date, /^\d{4}-\d{2}-\d{2}$/, 'Wrangler compatibility_date is invalid');
  for (const key of ['workers_dev', 'preview_urls', 'keep_vars']) assert.equal(typeof value[key], 'boolean', `${key} must be boolean`);
  if (value.compatibility_flags !== undefined) {
    assert.ok(Array.isArray(value.compatibility_flags) && value.compatibility_flags.every(isNonEmptyString), 'compatibility_flags are invalid');
  }
  validateAssets(value.assets, false);
  if (value.version_metadata !== undefined) validateVersionMetadata(value.version_metadata);
  if (value.vars !== undefined) validateVars(value.vars);
  if (value.r2_buckets !== undefined) validateR2Buckets(value.r2_buckets);
}

function validateAssets(value, closed) {
  assertPlainObject(value, 'assets config');
  assertExactKeys(value, ['binding', 'directory', 'not_found_handling', 'run_worker_first'], 'assets config');
  assertBinding(value.binding, 'assets binding');
  assert.equal(typeof value.directory, 'string', 'assets directory must be a string');
  if (closed) assert.equal(value.directory, 'assets', 'closed upload assets directory must be assets');
  assert.ok(['single-page-application', '404-page', 'none'].includes(value.not_found_handling), 'assets not_found_handling is invalid');
  assert.equal(typeof value.run_worker_first, 'boolean', 'assets run_worker_first must be boolean');
}

function validateVersionMetadata(value) {
  assertPlainObject(value, 'version_metadata');
  assertExactKeys(value, ['binding'], 'version_metadata');
  assertBinding(value.binding, 'version metadata binding');
}

function validateVars(value) {
  assertPlainObject(value, 'vars');
  for (const [key, entry] of Object.entries(value)) {
    assertBinding(key, `var ${key}`);
    assert.ok(!/(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(key), `vars must not contain secret-like key ${key}`);
    assert.ok(['string', 'number', 'boolean'].includes(typeof entry), `var ${key} must be scalar`);
  }
}

function validateR2Buckets(value) {
  assert.ok(Array.isArray(value), 'r2_buckets must be an array');
  for (const bucket of value) {
    assertPlainObject(bucket, 'r2 bucket');
    const keys = Object.keys(bucket);
    assert.ok(keys.every((key) => ['binding', 'bucket_name', 'jurisdiction'].includes(key)), 'r2 bucket contains unsupported fields');
    assert.ok(keys.includes('binding') && keys.includes('bucket_name'), 'r2 bucket needs binding and bucket_name');
    assertBinding(bucket.binding, 'r2 binding');
    assertNonEmpty(bucket.bucket_name, 'r2 bucket_name');
    if (bucket.jurisdiction !== undefined) assertNonEmpty(bucket.jurisdiction, 'r2 jurisdiction');
  }
}

function assertUniqueBindings(config) {
  const bindings = [config.assets?.binding, config.version_metadata?.binding];
  for (const bucket of config.r2_buckets ?? []) bindings.push(bucket.binding);
  const actual = bindings.filter(Boolean);
  assert.equal(new Set(actual).size, actual.length, 'upload config contains duplicate binding names');
}

function assertNoExecutableConfigKeys(value, location = 'config') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExecutableConfigKeys(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    assert.ok(!/^(?:build|command|commands|script|scripts|hook|hooks)$/i.test(key), `${location} contains executable key ${key}`);
    assertNoExecutableConfigKeys(entry, `${location}.${key}`);
  }
}

async function inspectTree(root, label) {
  await assertUnlinkedDirectory(root, label);
  const rootReal = await realpath(root);
  const files = [];
  const seenCaseFolded = new Set();
  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      assertSafeRelativePath(relative, `${label} path`);
      const stat = await lstat(absolute);
      assert.ok(!stat.isSymbolicLink(), `${label} contains a symbolic link: ${relative}`);
      if (stat.isDirectory()) {
        const resolved = await realpath(absolute);
        assertInside(rootReal, resolved, `${label} directory ${relative}`);
        await walk(absolute, relative);
      } else if (stat.isFile()) {
        const folded = relative.toLocaleLowerCase('en-US');
        assert.ok(!seenCaseFolded.has(folded), `${label} contains a cross-platform path collision: ${relative}`);
        seenCaseFolded.add(folded);
        const resolved = await realpath(absolute);
        assertInside(rootReal, resolved, `${label} file ${relative}`);
        const digest = await digestFile(absolute);
        assert.equal(digest.size, stat.size, `${label} file changed while hashing: ${relative}`);
        files.push({
          sourcePath: absolute,
          path: relative.replaceAll('\\', '/'),
          size: digest.size,
          mode: normalizeMode(stat.mode),
          sha256: digest.sha256,
        });
      } else {
        throw new Error(`${label} contains a non-file entry: ${relative}`);
      }
    }
  }
  await walk(root, '');
  return files.sort((left, right) => compareCodeUnits(left.path, right.path));
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function copyInspectedFiles(files, sourceRoot, outputRoot, prefix) {
  for (const file of files) {
    const source = path.join(sourceRoot, ...file.path.split('/'));
    const destinationRelative = `${prefix}/${file.path}`;
    const destination = path.join(outputRoot, ...destinationRelative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
    await chmod(destination, 0o644);
    const copied = await digestFile(destination);
    assert.equal(copied.size, file.size, `source changed while packaging: ${file.path}`);
    assert.equal(copied.sha256, file.sha256, `source changed while packaging: ${file.path}`);
  }
}

async function writeDataFile(root, relative, bytes) {
  assertSafeRelativePath(relative, 'output file path');
  const destination = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx', mode: 0o644 });
  await chmod(destination, 0o644);
}

async function readAttestedFile(root, scanned, relative) {
  assert.ok(scanned.some((file) => file.path === relative), `release payload is missing ${relative}`);
  return readRegularUnlinkedFile(path.join(root, ...relative.split('/')), relative);
}

async function readRegularUnlinkedFile(filePath, label) {
  const stat = await lstat(filePath);
  assert.ok(!stat.isSymbolicLink(), `${label} must not be a symbolic link`);
  assert.ok(stat.isFile(), `${label} must be a regular file`);
  return readFile(filePath);
}

async function assertUnlinkedDirectory(directory, label) {
  const stat = await lstat(directory);
  assert.ok(!stat.isSymbolicLink(), `${label} must not be a symbolic link`);
  assert.ok(stat.isDirectory(), `${label} must be a directory`);
}

async function assertDeclaredAssetsMatch(sourceConfig, configPath, assetsRoot) {
  const declared = path.resolve(path.dirname(configPath), sourceConfig.assets.directory);
  const [declaredReal, suppliedReal] = await Promise.all([realpath(declared), realpath(assetsRoot)]);
  assert.equal(
    path.relative(declaredReal, suppliedReal),
    '',
    'assets-dir must match the directory declared by the Wrangler source config',
  );
}

async function assertOutputTargetIsEmptyAndUnlinked(outputRoot) {
  await assertNoSymlinkInExistingPath(outputRoot);
  try {
    const stat = await lstat(outputRoot);
    assert.ok(!stat.isSymbolicLink(), 'output-dir must not be a symbolic link');
    assert.ok(stat.isDirectory(), 'output-dir must be a directory');
    const entries = await readdir(outputRoot);
    assert.equal(entries.length, 0, 'output-dir must be empty');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function assertNoSymlinkInExistingPath(target) {
  let current = path.resolve(target);
  const roots = [];
  while (true) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const candidate of roots.reverse()) {
    try {
      const stat = await lstat(candidate);
      assert.ok(!stat.isSymbolicLink(), `output path traverses a symbolic link: ${candidate}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function assertNoPathOverlap(output, source, label) {
  assert.ok(!isInside(source, output), `output-dir must not be inside ${label}`);
  assert.ok(!isInside(output, source), `${label} must not be inside output-dir`);
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInside(root, candidate, label) {
  assert.ok(isInside(root, candidate), `${label} escapes its declared root`);
}

function selectWorkerEntry(files, requested) {
  if (requested !== undefined) {
    const normalized = requested.replaceAll('\\', '/');
    assertSafeRelativePath(normalized, 'worker-entry');
    assert.equal(normalized, 'index.js', 'worker-entry must be index.js');
    assert.ok(files.some((file) => file.path === normalized), `worker-entry is absent from worker-outdir: ${normalized}`);
    return normalized;
  }
  assert.ok(files.some((file) => file.path === 'index.js'), 'Wrangler worker outdir must contain index.js');
  return 'index.js';
}

function descriptorsUnder(files, prefix) {
  return files.filter((file) => file.path.startsWith(prefix)).map(toDescriptor);
}

function toDescriptor(file) {
  return { path: file.path, size: file.size, mode: file.mode, sha256: file.sha256 };
}

function isAllowedPayloadPath(filePath) {
  return filePath.startsWith('worker/')
    || filePath.startsWith('assets/')
    || filePath === UPLOAD_CONFIG_PATH;
}

function buildManifestProjection(workerFiles) {
  return {
    schemaVersion: 'lupi-worker-build-manifest-v1',
    files: workerFiles,
  };
}

function sourceManifestProjection({
  repository,
  targetSha,
  lockSha256,
  configSha256,
  buildSha256,
  uploadConfigSha256,
  assetManifest,
}) {
  return {
    schemaVersion: 'lupi-source-manifest-v1',
    repository,
    targetSha,
    lockSha256,
    configSha256,
    buildSha256,
    uploadConfigSha256,
    assetManifest,
  };
}

function appendTomlTable(lines, name, value, keys) {
  lines.push('', `[${name}]`);
  for (const key of keys) {
    if (value[key] !== undefined) lines.push(`${key} = ${tomlLiteral(value[key])}`);
  }
}

function tomlLiteral(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlLiteral).join(', ')}]`;
  throw new Error(`cannot serialize Wrangler TOML value of type ${typeof value}`);
}

function parseTomlValue(source, line) {
  const value = source.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') || value.startsWith('[')) {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`invalid closed TOML value on line ${line}: ${errorMessage(error)}`);
    }
  }
  throw new Error(`unsupported closed TOML value on line ${line}`);
}

function stripTomlComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (char === '#' && !quoted) return line.slice(0, index);
  }
  assert.equal(quoted, false, 'unterminated string in Wrangler TOML');
  return line;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(sortValue(value), null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function digestFile(filePath) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    size += chunk.byteLength;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest('hex') };
}

function normalizeMode(mode) {
  return (mode & 0o777).toString(8).padStart(4, '0');
}

function assertSafeRelativePath(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  assert.ok(!path.isAbsolute(value), `${label} must be relative`);
  assert.ok(!/^[A-Za-z]:/.test(value), `${label} must not be drive-relative`);
  assert.ok(!value.includes('\0'), `${label} contains NUL`);
  assert.ok(!value.includes('\\'), `${label} must use forward-slash separators`);
  const segments = value.split('/');
  assert.ok(!segments.includes('..'), `${label} must not escape its root`);
  assert.ok(!segments.includes('') && !segments.includes('.'), `${label} is not normalized`);
  assert.ok(segments.every((segment) => SAFE_PATH_SEGMENT.test(segment)), `${label} contains an unsafe segment`);
}

function assertSha512Sri(value, label) {
  assert.match(value ?? '', SRI_SHA512, `${label} must be a sha512 SRI`);
  const encoded = value.slice('sha512-'.length);
  const digest = Buffer.from(encoded, 'base64');
  assert.equal(digest.byteLength, 64, `${label} must contain a 64-byte SHA-512 digest`);
  assert.equal(digest.toString('base64'), encoded, `${label} must use canonical base64`);
}

function assertIsoDate(value, label) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}T/, `${label} must be an ISO timestamp`);
  assert.ok(Number.isFinite(Date.parse(value)), `${label} must be an ISO timestamp`);
}

function assertBinding(value, label) {
  assert.match(value ?? '', SAFE_BINDING, `${label} is invalid`);
}

function assertExactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} contains missing or extra fields`);
}

function assertPlainObject(value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}

function assertNonEmpty(value, label) {
  assert.ok(isNonEmptyString(value), `${label} must be non-empty`);
}

function required(value, label) {
  assertNonEmpty(value, label);
  return value;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

async function detectPnpmVersion() {
  const userAgent = process.env.npm_config_user_agent ?? '';
  const fromAgent = /(?:^|\s)pnpm\/([^\s]+)/.exec(userAgent)?.[1];
  if (fromAgent) return fromAgent;
  try {
    const rootPackage = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
    const declared = /^pnpm@(.+)$/.exec(rootPackage.packageManager ?? '')?.[1];
    if (declared) return declared;
  } catch {
    // The release manifest remains explicit even in a standalone fixture.
  }
  return 'not-provided';
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseCli(argv) {
  const args = [...argv];
  let command = args.shift();
  if (command === '--verify') command = 'verify';
  assert.ok(command === 'build' || command === 'verify', 'command must be build or verify');
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    assert.ok(token.startsWith('--'), `unexpected argument ${token}`);
    const equals = token.indexOf('=');
    const key = token.slice(2, equals === -1 ? undefined : equals);
    const value = equals === -1 ? args[++index] : token.slice(equals + 1);
    assert.ok(value !== undefined && !value.startsWith('--'), `missing value for --${key}`);
    assert.equal(values[key], undefined, `duplicate flag --${key}`);
    values[key] = value;
  }
  if (command === 'verify') {
    assert.deepEqual(Object.keys(values), ['package-dir'], 'verify accepts only --package-dir');
    return { command, options: { packageDir: values['package-dir'] } };
  }
  for (const key of Object.keys(values)) assert.ok(BUILD_FLAGS.has(key), `unsupported build flag --${key}`);
  return {
    command,
    options: Object.fromEntries(Object.entries(values).map(([key, value]) => [
      key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()),
      value,
    ])),
  };
}

async function main() {
  try {
    const { command, options } = parseCli(process.argv.slice(2));
    const manifest = command === 'build'
      ? await buildReleasePackage(options)
      : await verifyReleasePackage(options.packageDir);
    console.log(JSON.stringify({
      ok: true,
      command,
      packageSha256: manifest.packageSha256,
      targetSha: manifest.targetSha,
      fileCount: manifest.files.length,
    }));
  } catch (error) {
    console.error(`build-cloudflare-release-package: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
