import { useEffect, useMemo, useRef, useState } from 'react';
import { FUNCTIONAL_GROUP_BY_ID, type FunctionalGroupId } from '../organicFunctionalGroups';
import { omolFacets, searchOmolValidation, type OmolFacets } from '../molecules/providers/omol';
import {
  FALLBACK_OMOL_COLLECTIONS,
  RemoteOmolWarmingError,
  remoteOmolHit,
  remoteOmolManifest,
  remoteOmolPage,
  type RemoteOmolCollection,
  type RemoteOmolCollectionId,
  type RemoteOmolPage,
} from '../molecules/remoteOmol';
import type { MoleculeHit } from '../molecules/types';
import { LibraryCard } from './LibraryCard';
import { openLibraryHit, useLibraryHandoff } from './openHit';
import { PeriodicTableFacet } from './PeriodicTableFacet';
import { useLibraryQuery } from './useLibraryQuery';

const PAGE_SIZE = 24;
const FACET_PAGE = 36;
const DEBOUNCE_MS = 260;
const PAPER_URL = 'https://arxiv.org/abs/2505.08762';
const SOURCE_URL = 'https://huggingface.co/collections/colabfit/omol25-open-molecules-2025-colabfit';
const REMOTE_COLLECTIONS: RemoteOmolCollectionId[] = ['neutral-train', 'all-train-preview', 'train-4m-preview', 'validation-preview'];

export function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return value.toLocaleString();
}

function looksLikeFormula(text: string): boolean {
  return text.length > 0 && /^[A-Z][A-Za-z0-9()[\]+.\-]*$/.test(text);
}

function isRemoteCollection(value: string | null): value is RemoteOmolCollectionId {
  return value !== null && FALLBACK_OMOL_COLLECTIONS.some((collection) => collection.id === value);
}

/**
 * Meta FAIR's Open Molecules 2025 through the public ColabFit conversions.
 * Default view pages the five remote collections through the same-origin
 * edge; the facets view navigates the complete 27,697-row neutral validation
 * slice by periodic table and Lupi's functional-group geometry screen.
 */
export function Omol25Collection() {
  const [query, update] = useLibraryQuery();
  const facets = query.view === 'facets';
  return (
    <div>
      <header className="library-masthead">
        <p className="student-eyebrow">Meta FAIR Chemistry · CC BY 4.0</p>
        <h2>Open Molecules 2025</h2>
        <p>
          Source DFT coordinates (ωB97M-V/def2-TZVPD) streamed one page at a time from the public ColabFit conversions.
          Lupi stores no shards and copies no rows; OMol25 supplies no bond topology, so any bond lines are a viewer
          guide.{' '}
          <a href={PAPER_URL} target="_blank" rel="noreferrer">
            Paper ↗
          </a>{' '}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        </p>
        <div className="student-filters library-chips" role="group" aria-label="OMol25 view">
          <button type="button" aria-pressed={!facets} onClick={() => update({ view: null, offset: 0 })}>
            Remote collections <small>34.3M+</small>
          </button>
          <button type="button" aria-pressed={facets} onClick={() => update({ view: 'facets', offset: 0 })}>
            Faceted validation slice <small>27.7K</small>
          </button>
        </div>
      </header>
      {facets ? <FacetedValidation /> : <RemoteBrowser />}
    </div>
  );
}

export function RemoteBrowser() {
  const [query, update] = useLibraryQuery();
  const handoff = useLibraryHandoff();
  const collectionId: RemoteOmolCollectionId = isRemoteCollection(query.collection) ? query.collection : 'neutral-train';
  const [collections, setCollections] = useState<RemoteOmolCollection[]>([...FALLBACK_OMOL_COLLECTIONS]);
  const [text, setText] = useState(query.q);
  const [debounced, setDebounced] = useState(query.q);
  const [page, setPage] = useState<RemoteOmolPage | null>(null);
  const [hits, setHits] = useState<MoleculeHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let alive = true;
    remoteOmolManifest().then((manifest) => {
      if (alive && manifest.collections.length) setCollections(manifest.collections);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setText(query.q);
  }, [query.q]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = text.trim();
      setDebounced(next);
      if (next !== query.q) update({ q: next, offset: 0 });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    remoteOmolPage({
      collection: collectionId,
      offset: query.offset,
      limit: PAGE_SIZE,
      ...(debounced ? (looksLikeFormula(debounced) ? { formula: debounced } : { query: debounced }) : {}),
    })
      .then((result) => {
        if (id !== requestId.current) return;
        setPage(result);
        setHits(result.rows.map(remoteOmolHit));
      })
      .catch((reason: unknown) => {
        if (id !== requestId.current) return;
        setError(
          reason instanceof RemoteOmolWarmingError
            ? `The upstream search index is warming. Browsing still works; retry this query in about ${reason.retryAfterSeconds} seconds.`
            : reason instanceof Error
              ? reason.message
              : 'OMol25 could not be reached.',
        );
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [collectionId, debounced, query.offset]);

  const collection = useMemo(
    () => collections.find((item) => item.id === collectionId) ?? FALLBACK_OMOL_COLLECTIONS.find((item) => item.id === collectionId)!,
    [collectionId, collections],
  );
  const visible = useMemo(
    () => REMOTE_COLLECTIONS.map((id) => collections.find((item) => item.id === id)).filter((item): item is RemoteOmolCollection => Boolean(item)),
    [collections],
  );
  const total = page?.matchedRows ?? collection.indexedRows;
  const pageEnd = Math.min(query.offset + hits.length, total);
  const canPrevious = query.offset > 0;
  const canNext = query.offset + PAGE_SIZE < total;

  const randomPage = () => {
    const lastStart = Math.max(0, total - PAGE_SIZE);
    const pageCount = Math.floor(lastStart / PAGE_SIZE) + 1;
    update({ offset: Math.min(lastStart, Math.floor(Math.random() * pageCount) * PAGE_SIZE) });
  };

  const open = async (hit: MoleculeHit) => {
    if (opening) return;
    const key = `${hit.source}:${hit.id}`;
    setOpening(key);
    try {
      await openLibraryHit(hit, handoff);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not open ${hit.title}.`);
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="library-browser">
      <div className="library-toolbar">
        <div className="student-filters library-chips" role="group" aria-label="OMol25 collection">
          {visible.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={collectionId === option.id}
              onClick={() => {
                setText('');
                update({ collection: option.id, q: '', offset: 0 });
              }}
              title={option.description}
            >
              {option.label} <small>{compactCount(option.indexedRows)}</small>
            </button>
          ))}
        </div>
        <div className="library-inline">
          <label className="student-search library-search">
            <span>Exact formula, or a text query</span>
            <input
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="C6H6"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="button" className="student-secondary" onClick={randomPage} disabled={loading || total <= PAGE_SIZE}>
            Random page
          </button>
        </div>
      </div>
      <p className="library-coverage">
        <strong>{collection.coverage === 'complete' ? 'Complete split' : 'Indexed preview'}:</strong>{' '}
        {collection.indexedRows.toLocaleString()} rows queryable of {collection.estimatedRows.toLocaleString()} in{' '}
        <code>{collection.repository}</code>.
        {collection.coverage === 'indexed-preview'
          ? ' Hugging Face exposes only this window through its row API; Lupi keeps that boundary visible.'
          : ''}
      </p>
      <p className="student-result-count" role="status">
        {loading
          ? 'Loading source rows…'
          : hits.length
            ? `${(query.offset + 1).toLocaleString()}–${pageEnd.toLocaleString()} of ${total.toLocaleString()}`
            : 'No rows'}
      </p>
      {error && (
        <p className="finder-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && hits.length === 0 && (
        <div className="student-empty">
          <h3>No exact match in this collection</h3>
          <p>Formula search is exact. Try the faceted validation slice for element and functional-group browsing.</p>
        </div>
      )}
      <div className="library-grid">
        {hits.map((hit) => {
          const key = `${hit.source}:${hit.id}`;
          return <LibraryCard key={key} hit={hit} busy={opening === key} onOpen={open} />;
        })}
      </div>
      <div className="library-pager">
        <button type="button" className="student-secondary" disabled={!canPrevious || loading} onClick={() => update({ offset: Math.max(0, query.offset - PAGE_SIZE) })}>
          Previous
        </button>
        <span>offset {query.offset.toLocaleString()}</span>
        <button type="button" className="student-secondary" disabled={!canNext || loading} onClick={() => update({ offset: query.offset + PAGE_SIZE })}>
          Next
        </button>
      </div>
    </div>
  );
}

export function FacetedValidation() {
  const [query, update] = useLibraryQuery();
  const handoff = useLibraryHandoff();
  const [facets, setFacets] = useState<OmolFacets | null>(null);
  const [facetError, setFacetError] = useState(false);
  const [groups, setGroups] = useState<FunctionalGroupId[]>([]);
  const [text, setText] = useState(query.q);
  const [debounced, setDebounced] = useState(query.q);
  const [hits, setHits] = useState<MoleculeHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    let alive = true;
    omolFacets()
      .then((result) => {
        if (!alive) return;
        setFacets(result);
        setFacetError(result.total === 0);
      })
      .catch(() => {
        if (alive) setFacetError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setText(query.q);
  }, [query.q]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = text.trim();
      setDebounced(next);
      if (next !== query.q) update({ q: next });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const elementsKey = query.elements.join(',');
  const groupsKey = groups.join(',');
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    searchOmolValidation({
      text: debounced,
      elements: query.elements.length ? query.elements : undefined,
      functionalGroups: groups.length ? groups : undefined,
      limit: FACET_PAGE,
    })
      .then((result) => {
        if (id === requestId.current) setHits(result);
      })
      .catch(() => {
        if (id === requestId.current) setHits([]);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, elementsKey, groupsKey]);

  const countByElement = useMemo(() => new Map((facets?.elementCounts ?? []).map((entry) => [entry.element, entry.count])), [facets]);
  const maxCount = facets?.elementCounts[0]?.count ?? 1;

  const toggleElement = (symbol: string) =>
    update({
      elements: query.elements.includes(symbol) ? query.elements.filter((item) => item !== symbol) : [...query.elements, symbol],
    });
  const toggleGroup = (id: FunctionalGroupId) =>
    setGroups((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));

  const open = async (hit: MoleculeHit) => {
    if (opening) return;
    const key = `${hit.source}:${hit.id}`;
    setOpening(key);
    setOpenError(null);
    try {
      await openLibraryHit(hit, handoff);
    } catch (reason) {
      setOpenError(reason instanceof Error ? reason.message : `Could not open ${hit.title}.`);
    } finally {
      setOpening(null);
    }
  };

  const filterLabel = [
    query.elements.length ? `containing ${query.elements.join(' + ')}` : '',
    groups.length ? `with ${groups.map((id) => FUNCTIONAL_GROUP_BY_ID[id]?.label ?? id).join(' + ')}` : '',
  ]
    .filter(Boolean)
    .join(' and ');

  return (
    <div className="library-browser">
      <div className="library-stats">
        <div>
          <strong>{facets ? facets.total.toLocaleString() : '…'}</strong>
          <span>structures in this slice</span>
        </div>
        <div>
          <strong>{facets ? facets.elementCounts.length : '…'}</strong>
          <span>elements present</span>
        </div>
        <div>
          <strong>{facets ? `${facets.natoms.min}–${facets.natoms.max}` : '…'}</strong>
          <span>atoms per structure{facets ? ` (median ${facets.natoms.median})` : ''}</span>
        </div>
      </div>
      {facetError && (
        <p className="finder-error" role="alert">
          The OMol25 validation index could not be reached right now. Try again in a moment.
        </p>
      )}
      <section aria-labelledby="omol-space">
        <div className="library-section-head">
          <h3 id="omol-space">Chemical space</h3>
          <p>
            Click elements to filter (AND).{' '}
            {query.elements.length > 0 && (
              <button type="button" className="library-clear" onClick={() => update({ elements: [] })}>
                Clear {query.elements.length}
              </button>
            )}
          </p>
        </div>
        <PeriodicTableFacet countByElement={countByElement} maxCount={maxCount} selected={query.elements} onToggle={toggleElement} />
      </section>
      {facets && facets.functionalGroupCounts.length > 0 && (
        <section aria-labelledby="omol-groups">
          <div className="library-section-head">
            <h3 id="omol-groups">Functional group screen</h3>
            <p>Lupi geometry screen over source coordinates; not OMol25 bond topology.</p>
          </div>
          <div className="student-filters library-chips" role="group" aria-label="Functional group">
            {facets.functionalGroupCounts.map((group) => (
              <button key={group.id} type="button" aria-pressed={groups.includes(group.id)} onClick={() => toggleGroup(group.id)}>
                {group.label} <small>{group.count.toLocaleString()}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      <label className="student-search library-search">
        <span>Filter by formula or element</span>
        <input type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder="C6H6" autoComplete="off" spellCheck={false} />
      </label>
      <p className="student-result-count" role="status">
        {loading ? 'Searching…' : `${hits.length}${hits.length >= FACET_PAGE ? '+' : ''} ${hits.length === 1 ? 'structure' : 'structures'}${filterLabel ? ` ${filterLabel}` : ''}`}
      </p>
      {openError && (
        <p className="finder-error" role="alert">
          {openError}
        </p>
      )}
      {!loading && hits.length === 0 ? (
        <div className="student-empty">
          <h3>No structures match</h3>
          <p>Try fewer filters or a different formula.</p>
        </div>
      ) : (
        <div className="library-grid">
          {hits.map((hit) => {
            const key = `${hit.source}:${hit.id}`;
            return <LibraryCard key={key} hit={hit} busy={opening === key} onOpen={open} activeElements={query.elements} />;
          })}
        </div>
      )}
    </div>
  );
}
