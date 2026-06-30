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
      <header
        style={{
          height: 56,
          minHeight: 56,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 10px' : '0 16px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          zIndex: 200,
        }}
      >
        <a
          href="/"
          aria-label="Lupi home"
          style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', flexShrink: 0 }}
        >
          <span style={{ fontSize: isMobile ? 19 : 21, fontWeight: 750, color: 'var(--text-primary)', letterSpacing: 0 }}>
            Lupi
          </span>
        </a>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: isMobile ? 6 : 10, minWidth: 0 }}>
          <a
            href="#gallery"
            onClick={(e) => {
              const el = document.getElementById('gallery');
              if (el) {
                e.preventDefault();
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            className="lupine-btn"
            style={{ padding: isMobile ? '7px 9px' : '8px 12px', fontSize: isMobile ? 12 : 13 }}
          >
            Gallery
          </a>
          <button
            type="button"
            onClick={() => void openRandomOmol25Molecule()}
            className="lupine-btn primary"
            style={{ padding: isMobile ? '7px 10px' : '8px 14px', fontSize: isMobile ? 12 : 14 }}
          >
            {isMobile ? 'View' : 'View a molecule'}
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
