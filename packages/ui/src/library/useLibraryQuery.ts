import { useCallback, useSyncExternalStore } from 'react';

/**
 * URL-backed state for the Library. Every filter lives in the query string so
 * Back, refresh, and shared links reproduce the same view. Writes use
 * `history.replaceState` (typing should not spam the history stack) and fan
 * out to every subscribed component through a tiny in-memory notifier.
 */
export interface LibraryQuery {
  /** Free-text search; empty string browses. */
  q: string;
  /** Federated source id, or null for every source. */
  source: string | null;
  /** Required element symbols (AND). */
  elements: string[];
  /** OMol25 collection id. */
  collection: string | null;
  /** Page offset for paged collections. */
  offset: number;
  /** Collection-specific sub view, e.g. `remote` or `facets`. */
  view: string | null;
}

export const EMPTY_LIBRARY_QUERY: LibraryQuery = {
  q: '',
  source: null,
  elements: [],
  collection: null,
  offset: 0,
  view: null,
};

export function parseLibraryQuery(search: string): LibraryQuery {
  const params = new URLSearchParams(search);
  const offset = Number.parseInt(params.get('offset') ?? '0', 10);
  return {
    q: (params.get('q') ?? '').trim(),
    source: params.get('source') || null,
    elements: (params.get('elements') ?? '')
      .split(',')
      .map((symbol) => symbol.trim())
      .filter(Boolean),
    collection: params.get('collection') || null,
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    view: params.get('view') || null,
  };
}

/** Serialize to a query string without a leading `?`; empty values are dropped. */
export function serializeLibraryQuery(query: LibraryQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.source) params.set('source', query.source);
  if (query.elements.length) params.set('elements', query.elements.join(','));
  if (query.collection) params.set('collection', query.collection);
  if (query.offset > 0) params.set('offset', String(query.offset));
  if (query.view) params.set('view', query.view);
  return params.toString();
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function snapshot(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function serverSnapshot(): string {
  return '';
}

/** Replace the query string and notify every subscriber. */
export function writeLibraryQuery(query: LibraryQuery): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.search = serializeLibraryQuery(query);
  window.history.replaceState(window.history.state, '', url);
  listeners.forEach((listener) => listener());
}

export function useLibraryQuery(): [LibraryQuery, (patch: Partial<LibraryQuery>) => void] {
  const search = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const query = parseLibraryQuery(search);
  const update = useCallback((patch: Partial<LibraryQuery>) => {
    writeLibraryQuery({ ...parseLibraryQuery(snapshot()), ...patch });
  }, []);
  return [query, update];
}
