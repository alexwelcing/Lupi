#!/usr/bin/env node
/**
 * eval-jev-switch.mjs — labeled evaluation of the molecule switcher's Jev judgment.
 *
 * Builds the same candidate pool the browser sends (local matches first, then
 * the whole gallery) for a set of queries with known expected picks, calls
 * either the TypeSafe API directly or a running Lupi edge, and reports
 * accuracy, confidence bands, and latency. Use it to tune instructions and
 * the promotion threshold before trusting a judgment in the UI.
 *
 *   TYPESAFE_API_KEY=... node tools/eval-jev-switch.mjs            # direct API
 *   node tools/eval-jev-switch.mjs --edge http://127.0.0.1:8787    # through the Worker route
 *   node tools/eval-jev-switch.mjs --json > receipt.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const EDGE = flag('--edge');
const JSON_OUT = argv.includes('--json');
const KEY = process.env.TYPESAFE_API_KEY;
if (!EDGE && !KEY) { console.error('Set TYPESAFE_API_KEY or pass --edge <origin>'); process.exit(2); }

const gallery = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/src/gallery-data.json'), 'utf8'));
const nomenclature = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui/src/gallery-nomenclature.json'), 'utf8')).entries ?? {};
const formulaOf = (id) => (Array.isArray(nomenclature) ? nomenclature.find((e) => e.id === id) : nomenclature[id])?.molecularFormula;
const elementsOf = (formula) => (formula ? [...new Set(formula.match(/[A-Z][a-z]?/g) ?? [])].sort() : []);
const atomsOf = (label) => Number(String(label).replace(/[^\d]/g, '')) || 0;

const POOL = gallery
  .filter((e) => e.available && e.file && !e.route)
  .map((e) => ({ key: `gallery:${e.id}`, title: e.title, formula: formulaOf(e.id), elements: elementsOf(formulaOf(e.id)), atoms: atomsOf(e.atoms), source: 'gallery', domain: e.domain }));

/** [query, elements, expected keys (any of), note] */
const CASES = [
  ['caffeine', [], ['gallery:caffeine'], 'exact name'],
  ['aspirin', [], ['gallery:aspirin'], 'exact name'],
  ['C6H6', [], ['gallery:benzene'], 'formula'],
  ['H2O', [], ['gallery:water'], 'formula'],
  ['something sweet', [], ['gallery:glucose', 'gallery:sucrose'], 'class'],
  ['the molecule in coffee', [], ['gallery:caffeine'], 'indirect name'],
  ['table salt', [], ['gallery:sodium_chloride'], 'common name'],
  ['an alcohol', [], ['gallery:ethanol', 'gallery:phenol'], 'functional group'],
  ['painkiller', [], ['gallery:aspirin', 'gallery:ibuprofen', 'gallery:acetaminophen'], 'class'],
  ['a neurotransmitter', [], ['gallery:dopamine', 'gallery:serotonin', 'gallery:adrenaline'], 'class'],
  ['the happiness molecule', [], ['gallery:serotonin', 'gallery:dopamine'], 'colloquial'],
  ['a carbon allotrope', [], ['gallery:c60_buckyball', 'gallery:graphene_ribbon', 'gallery:diamond_crystal'], 'materials class'],
  ['a nanotube', [], ['gallery:cnt_6_6'], 'material'],
  ['a sugar ring', [], ['gallery:glucose', 'gallery:sucrose'], 'class'],
  ['something in chili peppers', [], ['gallery:capsaicin'], 'indirect'],
  ['smells like vanilla', [], ['gallery:vanillin'], 'indirect'],
  ['a steroid', [], ['gallery:cholesterol'], 'class'],
  ['energy currency of the cell', [], ['gallery:atp'], 'indirect'],
  ['aromatic ring with nitrogen', [], ['gallery:caffeine', 'gallery:nicotine', 'gallery:serotonin', 'gallery:melatonin', 'gallery:dopamine', 'gallery:adenosine', 'gallery:theobromine'], 'structure description'],
  ['a metal', [], null, 'materials; any metal entry acceptable'],
  ['pizza', [], ['none'], 'not a molecule'],
  ['', ['Na', 'Cl'], ['gallery:sodium_chloride'], 'elements only'],
  ['', ['C', 'N'], ['gallery:caffeine', 'gallery:dopamine', 'gallery:serotonin', 'gallery:nicotine', 'gallery:adrenaline'], 'elements only; everyday C+N molecule'],
  ['', ['C', 'H', 'N', 'O'], ['gallery:caffeine', 'gallery:dopamine', 'gallery:serotonin', 'gallery:aspirin', 'gallery:adrenaline', 'gallery:melatonin'], 'elements only; everyday CHNO'],
  ['', ['Fe'], null, 'elements only; any iron entry'],
  ['', ['C', 'H', 'O'], null, 'elements only; any small CHO organic'],
  ['a base in DNA', [], ['gallery:adenine', 'gallery:guanine', 'gallery:cytosine', 'gallery:thymine', 'gallery:adenosine'], 'class'],
];

const INTENT = {
  named_molecule: 'A specific molecule or compound by common or systematic name',
  formula: 'A chemical formula such as C6H6 or H2O',
  elements: 'Only element symbols or element names, asking for anything containing them',
  class_or_property: 'A class of molecule or a property, such as "a sugar", "something aromatic", "an amino acid"',
  material: 'A crystal, alloy, lattice, surface, or bulk material rather than a small molecule',
  not_a_molecule: 'Not a request for a molecular structure at all',
};

function localMatches(query, elements) {
  const q = query.trim().toLowerCase();
  return POOL.filter((c) => (!elements.length || elements.every((s) => c.elements.includes(s))) && (!q || c.title.toLowerCase().includes(q) || (c.formula ?? '').toLowerCase() === q)).slice(0, 24);
}

function buildRequest(query, elements) {
  const local = localMatches(query, elements);
  const seen = new Set(local.map((c) => c.key));
  const pool = [...local, ...POOL.filter((c) => !seen.has(c.key) && (!elements.length || elements.every((s) => c.elements.includes(s))))].slice(0, 160);
  const criteria = { none: 'None of the listed candidates is what the request asks for' };
  for (const c of pool) criteria[c.key] = [c.title, c.formula, c.atoms ? `${c.atoms} atoms` : null, c.domain].filter(Boolean).join(' · ');
  const questions = {
    intent: { type: 'choice', instructions: 'What kind of molecular structure request is `request.query` (with `request.elements` if the query is empty)?', criteria: INTENT },
    best: { type: 'choice', instructions: 'Which candidate in `candidates` best satisfies `request`? Prefer the exact molecule when one is named; when only elements or a class are given, prefer the molecule most people would have heard of (a food, drug, or household compound) over a laboratory reagent; among equally familiar options prefer the smaller one. Choose `none` if nothing fits.', criteria },
  };
  for (const c of local) questions[`fit:${c.key}`] = { type: 'noul', instructions: `The candidate with key \`${c.key}\` satisfies what \`request\` asks for.` };
  const state = { request: { query, elements, currently_loaded: null }, candidates: pool.map((c) => ({ key: c.key, title: c.title, formula: c.formula ?? null, elements: c.elements, atoms: c.atoms || null, source: c.source })) };
  return { pool, local, body: { model: 'jev-latest', state, questions } };
}

async function judgeDirect(body) {
  const started = performance.now();
  const response = await fetch('https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const payload = await response.json();
  return { ms, model: payload.model, best: payload.answers.best, intent: payload.answers.intent, usage: payload.usage };
}

async function judgeEdge(query, elements, pool) {
  const started = performance.now();
  const response = await fetch(`${EDGE}/v1/switch/judge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, elements, candidates: pool.map(({ domain: _d, ...c }) => c) }) });
  const ms = Math.round(performance.now() - started);
  const payload = await response.json();
  if (!response.ok || !payload.configured) throw new Error(`edge ${response.status} ${JSON.stringify(payload)}`);
  return { ms, model: payload.model, best: payload.best ? { choice: payload.best.key, confidence: payload.best.confidence } : { choice: 'none', confidence: 1 }, intent: payload.intent, usage: null };
}

const rows = [];
for (const [query, elements, expected, note] of CASES) {
  const { pool, body } = buildRequest(query, elements);
  try {
    const result = EDGE ? await judgeEdge(query, elements, pool) : await judgeDirect(body);
    const pick = result.best?.choice ?? 'none';
    const ok = expected === null ? pick !== 'none' : expected.includes(pick);
    rows.push({ query: query || `[${elements.join('+')}]`, note, pick, confidence: Number((result.best?.confidence ?? 0).toFixed(2)), intent: result.intent?.choice, ok, ms: result.ms, tokens: result.usage?.input_tokens ?? null, pool: pool.length });
  } catch (error) {
    rows.push({ query: query || `[${elements.join('+')}]`, note, error: String(error.message).slice(0, 120), ok: false });
  }
}
const scored = rows.filter((r) => !r.error);
const accuracy = scored.length ? scored.filter((r) => r.ok).length / scored.length : 0;
const highConf = scored.filter((r) => r.confidence >= 0.6);
const summary = {
  cases: rows.length,
  accuracy: Number(accuracy.toFixed(3)),
  accuracyAtOrAbove0_6: highConf.length ? Number((highConf.filter((r) => r.ok).length / highConf.length).toFixed(3)) : null,
  coveredAtOrAbove0_6: Number((highConf.length / Math.max(1, scored.length)).toFixed(3)),
  medianMs: scored.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(scored.length / 2)] ?? null,
  meanTokens: scored.some((r) => r.tokens) ? Math.round(scored.reduce((s, r) => s + (r.tokens ?? 0), 0) / scored.length) : null,
  errors: rows.filter((r) => r.error).length,
};
if (JSON_OUT) console.log(JSON.stringify({ summary, rows }, null, 2));
else {
  for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'MISS'} ${String(r.query).padEnd(30)} -> ${String(r.pick ?? r.error).padEnd(28)} ${r.confidence ?? ''} ${r.intent ?? ''} ${r.ms ?? ''}ms  (${r.note})`);
  console.log(JSON.stringify(summary));
}
