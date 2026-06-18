import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = path.join(repoRoot, 'deploy_bundle');
const distSource = path.join(repoRoot, 'apps', 'web', 'dist');
const serveSource = path.join(repoRoot, 'tools', 'serve-web.mjs');

function assertInsideRepo(target) {
  const relative = path.relative(repoRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside repo: ${target}`);
  }
}

async function main() {
  assertInsideRepo(bundleRoot);

  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(path.join(bundleRoot, 'apps', 'web'), { recursive: true });
  await mkdir(path.join(bundleRoot, 'tools'), { recursive: true });

  await cp(distSource, path.join(bundleRoot, 'apps', 'web', 'dist'), {
    recursive: true,
    force: true,
  });
  await cp(serveSource, path.join(bundleRoot, 'tools', 'serve-web.mjs'), {
    force: true,
  });

  await writeFile(
    path.join(bundleRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'lupi-live-cloud-run',
        private: true,
        type: 'module',
        engines: { node: '>=20.0.0' },
        scripts: { start: 'node tools/serve-web.mjs' },
      },
      null,
      2
    )}\n`
  );

  await writeFile(
    path.join(bundleRoot, '.gcloudignore'),
    ['.git', 'node_modules', 'npm-debug.log', 'yarn-error.log', 'pnpm-lock.yaml', ''].join('\n')
  );

  console.log(`Cloud Run bundle ready: ${path.relative(repoRoot, bundleRoot)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
