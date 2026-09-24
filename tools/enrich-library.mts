#!/usr/bin/env -S npx tsx
/**
 * enrich-library.mts — judge every library entry against the facet taxonomy
 * with Jev, once, and check the answers in as data.
 *
 * Incremental: an entry is re-judged only when its subject (title, formula,
 * category, evidence) changed, or when the taxonomy or prompt version did.
 * Adding ten gallery entries costs ten calls, not a hundred.
 *
 *   TYPESAFE_API_KEY=... pnpm exec tsx tools/enrich-library.mts            # enrich what changed
 *   TYPESAFE_API_KEY=... pnpm exec tsx tools/enrich-library.mts --force    # re-judge everything
 *   pnpm exec tsx tools/enrich-library.mts --report                         # coverage, no API calls
 *   pnpm exec tsx tools/enrich-library.mts --report --json                  # coverage as JSON
 *   pnpm exec tsx tools/enrich-library.mts --check                          # exit 1 if facts are stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FACETS,
  FACET_GROUP_LABELS,
  FACTS_PROMPT_VERSION,
  FACT_THRESHOLD,
  JEV_MODEL_LATEST,
  LIBRARY_FACTS_SCHEMA,
  enrichmentRequest,
  evidenceState,
  facetCounts,
  parsePropertyEvidence,
  derivedFacts,
  mergeFacts,
  readEnrichment,
  subjectHash,
  systemOne,
  taxonomyFingerprint,
  type FactsSubject,
  type LibraryFactsFile,
} from '../packages/core/src/index';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const REPORT = argv.includes('--report');
const CHECK = argv.includes('--check');
const JSON_OUT = argv.includes('--json');
const OUT = path.join(root, 'packages/ui/src/library/library-facts.json');
const CONCURRENCY = 6;

const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const gallery = read('packages/ui/src/gallery-data.json') as Array<Record<string, unknown>>;
const nomenclature = read('packages/ui/src/gallery-nomenclature.json').entries as Record<string, { molecularFormula?: string }>;
const sheet = read('packages/ui/src/switcher/property-sheet.json').entries as Record<string, unknown>;

const evidenceByKey = new Map<string, ReturnType<typeof parsePropertyEvidence>>();

/** Every openable gallery entry, as the subject Jev judges. Other sources join here. */
function gallerySubjects(): Map<string, FactsSubject> {
  const subjects = new Map<string, FactsSubject>();
  for (const entry of gallery) {
    if (entry.available === false || !entry.file || entry.route) continue;
    const id = String(entry.id);
    const evidence = parsePropertyEvidence(sheet[id]);
    evidenceByKey.set(`gallery:${id}`, evidence);
    const state = evidenceState(evidence);
    delete state.substance;
    subjects.set(`gallery:${id}`, {
      title: String(entry.title),
      ...(entry.subtitle ? { subtitle: String(entry.subtitle).slice(0, 160) } : {}),
      ...(nomenclature[id]?.molecularFormula ? { formula: nomenclature[id].molecularFormula } : {}),
      category: String(entry.domain),
      ...(evidence?.substance ? { substance: evidence.substance } : {}),
      atoms: Number(String(entry.atoms).replace(/[^\d]/g, '')) || 0,
      ...(Object.keys(state).length ? { evidence: state } : {}),
    });
  }
  return subjects;
}

const subjects = gallerySubjects();
const taxonomy = taxonomyFingerprint();
const existing: LibraryFactsFile | null = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
const sameVersion = existing?.taxonomy === taxonomy && existing?.prompt === FACTS_PROMPT_VERSION;

const stale = [...subjects].filter(([key, subject]) => FORCE || !sameVersion || existing?.entries[key]?.inputHash !== subjectHash(subject)).map(([key]) => key);
const orphaned = Object.keys(existing?.entries ?? {}).filter((key) => !subjects.has(key));

if (REPORT) {
  report();
  process.exit(0);
}
if (CHECK) {
  if (stale.length || orphaned.length) {
    console.error(`library-facts.json is stale: ${stale.length} entries to judge, ${orphaned.length} orphaned. Run tools/enrich-library.mts.`);
    process.exit(1);
  }
  console.log(`library-facts.json is current (${subjects.size} entries, ${taxonomy}, ${FACTS_PROMPT_VERSION}).`);
  process.exit(0);
}

const KEY = process.env.TYPESAFE_API_KEY;
if (!KEY) {
  console.error('Set TYPESAFE_API_KEY (or pass --report / --check).');
  process.exit(2);
}

const entries: LibraryFactsFile['entries'] = sameVersion ? { ...existing!.entries } : {};
for (const key of orphaned) delete entries[key];
let model = existing?.model ?? JEV_MODEL_LATEST;
let tokens = 0;
const started = Date.now();
const queue = [...stale];
const failures: string[] = [];

async function worker() {
  for (let key = queue.shift(); key; key = queue.shift()) {
    const subject = subjects.get(key)!;
    try {
      const result = await systemOne({ apiKey: KEY, timeoutMs: 15_000, retries: 3, retryDelayMs: 1_000 }, enrichmentRequest(subject));
      const derived = derivedFacts(evidenceByKey.get(key));
      entries[key] = { inputHash: subjectHash(subject), facts: mergeFacts(readEnrichment(result), derived), ...(Object.keys(derived).length ? { derived: Object.keys(derived).sort() as typeof entries[string]['derived'] } : {}) };
      model = result.model;
      tokens += result.usage?.input_tokens ?? 0;
      process.stderr.write('.');
    } catch (error) {
      failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
      process.stderr.write('x');
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stderr.write('\n');

const file: LibraryFactsFile = {
  schema: LIBRARY_FACTS_SCHEMA,
  taxonomy,
  prompt: FACTS_PROMPT_VERSION,
  model,
  generatedAt: stale.length ? new Date().toISOString().slice(0, 10) : existing?.generatedAt ?? new Date().toISOString().slice(0, 10),
  note: `Generated by tools/enrich-library.mts. Facet probabilities judged by Jev; values under 0.3 are omitted and mean "no". An entry has a facet at ${FACT_THRESHOLD} or above. Do not edit by hand: change the subject or the taxonomy and re-run.`,
  entries: Object.fromEntries(Object.keys(entries).sort().map((key) => [key, { inputHash: entries[key].inputHash, facts: Object.fromEntries(Object.entries(entries[key].facts).sort(([a], [b]) => a.localeCompare(b))), ...(entries[key].derived ? { derived: entries[key].derived } : {}) }])),
};
fs.writeFileSync(OUT, `${JSON.stringify(file, null, 1)}\n`);
console.log(`judged ${stale.length - failures.length}/${stale.length} entries (${subjects.size} total) in ${((Date.now() - started) / 1000).toFixed(1)} s · ${tokens} input tokens · ${model}`);
for (const failure of failures) console.error(`  failed ${failure}`);
process.exit(failures.length ? 1 : 0);

/** Coverage: what the library has, what it lacks, and what is uncertain. */
function report() {
  const facts = existing?.entries ?? {};
  const counts = facetCounts(Object.values(facts).map((entry) => entry.facts));
  const uncertain = new Map<string, number>();
  for (const entry of Object.values(facts)) {
    for (const [id, value] of Object.entries(entry.facts)) if ((value ?? 0) >= 0.4 && (value ?? 0) < 0.6) uncertain.set(id, (uncertain.get(id) ?? 0) + 1);
  }
  const noEvidence = [...subjects].filter(([, subject]) => !subject.evidence && !subject.formula).map(([key]) => key);
  const rows = FACETS.map((definition) => ({ id: definition.id, group: definition.group, label: definition.label, entries: counts.get(definition.id) ?? 0, uncertain: uncertain.get(definition.id) ?? 0 }));
  const summary = {
    entries: subjects.size,
    judged: Object.keys(facts).length,
    stale: stale.length,
    taxonomy,
    prompt: FACTS_PROMPT_VERSION,
    model: existing?.model ?? null,
    thin: rows.filter((row) => row.entries <= 1).map((row) => row.id),
    withoutFormulaOrEvidence: noEvidence.length,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, facets: rows, withoutFormulaOrEvidence: noEvidence }, null, 2));
    return;
  }
  console.log(`${summary.judged}/${summary.entries} entries judged · ${summary.stale} stale · ${taxonomy} · ${FACTS_PROMPT_VERSION} · ${summary.model ?? 'no model'}\n`);
  for (const group of Object.keys(FACET_GROUP_LABELS) as Array<keyof typeof FACET_GROUP_LABELS>) {
    console.log(FACET_GROUP_LABELS[group]);
    for (const row of rows.filter((candidate) => candidate.group === group)) {
      const bar = '█'.repeat(Math.min(40, row.entries));
      console.log(`  ${row.label.padEnd(26)} ${String(row.entries).padStart(3)} ${bar}${row.uncertain ? `  (${row.uncertain} uncertain)` : ''}`);
    }
  }
  console.log(`\nThin facets (0 or 1 entries): ${summary.thin.join(', ') || 'none'}`);
  console.log(`Entries with neither a formula nor reference evidence: ${noEvidence.length}`);
}
