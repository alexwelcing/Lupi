#!/usr/bin/env -S npx tsx
/**
 * export-scale-fixtures.mts — copies LupiScale's golden fixtures, written by
 * the TypeScript reference (packages/core/scripts/write-scale-fixtures.mts),
 * to where the Swift package's tests read them:
 *
 *   packages/core/src/scale/__fixtures__/scale-v1.json
 *     → apps/apple/LupiScale/Tests/Fixtures/scale-v1.json
 *
 *   pnpm exec tsx tools/apple/export-scale-fixtures.mts
 *   pnpm exec tsx tools/apple/export-scale-fixtures.mts --check   # exit 1 when stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE = path.join(ROOT, 'packages/core/src/scale/__fixtures__/scale-v1.json');
const TARGET = path.join(ROOT, 'apps/apple/LupiScale/Tests/Fixtures/scale-v1.json');

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!fs.existsSync(SOURCE)) {
    console.error(`${path.relative(ROOT, SOURCE)} is missing: run pnpm exec tsx packages/core/scripts/write-scale-fixtures.mts`);
    process.exit(1);
  }
  const source = fs.readFileSync(SOURCE);
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET) : null;
    if (!current || !current.equals(source)) {
      console.error(`${path.relative(ROOT, TARGET)} is stale: run pnpm exec tsx tools/apple/export-scale-fixtures.mts`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(TARGET), { recursive: true });
    fs.writeFileSync(TARGET, source);
    console.log(`wrote ${path.relative(ROOT, TARGET)} (${(source.length / 1024).toFixed(0)} KB)`);
  }
}
