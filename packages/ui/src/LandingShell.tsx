import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { LandingPage } from './LandingPage';
import { MoleculeConfigurator } from './molecules/MoleculeConfigurator';
import { LupiAgentDock } from './LupiAgentDock';
import { LupiAuthCallout } from './LupiAuthCallout';
import { openRandomOmol25Molecule } from './molecules/randomOmol';
import { track, ANALYTICS_EVENTS, ensureAnalyticsSession } from './analytics';

/**
 * LandingShell — the lightweight marketing entry.
 *
 * `main.tsx` mounts this instead of the full App for plain landing visits, so
 * the three.js / R3F / drei / postprocessing viewer stack (~1 MB gzip) never
 * touches the marketing critical path. The whole landing closure (hero,
 * gallery, dropzone, footer, store, molecule loaders) is import-graph verified
 * to be three-free.
 *
 * The instant the visitor expresses molecule intent — clicking a gallery card,
 * "Open the 1M-atom scene", dropping a file, "View a molecule", or building a
 * scene — `store.file` is set and we hand off to the real viewer (App), which
 * is dynamically imported on demand. The store is a shared singleton, so the
 * molecule that's already loading/loaded survives the swap.
 */
export function LandingShell({ onEnterViewer }: { onEnterViewer: () => void }) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  const handedOff = useRef(false);

  // Top-of-funnel analytics, mirroring what App fires on mount so landing
  // sessions are still minted and app_landed still emits once.
  useEffect(() => {
    ensureAnalyticsSession();
    track(ANALYTICS_EVENTS.APP_LANDED);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Hand off to the full viewer the moment a molecule lands in the store.
  // openMolecule / loadMoleculeSource / dropzone all set `file` synchronously
  // in memory before App mounts, so the viewer renders the loaded scene with
  // no re-fetch and no double-load (App's auto-loaders are `!file`-guarded).
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
      (s) => s.file,
      (file) => {
        if (file) enter();
      },
    );
  }, [onEnterViewer]);

  return (
    <div style={{ width: '100%', minHeight: '100vh', background: '#020204', display: 'flex', flexDirection: 'column' }}>
      {/* Landing header — kept in the Melancholia register: transparent over the
          twilight sky, a serif wordmark, gold-outlined actions. No filled blue. */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 14px' : '0 clamp(20px, 4vw, 40px)',
          background: 'transparent',
          zIndex: 200,
        }}
      >
        <a
          href="/"
          aria-label="Lupi home"
          style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, textDecoration: 'none', flexShrink: 0 }}
        >
          <span style={{
            fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
            fontSize: isMobile ? 22 : 25, fontWeight: 400, color: '#eef2f8', letterSpacing: '0.01em',
          }}>
            Lupi
          </span>
          {!isMobile && (
            <span style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase',
              color: 'rgba(216,184,120,0.72)',
            }}>
              archive of matter
            </span>
          )}
        </a>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: isMobile ? 8 : 14, minWidth: 0 }}>
          <a
            href="#gallery"
            onClick={(e) => {
              const el = document.getElementById('gallery');
              if (el) {
                e.preventDefault();
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: isMobile ? 11 : 12, letterSpacing: '0.06em',
              color: 'rgba(205,214,228,0.72)', textDecoration: 'none',
              padding: '8px 4px',
            }}
          >
            The index
          </a>
          <button
            type="button"
            onClick={() => void openRandomOmol25Molecule()}
            style={{
              fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
              fontSize: isMobile ? 11 : 12, letterSpacing: '0.04em', cursor: 'pointer',
              padding: isMobile ? '8px 12px' : '9px 16px', borderRadius: 2,
              color: '#f2ead8', background: 'rgba(216,184,120,0.06)',
              border: '1px solid rgba(216,184,120,0.4)',
            }}
          >
            {isMobile ? 'At random' : 'A body at random'}
          </button>
          <LupiAgentDock compact={isMobile} />
        </div>
      </header>

      <LupiAuthCallout compact={isMobile} />
      {/* Modal host for the hero "Build a scene" flow; renders null until opened. */}
      <MoleculeConfigurator />

      <div style={{ flex: 1, minHeight: 0 }}>
        <LandingPage />
      </div>
    </div>
  );
}

export default LandingShell;
