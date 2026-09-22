import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { SiteHeader } from '../landing/SiteHeader';
import { LandingFooter } from '../landing/LandingFooter';
import { track, ANALYTICS_EVENTS, ensureAnalyticsSession } from '../analytics';
import { ScanPage } from './ScanPage';
import '../landing/student-home.css';

/**
 * Scan shell: no renderer on first paint. Like the landing and library
 * shells it hands off to the viewer chunk the moment a structure lands in
 * the store, which is what opening a molecule card does.
 */
export function ScanShell({ onEnterViewer }: { onEnterViewer: () => void }) {
  const handedOff = useRef(false);
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
      (state) => state.file,
      (file) => {
        if (file) enter();
      },
    );
  }, [onEnterViewer]);
  return (
    <div className="student-home">
      <a className="student-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader current="scan" />
      <ScanPage />
      <LandingFooter />
    </div>
  );
}

export default ScanShell;
