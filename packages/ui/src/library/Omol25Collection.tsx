import { useEffect, useMemo, useRef, useState } from 'react';
import {
  OMOL25_ATTRIBUTION_URL,
  OMOL25_FEATURED_FILE_PATH,
  OMOL25_MASTHEAD_BOND_SENTENCE,
  OMOL25_PAPER_URL,
  OMOL25_SHELF_LABELS,
  OMOL25_SHELVES,
  omol25Collection,
  omolGeometryState,
  type OmolShelfId,
} from '@atlas/core/omol25';
import { FUNCTIONAL_GROUP_BY_ID, type FunctionalGroupId } from '../organicFunctionalGroups';
import { omolFacets, searchOmolValidationPage, type OmolFacets } from '../molecules/providers/omol';
import {
  FALLBACK_OMOL_COLLECTIONS,
  OmolSlowError,
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
import { ElementChips } from '../switcher/ElementChips';
import { OmolOpenerStatus, OmolPickTiles, useOmolOpener } from '../landing/OmolShelf';
import { OMOL_PICKS } from '../landing/omolShelf.data';
import { trackLibrarySearch } from './trackLibrarySearch';
import { useLibraryQuery } from './useLibraryQuery';

const PAGE_SIZE = 24;
const FACET_PAGE = 36;
const DEBOUNCE_MS = 260;
const REMOTE_COLLECTIONS: RemoteOmolCollectionId[] = ['neutral-train', 'all-train-preview', 'train-4m-preview', 'validation-preview'];
const NEUTRAL_TRAIN_ROWS = omol25Collection('neutral-train').sourceRows;
const VALIDATION_ROWS = omol25Collection('neutral-validation').sourceRows;

export const OMOL_SLOW_COPY = 'OMol25’s host is slow to answer. Try again in a moment.';
const OMOL_UNREACHABLE_COPY = 'OMol25 could not be reached right now. Try again in a moment.';
const OMOL_OPEN_FAILED_COPY = 'That structure didn’t open. Try again in a moment.';

/**
 * What a failed OMol25 request tells the visitor. The warming sentence keeps
 * the edge's retry hint; a timeout, an abort or anything else gets a plain
 * sentence, never the raw transport text.
 */
export function omolErrorCopy(reason: unknown): string {
  if (reason instanceof RemoteOmolWarmingError) {
    return `The upstream search index is warming. Browsing still works; retry this query in about ${reason.retryAfterSeconds} seconds.`;
  }
  if (reason instanceof OmolSlowError) return OMOL_SLOW_COPY;
  const name = (reason as { name?: unknown } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return OMOL_SLOW_COPY;
  return OMOL_UNREACHABLE_COPY;
}

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
 * The featured picks sit on top, by shelf. Default view pages the remote
 * collections through the same-origin edge; the facets view navigates the
 * complete 27,697-row neutral validation slice by element and Lupi's
 * functional-group geometry screen.
 */
export function Omol25Collection() {
  const [query, update] = useLibraryQuery();
  const facets = query.view === 'facets';
  return (
    <div>
      <OmolMasthead />
      <FeaturedShelves />
      <div className="student-filters library-chips" role="group" aria-label="OMol25 view">
        <button type="button" aria-pressed={!facets} onClick={() => update({ view: null, offset: 0 })}>
          Remote collections <small>{compactCount(NEUTRAL_TRAIN_ROWS)}+</small>
        </button>
        <button type="button" aria-pressed={facets} onClick={() => update({ view: 'facets', offset: 0 })}>
          Filter by element <small>{compactCount(VALIDATION_ROWS)}</small>
        </button>
      </div>
      {facets ? <FacetedValidation /> : <RemoteBrowser />}
    </div>
  );
}

export function OmolMasthead() {
  return (
    <header className="library-masthead">
      <p className="student-eyebrow">Meta FAIR Chemistry · CC BY 4.0</p>
      <h2>Open Molecules 2025</h2>
      <p>
        Source DFT coordinates (ωB97M-V/def2-TZVPD) streamed one page at a time from the public ColabFit conversions.
        Lupi pages rows on demand and keeps {OMOL_PICKS.length} hand-picked rows, credited, for its shelves. Nearly all
        OMol25 geometries are snapshots away from a minimum. {OMOL25_MASTHEAD_BOND_SENTENCE}{' '}
        <a href={OMOL25_PAPER_URL} target="_blank" rel="noreferrer">
          Paper ↗
        </a>{' '}
        <a href={OMOL25_ATTRIBUTION_URL} target="_blank" rel="noreferrer">
          Source ↗
        </a>
      </p>
    </header>
  );
}

interface FeaturedFacts {
  maxForceEvPerA: number | null;
}

/** Per-pick facts from featured.v1.json that the bundled shelf data leaves out. */
function useFeaturedFacts(): Map<string, FeaturedFacts> {
  const [facts, setFacts] = useState<Map<string, FeaturedFacts>>(() => new Map());
  useEffect(() => {
    let alive = true;
    fetch(OMOL25_FEATURED_FILE_PATH)
      .then((response) => (response.ok ? response.json() : null))
      .then((file: { picks?: unknown } | null) => {
        if (!alive || !Array.isArray(file?.picks)) return;
        const next = new Map<string, FeaturedFacts>();
        for (const raw of file.picks as Array<{ id?: unknown; maxForceEvPerA?: unknown }>) {
          if (typeof raw?.id !== 'string') continue;
          const force = raw.maxForceEvPerA;
          next.set(raw.id, { maxForceEvPerA: typeof force === 'number' && Number.isFinite(force) ? force : null });
        }
        setFacts(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return facts;
}

/** The featured picks, one shelf at a time: ink tiles that open the same-origin copy. */
export function FeaturedShelves() {
  const [shelf, setShelf] = useState<OmolShelfId>(OMOL25_SHELVES[0]);
  const facts = useFeaturedFacts();
  const opener = useOmolOpener();
  const counts = useMemo(() => new Map(OMOL25_SHELVES.map((id) => [id, OMOL_PICKS.filter((pick) => pick.shelf === id).length])), []);
  const picks = useMemo(() => OMOL_PICKS.filter((pick) => pick.shelf === shelf), [shelf]);
  return (
    <section className="omol-shelf omol-shelf--library" aria-labelledby="omol-featured-title">
      <div className="library-section-head">
        <h3 id="omol-featured-title">Featured picks</h3>
        <p>{OMOL_PICKS.length} neutral-validation rows kept as credited copies, each with a sha256 receipt.</p>
      </div>
      <div className="student-filters library-chips" role="group" aria-label="OMol25 shelves">
        {OMOL25_SHELVES.filter((id) => (counts.get(id) ?? 0) > 0).map((id) => (
          <button key={id} type="button" aria-pressed={shelf === id} onClick={() => setShelf(id)}>
            {OMOL25_SHELF_LABELS[id]} <small>{counts.get(id)}</small>
          </button>
        ))}
      </div>
      <OmolPickTiles
        picks={picks}
        entry="library"
        opener={opener}
        label={OMOL25_SHELF_LABELS[shelf]}
        note={(pick) => omolGeometryState(facts.get(pick.id)?.maxForceEvPerA ?? null)}
      />
      <OmolOpenerStatus opener={opener} />
    </section>
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
        trackLibrarySearch({ collection: 'omol25', source: collectionId, hasQuery: debounced.length > 0, elementCount: 0, resultCount: result.returnedRows });
      })
      .catch((reason: unknown) => {
        if (id !== requestId.current) return;
        setError(omolErrorCopy(reason));
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

  // A filtered search whose total is unknown can only draw from the rows on screen.
  const fromScreen = debounced.length > 0 && page?.matchedRows == null;
  const randomPool = fromScreen ? hits.length : total;

  /** Open one uniformly chosen row of this collection and filter. */
  const randomRow = async () => {
    if (opening || randomPool <= 0) return;
    setOpening('random');
    setError(null);
    try {
      const { uniformRandomInt } = await import('../molecules/randomOmol');
      const index = uniformRandomInt(randomPool);
      let hit: MoleculeHit | undefined;
      if (fromScreen) {
        hit = hits[index];
      } else {
        const result = await remoteOmolPage({
          collection: collectionId,
          offset: index,
          limit: 1,
          ...(debounced ? (looksLikeFormula(debounced) ? { formula: debounced } : { query: debounced }) : {}),
        });
        hit = result.rows[0] ? remoteOmolHit(result.rows[0]) : undefined;
      }
      if (!hit) throw new Error('no row');
      await openLibraryHit(hit, handoff);
    } catch (reason) {
      setError(reason instanceof RemoteOmolWarmingError || reason instanceof OmolSlowError ? omolErrorCopy(reason) : OMOL_OPEN_FAILED_COPY);
    } finally {
      setOpening(null);
    }
  };

  const open = async (hit: MoleculeHit) => {
    if (opening) return;
    const key = `${hit.source}:${hit.id}`;
    setOpening(key);
    try {
      await openLibraryHit(hit, handoff);
    } catch {
      setError(OMOL_OPEN_FAILED_COPY);
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
              {option.label} <small>{compactCount(option.sourceRows ?? option.estimatedRows)}</small>
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
          <button type="button" className="student-secondary" onClick={() => void randomRow()} disabled={loading || opening !== null || randomPool <= 0}>
            {opening === 'random' ? 'Opening…' : 'Random row'}
          </button>
        </div>
      </div>
      <p className="library-coverage">
        <strong>{collection.coverage === 'complete' ? 'Complete split' : 'Indexed preview'}:</strong>{' '}
        {collection.indexedRows.toLocaleString()} rows queryable of {(collection.sourceRows ?? collection.estimatedRows).toLocaleString()} in{' '}
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
  const [text, setText] = useState(query.q);
  const [debounced, setDebounced] = useState(query.q);
  const [hits, setHits] = useState<MoleculeHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const requestId = useRef(0);
  const groups = useMemo(
    () => query.groups.filter((id): id is FunctionalGroupId => Object.prototype.hasOwnProperty.call(FUNCTIONAL_GROUP_BY_ID, id)),
    [query.groups],
  );

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
      if (next !== query.q) update({ q: next, offset: 0 });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const filters = useMemo(
    () => ({
      text: debounced,
      elements: query.elements.length ? query.elements : undefined,
      functionalGroups: groups.length ? groups : undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debounced, query.elements.join(','), groups.join(',')],
  );

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    searchOmolValidationPage({ ...filters, limit: FACET_PAGE }, query.offset)
      .then((result) => {
        if (id !== requestId.current) return;
        setHits(result.hits);
        setTotal(result.total);
        trackLibrarySearch({ collection: 'omol25', source: 'neutral-validation-facets', hasQuery: filters.text.length > 0, elementCount: query.elements.length + groups.length, resultCount: result.total });
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setHits([]);
        setTotal(0);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, query.offset]);

  const elementChips = useMemo(() => (facets?.elementCounts ?? []).map((entry) => ({ symbol: entry.element, count: entry.count })), [facets]);

  const toggleElement = (symbol: string) =>
    update({
      elements: query.elements.includes(symbol) ? query.elements.filter((item) => item !== symbol) : [...query.elements, symbol],
      offset: 0,
    });
  const toggleGroup = (id: FunctionalGroupId) =>
    update({ groups: groups.includes(id) ? groups.filter((item) => item !== id) : [...groups, id], offset: 0 });

  const open = async (hit: MoleculeHit) => {
    if (opening) return;
    const key = `${hit.source}:${hit.id}`;
    setOpening(key);
    setOpenError(null);
    try {
      await openLibraryHit(hit, handoff);
    } catch {
      setOpenError(OMOL_OPEN_FAILED_COPY);
    } finally {
      setOpening(null);
    }
  };

  /** Open one uniformly chosen structure among everything this filter matches. */
  const randomInFilter = async () => {
    if (opening || total <= 0) return;
    setOpening('random');
    setOpenError(null);
    try {
      const { uniformRandomInt } = await import('../molecules/randomOmol');
      const { hits: [hit] } = await searchOmolValidationPage({ ...filters, limit: 1 }, uniformRandomInt(total));
      if (!hit) throw new Error('no match');
      await openLibraryHit(hit, handoff);
    } catch {
      setOpenError(OMOL_OPEN_FAILED_COPY);
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
  const pageEnd = query.offset + hits.length;
  const noun = total === 1 ? 'structure' : 'structures';
  const canPrevious = query.offset > 0;
  const canNext = query.offset + FACET_PAGE < total;

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
          <h3 id="omol-space">Elements</h3>
          <p>
            Tap elements to filter (AND).{' '}
            {query.elements.length > 0 && (
              <button type="button" className="library-clear" onClick={() => update({ elements: [], offset: 0 })}>
                Clear {query.elements.length}
              </button>
            )}
          </p>
        </div>
        <ElementChips counts={elementChips} selected={query.elements} onToggle={toggleElement} quick={16} ariaLabel="Elements in this slice" />
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
      <div className="library-inline">
        <label className="student-search library-search">
          <span>Filter by formula or element</span>
          <input type="search" value={text} onChange={(event) => setText(event.target.value)} placeholder="C6H6" autoComplete="off" spellCheck={false} />
        </label>
        <button type="button" className="student-secondary" onClick={() => void randomInFilter()} disabled={loading || opening !== null || total <= 0}>
          {opening === 'random' ? 'Opening…' : 'Random in this filter'}
        </button>
      </div>
      <p className="student-result-count" role="status">
        {loading
          ? 'Searching…'
          : total > 0
            ? `${(query.offset + 1).toLocaleString()}–${pageEnd.toLocaleString()} of ${total.toLocaleString()} ${noun}${filterLabel ? ` ${filterLabel}` : ''}`
            : `0 structures${filterLabel ? ` ${filterLabel}` : ''}`}
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
      {total > FACET_PAGE && (
        <div className="library-pager">
          <button type="button" className="student-secondary" disabled={!canPrevious || loading} onClick={() => update({ offset: Math.max(0, query.offset - FACET_PAGE) })}>
            Previous
          </button>
          <span>
            {(query.offset + 1).toLocaleString()}–{pageEnd.toLocaleString()} of {total.toLocaleString()}
          </span>
          <button type="button" className="student-secondary" disabled={!canNext || loading} onClick={() => update({ offset: query.offset + FACET_PAGE })}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
