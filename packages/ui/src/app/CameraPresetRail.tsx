import { useStore } from '../store';
import { Rail } from '../primitives/AppShell';
import { IconStudy } from '../icons';

function CameraPresetOption({
  code,
  label,
  detail,
  active,
  onClick,
}: {
  code: string;
  label: string;
  detail: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`lupine-menu-item ${active ? 'active' : ''}`}
      style={{
        minHeight: 38,
        display: 'grid',
        gridTemplateColumns: '42px 1fr',
        gap: 8,
        alignItems: 'center',
        padding: '7px 9px',
      }}
    >
      <span style={{
        display: 'grid',
        placeItems: 'center',
        height: 26,
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.10)',
        background: active ? 'rgba(30,220,224,0.14)' : 'rgba(15,23,42,0.62)',
        color: active ? '#99f6e4' : 'rgba(226,232,240,0.72)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 820,
        lineHeight: 1,
      }}>
        {code}
      </span>
      <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 780, color: active ? '#eaffff' : 'var(--text-primary)', lineHeight: 1 }}>
          {label}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(203,213,225,0.54)', lineHeight: 1 }}>
          {detail}
        </span>
      </span>
    </button>
  );
}

export function CameraPresetRail() {
  const cameraPreset = useStore(s => s.cameraPreset);
  const setCameraPreset = useStore(s => s.setCameraPreset);
  const viewMenuOpen = useStore(s => s.viewMenuOpen);
  const setViewMenuOpen = useStore(s => s.setViewMenuOpen);
  const toggleViewMenu = useStore(s => s.toggleViewMenu);
  const setStudioDeck = useStore(s => s.setStudioDeck);
  const studyLensOpen = useStore(s => s.studyLensOpen);
  const toggleStudyLens = useStore(s => s.toggleStudyLens);

  const cameraPresetLabel =
    cameraPreset === 'top' ? 'XY' :
    cameraPreset === 'side' ? 'XZ' :
    cameraPreset === 'front' ? 'YZ' :
    cameraPreset === 'iso' ? 'ISO' : 'View';
  const cameraPresetName =
    cameraPreset === 'top' ? 'Top' :
    cameraPreset === 'side' ? 'Side' :
    cameraPreset === 'front' ? 'Front' :
    cameraPreset === 'iso' ? 'Iso' : 'Free';

  return (
    <Rail
      direction="col"
      className="lupine-overlay lupine-overlay--top-left"
      style={{ top: 88, alignItems: 'flex-start' }}
    >
      <button
        type="button"
        onClick={() => {
          toggleViewMenu();
          setStudioDeck(null);
        }}
        title={`Camera view: ${cameraPresetName}`}
        aria-label={`Camera view: ${cameraPresetName}`}
        aria-expanded={viewMenuOpen}
        className={`lupine-btn compact icon-only ${viewMenuOpen ? 'active' : ''}`}
        style={{
          width: 48,
          height: 36,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 820,
        }}
      >
        {cameraPresetLabel}
      </button>
      {viewMenuOpen && (
        <div
          className="lupine-glass lupine-glass--menu animate-menu-in"
          role="menu"
          aria-label="Camera presets"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            display: 'grid',
            gridTemplateColumns: '1fr',
            minWidth: 206,
            gap: 5,
          }}
        >
          <CameraPresetOption code="XY" label="Top" detail="XY plane" active={cameraPreset === 'top'} onClick={() => { setCameraPreset('top'); setViewMenuOpen(false); }} />
          <CameraPresetOption code="XZ" label="Side" detail="XZ plane" active={cameraPreset === 'side'} onClick={() => { setCameraPreset('side'); setViewMenuOpen(false); }} />
          <CameraPresetOption code="YZ" label="Front" detail="YZ plane" active={cameraPreset === 'front'} onClick={() => { setCameraPreset('front'); setViewMenuOpen(false); }} />
          <CameraPresetOption code="ISO" label="Isometric" detail="3D angle" active={cameraPreset === 'iso'} onClick={() => { setCameraPreset('iso'); setViewMenuOpen(false); }} />
        </div>
      )}
      <button
        type="button"
        data-testid="study-lens-toggle"
        onClick={() => {
          setViewMenuOpen(false);
          toggleStudyLens();
        }}
        title="Study lens"
        aria-label="Study lens"
        aria-pressed={studyLensOpen}
        className={`lupine-btn compact icon-only ${studyLensOpen ? 'active' : ''}`}
        style={{
          width: 48,
          height: 36,
          padding: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <IconStudy />
      </button>
    </Rail>
  );
}
