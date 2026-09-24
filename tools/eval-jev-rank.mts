#!/usr/bin/env -S npx tsx
/**
 * eval-jev-rank.mts — labeled evaluation of the switcher's property ranking.
 *
 * Runs the real edge handler (`handleSwitchJudge` with `rank: true`) over the
 * same gallery pool and reference evidence the browser sends, applies the
 * shared plan and ranking, and checks each case's expected plan and top
 * results. Use it before changing an instruction, criterion, or threshold in
 * `packages/core/src/jev/propertyRank.ts`.
 *
 *   TYPESAFE_API_KEY=... pnpm exec tsx tools/eval-jev-rank.mts
 *   TYPESAFE_API_KEY=... pnpm exec tsx tools/eval-jev-rank.mts --json > docs/jev-rank-eval-<date>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { molarMass, parsePropertyEvidence, planPropertyRank, rankByPlan, type PropertyEvidence, type RankPlan, type RankProperty } from '../packages/core/src/jev/propertyRank';
import { handleSwitchJudge, type SwitchJudgeResponse } from '../apps/mcp-worker/src/jev';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const KEY = process.env.TYPESAFE_API_KEY;
if (!KEY) {
  console.error('Set TYPESAFE_API_KEY.');
  process.exit(2);
}

// The edge writes one \`lupi_jev\` line per call to stdout; keep stdout for the report.
console.log = (...args: unknown[]) => console.error(...args);
const print = (text: string) => process.stdout.write(`${text}\n`);

const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const gallery = read('packages/ui/src/gallery-data.json') as Array<Record<string, unknown>>;
const nomenclature = read('packages/ui/src/gallery-nomenclature.json').entries as Record<string, { molecularFormula?: string }>;
const sheet = read('packages/ui/src/switcher/property-sheet.json').entries as Record<string, unknown>;

interface PoolEntry {
  key: string;
  title: string;
  formula?: string;
  atoms: number;
  source: 'gallery';
  category: string;
  evidence?: PropertyEvidence;
}

const POOL: PoolEntry[] = gallery
  .filter((entry) => entry.available !== false && entry.file && !entry.route)
  .map((entry) => {
    const id = String(entry.id);
    return {
      key: `gallery:${id}`,
      title: String(entry.title),
      formula: nomenclature[id]?.molecularFormula,
      atoms: Number(String(entry.atoms).replace(/[^\d]/g, '')) || 0,
      source: 'gallery' as const,
      category: String(entry.domain),
      evidence: parsePropertyEvidence(sheet[id]),
    };
  });

function measured(entry: PoolEntry, property: Exclude<RankProperty, 'other'>): number | undefined {
  if (property === 'molar_mass') return molarMass(entry.formula);
  if (property === 'size') return entry.atoms || undefined;
  if (property === 'density') return entry.evidence?.density;
  if (property === 'melting_point') return entry.evidence?.meltingPoint;
  return entry.evidence?.boilingPoint;
}

interface Case {
  query: string;
  /** Expected plan kind and, for measured plans, the property and direction. */
  plan: RankPlan | null;
  /** Every one of these must appear in the top `within` rows. */
  top?: string[];
  within?: number;
  /** Each of these must appear somewhere in the ranked rows. */
  present?: string[];
  /** None of these may appear anywhere in the ranked rows. */
  absent?: string[];
}

const g = (id: string) => `gallery:${id}`;
const CASES: Case[] = [
  // The floating liquids come back as a near tie (0.70 to 0.76), so only the leaders are pinned.
  { query: 'floats in water', plan: { kind: 'filter', property: 'density' }, top: [g('water_cluster_64'), g('limonene')], within: 4, present: [g('benzene'), g('ethyl_acetate'), g('coudert_mof_flexibility')], absent: [g('sand_w_cascade'), g('sodium_chloride'), g('sucrose')] },
  { query: 'metal for planes', plan: { kind: 'filter', property: 'other' }, top: [g('al_polycrystal')], within: 1, absent: [g('water'), g('caffeine')] },
  { query: 'heaviest metal', plan: { kind: 'measured', direction: 'most', property: 'density' }, top: [g('sand_w_cascade')], within: 1 },
  { query: 'lightest metal', plan: { kind: 'measured', direction: 'least', property: 'density' }, top: [g('mlip_mg_slip_playthrough')], within: 1, absent: [g('oxygen'), g('water')] },
  { query: 'most dense', plan: { kind: 'measured', direction: 'most', property: 'density' }, top: [g('sand_w_cascade')], within: 1 },
  { query: 'heaviest liquid', plan: { kind: 'measured', direction: 'most', property: 'density' }, top: [g('bromobutane_1')], within: 1, absent: [g('sand_w_cascade')] },
  { query: 'lightest molecule', plan: { kind: 'measured', direction: 'least', property: 'molar_mass' }, top: [g('water')], within: 2 },
  { query: 'biggest molecule', plan: { kind: 'measured', direction: 'most', property: 'size' }, absent: [g('massive_1m'), g('lupi_live_qr_atomized'), g('sand_w_cascade')] },
  { query: 'highest melting point', plan: { kind: 'measured', direction: 'most', property: 'melting_point' }, top: [g('sand_w_cascade')], within: 1 },
  // Jev counts ethanethiol and dimethyl sulfide as solvents; the check is that the common low boilers lead and water does not.
  { query: 'lowest boiling solvent', plan: { kind: 'measured', direction: 'least', property: 'boiling_point' }, top: [g('acetone')], within: 10, absent: [g('sand_w_cascade'), g('sucrose')] },
  { query: 'hardest material', plan: { kind: 'judged', direction: 'most' }, top: [g('diamond_crystal')], within: 3 },
  { query: 'sweet', plan: { kind: 'filter', property: 'other' }, top: [g('sucrose'), g('glucose')], within: 2 },
  { query: 'used in batteries', plan: { kind: 'filter', property: 'other' }, top: [g('mlip_lifepo4_li_channel')], within: 2 },
  { query: 'smells like citrus', plan: { kind: 'filter', property: 'other' }, top: [g('limonene')], within: 1 },
  { query: 'gas at room temperature', plan: { kind: 'filter', property: 'boiling_point' }, top: [g('oxygen'), g('nitrous_oxide')], within: 5, absent: [g('water'), g('sand_w_cascade')] },
  { query: 'conducts electricity', plan: { kind: 'filter', property: 'other' }, top: [g('research_cu')], within: 4, absent: [g('sucrose')] },
  { query: 'caffeine', plan: null },
  { query: 'something sweet', plan: { kind: 'filter', property: 'other' }, top: [g('sucrose'), g('glucose')], within: 3 },
];

function samePlan(expected: RankPlan | null, actual: RankPlan | null): boolean {
  if (!expected || !actual) return expected === actual;
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === 'filter') return true; // the property of a filter only shapes the wording
  return JSON.stringify(expected) === JSON.stringify(actual);
}

const rows: unknown[] = [];
let pass = 0;
const latencies: number[] = [];
for (const testCase of CASES) {
  const request = new Request('https://lupi.test/v1/switch/judge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: testCase.query, elements: [], rank: true, candidates: POOL.map((entry, index) => ({ ...entry, fit: index < 24 })) }),
  });
  const started = performance.now();
  const response = await handleSwitchJudge(request, { TYPESAFE_API_KEY: KEY }, { cache: null });
  const ms = Math.round(performance.now() - started);
  latencies.push(ms);
  const body = (await response.json()) as SwitchJudgeResponse & { error?: string };
  const plan = planPropertyRank(body.rank ?? null);
  const ranked = plan && body.rank
    ? rankByPlan(POOL.map((entry) => ({ key: entry.key, value: plan.kind === 'measured' ? measured(entry, plan.property) : undefined })), plan, body.rank)
    : [];
  const keys = ranked.map((row) => row.key);
  const failures: string[] = [];
  if (!response.ok) failures.push(`http ${response.status}: ${body.error}`);
  if (!samePlan(testCase.plan, plan)) failures.push(`plan ${JSON.stringify(plan)}`);
  for (const key of testCase.top ?? []) if (!keys.slice(0, testCase.within ?? 3).includes(key)) failures.push(`${key} not in top ${testCase.within ?? 3}`);
  for (const key of testCase.present ?? []) if (!keys.includes(key)) failures.push(`${key} missing`);
  for (const key of testCase.absent ?? []) if (keys.includes(key)) failures.push(`${key} ranked`);
  if (failures.length === 0) pass += 1;
  const title = (key: string) => POOL.find((entry) => entry.key === key)?.title ?? key;
  const top = ranked.slice(0, 5).map((row) => `${title(row.key)}${row.value !== undefined ? ` ${row.value}` : ''}${row.probability !== undefined ? ` p=${row.probability}` : ''}`);
  rows.push({
    query: testCase.query,
    ok: failures.length === 0,
    failures,
    mode: body.rank?.mode ?? null,
    property: body.rank?.property ?? null,
    plan,
    top,
    ranked: ranked.length,
    ms,
    model: body.model,
  });
  if (!JSON_OUT) {
    print(`${failures.length ? 'FAIL' : 'ok  '} ${testCase.query.padEnd(26)} ${String(body.rank?.mode.choice ?? '-').padEnd(7)} ${String(body.rank?.property.choice ?? '-').padEnd(14)} ${ms} ms  ${top.slice(0, 3).join(' | ')}`);
    for (const failure of failures) print(`       ${failure}`);
  }
}

latencies.sort((a, b) => a - b);
const summary = { date: new Date().toISOString().slice(0, 10), cases: CASES.length, pass, pool: POOL.length, withEvidence: POOL.filter((entry) => entry.evidence).length, medianMs: latencies[Math.floor(latencies.length / 2)] };
if (JSON_OUT) print(JSON.stringify({ summary, rows }, null, 2));
else print(`\n${pass}/${CASES.length} cases pass · pool ${summary.pool} (${summary.withEvidence} with evidence) · median ${summary.medianMs} ms`);
process.exit(pass === CASES.length ? 0 : 1);
