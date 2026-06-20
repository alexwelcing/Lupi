import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EquilibriumSolveWorkbench } from '../EquilibriumSolveWorkbench';
import { Gallery } from '../Gallery';
import { BG_PRESETS, getBgPoster, type BgPresetWithId } from '../backgroundPresets';
import { MoleculeBrowser } from '../molecules/MoleculeBrowser';
import { OmolCollection } from '../molecules/OmolCollection';
import { PotentialBrowser } from '../panels/PotentialBrowser';
import { useStore } from '../store';
import { WorldHomeBackground } from './WorldHomeBackground';

export function GallerySection() {
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<'simulations' | 'omol25' | 'browse' | 'potentials' | 'equilibrium'>('simulations');
  const sectionRef = useRef<HTMLDivElement>(null);
  const backgroundPreset = useStore((state) => state.backgroundPreset);

  const activePreset = useMemo<BgPresetWithId>(() => {
    const preset = BG_PRESETS[backgroundPreset];
    if (preset) return { id: backgroundPreset, ...preset };
    return { id: 'deep', ...BG_PRESETS.deep };
  }, [backgroundPreset]);

  useEffect(() => {
    // Allow deep-linking to research catalog tabs.
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    if (requestedTab === 'omol25' || requestedTab === 'browse' || requestedTab === 'potentials' || requestedTab === 'equilibrium') {
      setTab(requestedTab);
      params.delete('tab');
      const url = new URL(window.location.href);
      url.search = params.toString();
      window.history.replaceState({}, '', url);
    }
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
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
        transition: 'all 0.8s ease-out',
      }}
    >
      <style>{GALLERY_SECTION_CSS}</style>
      <div className="lupi-gallery-section__shade" aria-hidden="true" />
      <div className="lupi-gallery-section__shell">
        <div className="lupi-gallery-section__intro">
          <div>
            <p>Explore Lupi</p>
            <h2>Pick a structure, then open the same scene in the full viewer.</h2>
          </div>
          <a href="#dropzone">Load your data</a>
        </div>

        <WorldHomeBackground variant="gallery" />

        <div style={sTabBar} role="tablist" aria-label="Catalog">
          <button
            role="tab"
            aria-selected={tab === 'simulations'}
            data-testid="tab-simulations"
            style={sTab(tab === 'simulations', '#1edce0')}
            onClick={() => setTab('simulations')}
          >
            Structures
          </button>
          <button
            role="tab"
            aria-selected={tab === 'omol25'}
            data-testid="tab-omol25"
            style={sTab(tab === 'omol25', '#34d399')}
            onClick={() => setTab('omol25')}
          >
            Meta OMol25
          </button>
          <button
            role="tab"
            aria-selected={tab === 'browse'}
            data-testid="tab-browse"
            style={sTab(tab === 'browse', '#38bdf8')}
            onClick={() => setTab('browse')}
          >
            Browse All
          </button>
          <button
            role="tab"
            aria-selected={tab === 'potentials'}
            data-testid="tab-potentials"
            style={sTab(tab === 'potentials', '#c084fc')}
            onClick={() => setTab('potentials')}
          >
            NIST Potentials
          </button>
          <button
            role="tab"
            aria-selected={tab === 'equilibrium'}
            data-testid="tab-equilibrium"
            style={sTab(tab === 'equilibrium', '#10b981')}
            onClick={() => setTab('equilibrium')}
          >
            Equilibrium Solve
          </button>
        </div>

        <div className="lupi-gallery-section__panel">
          {tab === 'simulations' && <Gallery />}
          {tab === 'omol25' && <OmolCollection />}
          {tab === 'browse' && <MoleculeBrowser />}
          {tab === 'potentials' && <PotentialBrowser />}
          {tab === 'equilibrium' && <EquilibriumSolveWorkbench embedded />}
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
    radial-gradient(circle at 50% 16%, rgba(30, 220, 224, 0.10), transparent 31%),
    linear-gradient(180deg, rgba(2, 2, 4, 0.10), rgba(2, 2, 4, 0.46) 72%, #06080d);
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
  margin: 0 0 8px;
  color: #7dd3fc;
  font-size: 12px;
  font-weight: 820;
  letter-spacing: 0;
  text-transform: uppercase;
}
.lupi-gallery-section__intro h2 {
  max-width: 820px;
  margin: 0;
  color: #f8fafc;
  font-size: clamp(28px, 4.2vw, 48px);
  line-height: 1.02;
  font-weight: 820;
  letter-spacing: 0;
  text-wrap: balance;
}
.lupi-gallery-section__intro a {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgba(125, 211, 252, 0.28);
  background: rgba(2, 6, 23, 0.48);
  color: #dff7ff;
  font-size: 13px;
  font-weight: 780;
  letter-spacing: 0;
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
  borderRadius: 8,
  fontSize: 14,
  fontWeight: active ? 600 : 500,
  color: active ? '#f8fafc' : 'rgba(255,255,255,0.45)',
  background: active ? `${color}15` : 'transparent',
  border: active ? `1.5px dashed ${color}` : '1.5px dashed rgba(255,255,255,0.1)',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
});
