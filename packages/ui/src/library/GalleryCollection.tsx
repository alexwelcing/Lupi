import { useEffect, useState } from 'react';
import { ALL_DOMAINS, SOURCE_FILTERS, type Domain, type GalleryExample, type SourceFilter } from '../gallery/catalog';
import { useGalleryFilters } from '../gallery/useGalleryFilters';
import { galleryNomenclatureTags, nomenclatureForGalleryId } from '../galleryNomenclature';
import { LOCAL_MOLECULES } from '../landing/moleculeIndex';
import { openLocalMolecule } from '../landing/MoleculeFinder';
import type { FunctionalGroupId } from '../organicFunctionalGroups';
import { useLibraryQuery } from './useLibraryQuery';

const PREVIEW_BY_ID = new Map(LOCAL_MOLECULES.filter((m) => m.image).map((m) => [m.id, m.image!]));

function hrefFor(example: GalleryExample): string {
  return example.route ?? `/?sim=${encodeURIComponent(example.id)}`;
}

/**
 * The full curated catalog with the domain, source-type, and functional-group
 * filters the pre-reset gallery had. Cards are plain `/?sim=` links that open
 * in place, exactly like the homepage wall.
 */
export function GalleryCollection() {
  const [query, update] = useLibraryQuery();
  const filters = useGalleryFilters('All');
  const { setSearch, clearFilters } = filters;
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    setSearch(query.q);
  }, [query.q, setSearch]);

  const open = (event: React.MouseEvent<HTMLAnchorElement>, example: GalleryExample) => {
    if (example.route || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    if (opening) return;
    setOpening(example.id);
    openLocalMolecule(example.id)
      .catch(() => undefined)
      .finally(() => setOpening(null));
  };

  const examples = filters.filteredExamples;
  return (
    <div className="library-browser">
      <div className="library-toolbar">
        <label className="student-search library-search">
          <span>Find in the gallery</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => {
              setSearch(event.target.value);
              update({ q: event.target.value.trim() });
            }}
            placeholder="Title, formula, domain, method…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="student-filters library-chips" role="group" aria-label="Domain">
          <button type="button" aria-pressed={filters.filter === 'All'} onClick={() => filters.setFilter('All')}>
            All domains
          </button>
          {filters.domainSummaries.map(({ domain, count }) => (
            <button key={domain} type="button" aria-pressed={filters.filter === domain} onClick={() => filters.setFilter(domain as Domain)}>
              {domain} <small>{count}</small>
            </button>
          ))}
        </div>
        <div className="library-selects">
          <label>
            <span>Type</span>
            <select value={filters.sourceFilter} onChange={(event) => filters.setSourceFilter(event.target.value as SourceFilter)}>
              {SOURCE_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Functional group</span>
            <select
              value={filters.functionalGroupFilter}
              onChange={(event) => filters.setFunctionalGroupFilter(event.target.value as FunctionalGroupId | 'All')}
            >
              <option value="All">Any</option>
              {filters.functionalGroupSummaries.map(({ group, count }) => (
                <option key={group.id} value={group.id}>
                  {group.label} ({count})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <p className="student-result-count" role="status">
        {examples.length} of {filters.galleryStats.available} gallery {examples.length === 1 ? 'entry' : 'entries'} across{' '}
        {ALL_DOMAINS.length} domains
      </p>
      {examples.length === 0 ? (
        <div className="student-empty">
          <h3>No matching gallery entries</h3>
          <p>Every entry is a coordinate file Lupi ships or streams. Try another domain or clear the filters.</p>
          <button
            type="button"
            className="student-secondary"
            onClick={() => {
              clearFilters();
              update({ q: '' });
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="library-grid">
          {examples.map((example) => {
            const image = PREVIEW_BY_ID.get(example.id);
            const formula = nomenclatureForGalleryId(example.id)?.molecularFormula;
            const tags = galleryNomenclatureTags(example.id).slice(0, 3);
            return (
              <article key={example.id} className="library-card library-card--gallery">
                <a
                  href={hrefFor(example)}
                  aria-label={`Open ${example.title}`}
                  aria-busy={opening === example.id}
                  onClick={(event) => open(event, example)}
                >
                  <span className="library-card-head">
                    {image ? (
                      <img src={image} alt="" width="44" height="44" loading="lazy" decoding="async" />
                    ) : (
                      <span
                        className="wall-mark"
                        aria-hidden="true"
                        style={{ background: `linear-gradient(135deg, ${example.colors[0]}, ${example.colors[1]})` }}
                      >
                        {example.title.slice(0, 1)}
                      </span>
                    )}
                    <h3>{example.title}</h3>
                  </span>
                  <span className="library-card-subtitle">{example.subtitle}</span>
                  <span className="library-meta">
                    {example.domain} · {example.atoms} atoms
                    {Number(example.frames.replace(/[^\d]/g, '')) > 1 ? ` · ${example.frames} frames` : ''}
                    {formula ? ` · ${formula}` : ''}
                  </span>
                  {tags.length > 0 && (
                    <span className="library-elements" aria-label="Nomenclature">
                      {tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </span>
                  )}
                  <span className="library-truth">
                    {example.metadata?.doi ? `DOI ${example.metadata.doi}` : 'Curated Lupi file'}
                    {' · '}bond lines are distance-inferred guides
                  </span>
                  {opening === example.id && <span className="library-card-busy">Opening…</span>}
                </a>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
