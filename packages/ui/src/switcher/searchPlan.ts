import {
  FACT_THRESHOLD,
  LOOKUP_GATE,
  MEASURED_PROPERTIES,
  QUERY_FACET_THRESHOLD,
  facetById,
  facetScore,
  missingFacets,
  planPropertyRank,
  rankByPlan,
  type FacetId,
  type RankPlan,
  type RankProperty,
} from '@atlas/core';
import { factsFor, isDerivedFact } from '../library/libraryFacts';
import type { SwitchJudgment } from './judgeSwitch';
import type { SwitchCandidate } from './switchIndex';

/**
 * Organize a result list: the multi-step half of the switcher.
 *
 * 1. Filters. Facet chips the user tapped are hard requirements; facets Jev
 *    read from the typed words ("flammable liquid that floats" → flammable,
 *    liquid, floats) are soft ones weighted by Jev's probability, and are
 *    shown as removable chips so the reading is visible and correctable.
 *    Membership comes from the checked-in library facts, not a live call.
 * 2. Group. Without facets, the live per-candidate `kind:`/`has:` judgment
 *    decides who is compared (the property-ranking path).
 * 3. Order. A sort the user chose wins; then a measured most/least plan
 *    (values from formula or reference sheet); then Jev's live judgment for
 *    unmeasurable superlatives; then the facet match.
 *
 * Every row carries why it is there: the facets it matched or lacks, the
 * value it was sorted by, or the probability that placed it. Pure.
 */

export type MeasuredProperty = Exclude<RankProperty, 'other'>;

/** The number a measured sort uses, when this candidate has one. */
export function measuredValue(candidate: Pick<SwitchCandidate, 'molarMass' | 'atoms' | 'evidence'>, property: MeasuredProperty): number | undefined {
  switch (property) {
    case 'molar_mass':
      return candidate.molarMass;
    case 'size':
      return candidate.atoms > 0 ? candidate.atoms : undefined;
    case 'density':
      return candidate.evidence?.density;
    case 'melting_point':
      return candidate.evidence?.meltingPoint;
    case 'boiling_point':
      return candidate.evidence?.boilingPoint;
  }
}

export interface SortSpec {
  by: MeasuredProperty;
  direction: 'most' | 'least';
}

export interface SearchControls {
  /** Facets the user tapped: hard requirements. */
  chips: FacetId[];
  /** Jev-read facets the user removed for this query. */
  dismissed: FacetId[];
  /** A sort the user chose; overrides Jev's. */
  sort: SortSpec | null;
}

export const EMPTY_CONTROLS: SearchControls = { chips: [], dismissed: [], sort: null };

export interface FilterChip {
  id: FacetId;
  source: 'you' | 'jev';
  /** 1 for a tapped chip; Jev's probability for a read one. */
  weight: number;
}

export interface OrganizedRow {
  key: string;
  /** The sort value, when sorting by a measured property. */
  value?: number;
  /** Jev's live probability, when it decided the position. */
  probability?: number;
  /** Facet-match score in [0, 1], when filters applied. */
  match?: number;
  matched: FacetId[];
  missing: FacetId[];
}

export interface Organized {
  ordered: SwitchCandidate[];
  rows: Record<string, OrganizedRow>;
  filters: FilterChip[];
  /** The sort in force, from the user or from Jev's plan. */
  sort: SortSpec | null;
  /** Who chose the sort. */
  sortSource: 'you' | 'jev' | null;
  plan: RankPlan | null;
  summary: string;
}

/** Entries whose facet score falls under this are not shown. */
export const PARTIAL_MATCH_FLOOR = 0.05;
/** A partial match must still satisfy at least this share of the asked weight:
 *  with one facet, a partial is simply a miss ("floats in water" once listed
 *  tungsten as a partial). */
export const PARTIAL_WEIGHT_SHARE = 0.5;

/**
 * Facets are general; the live per-candidate judgment is specific. "smells
 * like citrus" reads as smell + scent + plants, which vanillin satisfies as
 * well as limonene; `has:` knows which is citrus. When it exists it scales
 * the facet match by 0.5 to 1.
 */
export function blendedScore(match: number, has: number | undefined): number {
  return has === undefined ? match : match * (0.5 + 0.5 * has);
}

/** Facets Jev read from the query, unless the query names one thing. */
export function jevFilters(judgment: SwitchJudgment | null, controls: SearchControls): FilterChip[] {
  const rank = judgment?.configured ? judgment.rank : null;
  if (!rank?.asks) return [];
  if (rank.mode.choice === 'lookup' && rank.mode.confidence >= LOOKUP_GATE) return [];
  return (Object.entries(rank.asks) as Array<[FacetId, number | undefined]>)
    .filter(([id, weight]) => (weight ?? 0) >= QUERY_FACET_THRESHOLD && !controls.dismissed.includes(id) && !controls.chips.includes(id) && facetById(id))
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([id, weight]) => ({ id, source: 'jev' as const, weight: weight ?? 0 }));
}

const compareValues = (direction: 'most' | 'least') => (a?: number, b?: number) => {
  const known = (value?: number) => typeof value === 'number' && Number.isFinite(value);
  if (known(a) && known(b)) return direction === 'most' ? b! - a! : a! - b!;
  return Number(known(b)) - Number(known(a));
};

export function organize(
  candidates: SwitchCandidate[],
  pool: SwitchCandidate[],
  judgment: SwitchJudgment | null,
  controls: SearchControls = EMPTY_CONTROLS,
): Organized | null {
  const rank = judgment?.configured ? judgment.rank ?? null : null;
  const plan = planPropertyRank(rank);
  const filters: FilterChip[] = [...controls.chips.filter((id) => facetById(id)).map((id) => ({ id, source: 'you' as const, weight: 1 })), ...jevFilters(judgment, controls)];
  const sort: SortSpec | null = controls.sort ?? (plan?.kind === 'measured' ? { by: plan.property, direction: plan.direction } : null);
  const sortSource = controls.sort ? 'you' : sort ? 'jev' : null;
  if (filters.length === 0 && !plan && !controls.sort) return null;

  const byKey = new Map<string, SwitchCandidate>();
  const universe = filters.length || plan ? [...candidates, ...pool] : candidates;
  for (const candidate of universe) if (!byKey.has(candidate.key)) byKey.set(candidate.key, candidate);
  const has = (key: string) => rank?.has[key];
  const asks = Object.fromEntries(filters.map((chip) => [chip.id, chip.weight])) as Partial<Record<FacetId, number>>;
  const totalWeight = filters.reduce((sum, chip) => sum + chip.weight, 0);

  let rows: OrganizedRow[];
  if (filters.length) {
    rows = [...byKey.keys()]
      .map((key) => {
        const facts = factsFor(key);
        const match = facetScore(facts, asks);
        const missing = missingFacets(facts, asks);
        // A tapped facet is a hard requirement, and so is any asked facet the
        // reference sheet (not Jev) says the entry lacks: ethanol certainly does
        // not float, whereas limonene merely lacks a "fuel" Jev over-read.
        const hard = filters.some((chip) => missing.includes(chip.id) && (chip.source === 'you' || isDerivedFact(key, chip.id)));
        const satisfied = filters.filter((chip) => !missing.includes(chip.id)).reduce((sum, chip) => sum + chip.weight, 0);
        const enough = satisfied >= PARTIAL_WEIGHT_SHARE * totalWeight;
        return { key, match: hard || !enough ? 0 : match, missing, matched: filters.map((chip) => chip.id).filter((id) => (facts?.[id] ?? 0) >= FACT_THRESHOLD), probability: has(key) };
      })
      .filter((row) => row.match >= PARTIAL_MATCH_FLOOR);
    const index = new Map([...byKey.keys()].map((key, i) => [key, i]));
    rows.sort((a, b) => blendedScore(b.match!, b.probability) - blendedScore(a.match!, a.probability) || index.get(a.key)! - index.get(b.key)!);
    if (plan?.kind === 'judged') rows.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
    if (rows.length === 0 && !controls.chips.length && plan && rank) rows = fromPlan();
  } else if (plan && rank) {
    rows = fromPlan();
  } else {
    rows = [...byKey.keys()].map((key) => ({ key, matched: [], missing: [] }));
  }

  function fromPlan(): OrganizedRow[] {
    const items = [...byKey.values()].map((candidate) => ({ key: candidate.key, value: plan!.kind === 'measured' ? measuredValue(candidate, plan!.property) : undefined }));
    return rankByPlan(items, plan!, rank!).map((item) => ({ key: item.key, value: item.value, probability: item.probability, matched: [], missing: [] }));
  }

  if (sort) {
    for (const row of rows) row.value = measuredValue(byKey.get(row.key)!, sort.by);
    const order = compareValues(sort.direction);
    // Full matches before partial ones, then the value; equal values keep the
    // match/judgment order from above.
    rows = rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => Number(a.row.missing.length > 0) - Number(b.row.missing.length > 0) || order(a.row.value, b.row.value) || a.i - b.i)
      .map(({ row }) => row);
  }
  if (rows.length === 0 && filters.every((chip) => chip.source === 'jev') && !controls.sort) return null;

  return {
    ordered: rows.map((row) => byKey.get(row.key)!),
    rows: Object.fromEntries(rows.map((row) => [row.key, row])),
    filters,
    sort,
    sortSource,
    plan,
    summary: summarize(filters, sort, sortSource, plan),
  };
}

function summarize(filters: FilterChip[], sort: SortSpec | null, sortSource: 'you' | 'jev' | null, plan: RankPlan | null): string {
  const parts: string[] = [];
  if (filters.length) {
    const read = filters.some((chip) => chip.source === 'jev');
    parts.push(`${filters.map((chip) => facetById(chip.id)!.label.toLowerCase()).join(' + ')}${read ? ' (read by Jev)' : ''}`);
  } else if (plan?.kind === 'filter') {
    parts.push('filtered by what you asked, judged by Jev (inferred)');
  }
  if (sort) {
    const basis = sort.by === 'molar_mass' || sort.by === 'size' ? 'computed' : 'reference values';
    parts.push(`${MEASURED_PROPERTIES[sort.by].label}, ${sort.direction === 'most' ? 'highest' : 'lowest'} first (${basis}${sortSource === 'jev' ? ', chosen by Jev' : ''})`);
  } else if (plan?.kind === 'judged') {
    parts.push(`ordered by Jev's judgment, ${plan.direction === 'most' ? 'most' : 'least'} first (inferred)`);
  }
  return parts.join(' · ');
}

/** "19.3 g/cm³", "−183 °C", "180.2 g/mol", "24 atoms". */
export function formatValue(property: MeasuredProperty, value: number): string {
  const { unit } = MEASURED_PROPERTIES[property];
  const text =
    property === 'density'
      ? value < 0.01 ? value.toPrecision(2) : String(Number(value.toPrecision(3)))
      : property === 'molar_mass'
        ? value.toFixed(value >= 1000 ? 0 : 1)
        : property === 'size'
          ? value.toLocaleString('en-US')
          : String(Math.round(value * 10) / 10);
  return `${text.replace(/^-/, '−')} ${unit}`;
}

/** The badge a row shows: its sort value, Jev's probability, or a partial-match mark. */
export function rowBadge(organized: Organized, row: OrganizedRow): { text: string; kind: 'measured' | 'inferred' | 'partial' } | null {
  if (organized.sort) return row.value !== undefined ? { text: formatValue(organized.sort.by, row.value), kind: 'measured' } : { text: 'no data', kind: 'inferred' };
  if (row.missing.length && organized.filters.length) return { text: 'partial', kind: 'partial' };
  const byJudgment = organized.plan?.kind === 'judged' || (!organized.filters.length && organized.plan?.kind === 'filter');
  if (byJudgment && row.probability !== undefined) return { text: `Jev ${Math.round(row.probability * 100)}%`, kind: 'inferred' };
  return null;
}

/** "✓ metal · aircraft  ✗ fuel" as data: the reason line under a row. */
export function rowReason(organized: Organized, row: OrganizedRow): string | null {
  if (!organized.filters.length) return null;
  const label = (id: FacetId) => facetById(id)!.label.toLowerCase();
  const matched = row.matched.map(label);
  const missing = row.missing.map(label);
  return [matched.length ? `✓ ${matched.join(' · ')}` : '', missing.length ? `✗ ${missing.join(' · ')}` : ''].filter(Boolean).join('  ') || null;
}
