import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { SiteHeader } from '../landing/SiteHeader';
import { LandingFooter } from '../landing/LandingFooter';
import { track, ANALYTICS_EVENTS, ensureAnalyticsSession } from '../analytics';
import { LIBRARY_SEO, useSeo } from '../seo';
import type { LibraryCollectionId } from '../viewer/viewerRoutes';
import { LibraryHandoffContext, type LibraryHandoff } from './openHit';
import { LibraryPage } from './LibraryPage';
import '../landing/student-home.css';

/**
 * Library shell: no renderer on first paint. Like the landing shell, it hands
 * off to the viewer chunk the moment a structure is in the store, and it
 * lets a hit that needs the viewer's resolver request the handoff early.
 */
export function LibraryShell({
  collection,
  onEnterViewer,
}: {
  collection: LibraryCollectionId;
  onEnterViewer: () => void;
}) {
  useSeo(LIBRARY_SEO[collection]);
  const handedOff = useRef(false);
  const handoff = useMemo<LibraryHandoff>(
    () => ({
      enterViewer: () => {
        if (handedOff.current) return;
        handedOff.current = true;
        onEnterViewer();
      },
    }),
    [onEnterViewer],
  );

  useEffect(() => {
    ensureAnalyticsSession();
    track(ANALYTICS_EVENTS.APP_LANDED);
  }, []);

  useEffect(() => {
    if (useStore.getState().file) {
      handoff.enterViewer();
      return;
    }
    return useStore.subscribe(
      (state) => state.file,
      (file) => {
        if (file) handoff.enterViewer();
      },
    );
  }, [handoff]);

  return (
    <LibraryHandoffContext.Provider value={handoff}>
      <div className="student-home">
        <a className="student-skip" href="#main">
          Skip to content
        </a>
        <SiteHeader current="library" />
        <LibraryPage collection={collection} />
        <LandingFooter />
      </div>
    </LibraryHandoffContext.Provider>
  );
}

export default LibraryShell;
