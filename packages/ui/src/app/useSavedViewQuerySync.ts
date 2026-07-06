import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from '../store';
import { loadSavedMolecularView } from '../savedViews';

export function useSavedViewQuerySync(savedViewSlug: string | null) {
  const processedSlugRef = useRef<string | null>(null);
  const setLoading = useStore(s => s.setLoading);
  const setError = useStore(s => s.setError);

  return useQuery({
    queryKey: ['savedView', savedViewSlug],
    queryFn: async () => {
      if (savedViewSlug !== processedSlugRef.current) {
        setLoading(true, 0);
      }
      try {
        const data = await loadSavedMolecularView(savedViewSlug!);
        document.title = `${data.title} - Lupi`;
        setLoading(false);
        processedSlugRef.current = savedViewSlug;
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLoading(false);
        setError(message);
        processedSlugRef.current = savedViewSlug;
        throw err;
      }
    },
    enabled: !!savedViewSlug,
    staleTime: 1000 * 60 * 10,
  });
}
