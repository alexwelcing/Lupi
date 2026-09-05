import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { LandingPage } from './LandingPage';
import { LupiAgentDock } from './LupiAgentDock';
import { track, ANALYTICS_EVENTS, ensureAnalyticsSession } from './analytics';
import './landing/student-home.css';

/** No renderer, research workbench, configurator, or animated canvas on first visit. */
export function LandingShell({ onEnterViewer }: { onEnterViewer: () => void }) {
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
      state => state.file,
      file => {
        if (file) enter();
      },
    );
  }, [onEnterViewer]);
  return (
    <div className="student-home">
      <a className="student-skip" href="#main">
        Skip to content
      </a>
      <header className="student-header student-width">
        <a className="student-wordmark" href="/" aria-label="Lupi home">
          Lupi<span>See what things are made of.</span>
        </a>
        <nav aria-label="Primary">
          <a href="#gallery">Explore</a>
          <a href="#learn">How to use</a>
          <a href="#dropzone">Open a file</a>
        </nav>
        <LupiAgentDock />
      </header>
      <LandingPage />
    </div>
  );
}
export default LandingShell;
