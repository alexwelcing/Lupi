import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { EquilibriumSolveWorkbench } from '../EquilibriumSolveWorkbench';
import { Gallery } from '../Gallery';
import { MoleculeBrowser } from '../molecules/MoleculeBrowser';
import { OmolCollection } from '../molecules/OmolCollection';
import { PotentialBrowser } from '../panels/PotentialBrowser';
import { ALL_EXAMPLES, type GalleryExample } from './shared';
import { openGalleryExampleById } from '../galleryExampleLoader';

type CatalogTab = 'simulations' | 'omol25' | 'browse' | 'potentials' | 'equilibrium';

type SimpleScene = {
  id: string;
  kicker: string;
  title: string;
  line: string;
  colors: [string, string, string];
};

type SceneButtonStyle = CSSProperties & {
  '--scene-a': string;
  '--scene-b': string;
  '--scene-c': string;
};

const SIMPLE_SCENES: SimpleScene[] = [
  {
    id: 'elliott_gst_crystallization',
    kicker: 'Atoms interact',
    title: 'Phase-change atoms',
    line: 'Watch a material change phase and keep control of every frame.',
    colors: ['#5eead4', '#38bdf8', '#0f172a'],
  },
  {
    id: 'c60_buckyball',
    kicker: 'Spin the structure',
    title: 'Carbon cage',
    line: 'A beautiful carbon cage that makes 3D shape obvious fast.',
    colors: ['#f8fafc', '#94a3b8', '#1f2937'],
  },
  {
    id: 'graphene_ribbon',
    kicker: 'See the lattice',
    title: 'Graphene ribbon',
    line: 'A clean sheet of atoms for desktop, mobile, and classroom screens.',
    colors: ['#34d399', '#38bdf8', '#111827'],
  },
  {
    id: 'cuzr_melt',
    kicker: 'Feel the motion',
    title: 'Metallic melt',
    line: 'A metallic melt that turns atom interaction into something visible.',
    colors: ['#f59e0b', '#fb7185', '#111827'],
  },
  {
    id: 'aspirin',
    kicker: 'Learn molecules',
    title: 'Aspirin',
    line: 'Organic chemistry becomes touchable instead of trapped on paper.',
    colors: ['#c084fc', '#60a5fa', '#111827'],
  },
  {
    id: 'massive_1m',
    kicker: 'Scale up',
    title: 'Million-atom scale',
    line: 'A nearly million-atom scene that still opens as one simple view.',
    colors: ['#fbbf24', '#fb7185', '#111827'],
  },
];

export function GallerySection() {
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<CatalogTab>('simulations');
  const [showLibrary, setShowLibrary] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    if (isCatalogTab(requestedTab)) {
      setTab(requestedTab);
      setShowLibrary(true);
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

  const scenes = useMemo(
    () => SIMPLE_SCENES.map((scene) => ({
      ...scene,
      example: ALL_EXAMPLES.find((example) => example.id === scene.id),
    })),
    [],
  );

  const openScene = (id: string) => {
    void openGalleryExampleById(id);
  };

  return (
    <section
      id="gallery"
      ref={sectionRef}
      className="lupi-simple-gallery"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
      }}
    >
      <style>{GALLERY_SECTION_CSS}</style>
      <div className="lupi-simple-gallery-shell">
        <div className="lupi-simple-gallery-head">
          <p>Lupi gallery</p>
          <h2>Pick a molecule. Watch atoms interact.</h2>
          <span>
            Big, pretty molecular buttons open clean 3D worlds for phones,
            desktops, and AR/VR.
          </span>
        </div>

        <div className="lupi-simple-gallery-grid" aria-label="Featured molecule scenes">
          {scenes.map((scene) => (
            <SimpleSceneButton
              key={scene.id}
              scene={scene}
              example={scene.example}
              onOpen={() => openScene(scene.id)}
            />
          ))}
        </div>

        <div className="lupi-simple-gallery-actions">
          <button type="button" onClick={() => setShowLibrary((value) => !value)}>
            {showLibrary ? 'Hide full library' : 'Browse full library'}
          </button>
        </div>
      </div>

      {showLibrary && (
        <div className="lupi-simple-library" data-testid="gallery-full-library">
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

          {tab === 'simulations' && <Gallery />}
          {tab === 'omol25' && <OmolCollection />}
          {tab === 'browse' && <MoleculeBrowser />}
          {tab === 'potentials' && <PotentialBrowser />}
          {tab === 'equilibrium' && <EquilibriumSolveWorkbench embedded />}
        </div>
      )}
    </section>
  );
}

function SimpleSceneButton({
  scene,
  example,
  onOpen,
}: {
  scene: SimpleScene;
  example?: GalleryExample;
  onOpen: () => void;
}) {
  const colors = example?.colors ?? scene.colors;
  return (
    <button
      type="button"
      className="lupi-simple-scene"
      onClick={onOpen}
      style={{
        '--scene-a': colors[0],
        '--scene-b': colors[1],
        '--scene-c': colors[2],
      } as SceneButtonStyle}
      data-testid={`simple-scene-${scene.id}`}
    >
      <span className="lupi-simple-scene-art" aria-hidden="true">
        <i />
        <i />
        <i />
        <b />
      </span>
      <span className="lupi-simple-scene-copy">
        <em>{scene.kicker}</em>
        <strong>{scene.title}</strong>
        <span>{scene.line}</span>
      </span>
    </button>
  );
}

function isCatalogTab(value: string | null): value is CatalogTab {
  return value === 'simulations' || value === 'omol25' || value === 'browse' || value === 'potentials' || value === 'equilibrium';
}

const sTabBar: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 32,
  padding: '0 24px',
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

const GALLERY_SECTION_CSS = `
.lupi-simple-gallery {
  position: relative;
  padding: 72px 20px 92px;
  background: linear-gradient(180deg, rgba(6,8,13,0.58), rgba(2,4,8,0.72));
  transition: opacity 0.7s ease, transform 0.7s ease;
}
.lupi-simple-gallery-shell {
  width: min(1180px, 100%);
  margin: 0 auto;
}
.lupi-simple-gallery-head {
  display: grid;
  gap: 10px;
  max-width: 760px;
  margin: 0 auto 28px;
  text-align: center;
}
.lupi-simple-gallery-head p {
  margin: 0;
  color: #7dd3fc;
  font-size: 13px;
  font-weight: 820;
  line-height: 1;
  letter-spacing: 0;
}
.lupi-simple-gallery-head h2 {
  margin: 0;
  color: #f8fafc;
  font-size: 42px;
  line-height: 1.05;
  font-weight: 840;
  letter-spacing: 0;
  text-wrap: balance;
}
.lupi-simple-gallery-head span {
  display: block;
  max-width: 620px;
  margin: 0 auto;
  color: rgba(226, 232, 240, 0.7);
  font-size: 17px;
  line-height: 1.55;
  letter-spacing: 0;
}
.lupi-simple-gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.lupi-simple-scene {
  min-width: 0;
  min-height: 218px;
  display: grid;
  grid-template-rows: minmax(112px, 1fr) auto;
  gap: 12px;
  padding: 14px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background:
    radial-gradient(circle at 24% 18%, color-mix(in srgb, var(--scene-a) 28%, transparent), transparent 36%),
    radial-gradient(circle at 82% 68%, color-mix(in srgb, var(--scene-b) 22%, transparent), transparent 42%),
    linear-gradient(145deg, rgba(15, 23, 42, 0.76), rgba(2, 6, 23, 0.62));
  color: #f8fafc;
  box-shadow: 0 16px 42px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08);
  text-align: left;
  cursor: pointer;
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}
.lupi-simple-scene:hover,
.lupi-simple-scene:focus-visible {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--scene-a) 62%, rgba(255,255,255,0.18));
  box-shadow: 0 22px 54px rgba(0,0,0,0.32), 0 0 0 1px color-mix(in srgb, var(--scene-a) 22%, transparent);
  outline: none;
}
.lupi-simple-scene-art {
  position: relative;
  min-height: 112px;
  display: block;
}
.lupi-simple-scene-art::before,
.lupi-simple-scene-art::after {
  content: "";
  position: absolute;
  inset: 15% 10%;
  border: 1px solid color-mix(in srgb, var(--scene-a) 42%, rgba(255,255,255,0.08));
  border-radius: 999px;
  transform: rotate(-18deg);
}
.lupi-simple-scene-art::after {
  inset: 20% 8%;
  border-color: color-mix(in srgb, var(--scene-b) 36%, rgba(255,255,255,0.08));
  transform: rotate(20deg);
}
.lupi-simple-scene-art i,
.lupi-simple-scene-art b {
  position: absolute;
  display: block;
  border-radius: 999px;
}
.lupi-simple-scene-art i:nth-child(1) {
  left: 13%;
  top: 34%;
  width: 40px;
  height: 40px;
  background: var(--scene-a);
  box-shadow: 0 0 24px color-mix(in srgb, var(--scene-a) 32%, transparent);
}
.lupi-simple-scene-art i:nth-child(2) {
  left: 44%;
  top: 16%;
  width: 54px;
  height: 54px;
  background: var(--scene-b);
  box-shadow: 0 0 26px color-mix(in srgb, var(--scene-b) 30%, transparent);
}
.lupi-simple-scene-art i:nth-child(3) {
  right: 15%;
  top: 46%;
  width: 34px;
  height: 34px;
  background: #f8fafc;
  box-shadow: 0 0 20px rgba(248,250,252,0.2);
}
.lupi-simple-scene-art b {
  left: 36%;
  bottom: 10%;
  width: 30px;
  height: 30px;
  background: color-mix(in srgb, var(--scene-a) 54%, #f8fafc);
  box-shadow: 0 0 20px color-mix(in srgb, var(--scene-a) 24%, transparent);
}
.lupi-simple-scene-copy {
  display: grid;
  gap: 6px;
}
.lupi-simple-scene-copy em {
  color: color-mix(in srgb, var(--scene-a) 74%, #f8fafc);
  font-size: 12px;
  font-style: normal;
  font-weight: 820;
  line-height: 1;
  letter-spacing: 0;
}
.lupi-simple-scene-copy strong {
  color: #fff;
  font-size: 22px;
  font-weight: 820;
  line-height: 1.08;
  letter-spacing: 0;
}
.lupi-simple-scene-copy span {
  color: rgba(226, 232, 240, 0.64);
  font-size: 13px;
  line-height: 1.35;
  letter-spacing: 0;
}
.lupi-simple-gallery-actions {
  display: flex;
  justify-content: center;
  margin-top: 22px;
}
.lupi-simple-gallery-actions button {
  min-height: 42px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.14);
  color: #e2e8f0;
  background: rgba(255,255,255,0.06);
  font: inherit;
  font-size: 13px;
  font-weight: 780;
  letter-spacing: 0;
  cursor: pointer;
}
.lupi-simple-library {
  width: min(1760px, 100%);
  margin: 42px auto 0;
}
@media (max-width: 980px) {
  .lupi-simple-gallery-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .lupi-simple-gallery {
    padding: 50px 12px 64px;
  }
  .lupi-simple-gallery-head {
    text-align: left;
    margin-bottom: 20px;
  }
  .lupi-simple-gallery-head h2 {
    font-size: 31px;
  }
  .lupi-simple-gallery-head span {
    font-size: 15px;
  }
  .lupi-simple-gallery-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .lupi-simple-scene {
    min-height: 150px;
    grid-template-columns: 112px minmax(0, 1fr);
    grid-template-rows: 1fr;
    align-items: center;
  }
  .lupi-simple-scene-art {
    min-height: 108px;
  }
  .lupi-simple-scene-copy strong {
    font-size: 19px;
  }
  .lupi-simple-scene-copy span {
    font-size: 12px;
  }
}
`;
