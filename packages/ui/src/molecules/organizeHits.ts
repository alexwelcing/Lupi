import { MEASURED_PROPERTIES, facetMatch, isFacetId, molarMass, type FacetId } from '@atlas/core';
import { facetsOf, factsFor } from '../library/libraryFacts';
import { galleryEvidence } from '../switcher/switchIndex';
import type { MoleculeHit } from './types';

/**
 * Facet filters and measured sorts for federated search hits: the agent-side
 * twin of the switcher's organize bar (`lupi.search_molecules` with
 * `facets`, `sortBy`, `order`). Pure over the checked-in library facts and
 * reference sheet, so an agent gets the same answer as the UI, with no Jev
 * call. Hits without facts (PubChem, NIST, OMol25) are dropped by a facet
 * filter and sort after hits with a value.
 */
export type HitSortKey = keyof typeof MEASURED_PROPERTIES;

export interface HitFacts {
  /** Facet ids the entry has, strongest first. */
  facets: FacetId[];
  molarMass?: number;
  atoms?: number;
  density?: number;
  meltingPoint?: number;
  boilingPoint?: number;
  phase?: string;
}

export function hitFacts(hit: MoleculeHit): HitFacts | undefined {
  const key = `${hit.source}:${hit.id}`;
  const facts = factsFor(key);
  const evidence = hit.source === 'gallery' ? galleryEvidence(hit.id) : undefined;
  const mass = molarMass(hit.formula);
  if (!facts && !evidence && mass === undefined) return undefined;
  return {
    facets: facetsOf(key).map((facet) => facet.id),
    ...(mass !== undefined ? { molarMass: mass } : {}),
    ...(evidence?.density !== undefined ? { density: evidence.density } : {}),
    ...(evidence?.meltingPoint !== undefined ? { meltingPoint: evidence.meltingPoint } : {}),
    ...(evidence?.boilingPoint !== undefined ? { boilingPoint: evidence.boilingPoint } : {}),
    ...(evidence?.phase ? { phase: evidence.phase } : {}),
  };
}

function valueOf(facts: HitFacts | undefined, key: HitSortKey, hit: MoleculeHit & { atoms?: number }): number | undefined {
  if (key === 'molar_mass') return facts?.molarMass;
  if (key === 'size') return hit.atoms;
  if (key === 'density') return facts?.density;
  if (key === 'melting_point') return facts?.meltingPoint;
  return facts?.boilingPoint;
}

export function organizeHits<T extends MoleculeHit & { atoms?: number }>(
  hits: T[],
  options: { facets?: unknown[]; sortBy?: unknown; order?: unknown },
): Array<T & { facts?: HitFacts }> {
  const facets = (options.facets ?? []).filter(isFacetId);
  const sortBy = typeof options.sortBy === 'string' && options.sortBy in MEASURED_PROPERTIES ? (options.sortBy as HitSortKey) : null;
  const direction = options.order === 'asc' ? 1 : -1;
  let rows = hits.map((hit) => ({ hit, facts: hitFacts(hit) }));
  if (facets.length) rows = rows.filter(({ hit }) => facetMatch(factsFor(`${hit.source}:${hit.id}`), facets) > 0);
  if (sortBy) {
    const known = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value);
    rows = rows
      .map((row, index) => ({ ...row, index, value: valueOf(row.facts, sortBy, row.hit) }))
      .sort((a, b) => (known(a.value) && known(b.value) ? direction * (a.value! - b.value!) : Number(known(b.value)) - Number(known(a.value))) || a.index - b.index);
  }
  return rows.map(({ hit, facts }) => (facts ? { ...hit, facts } : hit));
}
