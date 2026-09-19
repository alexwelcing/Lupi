#!/usr/bin/env node
/**
 * build-omol25-validation-index.mjs — same-origin OMol25 validation index.
 *
 * The faceted OMol25 view needs a compact, whole-slice index of the 27,697-row
 * public neutral-validation conversion (colabfit/OMol25_neutral_validation).
 * Earlier builds served that index and one XYZ per structure from a GCS bucket
 * outside the Cloudflare estate. This tool binds the index to the dataset edge
 * instead: record i IS Hugging Face row i, so a hit opens through
 * `/v1/datasets/omol25/neutral-validation/structures/{i}.xyz` and no external
 * bucket is needed at runtime.
 *
 * Source: the v3 index built by tools/omol25-structures.py (records carry the
 * geometry-derived functional-group screen, which is a Lupi search aid, not
 * OMol25 bond topology). Every run spot-checks a sample of rows against the
 * live edge and refuses to write when formula or atom count disagree.
 *
 * Usage:
 *   node tools/build-omol25-validation-index.mjs                 # fetch v3 from GCS, verify against lupi.live
 *   node tools/build-omol25-validation-index.mjs --source x.json # local v3 copy
 *   node tools/build-omol25-validation-index.mjs --edge http://127.0.0.1:8787 --sample 8
 *   node tools/build-omol25-validation-index.mjs --no-verify     # offline; receipt records verification as skipped
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const SOURCE = flag('--source', 'https://storage.googleapis.com/shed-489901-omol25/omol25_neutral_val.v3.json');
const EDGE = flag('--edge', 'https://lupi.live').replace(/\/+$/, '');
const SAMPLE = Number.parseInt(flag('--sample', '24'), 10);
const VERIFY = !argv.includes('--no-verify');
const COLLECTION = 'neutral-validation';
const REPOSITORY = 'colabfit/OMol25_neutral_validation';
const OUT_DIR = path.join(root, 'apps/web/public/datasets/omol25');
const VERSION = 'v4';

function elementsOf(formula) {
  return [...new Set(formula.match(/[A-Z][a-z]?/g) ?? [])].sort();
}

async function readSource(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Source index fetch failed: ${response.status}`);
    return response.json();
  }
  return JSON.parse(readFileSync(path.resolve(source), 'utf8'));
}

async function edgeRow(index) {
  const response = await fetch(`${EDGE}/v1/datasets/omol25/${COLLECTION}/rows?offset=${index}&limit=1`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Edge row ${index} failed: ${response.status}`);
  const body = await response.json();
  const row = body.rows?.[0];
  if (!row || row.rowIndex !== index) throw new Error(`Edge returned no row for index ${index}`);
  return row;
}

const source = await readSource(SOURCE);
const records = source.records;
if (!Array.isArray(records) || records.length === 0) throw new Error('Source index has no records.');
records.forEach((record, i) => {
  if (record.id !== `nval-${i}`) throw new Error(`Record ${i} is ${record.id}; the index is not in row order.`);
});

const groups = [...new Set(records.flatMap((record) => record.functionalGroups ?? []))].sort();
if (groups.length > 31) throw new Error('Functional-group bitmask supports at most 31 groups.');
const groupBit = new Map(groups.map((id, i) => [id, 1 << i]));

const compact = records.map((record) => {
  const natoms = Number(record.natoms);
  if (!Number.isInteger(natoms) || natoms <= 0) throw new Error(`Record ${record.id} has no atom count.`);
  let mask = 0;
  for (const id of record.functionalGroups ?? []) mask |= groupBit.get(id);
  return mask ? [record.formula, natoms, mask] : [record.formula, natoms];
});

const checks = [];
if (VERIFY) {
  const picks = new Set([0, records.length - 1]);
  let seed = 0x9e3779b9;
  while (picks.size < Math.min(SAMPLE, records.length)) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    picks.add(seed % records.length);
  }
  for (const index of [...picks].sort((a, b) => a - b)) {
    const row = await edgeRow(index);
    const expected = records[index];
    const ok = row.formula === expected.formula && row.atomCount === expected.natoms;
    checks.push({ row: index, formula: expected.formula, atoms: expected.natoms, edgeFormula: row.formula, edgeAtoms: row.atomCount, ok });
    if (!ok) throw new Error(`Row ${index} disagrees with the edge: index ${expected.formula}/${expected.natoms}, edge ${row.formula}/${row.atomCount}.`);
  }
}

const elementCounts = new Map();
const groupCounts = new Map(groups.map((id) => [id, 0]));
const sizes = [];
for (const [formula, natoms, mask = 0] of compact) {
  for (const symbol of elementsOf(formula)) elementCounts.set(symbol, (elementCounts.get(symbol) ?? 0) + 1);
  for (const [id, bit] of groupBit) if (mask & bit) groupCounts.set(id, groupCounts.get(id) + 1);
  sizes.push(natoms);
}
sizes.sort((a, b) => a - b);

const index = {
  schema: `lupi.omol25-validation-index.${VERSION}`,
  dataset: REPOSITORY,
  collection: COLLECTION,
  count: compact.length,
  rowsUrl: `/v1/datasets/omol25/${COLLECTION}/rows`,
  structureUrl: `/v1/datasets/omol25/${COLLECTION}/structures/{row}.xyz`,
  sourceTruth: { coordinates: 'source', bondTopology: 'not-provided' },
  functionalGroupMethod: `${source.functionalGroupMethod ?? 'geometry-derived heuristic'} (Lupi screen over source coordinates; not OMol25 bond topology)`,
  groups,
  fields: ['formula', 'atomCount', 'functionalGroupMask'],
  records: compact,
};
const facets = {
  schema: `lupi.omol25-validation-facets.${VERSION}`,
  total: compact.length,
  elementCounts: [...elementCounts].map(([element, count]) => ({ element, count })).sort((a, b) => b.count - a.count || a.element.localeCompare(b.element)),
  functionalGroupCounts: [...groupCounts].map(([id, count]) => ({ id, count })).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count),
  natoms: { min: sizes[0], max: sizes[sizes.length - 1], median: sizes[Math.floor(sizes.length / 2)] },
};

mkdirSync(OUT_DIR, { recursive: true });
const indexJson = JSON.stringify(index);
const facetsJson = JSON.stringify(facets);
writeFileSync(path.join(OUT_DIR, `${COLLECTION}.${VERSION}.json`), `${indexJson}\n`);
writeFileSync(path.join(OUT_DIR, `${COLLECTION}.${VERSION}.facets.json`), `${JSON.stringify(facets, null, 2)}\n`);
const receipt = {
  builtAt: new Date().toISOString(),
  source: SOURCE,
  sourceIndexVersion: source.indexVersion ?? null,
  edge: VERIFY ? EDGE : null,
  verification: VERIFY ? { sampled: checks.length, allMatched: checks.every((check) => check.ok), checks } : { skipped: true },
  index: { bytes: Buffer.byteLength(indexJson), sha256: createHash('sha256').update(indexJson).digest('hex'), count: compact.length },
  facets: { bytes: Buffer.byteLength(facetsJson), sha256: createHash('sha256').update(facetsJson).digest('hex') },
};
writeFileSync(path.join(OUT_DIR, `${COLLECTION}.${VERSION}.receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ count: compact.length, groups: groups.length, verified: checks.length, indexBytes: receipt.index.bytes, facetsBytes: receipt.facets.bytes }, null, 2));
