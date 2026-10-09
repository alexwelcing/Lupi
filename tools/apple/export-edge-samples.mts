#!/usr/bin/env -S npx tsx
/**
 * export-edge-samples.mts — sample responses for LupiData's decoding tests,
 * produced by the code that serves them, so the Swift models track the real
 * shapes without any network in tests:
 *
 *   molecule-manifest.sample.json   /m/manifest.json (moleculeManifest, three pages)
 *   omol25-featured.sample.json     /datasets/omol25/featured.v1.json (first pick)
 *   omol25_nv_<row>.xyz             that pick's committed XYZ (sha256 checked in Swift)
 *   omol25-collections.sample.json  GET /v1/datasets/omol25
 *   omol25-rows.sample.json         GET /v1/datasets/omol25/:collection/rows
 *   omol25-rows-warming.sample.json the 202 a cold search index answers
 *   omol25-structure.sample.xyz     GET …/structures/:row.xyz, and its headers (.headers.json)
 *
 * The OMol25 routes run the Worker's routeScienceData against a stubbed
 * Hugging Face Dataset Viewer.
 *
 *   pnpm exec tsx tools/apple/export-edge-samples.mts [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeScienceData } from '../../apps/mcp-worker/src/scienceData';
import { loadMoleculeSite, moleculeManifest } from '../../scripts/molecule-pages/build.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'apps/apple/LupiKit/Tests/Fixtures/data');
const MANIFEST_PAGES = ['c60_buckyball', 'caffeine', 'water'];

/** Dataset Viewer rows as Hugging Face returns them (shapes from scienceData.test.ts). */
const HF_ROWS = {
  rows: [
    {
      row_idx: 273,
      truncated_cells: [],
      row: {
        atomic_numbers: [8, 1, 1],
        positions: [[0, 0, 0.1173], [0, 0.7572, -0.4692], [0, -0.7572, -0.4692]],
        chemical_formula_hill: 'H2O',
        chemical_formula_reduced: 'H2O',
        elements: ['H', 'O'],
        nsites: 3,
        configuration_id: 'CO_85',
        property_id: 'PO_10',
        method: 'ωB97M-V',
        software: 'ORCA',
        multiplicity: 1,
        energy: -63330.86111298835,
        max_force_norm: 3.0829408336136006,
        names: ['water'],
        property_metadata: JSON.stringify({ charge: 0, spin: 1, data_id: 'orbnet_denali', homo_lumo_gap: [6.386757202393212] }),
      },
    },
    {
      row_idx: 274,
      truncated_cells: ['property_metadata'],
      row: {
        chemical_formula_hill: 'C2H6O',
        elements: ['C', 'H', 'O'],
        nsites: 9,
        configuration_id: 'CO_86',
        method: 'ωB97M-V',
        energy: -4214.5,
        property_metadata: '{"charge": 0, "sp',
      },
    },
  ],
  num_rows_total: 27697,
  partial: false,
};

async function body(route: string, upstream: (url: URL) => Response): Promise<{ status: number; text: string; headers: Headers }> {
  const response = await routeScienceData(new Request(`https://lupi.live${route}`), {
    cache: null,
    fetcher: (async (input: RequestInfo | URL) => upstream(new URL(String(input)))) as typeof fetch,
  });
  if (!response) throw new Error(`${route} is not a science-data route`);
  return { status: response.status, text: await response.text(), headers: response.headers };
}

const json = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });

export async function buildSamples(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  const site = loadMoleculeSite(ROOT);
  const manifest = moleculeManifest(site, true);
  files['molecule-manifest.sample.json'] = `${JSON.stringify(
    { ...manifest, pages: manifest.pages.filter((page) => MANIFEST_PAGES.includes(page.id)) },
    null,
    2,
  )}\n`;

  const featured = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/web/public/datasets/omol25/featured.v1.json'), 'utf8'));
  const pick = featured.picks[0];
  files['omol25-featured.sample.json'] = `${JSON.stringify({ ...featured, picks: [pick] }, null, 2)}\n`;
  files[path.basename(pick.xyz)] = fs.readFileSync(path.join(ROOT, 'apps/web/public', pick.xyz), 'utf8');

  const collections = await body('/v1/datasets/omol25', () => {
    throw new Error('the collections manifest fetches nothing');
  });
  files['omol25-collections.sample.json'] = collections.text;

  const rows = await body('/v1/datasets/omol25/neutral-validation/rows?offset=273&limit=2', () => json(HF_ROWS));
  if (rows.status !== 200) throw new Error(`rows answered ${rows.status}`);
  files['omol25-rows.sample.json'] = rows.text;

  const warming = await body('/v1/datasets/omol25/all-train-preview/rows?query=caffeine', () =>
    json({ error: 'The split index is loading.' }, { status: 500, headers: { 'x-error-code': 'ResponseNotReady' } }));
  if (warming.status !== 202) throw new Error(`warming answered ${warming.status}`);
  files['omol25-rows-warming.sample.json'] = warming.text;

  const structure = await body('/v1/datasets/omol25/neutral-validation/structures/273.xyz', () => json({ rows: [HF_ROWS.rows[0]] }));
  if (structure.status !== 200) throw new Error(`structure answered ${structure.status}`);
  files['omol25-structure.sample.xyz'] = structure.text;
  const headers = Object.fromEntries([...structure.headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
  files['omol25-structure.sample.headers.json'] = `${JSON.stringify(headers, null, 2)}\n`;
  return files;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = await buildSamples();
  const check = process.argv.includes('--check');
  let stale = false;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(OUT_DIR, name);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
        console.error(`${path.relative(ROOT, file)} is stale`);
        stale = true;
      }
    } else {
      fs.writeFileSync(file, text);
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
  }
  if (stale) {
    console.error('run pnpm exec tsx tools/apple/export-edge-samples.mts');
    process.exit(1);
  }
}
