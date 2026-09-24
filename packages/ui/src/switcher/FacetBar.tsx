import { useMemo, useState } from 'react';
import { FACET_GROUP_LABELS, MEASURED_PROPERTIES, facetById, type FacetGroup, type FacetId } from '@atlas/core';
import { facetCountsAmong } from '../library/libraryFacts';
import type { FilterChip, MeasuredProperty, SortSpec } from './searchPlan';

/**
 * The organize bar: the filters in force (yours solid, Jev's reading of your
 * words dashed, every one removable), a picker of every facet with how many
 * entries have it, and a sort. Everything here filters the checked-in facts,
 * so it works instantly and without Jev.
 */
const SORTS = Object.keys(MEASURED_PROPERTIES) as MeasuredProperty[];

export function FacetBar({
  filters,
  poolKeys,
  sort,
  sortSource,
  onAdd,
  onRemove,
  onSort,
}: {
  filters: FilterChip[];
  /** Entries the counts are taken over. */
  poolKeys: string[];
  sort: SortSpec | null;
  sortSource: 'you' | 'jev' | null;
  onAdd: (id: FacetId) => void;
  onRemove: (chip: FilterChip) => void;
  onSort: (sort: SortSpec | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const counts = useMemo(() => facetCountsAmong(poolKeys), [poolKeys]);
  const active = new Set(filters.map((chip) => chip.id));
  const groups = (Object.keys(FACET_GROUP_LABELS) as FacetGroup[])
    .map((group) => ({ group, entries: counts.filter((entry) => entry.facet.group === group && !active.has(entry.facet.id)) }))
    .filter((entry) => entry.entries.length);

  return (
    <div className="facet-bar">
      <div className="facet-row" role="group" aria-label="Filters">
        {filters.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`facet-chip is-on${chip.source === 'jev' ? ' is-read' : ''}`}
            onClick={() => onRemove(chip)}
            title={chip.source === 'jev' ? `Read from your words by Jev (${Math.round(chip.weight * 100)}%). Click to remove.` : 'Click to remove.'}
            aria-label={`Remove filter ${facetById(chip.id)!.label}`}
          >
            {facetById(chip.id)!.label} <span aria-hidden="true">×</span>
          </button>
        ))}
        <button type="button" className="facet-chip facet-add" aria-expanded={picking} onClick={() => setPicking((open) => !open)}>
          {picking ? 'Done' : filters.length ? '+ filter' : 'Filter by…'}
        </button>
        <label className="facet-sort">
          <span>Sort</span>
          <select
            value={sort?.by ?? ''}
            onChange={(event) => onSort(event.target.value ? { by: event.target.value as MeasuredProperty, direction: sort?.direction ?? 'most' } : null)}
            aria-label="Sort by"
          >
            <option value="">relevance</option>
            {SORTS.map((key) => (
              <option key={key} value={key}>
                {MEASURED_PROPERTIES[key].label}
              </option>
            ))}
          </select>
          {sort && (
            <button
              type="button"
              className="facet-direction"
              onClick={() => onSort({ by: sort.by, direction: sort.direction === 'most' ? 'least' : 'most' })}
              aria-label={sort.direction === 'most' ? 'Highest first; switch to lowest first' : 'Lowest first; switch to highest first'}
              title={sortSource === 'jev' ? 'Chosen by Jev from your words' : undefined}
            >
              {sort.direction === 'most' ? '↓ high' : '↑ low'}
            </button>
          )}
        </label>
      </div>
      {picking && (
        <div className="facet-picker">
          {groups.map(({ group, entries }) => (
            <div key={group} className="facet-group" role="group" aria-label={FACET_GROUP_LABELS[group]}>
              <span className="facet-group-label">{FACET_GROUP_LABELS[group]}</span>
              {entries.map(({ facet, count }) => (
                <button key={facet.id} type="button" className="facet-chip" onClick={() => onAdd(facet.id)} title={`The substance ${facet.predicate}`}>
                  {facet.label} <small>{count}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
