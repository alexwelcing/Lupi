#!/usr/bin/env -S npx tsx
/**
 * fetch-rows.mts — page an OMol25 ColabFit split through the Hugging Face
 * datasets-server rows API and keep a compact local cache.
 *
 * Only what the bond harness reads is cached: atomic numbers, coordinates,
 * the Hill formula, and from `property_metadata` the charge, spin, data_id and
 * Mulliken charges. Pages live under .verify-artifacts/omol25-bonds/ (git
 * ignored), so a re-run is offline.
 *
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx tools/omol25-bonds/fetch-rows.mts
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx tools/omol25-bonds/fetch-rows.mts --dataset colabfit/OMol25_validation --limit 2000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE_ROOT = path.join(ROOT, '.verify-artifacts/omol25-bonds');
export const NEUTRAL_VALIDATION = 'colabfit/OMol25_neutral_validation';

const ROWS_API = 'https://datasets-server.huggingface.co/rows';
const PAGE = 100;

export interface OmolRow {
  /** Hugging Face row index. */
  row: number;
  formula: string;
  z: number[];
  /** Flat x, y, z in Å, as published. */
  pos: number[];
  dataId: string | null;
  charge: number | null;
  spin: number | null;
  mulliken: number[] | null;
  /** True when any cell this row needs came back truncated. */
  truncated: boolean;
}

interface CachedPage {
  dataset: string;
  offset: number;
  total: number;
  rows: OmolRow[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function compactRow(entry: { row_idx: number; row: Record<string, unknown>; truncated_cells?: string[] }): OmolRow {
  const row = entry.row;
  const truncated = (entry.truncated_cells ?? []).some((cell) => ['positions', 'atomic_numbers', 'property_metadata'].includes(cell));
  const z = (typeof row.atomic_numbers === 'string' ? JSON.parse(row.atomic_numbers) : row.atomic_numbers) as number[];
  const positions = row.positions as number[][];
  let meta: Record<string, unknown> = {};
  try {
    meta = typeof row.property_metadata === 'string' ? JSON.parse(row.property_metadata) : (row.property_metadata as Record<string, unknown>) ?? {};
  } catch {
    meta = {};
  }
  const integer = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : null);
  return {
    row: entry.row_idx,
    formula: String(row.chemical_formula_hill ?? ''),
    z: z.map(Number),
    pos: positions.flat().map(Number),
    dataId: typeof meta.data_id === 'string' ? meta.data_id : null,
    charge: integer(meta.charge),
    spin: integer(meta.spin),
    mulliken: Array.isArray(meta.mulliken_charges) ? (meta.mulliken_charges as number[]).map(Number) : null,
    truncated,
  };
}

async function fetchPage(dataset: string, offset: number, length: number): Promise<{ total: number; rows: OmolRow[] }> {
  const url = `${ROWS_API}?dataset=${encodeURIComponent(dataset)}&config=default&split=train&offset=${offset}&length=${length}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) {
        const body = await response.json() as { num_rows_total: number; rows: Array<{ row_idx: number; row: Record<string, unknown>; truncated_cells?: string[] }> };
        return { total: body.num_rows_total, rows: body.rows.map(compactRow) };
      }
      lastError = new Error(`${response.status} ${await response.text().catch(() => '')}`.slice(0, 300));
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(30_000, 1000 * 2 ** attempt));
  }
  throw new Error(`rows ${dataset} offset ${offset}: ${String(lastError)}`);
}

/**
 * Every row of `dataset` from offset 0 (or the first `limit` rows), served
 * from the cache when present and fetched page by page otherwise.
 */
export async function loadRows(options: {
  dataset?: string;
  limit?: number;
  concurrency?: number;
  log?: (line: string) => void;
} = {}): Promise<OmolRow[]> {
  const dataset = options.dataset ?? NEUTRAL_VALIDATION;
  const log = options.log ?? (() => {});
  const dir = path.join(CACHE_ROOT, dataset.replace(/[^A-Za-z0-9_.-]+/g, '__'));
  fs.mkdirSync(dir, { recursive: true });
  const pageFile = (offset: number) => path.join(dir, `rows-${String(offset).padStart(9, '0')}.json`);

  const readCached = (offset: number): CachedPage | null => {
    try {
      return JSON.parse(fs.readFileSync(pageFile(offset), 'utf8')) as CachedPage;
    } catch {
      return null;
    }
  };
  let fetchedPages = 0;
  const getPage = async (offset: number, length: number): Promise<CachedPage> => {
    const cached = readCached(offset);
    if (cached && cached.rows.length === length) return cached;
    fetchedPages += 1;
    const fetched = await fetchPage(dataset, offset, length);
    const page: CachedPage = { dataset, offset, total: fetched.total, rows: fetched.rows };
    fs.writeFileSync(pageFile(offset), JSON.stringify(page));
    return page;
  };

  const first = await getPage(0, Math.min(PAGE, options.limit ?? PAGE));
  const total = Math.min(first.total, options.limit ?? first.total);
  const offsets: number[] = [];
  for (let offset = PAGE; offset < total; offset += PAGE) offsets.push(offset);
  const pages = new Map<number, CachedPage>([[0, first]]);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < offsets.length) {
      const offset = offsets[next];
      next += 1;
      pages.set(offset, await getPage(offset, Math.min(PAGE, total - offset)));
      done += 1;
      if (fetchedPages > 0 && done % 25 === 0) log(`  ${dataset}: ${done}/${offsets.length} pages`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));

  const rows: OmolRow[] = [];
  for (const offset of [0, ...offsets]) rows.push(...pages.get(offset)!.rows);
  rows.forEach((row, index) => {
    if (row.row !== index) throw new Error(`${dataset}: expected row ${index}, cache holds ${row.row}`);
  });
  return rows.slice(0, total);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const rows = await loadRows({
    dataset: flag('--dataset'),
    limit: flag('--limit') ? Number(flag('--limit')) : undefined,
    concurrency: flag('--concurrency') ? Number(flag('--concurrency')) : undefined,
    log: (line) => console.log(line),
  });
  const truncated = rows.filter((row) => row.truncated).length;
  console.log(`${rows.length} rows cached (${truncated} with truncated cells)`);
}
