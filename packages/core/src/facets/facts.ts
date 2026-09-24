/**
 * Library facts: per-entry facet probabilities, how they are produced, and
 * how they are used at search time. Pure; the Jev call itself lives in the
 * enrichment tool (offline) and the edge (query side).
 */

import type { JevQuestion, JevResult } from '../jev/client';
import type { PropertyEvidence } from '../jev/propertyRank';
import { FACETS, isFacetId, type FacetId } from './taxonomy';

/** Bump with any change to the enrichment or query instructions below. */
export const FACTS_PROMPT_VERSION = 'facts-v1.2-derived';
export const LIBRARY_FACTS_SCHEMA = 'lupi.library-facts.v1';

/** Probabilities under this are not stored: absent means "no". */
export const FACT_STORE_FLOOR = 0.3;
/** An entry has a facet when its probability is at least this. */
export const FACT_THRESHOLD = 0.5;
/** A typed request asks for a facet when Jev's probability is at least this. */
export const QUERY_FACET_THRESHOLD = 0.7;

/** What the enrichment call is told about one entry. Everything is data. */
export interface FactsSubject {
  title: string;
  subtitle?: string;
  formula?: string;
  category?: string;
  substance?: string;
  atoms?: number;
  /** Extra reference evidence, already in plain words and units. */
  evidence?: Record<string, unknown>;
}

export interface EntryFacts {
  /** Hash of the subject that was judged; re-enrich when it changes. */
  inputHash: string;
  /** Facet probabilities at or above `FACT_STORE_FLOOR`, two decimals. */
  facts: Partial<Record<FacetId, number>>;
  /** Facets decided by reference data rather than Jev (see `derivedFacts`). */
  derived?: FacetId[];
}

export interface LibraryFactsFile {
  schema: typeof LIBRARY_FACTS_SCHEMA;
  taxonomy: string;
  prompt: string;
  model: string;
  generatedAt: string;
  note?: string;
  entries: Record<string, EntryFacts>;
}

/** FNV-1a over canonical JSON; stable across runtimes. */
export function subjectHash(subject: FactsSubject): string {
  const canonical = JSON.stringify(subject, Object.keys(subject).sort());
  const evidence = subject.evidence ? JSON.stringify(subject.evidence, Object.keys(subject.evidence).sort()) : '';
  let hash = 2166136261;
  for (const char of canonical + evidence) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** One Jev request judging one entry against every facet. */
export function enrichmentRequest(subject: FactsSubject): { state: unknown; questions: Record<string, JevQuestion> } {
  const questions: Record<string, JevQuestion> = {};
  for (const definition of FACETS) {
    questions[definition.id] = {
      type: 'noul',
      instructions: `In everyday conditions, the substance described by \`entry\` ${definition.predicate}. For a simulation or material entry, judge the substance it represents; use the listed evidence when given.`,
    };
  }
  return { state: { entry: subject }, questions };
}

export function readEnrichment(result: JevResult): Partial<Record<FacetId, number>> {
  const facts: Partial<Record<FacetId, number>> = {};
  for (const definition of FACETS) {
    const answer = result.answers[definition.id];
    if (answer?.type !== 'noul') continue;
    const value = Math.round(answer.noul * 100) / 100;
    if (value >= FACT_STORE_FLOOR) facts[definition.id] = value;
  }
  return facts;
}

/**
 * Facets never asked of a typed request. Every molecule search implies
 * "small molecule", and Jev said so at 0.6 to 0.9 for nearly any text.
 */
export const QUERY_EXCLUDED_FACETS: readonly FacetId[] = ['small_molecule'];

/**
 * Request-level questions: which facets does the typed text ask for?
 *
 * Wording chosen on 2026-09-24 from four candidates over ten labeled queries
 * (`docs/library-facts.md`): "names or clearly implies the requirement" put
 * requested facets at 0.80 to 0.98 and the rest at or under 0.72, apart
 * from properties of a named molecule ("caffeine" implies alkaloid), which
 * the lookup gate handles. "asks only for things that" peaked at 0.57 for
 * "floats in water".
 */
export function queryFacetQuestions(): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const definition of FACETS) {
    if (QUERY_EXCLUDED_FACETS.includes(definition.id)) continue;
    questions[`ask:${definition.id}`] = {
      type: 'noul',
      instructions: `\`request.query\` names or clearly implies the requirement that the result ${definition.predicate}.`,
    };
  }
  return questions;
}

/** Facets the request asks for, with probability, at or above `floor`. */
export function readQueryFacets(result: JevResult, floor = FACT_STORE_FLOOR): Partial<Record<FacetId, number>> {
  const asked: Partial<Record<FacetId, number>> = {};
  for (const definition of FACETS) {
    const answer = result.answers[`ask:${definition.id}`];
    if (answer?.type !== 'noul') continue;
    const value = Math.round(answer.noul * 1000) / 1000;
    if (value >= floor) asked[definition.id] = value;
  }
  return asked;
}

/** Sanitize a facet map from an untrusted source (a browser, a file). */
export function parseFacetMap(raw: unknown): Partial<Record<FacetId, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<FacetId, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isFacetId(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) out[key] = value;
  }
  return out;
}

/**
 * Facets the reference sheet decides outright. Numbers are code's job: on
 * the first enrichment Jev gave aluminium (2.70 g/cm³, listed) 0.59 for
 * "floats on water". Where the evidence settles a facet, this value wins;
 * where it does not (no density, a compound that reacts), Jev's stands.
 */
export function derivedFacts(evidence: PropertyEvidence | undefined): Partial<Record<FacetId, number>> {
  const derived: Partial<Record<FacetId, number>> = {};
  if (!evidence) return derived;
  const { phase, density, meltingPoint, water } = evidence;
  if (phase) {
    derived.gas_rt = phase === 'gas' ? 0.99 : 0;
    derived.liquid_rt = phase === 'liquid' ? 0.99 : 0;
    derived.solid_rt = phase === 'solid' ? 0.99 : 0;
  }
  if (meltingPoint !== undefined) derived.high_melting = meltingPoint >= 1000 ? 0.99 : 0;
  if (water === 'miscible' || water === 'soluble') derived.water_soluble = 0.95;
  else if (water === 'insoluble') derived.water_soluble = 0;
  if (phase === 'gas') derived.floats = 0;
  else if (density !== undefined) {
    if (density >= 1) derived.floats = 0;
    // A solid lighter than water floats even if it later dissolves (ice, menthol).
    else if (phase === 'solid') derived.floats = 0.95;
    // A light liquid that mixes in (ethanol, acetone) never forms a layer.
    else if (water === 'miscible' || water === 'soluble') derived.floats = 0;
    else if (water === 'insoluble' || water === 'slightly') derived.floats = 0.95;
  }
  return derived;
}

/** Jev's facts with the derived ones laid over them; zeros are dropped. */
export function mergeFacts(judged: Partial<Record<FacetId, number>>, derived: Partial<Record<FacetId, number>>): EntryFacts['facts'] {
  const merged: Partial<Record<FacetId, number>> = { ...judged, ...derived };
  for (const [id, value] of Object.entries(merged)) if ((value ?? 0) < FACT_STORE_FLOOR) delete merged[id as FacetId];
  return merged;
}

/* ─── Search-time use ─── */

/** The facets a query clearly requires, strongest first. */
export function requiredFacets(asked: Partial<Record<FacetId, number>> | undefined, threshold = QUERY_FACET_THRESHOLD): FacetId[] {
  return Object.entries(asked ?? {})
    .filter(([, value]) => (value ?? 0) >= threshold)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([id]) => id as FacetId);
}

/**
 * How well an entry satisfies every required facet: the smallest of its
 * probabilities (an AND), or 0 when any is missing or below threshold. An
 * entry with no facts at all is never a match: facts only claim what was judged.
 */
export function facetMatch(facts: Partial<Record<FacetId, number>> | undefined, required: readonly FacetId[], threshold = FACT_THRESHOLD): number {
  if (required.length === 0) return 1;
  if (!facts) return 0;
  let score = 1;
  for (const id of required) {
    const value = facts[id] ?? 0;
    if (value < threshold) return 0;
    score = Math.min(score, value);
  }
  return score;
}

/** How many entries have each facet, for chip counts and coverage reports. */
export function facetCounts(entries: Iterable<Partial<Record<FacetId, number>> | undefined>, threshold = FACT_THRESHOLD): Map<FacetId, number> {
  const counts = new Map<FacetId, number>();
  for (const facts of entries) {
    if (!facts) continue;
    for (const [id, value] of Object.entries(facts)) {
      if ((value ?? 0) >= threshold) counts.set(id as FacetId, (counts.get(id as FacetId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Asked facets under this weight are ignored by `facetScore`. */
export const ASK_FLOOR = 0.5;
/** Query facets apply only when Jev is not sure the text names one thing:
 *  "caffeine" came back lookup at 1.0 with alkaloid, food, and psychoactive
 *  all "implied"; "sweet thing from plants" came back lookup at 0.42. */
export const LOOKUP_GATE = 0.6;

/**
 * A soft AND: the probability that every asked facet is either not really
 * required or satisfied, Π (1 − ask × (1 − fact)). A facet the user tapped
 * has ask 1 and is a hard requirement; one Jev inferred at 0.76 costs an
 * entry that lacks it a factor of 0.24 rather than removing it, so one
 * over-read word ("fuel" in "flammable liquid that floats") demotes instead
 * of emptying the list. Entries with no facts score 0.
 */
export function facetScore(facts: Partial<Record<FacetId, number>> | undefined, asks: Partial<Record<FacetId, number>>): number {
  const weighted = Object.entries(asks).filter(([, ask]) => (ask ?? 0) >= ASK_FLOOR);
  if (weighted.length === 0) return 1;
  if (!facts) return 0;
  let score = 1;
  for (const [id, ask] of weighted) score *= 1 - (ask ?? 0) * (1 - (facts[id as FacetId] ?? 0));
  return Math.round(score * 1000) / 1000;
}

/** Asked facets (at or above the floor) the entry does not have. */
export function missingFacets(facts: Partial<Record<FacetId, number>> | undefined, asks: Partial<Record<FacetId, number>>, threshold = FACT_THRESHOLD): FacetId[] {
  return (Object.entries(asks) as Array<[FacetId, number | undefined]>)
    .filter(([id, ask]) => (ask ?? 0) >= ASK_FLOOR && (facts?.[id] ?? 0) < threshold)
    .map(([id]) => id);
}
