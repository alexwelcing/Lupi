import { useMemo, type CSSProperties } from 'react';
import { ParticleCanvas } from './ParticleCanvas';
import { ALL_EXAMPLES, type GalleryExample } from './shared';
import { openGalleryExampleById } from '../galleryExampleLoader';
import { useStore } from '../store';

type HeroScene = {
  id: string;
  label: string;
  title: string;
  copy: string;
  badge: string;
  colors: [string, string, string];
};

type MoleculeButtonStyle = CSSProperties & {
  '--molecule-a': string;
  '--molecule-b': string;
  '--molecule-c': string;
};

const HERO_SCENES: HeroScene[] = [
  {
    id: 'elliott_gst_crystallization',
    label: 'Atoms moving',
    title: 'Watch interaction',
    copy: 'A phase-change trajectory with motion you can pause, orbit, and read.',
    badge: 'trajectory',
    colors: ['#5eead4', '#38bdf8', '#0f172a'],
  },
  {
    id: 'c60_buckyball',
    label: 'Carbon cage',
    title: 'Spin a molecule',
    copy: 'Open a clean 3D molecule and feel the structure immediately.',
    badge: 'molecule',
    colors: ['#f8fafc', '#94a3b8', '#1f2937'],
  },
  {
    id: 'massive_1m',
    label: '1M atom scene',
    title: 'Zoom into scale',
    copy: 'A nearly million-atom lattice that still stays easy to move around.',
    badge: 'desktop',
    colors: ['#fbbf24', '#fb7185', '#111827'],
  },
  {
    id: 'aspirin',
    label: 'Study mode',
    title: 'Learn by looking',
    copy: 'Organic chemistry examples become touchable scenes instead of flat diagrams.',
    badge: 'mobile',
    colors: ['#c084fc', '#60a5fa', '#111827'],
  },
];

export function HeroSection() {
  const openConfigurator = useStore((s) => s.openConfigurator);
  const scenes = useMemo(
    () => HERO_SCENES.map((scene) => ({
      ...scene,
      example: ALL_EXAMPLES.find((example) => example.id === scene.id),
    })),
    [],
  );

  const openScene = (id: string) => {
    void openGalleryExampleById(id);
  };

  return (
    <section className="lupi-hero" aria-labelledby="lupi-hero-title">
      <style>{HERO_CSS}</style>
      <ParticleCanvas />

      <div className="lupi-hero-shell">
        <div className="lupi-hero-copy">
          <div className="lupi-hero-product">Lupi molecular viewer</div>
          <h1 id="lupi-hero-title" className="lupi-hero-title">
            See atoms interact.
          </h1>
          <p className="lupi-hero-lede">
            Lupi turns molecular motion into big, touchable scenes you can spin,
            share, and understand on desktop, mobile, and AR/VR.
          </p>

          <div className="lupi-hero-actions" aria-label="Primary actions">
            <a className="lupi-hero-primary" href="#gallery">
              <IconSpark />
              <span>Pick a molecule</span>
            </a>
            <button type="button" className="lupi-hero-secondary" onClick={() => openConfigurator('atoms interacting in 3D')}>
              <IconBuild />
              <span>Build a scene</span>
            </button>
          </div>
        </div>

        <div className="lupi-hero-scenes" aria-label="Featured molecule scenes">
          {scenes.map((scene) => (
            <MoleculeSceneButton
              key={scene.id}
              scene={scene}
              example={scene.example}
              onOpen={() => openScene(scene.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function MoleculeSceneButton({
  scene,
  example,
  onOpen,
}: {
  scene: HeroScene;
  example?: GalleryExample;
  onOpen: () => void;
}) {
  const colors = example?.colors ?? scene.colors;
  return (
    <button
      type="button"
      className="lupi-molecule-button"
      onClick={onOpen}
      data-testid={`hero-scene-${scene.id}`}
      style={{
        '--molecule-a': colors[0],
        '--molecule-b': colors[1],
        '--molecule-c': colors[2],
      } as MoleculeButtonStyle}
    >
      <span className="lupi-molecule-art" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <b />
      </span>
      <span className="lupi-molecule-button-copy">
        <span>{scene.label}</span>
        <strong>{scene.title}</strong>
        <em>{scene.copy}</em>
      </span>
      <small>{scene.badge}</small>
    </button>
  );
}

function IconSpark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="m5.6 5.6 2.8 2.8" />
      <path d="m15.6 15.6 2.8 2.8" />
      <path d="m18.4 5.6-2.8 2.8" />
      <path d="m8.4 15.6-2.8 2.8" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function IconBuild() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 14a8 8 0 0 1 16 0" />
      <path d="M12 4v10" />
      <path d="M8 20h8" />
      <path d="M9 14h6" />
    </svg>
  );
}

const HERO_CSS = `
.lupi-hero {
  position: relative;
  width: 100%;
  min-height: calc(100dvh - 104px);
  overflow: hidden;
  background:
    linear-gradient(120deg, rgba(2, 2, 4, 0.92) 0%, rgba(7, 12, 18, 0.76) 54%, rgba(4, 9, 13, 0.68) 100%);
  color: #f8fafc;
  isolation: isolate;
}
.lupi-hero::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 120px;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(2, 2, 4, 0), rgba(2, 2, 4, 0.78));
  z-index: 1;
}
.lupi-hero-shell {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  width: min(1380px, 100%);
  min-height: calc(100dvh - 104px);
  margin: 0 auto;
  padding: 64px 28px 34px;
  display: grid;
  grid-template-columns: minmax(340px, 0.72fr) minmax(560px, 1.28fr);
  gap: 34px;
  align-items: center;
}
.lupi-hero-copy {
  max-width: 620px;
}
.lupi-hero-product {
  margin-bottom: 14px;
  color: #7dd3fc;
  font-size: 14px;
  font-weight: 760;
  letter-spacing: 0;
}
.lupi-hero-title {
  margin: 0;
  color: #f8fafc;
  font-size: 68px;
  line-height: 0.96;
  font-weight: 860;
  letter-spacing: 0;
  text-wrap: balance;
}
.lupi-hero-lede {
  max-width: 560px;
  margin: 20px 0 0;
  color: rgba(226, 232, 240, 0.74);
  font-size: 19px;
  line-height: 1.55;
  letter-spacing: 0;
  text-wrap: pretty;
}
.lupi-hero-actions {
  margin-top: 28px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.lupi-hero-primary,
.lupi-hero-secondary {
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border-radius: 8px;
  font: inherit;
  font-size: 14px;
  font-weight: 780;
  letter-spacing: 0;
  text-decoration: none;
  cursor: pointer;
}
.lupi-hero-primary {
  border: 1px solid rgba(94, 234, 212, 0.58);
  color: #061316;
  background: linear-gradient(135deg, #5eead4, #fbbf24);
  box-shadow: 0 18px 44px rgba(20, 184, 166, 0.2);
}
.lupi-hero-secondary {
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.06);
}
.lupi-hero-scenes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.lupi-molecule-button {
  position: relative;
  min-width: 0;
  min-height: 220px;
  display: grid;
  grid-template-rows: minmax(112px, 1fr) auto;
  gap: 12px;
  padding: 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
  color: #f8fafc;
  background:
    radial-gradient(circle at 34% 26%, color-mix(in srgb, var(--molecule-a) 28%, transparent), transparent 38%),
    radial-gradient(circle at 78% 68%, color-mix(in srgb, var(--molecule-b) 22%, transparent), transparent 42%),
    linear-gradient(145deg, rgba(15, 23, 42, 0.78), rgba(2, 6, 23, 0.66));
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255,255,255,0.08);
  text-align: left;
  cursor: pointer;
  transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}
.lupi-molecule-button:hover,
.lupi-molecule-button:focus-visible {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--molecule-a) 60%, rgba(255,255,255,0.18));
  box-shadow: 0 22px 54px rgba(0, 0, 0, 0.34), 0 0 0 1px color-mix(in srgb, var(--molecule-a) 22%, transparent);
  outline: none;
}
.lupi-molecule-art {
  position: relative;
  min-height: 112px;
  display: block;
}
.lupi-molecule-art::before,
.lupi-molecule-art::after {
  content: "";
  position: absolute;
  inset: 13% 10%;
  border: 1px solid color-mix(in srgb, var(--molecule-a) 42%, rgba(255,255,255,0.1));
  border-radius: 999px;
  transform: rotate(-18deg);
}
.lupi-molecule-art::after {
  inset: 18% 7%;
  border-color: color-mix(in srgb, var(--molecule-b) 38%, rgba(255,255,255,0.08));
  transform: rotate(22deg);
}
.lupi-molecule-art i,
.lupi-molecule-art b {
  position: absolute;
  display: block;
  border-radius: 999px;
  box-shadow: 0 0 24px color-mix(in srgb, currentColor 24%, transparent);
}
.lupi-molecule-art i:nth-child(1) {
  left: 13%;
  top: 32%;
  width: 42px;
  height: 42px;
  color: var(--molecule-a);
  background: var(--molecule-a);
}
.lupi-molecule-art i:nth-child(2) {
  left: 42%;
  top: 16%;
  width: 56px;
  height: 56px;
  color: var(--molecule-b);
  background: var(--molecule-b);
}
.lupi-molecule-art i:nth-child(3) {
  right: 15%;
  top: 42%;
  width: 38px;
  height: 38px;
  color: #f8fafc;
  background: #f8fafc;
}
.lupi-molecule-art i:nth-child(4) {
  left: 36%;
  bottom: 8%;
  width: 34px;
  height: 34px;
  color: color-mix(in srgb, var(--molecule-a) 55%, #f8fafc);
  background: color-mix(in srgb, var(--molecule-a) 55%, #f8fafc);
}
.lupi-molecule-art b {
  right: 34%;
  bottom: 24%;
  width: 24px;
  height: 24px;
  color: color-mix(in srgb, var(--molecule-b) 60%, #f8fafc);
  background: color-mix(in srgb, var(--molecule-b) 60%, #f8fafc);
}
.lupi-molecule-button-copy {
  position: relative;
  display: grid;
  gap: 6px;
}
.lupi-molecule-button-copy span {
  color: color-mix(in srgb, var(--molecule-a) 72%, #f8fafc);
  font-size: 12px;
  font-weight: 820;
  line-height: 1;
  letter-spacing: 0;
}
.lupi-molecule-button-copy strong {
  color: #ffffff;
  font-size: 23px;
  line-height: 1.08;
  font-weight: 820;
  letter-spacing: 0;
}
.lupi-molecule-button-copy em {
  max-width: 24rem;
  color: rgba(226, 232, 240, 0.64);
  font-size: 13px;
  font-style: normal;
  line-height: 1.35;
  letter-spacing: 0;
}
.lupi-molecule-button small {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.12);
  color: rgba(226,232,240,0.72);
  background: rgba(2,6,23,0.42);
  font-size: 10px;
  font-weight: 820;
  line-height: 1;
  letter-spacing: 0;
  text-transform: uppercase;
}
@media (max-width: 1060px) {
  .lupi-hero-shell {
    grid-template-columns: 1fr;
    min-height: auto;
    padding-top: 54px;
  }
  .lupi-hero-title {
    font-size: 52px;
  }
}
@media (max-width: 680px) {
  .lupi-hero {
    min-height: auto;
  }
  .lupi-hero-shell {
    padding: 30px 14px 22px;
    gap: 24px;
  }
  .lupi-hero-title {
    font-size: 38px;
  }
  .lupi-hero-lede {
    margin-top: 14px;
    font-size: 16px;
    line-height: 1.45;
  }
  .lupi-hero-actions {
    margin-top: 20px;
    display: grid;
    grid-template-columns: 1fr;
  }
  .lupi-hero-scenes {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .lupi-molecule-button {
    min-height: 156px;
    grid-template-columns: 116px minmax(0, 1fr);
    grid-template-rows: 1fr;
    align-items: center;
    gap: 12px;
  }
  .lupi-molecule-art {
    min-height: 112px;
  }
  .lupi-molecule-button-copy strong {
    font-size: 19px;
  }
  .lupi-molecule-button-copy em {
    font-size: 12px;
  }
}
`;
