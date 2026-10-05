#!/usr/bin/env -S npx tsx
/**
 * export-validation-sample.mts — the OMol25 rows behind LupiKit's check of
 * its lupi-bonds.molecular.v1 port against packages/core/src/bonds/validation-v1.json.
 *
 * Writes apps/apple/LupiKit/Tests/Fixtures/bonds/validation-sample.json:
 * the validation file's targets, hard results, parameters, hand-check rows and
 * reported totals, and a stratified sample of colabfit/OMol25_neutral_validation
 * rows with the TypeScript perceiveBonds output for each. The sample is every
 * hand-check row; the first rows where each removal reason, each s-block ion,
 * a long bond and an ion near a carbon occur; the largest and smallest rows;
 * and every 1,000th row. `swift test` reproduces the hard targets, the
 * hand-check rows and the TypeScript output on it.
 *
 * Choosing rows reads the local cache of tools/omol25-bonds/fetch-rows.mts.
 * --check needs neither cache nor network: it re-runs perceiveBonds on the
 * committed rows and compares the copied validation blocks.
 *
 * --row-keys FILE writes one line per cached row (row, line count, FNV-1a of
 * the "i-j-kind,…" line key) for the Swift full run, which then checks all
 * 27,697 rows pair for pair (LupiKit README, "Recipe validation").
 *
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx tools/omol25-bonds/fetch-rows.mts   # once, ~250 MB down
 *   pnpm exec tsx tools/apple/export-validation-sample.mts
 *   pnpm exec tsx tools/apple/export-validation-sample.mts --check
 *   pnpm exec tsx tools/apple/export-validation-sample.mts --row-keys .verify-artifacts/omol25-bonds/row-keys.tsv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ELEMENT_CLASS,
  MOLECULAR_RECIPE_ID,
  REMOVAL_REASON,
  elementClass,
  perceiveBonds,
  type PerceivedBonds,
} from '../../packages/core/src/bonds/index';
import { getElementSpec } from '../../packages/core/src/elements';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VALIDATION = path.join(ROOT, 'packages/core/src/bonds/validation-v1.json');
const OUT = path.join(ROOT, 'apps/apple/LupiKit/Tests/Fixtures/bonds/validation-sample.json');
const CACHE = path.join(ROOT, '.verify-artifacts/omol25-bonds/colabfit__OMol25_neutral_validation');
const TOLERANCE = 0.45;
const REASON_NAMES = Object.fromEntries(Object.entries(REMOVAL_REASON).map(([name, code]) => [code, name])) as Record<number, string>;
const IONS = [3, 11, 19, 37, 55, 87, 12, 20, 38, 56, 88];

interface CachedRow {
  row: number;
  formula: string;
  z: number[];
  pos: number[];
  dataId: string | null;
  truncated: boolean;
}

interface SampleRow {
  row: number;
  formula: string;
  dataId: string | null;
  why: string[];
  atomicNumbers: number[];
  positions: number[];
}

const f32 = (values: ArrayLike<number>) => Array.from(values, (v) => Math.fround(v));

function perceive(atomicNumbers: number[], positions: ArrayLike<number>): PerceivedBonds {
  return perceiveBonds({
    atomicNumbers,
    positions: Float32Array.from(positions),
    natoms: atomicNumbers.length,
    tolerance: TOLERANCE,
    recipe: MOLECULAR_RECIPE_ID,
  });
}

/** run.mts's line key: "i-j-kind" per drawn line. */
function lineKey(p: PerceivedBonds): string {
  const parts: string[] = [];
  for (let k = 0; k < p.count; k += 1) parts.push(`${p.pairs[2 * k]}-${p.pairs[2 * k + 1]}-${p.kinds[k]}`);
  return parts.join(',');
}

function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let k = 0; k < text.length; k += 1) hash = Math.imul(hash ^ text.charCodeAt(k), 0x01000193) >>> 0;
  return hash;
}

function loadCache(): CachedRow[] {
  if (!fs.existsSync(CACHE)) {
    throw new Error(`no row cache at ${path.relative(ROOT, CACHE)}: run NODE_USE_ENV_PROXY=1 pnpm exec tsx tools/omol25-bonds/fetch-rows.mts`);
  }
  const rows: CachedRow[] = [];
  for (const file of fs.readdirSync(CACHE).filter((name) => /^rows-\d+\.json$/.test(name)).sort()) {
    rows.push(...(JSON.parse(fs.readFileSync(path.join(CACHE, file), 'utf8')) as { rows: CachedRow[] }).rows);
  }
  rows.forEach((row, index) => {
    if (row.row !== index) throw new Error(`cache: expected row ${index}, found ${row.row}`);
  });
  return rows;
}

/** Every hand-check row, then the first few rows that exercise each rule, then a spread. */
function chooseRows(rows: CachedRow[], handCheck: number[]): SampleRow[] {
  const chosen = new Map<number, Set<string>>();
  const pick = (row: number, why: string) => {
    if (!chosen.has(row)) chosen.set(row, new Set());
    chosen.get(row)!.add(why);
  };
  for (const row of handCheck) pick(row, 'handCheck');
  const quota = new Map<string, number>();
  const want = (why: string, limit: number, row: number) => {
    const taken = quota.get(why) ?? 0;
    if (taken >= limit) return;
    quota.set(why, taken + 1);
    pick(row, why);
  };
  let largest = rows[0];
  let smallest = rows[0];
  for (const row of rows) {
    if (row.truncated) continue;
    const p = perceive(row.z, row.pos);
    for (const reason of new Set(Array.from(p.evidence?.reasons ?? [], (code) => REASON_NAMES[code]))) want(`removed:${reason}`, 6, row.row);
    for (const z of new Set(row.z.filter((z) => IONS.includes(z)))) want(`ion:${getElementSpec(z).symbol}`, 4, row.row);
    if (p.counts.long > 0) want('long', 6, row.row);
    if (p.counts.ionCarbonClose > 0) want('ionCarbonClose', 6, row.row);
    if (p.counts.coordination > 0) want('coordination', 4, row.row);
    if (row.row % 1000 === 0) pick(row.row, 'spread');
    if (row.z.length > largest.z.length) largest = row;
    if (row.z.length < smallest.z.length) smallest = row;
  }
  pick(largest.row, 'largest');
  pick(smallest.row, 'smallest');
  return [...chosen.keys()].sort((a, b) => a - b).map((index) => ({
    row: index,
    formula: rows[index].formula,
    dataId: rows[index].dataId,
    why: [...chosen.get(index)!].sort(),
    atomicNumbers: rows[index].z,
    positions: f32(rows[index].pos),
  }));
}

/** The committed rows, with the TypeScript output for each and the validation blocks Swift checks against. */
function build(sample: SampleRow[]) {
  const validation = JSON.parse(fs.readFileSync(VALIDATION, 'utf8'));
  const reported = validation.reported;
  return {
    schema: 'lupi.apple-fixtures.validation-sample.v1',
    generator: 'tools/apple/export-validation-sample.mts',
    validation: {
      schema: validation.schema,
      recipe: validation.recipe,
      dataset: validation.dataset,
      rows: validation.rows,
      tolerance: validation.tolerance,
      pass: validation.pass,
      targets: validation.targets,
      hard: validation.hard,
      parameters: validation.parameters,
      handCheck: validation.handCheck,
      reported: {
        kinds: reported.kinds,
        removedByReason: reported.removedByReason,
        ions: reported.ions,
        isolatedIons: reported.isolatedIons,
        ionContactHistogram: reported.ionContactHistogram,
        contactPartners: reported.contactPartners,
        saltRows: reported.saltRows,
        bridgedBoraneRows: reported.bridgedBoraneRows,
        bridgingH: reported.bridgingH,
        longBondRows: reported.longBondRows,
        longBonds: reported.longBonds,
        nearMissPairs: reported.nearMissPairs,
        clashRows: reported.clashRows,
        ionCarbonCloseRows: reported.ionCarbonCloseRows,
        truncatedRows: reported.truncatedRows,
        timing350Atoms: reported.timing350Atoms,
      },
    },
    rows: sample.map((row) => {
      const p = perceive(row.atomicNumbers, row.positions);
      return {
        ...row,
        run: {
          pairs: Array.from(p.pairs),
          kinds: Array.from(p.kinds),
          distances: f32(p.distances),
          counts: p.counts,
          evidence: p.evidence ? { pairs: Array.from(p.evidence.pairs), reasons: Array.from(p.evidence.reasons) } : null,
        },
      };
    }),
  };
}

function writeRowKeys(file: string) {
  const rows = loadCache();
  const lines = rows.map((row) => {
    const p = perceive(row.z, row.pos);
    return `${row.row}\t${p.count}\t${fnv1a32(lineKey(p)).toString(16).padStart(8, '0')}`;
  });
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`wrote ${file} (${rows.length} rows)`);
}

const argv = process.argv.slice(2);
const rowKeysIndex = argv.indexOf('--row-keys');
if (rowKeysIndex >= 0) {
  writeRowKeys(argv[rowKeysIndex + 1]);
} else if (argv.includes('--check')) {
  const current = JSON.parse(fs.readFileSync(OUT, 'utf8')) as { rows: SampleRow[] };
  const sample = current.rows.map(({ row, formula, dataId, why, atomicNumbers, positions }) => ({ row, formula, dataId, why, atomicNumbers, positions }));
  const text = `${JSON.stringify(build(sample))}\n`;
  if (fs.readFileSync(OUT, 'utf8') !== text) {
    console.error(`${path.relative(ROOT, OUT)} is stale: run pnpm exec tsx tools/apple/export-validation-sample.mts`);
    process.exit(1);
  }
} else {
  const validation = JSON.parse(fs.readFileSync(VALIDATION, 'utf8'));
  const sample = chooseRows(loadCache(), Object.keys(validation.handCheck).map(Number));
  const text = `${JSON.stringify(build(sample))}\n`;
  fs.writeFileSync(OUT, text);
  const ionic = sample.filter((row) => row.atomicNumbers.some((z) => elementClass(z) === ELEMENT_CLASS.ion)).length;
  console.log(`wrote ${path.relative(ROOT, OUT)} (${sample.length} rows, ${ionic} with s-block ions, ${(text.length / 1024).toFixed(0)} KB)`);
}
