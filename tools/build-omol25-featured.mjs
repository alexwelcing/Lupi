#!/usr/bin/env node
/**
 * build-omol25-featured.mjs: the same-origin OMol25 featured picks.
 *
 * Reads the hand-edited tools/omol25-featured.picks.json (neutral-validation
 * rows with a shelf, a home flag and why each was chosen) and writes:
 *   apps/web/public/datasets/omol25/featured/omol25_nv_<row>.xyz
 *       byte-for-byte what the edge serves for that row (the edge module
 *       builds it), so the comment line follows the contract: charge,
 *       multiplicity, charge_source, data_id, energy, force, gap,
 *       bonds=not-provided, no Properties=;
 *   apps/web/public/datasets/omol25/featured.v1.json
 *       lupi.omol25-featured.v1, the agent-parity record of every pick with
 *       its sha256 receipt;
 *   packages/ui/src/landing/omolShelf.data.ts
 *       the landing-safe slice the home shelf renders (imports nothing);
 *   .verify-artifacts/omol25-featured/contact-sheet.html
 *       a curation sheet (not committed).
 *
 * Gates, all fatal: neutral-validation rows only; charge and spin from the
 * record; 12-120 atoms; no pair closer than 0.7 Å; under perceiveBonds
 * (lupi-bonds.molecular.v1, τ 0.45) every H has exactly one covalent partner
 * (two only when both are B), no atom exceeds its covalent cap and no
 * s-block ion has a covalent stick; across the set every neutral-lane
 * element appears, every shelf is filled and at least 12 picks are home.
 * Titles are Hill formulas; names are not resolved here.
 *
 * Needs the network (Hugging Face rows API) and @atlas/core/bonds, so it runs
 * once by hand and its output is committed; the web build never fetches.
 * TypeScript sources are imported directly, so run it with tsx:
 *
 *   pnpm exec tsx tools/build-omol25-featured.mjs            # fetch, gate, write
 *   pnpm exec tsx tools/build-omol25-featured.mjs --reuse    # keep committed XYZ files, fetch only new rows
 *   pnpm exec tsx tools/build-omol25-featured.mjs --check    # no network: re-gate committed files, exit 1 when stale
 *   pnpm exec tsx tools/build-omol25-featured.mjs --dry-run <dir> [--no-bond-gate]
 *       write everything under <dir> instead of the repository (plumbing check)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flagValue = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const CHECK = argv.includes('--check');
const REUSE = argv.includes('--reuse') || CHECK;
const DRY_RUN = flagValue('--dry-run');
const NO_BOND_GATE = argv.includes('--no-bond-gate');
if (NO_BOND_GATE && !DRY_RUN) {
  console.error('--no-bond-gate is only allowed with --dry-run: committed picks must pass perceiveBonds.');
  process.exit(2);
}

const PICKS_FILE = path.join(root, 'tools/omol25-featured.picks.json');
const OUT_ROOT = DRY_RUN ? path.resolve(DRY_RUN) : root;
const XYZ_DIR = path.join(OUT_ROOT, 'apps/web/public/datasets/omol25/featured');
const JSON_FILE = path.join(OUT_ROOT, 'apps/web/public/datasets/omol25/featured.v1.json');
const DATA_FILE = path.join(OUT_ROOT, 'packages/ui/src/landing/omolShelf.data.ts');
const SHEET_FILE = path.join(DRY_RUN ? OUT_ROOT : path.join(root, '.verify-artifacts/omol25-featured'), 'contact-sheet.html');
const COMMITTED_JSON = path.join(root, 'apps/web/public/datasets/omol25/featured.v1.json');
const COMMITTED_XYZ_DIR = path.join(root, 'apps/web/public/datasets/omol25/featured');

/** Covalent caps of the neutral-lane elements (contract classes.ts); halogens also allow one non-O/F partner. */
const COVALENT_CAP = new Map([[1, 1], [5, 4], [6, 4], [7, 4], [8, 3], [9, 1], [14, 6], [15, 6], [16, 6], [17, 7], [35, 7], [53, 7]]);
const HALOGENS = new Set([17, 35, 53]);
const S_BLOCK_IONS = new Set([3, 11, 19, 37, 55, 87, 12, 20, 38, 56, 88]);

async function importTs(relative, what) {
  try {
    return await import(path.join(root, relative));
  } catch (error) {
    const hint = /Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION/.test(String(error))
      ? ' Run this tool with tsx: pnpm exec tsx tools/build-omol25-featured.mjs'
      : '';
    throw new Error(`Could not load ${what} (${relative}).${hint}\n${error instanceof Error ? error.message : error}`);
  }
}

const omol = await importTs('packages/core/src/omol25/index.ts', '@atlas/core/omol25');
const { getAtomicNumberBySymbol, getElementSpec } = await importTs('packages/core/src/elements.ts', '@atlas/core/elements');
const bonds = NO_BOND_GATE ? null : await importTs('packages/core/src/bonds/index.ts', '@atlas/core/bonds (Track A)');
const edge = CHECK ? null : await importTs('apps/mcp-worker/src/scienceData.ts', 'the edge science-data module');

function readPicks() {
  const parsed = JSON.parse(readFileSync(PICKS_FILE, 'utf8'));
  const picks = Array.isArray(parsed) ? parsed : parsed.picks;
  if (!Array.isArray(picks) || picks.length === 0) throw new Error('omol25-featured.picks.json has no picks.');
  if (picks.length > omol.OMOL25_FEATURED_LIMITS.maxPicks) {
    throw new Error(`At most ${omol.OMOL25_FEATURED_LIMITS.maxPicks} picks; found ${picks.length}.`);
  }
  const rows = new Set();
  for (const [index, pick] of picks.entries()) {
    const label = `picks[${index}]`;
    if (pick.collection !== 'neutral-validation') throw new Error(`${label}: only neutral-validation rows have a verified 1:1 row map.`);
    if (!Number.isSafeInteger(pick.row) || pick.row < 0) throw new Error(`${label}: row must be a non-negative integer.`);
    if (rows.has(pick.row)) throw new Error(`${label}: row ${pick.row} is listed twice.`);
    rows.add(pick.row);
    if (!omol.OMOL25_SHELVES.includes(pick.shelf)) throw new Error(`${label}: unknown shelf ${pick.shelf}.`);
    if (typeof pick.home !== 'boolean') throw new Error(`${label}: home must be true or false.`);
    if (typeof pick.why !== 'string' || !pick.why.trim()) throw new Error(`${label}: say why the row was picked.`);
  }
  return picks;
}

async function fetchEdgeXyz(row) {
  const url = `https://lupi.live${omol.omolStructurePath('neutral-validation', row)}`;
  let last = '';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await edge.routeScienceData(new Request(url), { cache: null });
    if (response?.status === 200) return response.text();
    last = response ? `${response.status} ${await response.text()}` : 'no route';
    if (response && response.status < 500 && response.status !== 202) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
  }
  throw new Error(`row ${row}: the edge module could not build the XYZ (${last.trim().slice(0, 200)}).`);
}

function parseXyz(text, row) {
  const lines = text.split('\n');
  const count = Number(lines[0]);
  if (!Number.isInteger(count) || count <= 0) throw new Error(`row ${row}: bad atom count line.`);
  const comment = lines[1] ?? '';
  const fields = new Map();
  const [head, ...pairs] = comment.split(' | ');
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq > 0) fields.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  if (head !== `OMol25 neutral-validation row=${row}`) throw new Error(`row ${row}: unexpected comment head "${head}".`);
  if (comment.includes('Properties=')) throw new Error(`row ${row}: the comment must not carry Properties=.`);
  const atomicNumbers = new Uint8Array(count);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const [symbol, x, y, z] = (lines[i + 2] ?? '').trim().split(/\s+/);
    const zNumber = getAtomicNumberBySymbol(symbol);
    const xyz = [Number(x), Number(y), Number(z)];
    if (!zNumber || !xyz.every(Number.isFinite)) throw new Error(`row ${row}: bad atom line ${i + 3}.`);
    atomicNumbers[i] = zNumber;
    positions.set(xyz, i * 3);
  }
  return { count, fields, atomicNumbers, positions };
}

function minPairDistance(positions, n) {
  let best = Infinity;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = positions[3 * i] - positions[3 * j];
      const dy = positions[3 * i + 1] - positions[3 * j + 1];
      const dz = positions[3 * i + 2] - positions[3 * j + 2];
      best = Math.min(best, dx * dx + dy * dy + dz * dz);
    }
  }
  return Math.sqrt(best);
}

/** The drawability gate under the molecular recipe; returns problems (empty = drawable) and the result. */
function bondGate(atomicNumbers, positions, n) {
  const perceived = bonds.perceiveBonds({
    atomicNumbers,
    positions,
    natoms: n,
    tolerance: bonds.DEFAULT_BOND_TOLERANCE,
    recipe: bonds.MOLECULAR_RECIPE_ID,
  });
  const covalent = Array.from({ length: n }, () => []);
  let sBlockSticks = 0;
  for (let k = 0; k < perceived.count; k += 1) {
    if (perceived.kinds[k] !== bonds.BOND_KIND.covalent) continue;
    const i = perceived.pairs[2 * k];
    const j = perceived.pairs[2 * k + 1];
    covalent[i].push(j);
    covalent[j].push(i);
    if (S_BLOCK_IONS.has(atomicNumbers[i]) || S_BLOCK_IONS.has(atomicNumbers[j])) sBlockSticks += 1;
  }
  const problems = [];
  if (sBlockSticks > 0) problems.push(`${sBlockSticks} covalent s-block stick(s)`);
  for (let i = 0; i < n; i += 1) {
    const z = atomicNumbers[i];
    const partners = covalent[i];
    const symbol = getElementSpec(z).symbol;
    if (z === 1) {
      const bridging = partners.length === 2 && partners.every((p) => atomicNumbers[p] === 5);
      if (partners.length !== 1 && !bridging) problems.push(`H${i} has ${partners.length} covalent partners`);
      continue;
    }
    if (S_BLOCK_IONS.has(z)) continue;
    const cap = COVALENT_CAP.get(z);
    if (cap === undefined) {
      problems.push(`${symbol}${i} is outside the neutral-lane elements`);
    } else if (partners.length > cap) {
      problems.push(`${symbol}${i} is over-valent (${partners.length} > ${cap})`);
    } else if (HALOGENS.has(z) && partners.filter((p) => atomicNumbers[p] !== 8 && atomicNumbers[p] !== 9).length > 1) {
      problems.push(`${symbol}${i} has more than one non-O/F partner`);
    }
  }
  return { problems, perceived };
}

function numberField(fields, key) {
  if (!fields.has(key)) return null;
  const value = Number(fields.get(key));
  return Number.isFinite(value) ? value : null;
}

function buildPick(spec, xyzText, fetchedAt) {
  const { row } = spec;
  const { count, fields, atomicNumbers, positions } = parseXyz(xyzText, row);
  const formula = fields.get('formula');
  const parsedFormula = omol.parseOmolFormula(formula ?? '');
  if (!parsedFormula) throw new Error(`row ${row}: formula "${formula}" is not a Hill formula.`);
  if (fields.get('charge_source') !== 'record') throw new Error(`row ${row}: charge and spin must come from the record (got ${fields.get('charge_source')}).`);

  const problems = [];
  const { minAtoms, maxAtoms, minDistanceA } = omol.OMOL25_FEATURED_LIMITS;
  if (count < minAtoms || count > maxAtoms) problems.push(`${count} atoms is outside ${minAtoms}-${maxAtoms}`);
  const dMin = minPairDistance(positions, count);
  if (dMin < minDistanceA) problems.push(`closest pair ${dMin.toFixed(3)} Å < ${minDistanceA} Å`);
  let perceived = null;
  if (bonds) {
    const gate = bondGate(atomicNumbers, positions, count);
    problems.push(...gate.problems);
    perceived = gate.perceived;
  }
  if (problems.length > 0) throw new Error(`row ${row} (${formula}) fails the featured gate: ${problems.join('; ')}.`);

  const domain = fields.get('data_id') ?? null;
  const pick = {
    id: omol.omolPickKey(row),
    collection: 'neutral-validation',
    dataset: omol.OMOL25_FEATURED_DATASET,
    row,
    configurationId: fields.get('configuration_id'),
    propertyId: fields.get('property_id'),
    formula,
    atoms: count,
    elements: parsedFormula.map(([symbol]) => symbol),
    shelf: spec.shelf,
    home: spec.home,
    domain,
    domainLabel: omol.omolDomainLabel(domain),
    charge: numberField(fields, 'charge'),
    spinMultiplicity: numberField(fields, 'multiplicity'),
    chargeSource: 'record',
    energyEv: numberField(fields, 'energy_eV'),
    maxForceEvPerA: numberField(fields, 'max_force_eV_per_A'),
    homoLumoGapEv: numberField(fields, 'homo_lumo_gap_eV'),
    title: formula,
    name: null,
    xyz: omol.omolFeaturedPath(row),
    edge: omol.omolStructurePath('neutral-validation', row),
    ink: omol.omolPickInkPath(row),
    sha256: createHash('sha256').update(xyzText, 'utf8').digest('hex'),
    fetchedAt,
    bondRecipe: omol.OMOL25_FEATURED_BOND_RECIPE,
  };
  const errors = omol.validateOmolFeaturedPick(pick, pick.id);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { pick, atomicNumbers, positions, perceived, dMin, why: spec.why };
}

const tsString = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const SHELF_DATA_HEAD = `// Generated by tools/build-omol25-featured.mjs from tools/omol25-featured.picks.json. Do not edit.
// Landing-safe: imports nothing. One compact row per pick keeps the landing chunk under 1 KB gzip.

export interface OmolPick {
  id: string;
  title: string;
  formula: string;
  atoms: number;
  elements: string[];
  shelf: string;
  home: boolean;
  domainLabel: string;
  charge: number;
  spinMultiplicity: number;
  maxForceEvPerA: number | null;
  file: string;
  ink: string;
}

type Row = readonly [row: number, title: string | null, formula: string, atoms: number, shelf: string, home: 0 | 1, domainLabel: string, charge: number, spinMultiplicity: number, maxForceEvPerA: number | null];

const ROWS: readonly Row[] = [`;

const SHELF_DATA_TAIL = `];

export const OMOL_PICKS: readonly OmolPick[] = ROWS.map(([row, title, formula, atoms, shelf, home, domainLabel, charge, spinMultiplicity, maxForceEvPerA]) => ({
  id: \`omol25_nv_\${row}\`,
  title: title ?? formula,
  formula,
  atoms,
  elements: formula.match(/[A-Z][a-z]?/g) ?? [],
  shelf,
  home: home === 1,
  domainLabel,
  charge,
  spinMultiplicity,
  maxForceEvPerA,
  file: \`/datasets/omol25/featured/omol25_nv_\${row}.xyz\`,
  ink: \`/og/omol25/omol25_nv_\${row}-ink.svg\`,
}));
`;

/** The same expansion the generated module runs, so the build can prove it equals omolShelfPick. */
function expandShelfRow([row, title, formula, atoms, shelf, home, domainLabel, charge, spinMultiplicity, maxForceEvPerA]) {
  return {
    id: `omol25_nv_${row}`,
    title: title ?? formula,
    formula,
    atoms,
    elements: formula.match(/[A-Z][a-z]?/g) ?? [],
    shelf,
    home: home === 1,
    domainLabel,
    charge,
    spinMultiplicity,
    maxForceEvPerA,
    file: `/datasets/omol25/featured/omol25_nv_${row}.xyz`,
    ink: `/og/omol25/omol25_nv_${row}-ink.svg`,
  };
}

function shelfDataSource(picks) {
  const rows = picks.map((p) => {
    const shelf = omol.omolShelfPick(p);
    const row = [p.row, shelf.title === shelf.formula ? null : shelf.title, shelf.formula, shelf.atoms, shelf.shelf, shelf.home ? 1 : 0, shelf.domainLabel, shelf.charge, shelf.spinMultiplicity, shelf.maxForceEvPerA];
    if (JSON.stringify(expandShelfRow(row)) !== JSON.stringify(shelf)) {
      throw new Error(`${p.id}: the compact landing row does not expand to its shelf pick.`);
    }
    return `  [${row.map((v) => (typeof v === 'string' ? tsString(v) : String(v))).join(', ')}],`;
  });
  return [SHELF_DATA_HEAD, ...rows, SHELF_DATA_TAIL].join('\n');
}

/** Gzip size of the module as the landing chunk ships it (types and comments stripped). */
async function shippedJsGzip(source) {
  const { default: ts } = await import('typescript');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true },
  }).outputText;
  return gzipSync(Buffer.from(js)).byteLength;
}

/** A flat 2D drawing per pick (principal-axis projection) for curation; never shipped. */
function contactSheet(built) {
  const KIND_STYLE = ['stroke="#6b7a78" stroke-width="1.6"', 'stroke="#b7c4c1" stroke-width="1.1" stroke-dasharray="3 2"', 'stroke="#b7c4c1" stroke-width="1" stroke-dasharray="1 2.5"'];
  const tile = ({ pick, atomicNumbers, positions, perceived, dMin, why }) => {
    const n = pick.atoms;
    const c = [0, 0, 0];
    for (let i = 0; i < n; i += 1) for (let a = 0; a < 3; a += 1) c[a] += positions[3 * i + a] / n;
    const p = Array.from({ length: n }, (_, i) => [0, 1, 2].map((a) => positions[3 * i + a] - c[a]));
    const axis = (exclude) => {
      let v = [1, 0.7, 0.3];
      for (let it = 0; it < 50; it += 1) {
        const w = [0, 0, 0];
        for (const q of p) {
          const d = q[0] * v[0] + q[1] * v[1] + q[2] * v[2];
          for (let a = 0; a < 3; a += 1) w[a] += d * q[a];
        }
        if (exclude) {
          const d = w[0] * exclude[0] + w[1] * exclude[1] + w[2] * exclude[2];
          for (let a = 0; a < 3; a += 1) w[a] -= d * exclude[a];
        }
        const len = Math.hypot(...w) || 1;
        v = w.map((x) => x / len);
      }
      return v;
    };
    const ex = axis(null);
    const ey = axis(ex);
    const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
    const proj = p.map((q) => [0, 1, 2].map((k) => { const e = [ex, ey, ez][k]; return q[0] * e[0] + q[1] * e[1] + q[2] * e[2]; }));
    const span = Math.max(1, ...proj.map((q) => Math.max(Math.abs(q[0]), Math.abs(q[1])))) + 1;
    const s = 100 / span;
    const xy = (q) => [(110 + q[0] * s).toFixed(1), (110 - q[1] * s).toFixed(1)];
    const lines = [];
    if (perceived) {
      for (let k = 0; k < perceived.count; k += 1) {
        const [x1, y1] = xy(proj[perceived.pairs[2 * k]]);
        const [x2, y2] = xy(proj[perceived.pairs[2 * k + 1]]);
        lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${KIND_STYLE[perceived.kinds[k]] ?? KIND_STYLE[0]}/>`);
      }
    }
    const order = proj.map((q, i) => [q[2], i]).sort((a, b) => a[0] - b[0]);
    const atoms = order.map(([, i]) => {
      const [x, y] = xy(proj[i]);
      const spec = getElementSpec(atomicNumbers[i]);
      const r = Math.max(2.5, Math.min(9, spec.displayRadius * s * 0.55));
      return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${spec.color}" stroke="#101817" stroke-width="0.8"/>`;
    });
    const counts = perceived?.counts;
    const facts = [
      `${pick.shelf}${pick.home ? ' · home' : ''}`,
      `${pick.domainLabel} · ${pick.atoms} atoms · dmin ${dMin.toFixed(2)} Å`,
      omol.omolGeometryState(pick.maxForceEvPerA) ?? '',
      counts ? `${counts.covalent} bonds · ${counts.coordination} coord · ${counts.ionicContact} contacts · ${counts.long} long · ${counts.removed} removed` : 'bond gate skipped',
    ];
    return `<figure><svg viewBox="0 0 220 220" width="220" height="220">${lines.join('')}${atoms.join('')}</svg>`
      + `<figcaption><b>${pick.formula}</b> <small>row ${pick.row}</small><br>${facts.map((f) => `<small>${f}</small>`).join('<br>')}`
      + `<br><small><i>${why.replace(/</g, '&lt;')}</i></small></figcaption></figure>`;
  };
  return `<!doctype html><meta charset="utf-8"><title>OMol25 featured picks</title>
<style>body{background:#101817;color:#dfe8e5;font:13px system-ui;margin:16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
figure{margin:0;background:#16211f;border-radius:8px;padding:8px}svg{background:#101817;border-radius:6px;display:block;margin:auto}small{color:#9fb0ac}</style>
<h1>OMol25 featured picks (${built.length})</h1><main>${built.map(tile).join('\n')}</main>\n`;
}

async function main() {
  const specs = readPicks();
  const committed = existsSync(COMMITTED_JSON) ? JSON.parse(readFileSync(COMMITTED_JSON, 'utf8')) : null;
  const committedAt = new Map((committed?.picks ?? []).map((p) => [p.row, p.fetchedAt]));
  const now = new Date().toISOString();

  const built = [];
  for (const spec of specs) {
    const committedXyz = path.join(COMMITTED_XYZ_DIR, `${omol.omolPickKey(spec.row)}.xyz`);
    let xyzText;
    let fetchedAt;
    if (REUSE && existsSync(committedXyz)) {
      xyzText = readFileSync(committedXyz, 'utf8');
      fetchedAt = committedAt.get(spec.row) ?? now;
    } else if (CHECK) {
      throw new Error(`--check: ${path.relative(root, committedXyz)} is missing.`);
    } else {
      xyzText = await fetchEdgeXyz(spec.row);
      fetchedAt = now;
    }
    const result = buildPick(spec, xyzText, fetchedAt);
    built.push({ ...result, xyzText });
    const c = result.perceived?.counts;
    console.log(`ok  ${result.pick.id.padEnd(16)} ${result.pick.formula.padEnd(20)} ${String(result.pick.atoms).padStart(3)} atoms  ${spec.shelf}${spec.home ? ' (home)' : ''}`
      + (c ? `  ${c.covalent}/${c.coordination}/${c.ionicContact} bonds/coord/contacts, ${c.removed} removed, ${c.long} long` : ''));
  }

  const picks = built.map((b) => b.pick);
  const coverage = omol.omolFeaturedCoverage(picks);
  const setProblems = [];
  if (coverage.missingElements.length > 0) setProblems.push(`missing elements: ${coverage.missingElements.join(', ')}`);
  if (coverage.emptyShelves.length > 0) setProblems.push(`empty shelves: ${coverage.emptyShelves.join(', ')}`);
  if (coverage.home < omol.OMOL25_FEATURED_LIMITS.minHome) setProblems.push(`${coverage.home} home picks < ${omol.OMOL25_FEATURED_LIMITS.minHome}`);
  if (setProblems.length > 0) throw new Error(`The featured set fails its coverage gate: ${setProblems.join('; ')}.`);

  const file = { schema: omol.OMOL25_FEATURED_SCHEMA, license: 'CC-BY-4.0', citation: omol.OMOL25_CITATION, picks };
  const fileErrors = omol.validateOmolFeaturedFile(file);
  if (fileErrors.length > 0) throw new Error(fileErrors.join('\n'));
  const json = `${JSON.stringify(file, null, 2)}\n`;
  const data = shelfDataSource(picks);

  if (CHECK) {
    const stale = [];
    if (readFileSync(COMMITTED_JSON, 'utf8') !== json) stale.push('featured.v1.json');
    if (readFileSync(path.join(root, 'packages/ui/src/landing/omolShelf.data.ts'), 'utf8') !== data) stale.push('omolShelf.data.ts');
    if (stale.length > 0) {
      console.error(`Stale: ${stale.join(', ')}. Run pnpm exec tsx tools/build-omol25-featured.mjs --reuse.`);
      process.exit(1);
    }
    console.log(`--check: ${picks.length} picks pass every gate and the committed files are current.`);
    return;
  }

  mkdirSync(XYZ_DIR, { recursive: true });
  const keep = new Set(picks.map((p) => `${p.id}.xyz`));
  for (const name of readdirSync(XYZ_DIR)) {
    if (/^omol25_nv_\d+\.xyz$/.test(name) && !keep.has(name)) rmSync(path.join(XYZ_DIR, name));
  }
  for (const b of built) writeFileSync(path.join(XYZ_DIR, `${b.pick.id}.xyz`), b.xyzText);
  writeFileSync(JSON_FILE, json);
  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, data);
  mkdirSync(path.dirname(SHEET_FILE), { recursive: true });
  writeFileSync(SHEET_FILE, contactSheet(built));

  console.log(`\n${picks.length} picks (${coverage.home} home) covering ${coverage.elements.length} elements; shelves ${JSON.stringify(coverage.shelves)}.`);
  const shipped = await shippedJsGzip(data);
  console.log(`omolShelf.data.ts: ${Buffer.byteLength(data)} B source; ${shipped} B gzip as JS${shipped > 1024 ? ' (over the 1 KB landing budget)' : ''}.`);
  console.log(`Contact sheet: ${path.relative(process.cwd(), SHEET_FILE)}`);
  if (NO_BOND_GATE) console.log('Bond gate skipped (--no-bond-gate): these files are a plumbing check, not a release.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
