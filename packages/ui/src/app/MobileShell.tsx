import { Component } from 'react';
import { useStore, type ViewerControlMode } from '../store';
import { Sheet } from '../primitives/AppShell';
import { CameraPresetButton, MobileTabButton } from '../controls';
import { ViewerPanelBody } from '../ViewerPanelBody';
import { StudyLensPanel } from '../StudyLensPanel';

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) {
    return { error: err.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 16,
          color: 'var(--danger)',
          fontSize: 'var(--fs-xs)',
          fontFamily: 'var(--font-mono)',
        }}>
          <div style={{ marginBottom: 8, fontWeight: 600, textTransform: 'uppercase' }}>
            Panel Error
          </div>
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

export function MobileShell() {
  const file = useStore(s => s.file);
  const activePanel = useStore(s => s.activePanel);
  const studioDeck = useStore(s => s.studioDeck);
  const viewMenuOpen = useStore(s => s.viewMenuOpen);
  const studyLensOpen = useStore(s => s.studyLensOpen);
  const cameraPreset = useStore(s => s.cameraPreset);
  const setActivePanel = useStore(s => s.setActivePanel);
  const setStudioDeck = useStore(s => s.setStudioDeck);
  const setViewMenuOpen = useStore(s => s.setViewMenuOpen);
  const setStudyLensOpen = useStore(s => s.setStudyLensOpen);
  const toggleViewMenu = useStore(s => s.toggleViewMenu);
  const toggleStudyLens = useStore(s => s.toggleStudyLens);
  const setCameraPreset = useStore(s => s.setCameraPreset);

  if (!file) return null;

  const cameraPresetLabel =
    cameraPreset === 'top' ? 'XY' :
    cameraPreset === 'side' ? 'XZ' :
    cameraPreset === 'front' ? 'YZ' :
    cameraPreset === 'iso' ? 'ISO' : 'View';

  const structurePanelActive = activePanel === 'studio' && studioDeck !== 'export';

  const openStudioDeck = (mode: ViewerControlMode) => {
    setViewMenuOpen(false);
    setStudyLensOpen(false);
    setStudioDeck(mode);
    if (activePanel !== 'studio') setActivePanel('studio');
  };

  return (
    <>
      <nav
        aria-label="Viewer navigation"
        style={{
          position: 'fixed',
          bottom: 'var(--app-mobile-tab-bar-bottom)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 130,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          maxWidth: 'calc(100vw - 16px)',
          background: 'linear-gradient(180deg, rgba(17,19,27,0.96), rgba(8,9,14,0.96))',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 999,
          padding: '5px 6px',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.07)',
        }}
      >
        {viewMenuOpen && (
          <div
            className="lupine-glass lupine-glass--menu animate-menu-in"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              minWidth: 132,
              gap: 5,
            }}
          >
            <CameraPresetButton label="XY" active={cameraPreset === 'top'} onClick={() => { setCameraPreset('top'); setViewMenuOpen(false); }} title="Top view (XY plane)" />
            <CameraPresetButton label="XZ" active={cameraPreset === 'side'} onClick={() => { setCameraPreset('side'); setViewMenuOpen(false); }} title="Side view (XZ plane)" />
            <CameraPresetButton label="YZ" active={cameraPreset === 'front'} onClick={() => { setCameraPreset('front'); setViewMenuOpen(false); }} title="Front view (YZ plane)" />
            <CameraPresetButton label="ISO" active={cameraPreset === 'iso'} onClick={() => { setCameraPreset('iso'); setViewMenuOpen(false); }} title="Isometric view" />
          </div>
        )}
        <MobileTabButton
          onClick={() => {
            setViewMenuOpen(false);
            setStudyLensOpen(false);
            if (structurePanelActive) { setActivePanel(null); return; }
            setStudioDeck('molecule');
            if (activePanel !== 'studio') setActivePanel('studio');
          }}
          ariaLabel="Style controls"
          active={structurePanelActive}
        >
          STYLE
        </MobileTabButton>
        <MobileTabButton
          onClick={() => {
            setStudyLensOpen(false);
            if (activePanel) setActivePanel(null);
            toggleViewMenu();
          }}
          ariaLabel="Camera view"
          active={viewMenuOpen}
        >
          {cameraPresetLabel}
        </MobileTabButton>
        <MobileTabButton
          onClick={() => {
            setViewMenuOpen(false);
            if (activePanel) setActivePanel(null);
            toggleStudyLens();
          }}
          ariaLabel="Study Guide"
          active={studyLensOpen}
        >
          LEARN
        </MobileTabButton>
      </nav>

      {activePanel && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setActivePanel(null)}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(2,4,10,0.42)',
              zIndex: 90,
              animation: 'fadeIn 200ms ease-out',
              WebkitTapHighlightColor: 'transparent',
            }}
          />
          <Sheet tall={activePanel === 'studio' || activePanel === 'flythrough' || activePanel === 'export' || activePanel === 'telemetry'}>
            <div
              role="presentation"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 12px 8px', position: 'relative' }}
            >
              <div className="lupine-sheet--handle" aria-hidden="true" />
              <button
                onClick={() => setActivePanel(null)}
                style={{ position: 'absolute', right: 10, top: 0, background: 'transparent', border: 'none', color: '#cbd5e1', fontSize: 16, lineHeight: 1, padding: 8, minWidth: 40, minHeight: 40, touchAction: 'manipulation' }}
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>
            <ErrorBoundary>
              <ViewerPanelBody
                activePanel={activePanel}
                studioDeck={studioDeck}
                onModeChange={openStudioDeck}
                showChrome
              />
            </ErrorBoundary>
          </Sheet>
        </>
      )}

      {studyLensOpen && (
        <StudyLensPanel
          compact
          onClose={() => setStudyLensOpen(false)}
        />
      )}
    </>
  );
}
