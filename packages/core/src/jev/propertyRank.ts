/**
 * Property ranking for the molecule switcher: "floats in water", "metal for
 * planes", "heaviest metal", "lowest boiling solvent".
 *
 * The split of labour follows Jev's documented strengths. Jev reads the
 * request and answers three kinds of question, all code-owned constants:
 *
 * - `rank_mode`: is this a lookup, a yes/no filter, or a most/least ordering;
 * - `rank_property`: which measurable property it turns on, or `other`;
 * - per candidate, `has:<key>` (does it do what the request says, read
 *   literally) and `kind:<key>` (is it the kind of thing being compared,
 *   ignoring the ordering words).
 *
 * Jev never does the arithmetic. When the property is measurable, code sorts
 * by the number: molar mass computed from the formula, atom count from the
 * structure, density and transition temperatures from the curated reference
 * sheet the browser sends as evidence. Jev's per-candidate probabilities only
 * decide the order when the property has no number (hardness, taste, a use).
 *
 * Measured against the live API on 2026-09-24 over the 103-entry gallery pool
 * (`docs/jev-property-ranking.md`): property choices came back at 0.95 to
 * 1.0 confidence, mode choices at 0.64 to 1.0; `kind:` splits bimodally
 * around 0.5 for concrete groups ("metal", "liquid"); `has:` with
 * evidence puts ice, ZIF-8, limonene and benzene first for "floats in water".
 * Asked directly, Jev ranked diamond above tungsten for "most dense", which is
 * why numbers are code's job.
 */

import { getElementSpecBySymbol } from '../elements';
import type { JevCriteria, JevQuestion, JevResult } from './client';

/** Bump with any change to instructions or criteria below. */
export const PROPERTY_RANK_PROMPT_VERSION = 'rank-v1';

export const RANK_MODE_CRITERIA = {
  lookup: 'It names or describes one particular molecule or material to find',
  filter: 'It asks for the ones that have a property, behaviour, or use (a yes-or-no test, such as "floats in water" or "used in batteries")',
  most: 'It asks for the ones with the most or highest of a property (such as "heaviest", "most dense", "hardest", "highest melting")',
  least: 'It asks for the ones with the least or lowest of a property (such as "lightest", "smallest", "lowest boiling")',
  none: 'It is not about molecules or materials',
} as const satisfies JevCriteria;
export type RankMode = keyof typeof RANK_MODE_CRITERIA;

export const RANK_PROPERTY_CRITERIA = {
  molar_mass: 'Molecular weight or molar mass of one molecule ("heaviest molecule", "lightest molecule")',
  size: 'Number of atoms or how big the structure is',
  density: 'Density of the substance in bulk: mass per volume, what floats or sinks, "heaviest metal"',
  melting_point: 'The temperature at which it melts',
  boiling_point: 'The temperature at which it boils, how volatile it is',
  other: 'A property or use that is not one of the above (hardness, taste, smell, toxicity, conductivity, an application)',
} as const satisfies JevCriteria;
export type RankProperty = keyof typeof RANK_PROPERTY_CRITERIA;

/** Properties code can sort by, with the unit shown next to each value. */
export const MEASURED_PROPERTIES: Record<Exclude<RankProperty, 'other'>, { label: string; unit: string }> = {
  molar_mass: { label: 'molar mass', unit: 'g/mol' },
  size: { label: 'size', unit: 'atoms' },
  density: { label: 'density', unit: 'g/cm³' },
  melting_point: { label: 'melting point', unit: '°C' },
  boiling_point: { label: 'boiling point', unit: '°C' },
};

export const PHASES = ['solid', 'liquid', 'gas'] as const;
export type Phase = (typeof PHASES)[number];
export const WATER_BEHAVIOURS = ['miscible', 'soluble', 'slightly', 'insoluble', 'reacts'] as const;
export type WaterBehaviour = (typeof WATER_BEHAVIOURS)[number];

/** Reference evidence for one candidate. Every field is optional; a missing
 *  value is "not known", never zero. */
export interface PropertyEvidence {
  /** What bulk substance a simulation or material entry represents ("aluminium"). */
  substance?: string;
  /** Phase at 25 °C and 1 atm. */
  phase?: Phase;
  /** g/cm³ near 25 °C in that phase (gases are about 0.001 to 0.005). */
  density?: number;
  meltingPoint?: number;
  boilingPoint?: number;
  /** How it behaves when put in water. */
  water?: WaterBehaviour;
}

/** Sanitize evidence arriving from a browser. Unknown fields are dropped. */
export function parsePropertyEvidence(raw: unknown): PropertyEvidence | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const finite = (input: unknown, min: number, max: number) =>
    typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max ? input : undefined;
  const evidence: PropertyEvidence = {
    substance: typeof value.substance === 'string' && value.substance.trim() ? value.substance.trim().slice(0, 60) : undefined,
    phase: PHASES.includes(value.phase as Phase) ? (value.phase as Phase) : undefined,
    density: finite(value.density, 0, 30),
    meltingPoint: finite(value.meltingPoint, -273, 5000),
    boilingPoint: finite(value.boilingPoint, -273, 7000),
    water: WATER_BEHAVIOURS.includes(value.water as WaterBehaviour) ? (value.water as WaterBehaviour) : undefined,
  };
  const kept = Object.fromEntries(Object.entries(evidence).filter(([, field]) => field !== undefined)) as PropertyEvidence;
  return Object.keys(kept).length ? kept : undefined;
}

/** How the evidence reads in Jev's state: plain words and units, nulls omitted. */
export function evidenceState(evidence: PropertyEvidence | undefined): Record<string, unknown> {
  if (!evidence) return {};
  const state: Record<string, unknown> = {};
  if (evidence.substance) state.substance = evidence.substance;
  if (evidence.phase) state.phase_at_25C = evidence.phase;
  if (evidence.density !== undefined) state.density_g_per_cm3 = evidence.density;
  if (evidence.meltingPoint !== undefined) state.melting_point_C = evidence.meltingPoint;
  if (evidence.boilingPoint !== undefined) state.boiling_point_C = evidence.boilingPoint;
  if (evidence.water) state.in_water = evidence.water;
  return state;
}

/**
 * Only a known substance can be ranked by a property: something with a
 * formula or a reference-sheet entry. Demos, QR codes, and scale tests carry
 * an atom count but no substance, and on the live pool `kind:` could not tell
 * them from molecules (0.45 to 0.65 for "biggest molecule"), so they are not
 * asked about at all. Less irrelevant state also sharpens the rest.
 */
export function rankable(candidate: { formula?: string; evidence?: PropertyEvidence }): boolean {
  return Boolean(candidate.evidence) || Boolean(candidate.formula && formulaCounts(candidate.formula));
}

/**
 * The ranking questions for a candidate pool. Instructions are constants with
 * the candidate key interpolated; the request text only ever lives in state.
 */
export function propertyRankQuestions(keys: string[]): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    rank_mode: {
      type: 'choice',
      instructions: 'How should the molecules and materials in `candidates` be ordered to answer `request.query`?',
      criteria: RANK_MODE_CRITERIA,
    },
    rank_property: {
      type: 'choice',
      instructions: 'Which measurable property does `request.query` turn on, if any?',
      criteria: RANK_PROPERTY_CRITERIA,
    },
  };
  for (const key of keys) {
    questions[`has:${key}`] = {
      type: 'noul',
      instructions: `Taken literally and in everyday conditions (room temperature, ordinary water and air), the substance of the candidate with key \`${key}\` does what \`request.query\` says or has the property it names. Use its listed evidence when given.`,
    };
    questions[`kind:${key}`] = {
      type: 'noul',
      instructions: `The candidate with key \`${key}\` is the kind of substance or structure \`request.query\` is about. Ignore any ordering or comparison words in the query (heaviest, lightest, most, least, highest, lowest, biggest, smallest): only whether the candidate belongs to the group being compared.`,
    };
  }
  return questions;
}

export interface PropertyRankJudgment {
  /** `ranking` is P(filter) + P(most) + P(least): how sure Jev is this is a
   *  property question at all, whichever shape. */
  mode: { choice: RankMode; confidence: number; ranking?: number };
  property: { choice: RankProperty; confidence: number };
  /** P(candidate does what the request says), by key. */
  has: Record<string, number>;
  /** P(candidate belongs to the group being compared), by key. */
  kind: Record<string, number>;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Read the ranking answers out of a validated result; null if any are missing. */
export function readPropertyRankAnswers(result: JevResult, keys: string[]): PropertyRankJudgment | null {
  const mode = result.answers.rank_mode;
  const property = result.answers.rank_property;
  if (mode?.type !== 'choice' || property?.type !== 'choice') return null;
  if (!Object.hasOwn(RANK_MODE_CRITERIA, mode.choice) || !Object.hasOwn(RANK_PROPERTY_CRITERIA, property.choice)) return null;
  const has: Record<string, number> = {};
  const kind: Record<string, number> = {};
  for (const key of keys) {
    const hasAnswer = result.answers[`has:${key}`];
    const kindAnswer = result.answers[`kind:${key}`];
    if (hasAnswer?.type === 'noul') has[key] = round3(hasAnswer.noul);
    if (kindAnswer?.type === 'noul') kind[key] = round3(kindAnswer.noul);
  }
  const probability = (label: RankMode) => (typeof mode.probabilities?.[label] === 'number' ? mode.probabilities[label] : 0);
  return {
    mode: { choice: mode.choice as RankMode, confidence: round3(mode.confidence), ranking: round3(probability('filter') + probability('most') + probability('least')) },
    property: { choice: property.choice as RankProperty, confidence: round3(property.confidence) },
    has,
    kind,
  };
}

/* ─── Deterministic side ─── */

const FORMULA_TOKEN = /([A-Z][a-z]?)(\d*)|(\()|(\))(\d*)/g;

/** Element counts from a plain or parenthesized formula; null when any
 *  symbol is unknown or the text is not a formula. */
export function formulaCounts(formula: string): Map<string, number> | null {
  const text = formula.replace(/[\s·.]/g, '').replace(/[₀-₉]/g, (digit) => String(digit.charCodeAt(0) - 0x2080));
  if (!text || !/^[A-Za-z0-9()]+$/.test(text)) return null;
  const stack: Array<Map<string, number>> = [new Map()];
  let consumed = 0;
  for (const match of text.matchAll(FORMULA_TOKEN)) {
    if (match.index !== consumed) return null;
    consumed += match[0].length;
    if (match[1]) {
      if (!getElementSpecBySymbol(match[1])) return null;
      const top = stack[stack.length - 1];
      top.set(match[1], (top.get(match[1]) ?? 0) + (match[2] ? Number(match[2]) : 1));
    } else if (match[3]) {
      stack.push(new Map());
    } else if (match[4]) {
      if (stack.length < 2) return null;
      const group = stack.pop()!;
      const multiplier = match[5] ? Number(match[5]) : 1;
      const top = stack[stack.length - 1];
      for (const [symbol, count] of group) top.set(symbol, (top.get(symbol) ?? 0) + count * multiplier);
    }
  }
  if (consumed !== text.length || stack.length !== 1 || stack[0].size === 0) return null;
  return stack[0];
}

/** Molar mass in g/mol from a formula, from the element table's masses. */
export function molarMass(formula: string | undefined): number | undefined {
  if (!formula) return undefined;
  const counts = formulaCounts(formula);
  if (!counts) return undefined;
  let total = 0;
  for (const [symbol, count] of counts) total += getElementSpecBySymbol(symbol)!.mass * count;
  return Math.round(total * 100) / 100;
}

/** Below these the judgment is ignored and the switcher keeps its ordinary list. */
export const RANK_MODE_THRESHOLD = 0.6;
export const RANK_PROPERTY_THRESHOLD = 0.6;
/** `kind:` came back bimodal on the live pool: members 0.5 to 0.95, the rest under 0.25. */
export const KIND_THRESHOLD = 0.5;
/** A filter keeps candidates at or above this `has:` probability. */
export const HAS_THRESHOLD = 0.5;

const isRankingMode = (mode: RankMode) => mode === 'filter' || mode === 'most' || mode === 'least';

export type RankPlan =
  | { kind: 'measured'; direction: 'most' | 'least'; property: Exclude<RankProperty, 'other'> }
  | { kind: 'judged'; direction: 'most' | 'least' }
  | { kind: 'filter'; property: RankProperty };

/**
 * What to do with a judgment, or null to leave the list alone. Pure.
 *
 * A one-word request such as "sweet" splits Jev between `lookup` and
 * `filter` (0.21 and 0.64 on the live pool), so the gate is on the summed
 * ranking probability when it is known, and the shape is the chosen label
 * when that is a ranking one.
 */
export function planPropertyRank(judgment: PropertyRankJudgment | null | undefined): RankPlan | null {
  if (!judgment) return null;
  const ranking = judgment.mode.ranking ?? (isRankingMode(judgment.mode.choice) ? judgment.mode.confidence : 0);
  if (ranking < RANK_MODE_THRESHOLD) return null;
  const mode = judgment.mode.choice;
  const property = judgment.property.confidence >= RANK_PROPERTY_THRESHOLD ? judgment.property.choice : 'other';
  if (mode === 'filter') return { kind: 'filter', property };
  if (mode !== 'most' && mode !== 'least') return null;
  return property === 'other' ? { kind: 'judged', direction: mode } : { kind: 'measured', direction: mode, property };
}

export interface RankItem {
  key: string;
  /** The measured value for the plan's property, when known. */
  value?: number;
}

export interface RankedItem {
  key: string;
  value?: number;
  /** Jev's probability that decided the position, when a judgment did. */
  probability?: number;
  basis: 'measured' | 'inferred';
}

/**
 * Order candidates by a plan. Pure and deterministic given the judgment.
 *
 * - measured: members of the compared group (`kind:`) with a known value,
 *   sorted by it; members without a value follow, by `has:`. Nothing outside
 *   the group is returned.
 * - judged: members sorted by `has:`, the probability they have the most of
 *   the property.
 * - filter: candidates whose `has:` clears the threshold, most likely first.
 *
 * Candidates Jev was not asked about (no `kind:`/`has:` answer) are left out:
 * a ranking only claims what it judged.
 */
export function rankByPlan(items: RankItem[], plan: RankPlan, judgment: PropertyRankJudgment): RankedItem[] {
  const has = (key: string) => judgment.has[key];
  const kind = (key: string) => judgment.kind[key];
  const byHas = (a: RankItem, b: RankItem) => (has(b.key) ?? 0) - (has(a.key) ?? 0);

  if (plan.kind === 'filter') {
    return items
      .filter((item) => (has(item.key) ?? 0) >= HAS_THRESHOLD)
      .sort(byHas)
      .map((item) => ({ key: item.key, value: item.value, probability: has(item.key), basis: 'inferred' }));
  }

  const members = items.filter((item) => (kind(item.key) ?? 0) >= KIND_THRESHOLD);
  if (plan.kind === 'judged') {
    return members
      .sort(byHas)
      .map((item) => ({ key: item.key, value: item.value, probability: has(item.key), basis: 'inferred' }));
  }

  const sign = plan.direction === 'most' ? -1 : 1;
  const known = members.filter((item) => typeof item.value === 'number' && Number.isFinite(item.value));
  const unknown = members.filter((item) => !(typeof item.value === 'number' && Number.isFinite(item.value)));
  known.sort((a, b) => sign * (a.value! - b.value!) || a.key.localeCompare(b.key));
  unknown.sort(byHas);
  return [
    ...known.map((item) => ({ key: item.key, value: item.value, basis: 'measured' as const })),
    ...unknown.map((item) => ({ key: item.key, probability: has(item.key), basis: 'inferred' as const })),
  ];
}
