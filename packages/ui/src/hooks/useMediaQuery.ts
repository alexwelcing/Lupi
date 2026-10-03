import { useEffect, useState } from 'react';

/**
 * The viewer's single phone/landscape-phone breakpoint. Every surface that
 * switches between a desktop popover and a mobile sheet reads this constant so
 * the header, command deck and menus flip together.
 */
export const MOBILE_MEDIA_QUERY = '(max-width: 640px), (max-height: 500px) and (max-width: 900px)';

/** The query's answer right now; false where there is no matchMedia (jsdom, some webviews). */
export function matchesMediaQuery(query: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function useMediaQuery(query: string): boolean {
  // Answer on the first render, so a phone never paints one desktop frame
  // (a sheet that mounts with a panel would otherwise jump into place).
  const [matches, setMatches] = useState(() => matchesMediaQuery(query));
  useEffect(() => {
    // jsdom and some embedded webviews have no matchMedia; treat as "no match".
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    if (media.matches !== matches) setMatches(media.matches);
    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [matches, query]);
  return matches;
}
