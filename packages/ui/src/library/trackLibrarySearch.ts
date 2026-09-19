import { ANALYTICS_EVENTS, track } from '../analytics';

/**
 * One aggregate event per settled result set. Query text never leaves the
 * browser; only the shape of the search does.
 */
export function trackLibrarySearch(props: {
  collection: string;
  source?: string | null;
  hasQuery: boolean;
  elementCount: number;
  resultCount: number;
}): void {
  track(ANALYTICS_EVENTS.LIBRARY_SEARCHED, {
    collection: props.collection,
    source: props.source ?? 'all',
    hasQuery: props.hasQuery,
    elementCount: props.elementCount,
    resultCount: props.resultCount,
  });
}
