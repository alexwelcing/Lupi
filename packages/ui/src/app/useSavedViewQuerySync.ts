import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from '../store';
import { loadSavedMolecularView } from '../savedViews';
import {
  beginViewerLoad,
} from '../viewer/loadGuard';

export function useSavedViewQuerySync(savedViewSlug: string | null) {
  const setLoading = useStore(s => s.setLoading);
  const setError = useStore(s => s.setError);

  useEffect(() => {
    if (!savedViewSlug) setError(null);
  }, [savedViewSlug, setError]);

  return useQuery({
    queryKey: ['savedView', savedViewSlug],
    queryFn: async () => {
      const isCurrent = beginViewerLoad();
      // Each attempt, including refetch, gets a clean visible loading state.
      // setError clears loading, so this ordering is intentional.
      setError(null);
      setLoading(true, 0);
      try {
        const data = await loadSavedMolecularView(savedViewSlug!, { isCurrent });
        if (!isCurrent()) throw new Error('Saved-view load was superseded by newer navigation.');
        document.title = `${data.title} - Lupi`;
        setLoading(false);
        return data;
      } catch (err) {
        if (!isCurrent()) throw err;
        setLoading(false);
        setError(safeSavedViewStoreMessage(err, savedViewSlug!));
        throw err;
      }
    },
    enabled: !!savedViewSlug,
    // Loading a saved view restores molecule + viewer state, so a cached data
    // object alone is insufficient when the user leaves and revisits a slug.
    // Keep route entry fetchable while avoiding focus-driven scene resets.
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

function safeSavedViewStoreMessage(error: unknown, slug: string): string {
  const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
    || 'requested-view';
  if (typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'permission-denied') {
    return 'Lupi was not permitted to read this saved view.';
  }
  if (error instanceof Error && /^No Lupi view found for "[^"]+"\.$/.test(error.message)) {
    return `No Lupi view found for "${safeSlug}".`;
  }
  return 'This saved Lupi view could not be loaded.';
}
