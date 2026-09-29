import { useEffect, useMemo, useRef } from 'react';
import { useStore } from './store';
import { LandingPage } from './LandingPage';
import { SiteHeader } from './landing/SiteHeader';
import { track, ANALYTICS_EVENTS, ensureAnalyticsSession } from './analytics';
import { LandingIntentContext } from './landing/landingIntent';
import './landing/student-home.css';

/** No renderer, research workbench, configurator, or animated canvas on first visit. */
export function LandingShell({
  onEnterViewer,
  onPrefetchViewer,
}: {
  onEnterViewer: () => void;
  /** Warm the viewer chunks once a visitor shows intent (the hero's first spin). */
  onPrefetchViewer?: () => void;
}) {
  const handedOff = useRef(false);
  const landingIntent = useMemo(
    () => ({ prefetchViewer: () => onPrefetchViewer?.() }),
    [onPrefetchViewer],
  );
  useEffect(() => {
    ensureAnalyticsSession();
    track(ANALYTICS_EVENTS.APP_LANDED);
  }, []);
  useEffect(() => {
    const enter = () => {
      if (handedOff.current) return;
      handedOff.current = true;
      onEnterViewer();
    };
    if (useStore.getState().file) {
      enter();
      return;
    }
    return useStore.subscribe(
      state => state.file,
      file => {
        if (file) enter();
      },
    );
  }, [onEnterViewer]);
  return (
    <LandingIntentContext.Provider value={landingIntent}>
      <div className="student-home">
        <a className="student-skip" href="#main">
          Skip to content
        </a>
        <SiteHeader current="home" />
        <LandingPage />
      </div>
    </LandingIntentContext.Provider>
  );
}
export default LandingShell;
