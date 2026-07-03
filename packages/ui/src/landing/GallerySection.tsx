import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EquilibriumSolveWorkbench } from '../EquilibriumSolveWorkbench';
import { Gallery } from '../Gallery';
import { BG_PRESETS, getBgPoster, type BgPresetWithId } from '../backgroundPresets';
import { MoleculeBrowser } from '../molecules/MoleculeBrowser';
import { type MoleculeSourceId } from '../molecules';
import { PotentialBrowser } from '../panels/PotentialBrowser';
import { useStore } from '../store';

// One browse surface, two doors: "Explore" is the curated showcase (the
// pedagogically rich Gallery), "Search" is the federated faceted search over
// every source (curated, OMol25, NIST, PubChem, your saved/uploaded views).
// The old standalone OMol25 tab is gone — it's now a source facet inside
// Search. NIST Potentials and Equilibrium Solve are power-user tools, demoted
// out of the primary tab bar into a secondary Tools row so they stop competing
// with a first-time visitor's path to a render.
type GalleryView = 'explore' | 'search' | 'potentials' | 'equilibrium';

export function GallerySection() {
  // Start visible immediately so the catalog does not flash or paint hidden
  // while the IntersectionObserver fires.
  const [visible] = useState(true);
  const [view, setView] = useState<GalleryView>('explore');
  // When a deep link lands on Search, preselect the source facet it asked for
  // (e.g. ?tab=omol25 opens Search filtered to Meta OMol25).
  const [searchSource, setSearchSource] = useState<MoleculeSourceId | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const backgroundPreset = useStore((state) => state.backgroundPreset);

  const activePreset = useMemo<BgPresetWithId>(() => {
    const preset = BG_PRESETS[backgroundPreset];
    if (preset) return { id: backgroundPreset, ...preset };
    return { id: 'deep', ...BG_PRESETS.deep };
  }, [backgroundPreset]);

  useEffect(() => {
    // Allow deep-linking to catalog views. Legacy ?tab values are mapped onto
    // the consolidated structure so existing links keep working.
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    const mapping: Record<string, GalleryView> = {
      simulations: 'explore',
      omol25: 'search',
      browse: 'search',
      potentials: 'potentials',
      equilibrium: 'equilibrium',
    };
    if (requestedTab && mapping[requestedTab]) {
      setView(mapping[requestedTab]);
      if (requestedTab === 'omol25') setSearchSource('omol');
      params.delete('tab');
      const url = new URL(window.location.href);
      url.search = params.toString();
      window.history.replaceState({}, '', url);
    }
  }, []);

  return (
    <section
      id="gallery"
      ref={sectionRef}
      style={{
        ...gallerySectionBackground(activePreset),
        position: 'relative',
        overflow: 'hidden',
        padding: 'clamp(30px, 4.5vw, 58px) 0 clamp(48px, 8vw, 100px)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'opacity 0.8s ease-out, transform 0.8s ease-out',
        willChange: 'opacity, transform',
      }}
    >
      <style>{GALLERY_SECTION_CSS}</style>
      <div className="lupi-gallery-section__shade" aria-hidden="true" />
      <div className="lupi-gallery-section__shell">
        <div className="lupi-gallery-section__intro">
          <div>
            <p>The complete index</p>
            <h2>Every body in the archive. Search, or narrow to a field of matter.</h2>
          </div>
          <a href="#dropzone">Bring your own matter</a>
        </div>

        <div style={sTabBar} role="tablist" aria-label="Browse molecules">
          <button
            role="tab"
            aria-selected={view === 'explore'}
            data-testid="tab-explore"
            style={sTab(view === 'explore', '#d8b878')}
            onClick={() => setView('explore')}
          >
            Explore
          </button>
          <button
            role="tab"
            aria-selected={view === 'search'}
            data-testid="tab-search"
            style={sTab(view === 'search', '#8fb0d4')}
            onClick={() => setView('search')}
          >
            Search all molecules
          </button>
        </div>

        <div style={sToolsRow} aria-label="Advanced tools">
          <span style={sToolsLabel}>Tools</span>
          <button
            data-testid="tool-potentials"
            style={sToolBtn(view === 'potentials')}
            onClick={() => setView('potentials')}
          >
            NIST Potentials
          </button>
          <button
            data-testid="tool-equilibrium"
            style={sToolBtn(view === 'equilibrium')}
            onClick={() => setView('equilibrium')}
          >
            Equilibrium Solve
          </button>
        </div>

        <div className="lupi-gallery-section__panel">
          {view === 'explore' && <Gallery />}
          {view === 'search' && <MoleculeBrowser initialSource={searchSource} />}
          {view === 'potentials' && <PotentialBrowser />}
          {view === 'equilibrium' && <EquilibriumSolveWorkbench embedded />}
        </div>
      </div>
    </section>
  );
}

function gallerySectionBackground(preset: BgPresetWithId): CSSProperties {
  const poster = getBgPoster(preset);
  const readableTop = 'rgba(2, 2, 4, 0.70)';
  const readableMid = 'rgba(2, 2, 4, 0.90)';
  const readableBottom = 'rgba(6, 8, 13, 0.97)';

  if (poster) {
    return {
      backgroundColor: preset.bottom,
      backgroundImage: `linear-gradient(180deg, ${readableTop}, ${readableMid} 38%, ${readableBottom}), url("${poster}")`,
      backgroundPosition: 'center',
      backgroundSize: 'cover',
    };
  }

  return {
    backgroundColor: preset.bottom,
    backgroundImage:
      `radial-gradient(circle at 16% 0%, ${preset.top}aa, transparent 36%), ` +
      `radial-gradient(circle at 84% 14%, ${preset.bottom}66, transparent 34%), ` +
      `linear-gradient(180deg, ${preset.top}, ${preset.bottom})`,
  };
}

const GALLERY_SECTION_CSS = `
.lupi-gallery-section__shade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 12%, rgba(216, 184, 120, 0.07), transparent 34%),
    linear-gradient(180deg, rgba(4, 6, 11, 0.20), rgba(4, 6, 11, 0.5) 72%, #05060b);
}
.lupi-gallery-section__shell {
  position: relative;
  z-index: 1;
  width: min(1480px, 100%);
  box-sizing: border-box;
  margin: 0 auto;
  padding: 0 clamp(12px, 2vw, 28px);
}
.lupi-gallery-section__intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 20px;
  align-items: end;
  margin: 0 auto 18px;
  color: #f8fafc;
}
.lupi-gallery-section__intro p {
  margin: 0 0 10px;
  color: rgba(216, 184, 120, 0.82);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}
.lupi-gallery-section__intro h2 {
  max-width: 820px;
  margin: 0;
  color: #eef2f8;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  font-size: clamp(26px, 4vw, 44px);
  line-height: 1.06;
  font-weight: 400;
  letter-spacing: -0.01em;
  text-wrap: balance;
}
.lupi-gallery-section__intro a {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgba(216, 184, 120, 0.34);
  background: rgba(216, 184, 120, 0.05);
  color: #f2ead8;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-decoration: none;
  backdrop-filter: blur(12px);
}
.lupi-gallery-section__panel {
  min-width: 0;
}
@media (max-width: 760px) {
  .lupi-gallery-section__shell {
    padding-inline: 10px;
  }
  .lupi-gallery-section__intro {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 12px;
  }
  .lupi-gallery-section__intro h2 {
    font-size: 30px;
  }
  .lupi-gallery-section__intro a {
    width: max-content;
  }
}
`;

const sTabBar: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 8,
  margin: '18px 0 22px',
  padding: 0,
};

const sTab = (active: boolean, color: string): CSSProperties => ({
  padding: '8px 20px',
  borderRadius: 2,
  fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
  fontSize: 13,
  letterSpacing: '0.03em',
  fontWeight: active ? 600 : 500,
  color: active ? '#f2f5fa' : 'rgba(205,214,228,0.5)',
  background: active ? `${color}14` : 'transparent',
  border: active ? `1px solid ${color}` : '1px solid rgba(200,214,236,0.12)',
  cursor: 'pointer',
  transition: 'all 0.3s ease',
});

// Secondary "Tools" row — deliberately quieter than the primary tab bar so the
// power-user surfaces (potentials, equilibrium solve) stay reachable without
// competing with Explore/Search for a first-time visitor's attention.
const sToolsRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 8,
  margin: '-8px 0 24px',
};

const sToolsLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.32)',
};

const sToolBtn = (active: boolean): CSSProperties => ({
  padding: '5px 12px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: active ? 650 : 550,
  color: active ? '#f8fafc' : 'rgba(255,255,255,0.5)',
  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
  border: `1px solid ${active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)'}`,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
});
