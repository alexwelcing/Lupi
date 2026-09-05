/**
 * Active command body. Store subscriptions live inside the surface that needs
 * them so frame playback does not repaint every closed menu.
 */
import { lazy, memo, Suspense } from 'react';
import { StudioControlDeck } from './StudioControlDeck';
import { useStore, type AppState, type ViewerControlMode } from './store';
const FigureExportPanel = lazy(() =>
  import('./panels/FigureExportPanel').then(module => ({
    default: module.FigureExportPanel,
  })),
);
const FlythroughPanel = lazy(() =>
  import('./panels/FlythroughPanel').then(module => ({
    default: module.FlythroughPanel,
  })),
);
import { TelemetryPanel } from './panels/TelemetryPanel';
import { ScienceDeckPanel } from './science/ScienceDeckPanel';
import { ElementsPanel } from './panels/ElementsPanel';
import { SettingsPanel } from './panels/SettingsPanel';

export interface ViewerPanelBodyProps {
  activePanel: AppState['activePanel'];
  studioDeck: ViewerControlMode | null;
}

export const ViewerPanelBody = memo(function ViewerPanelBody({
  activePanel,
  studioDeck,
}: ViewerPanelBodyProps) {
  if (!activePanel) return null;
  return (
    <Suspense fallback={<p role="status">Loading tools…</p>}>{renderPanel(activePanel, studioDeck)}</Suspense>
  );
});

function renderPanel(
  activePanel: NonNullable<AppState['activePanel']>,
  studioDeck: ViewerControlMode | null,
) {
  switch (activePanel) {
    case 'studio':
      if (studioDeck === 'export') return <FigureExportPanel showCloseButton={false} embedded />;
      return <StudioControlDeck mode={studioDeck === 'scene' ? 'scene' : 'molecule'} />;
    case 'export':
      return <FigureExportPanel showCloseButton={false} embedded />;
    case 'flythrough':
      return <CameraCommandSurface />;
    case 'telemetry':
      return <TelemetryCommandSurface />;
    case 'science':
      return <ScienceCommandSurface />;
    case 'equilibrium':
    case 'mlipLongRun':
      return (
        <p>
          Research execution is separate from the learning viewer.{' '}
          <a href="https://lupine.science">Visit Lupine Science</a>.
        </p>
      );
    case 'elements':
      return <ElementsPanel />;
    case 'settings':
      return <SettingsPanel />;
  }
}

function CameraCommandSurface() {
  const cameraPreset = useStore(s => s.cameraPreset);
  const setCameraPreset = useStore(s => s.setCameraPreset);
  const fitCameraView = useStore(s => s.fitCameraView);

  const presets = [
    { id: 'iso' as const, code: 'ISO', label: 'Isometric' },
    { id: 'top' as const, code: 'XY', label: 'Top' },
    { id: 'side' as const, code: 'XZ', label: 'Side' },
    { id: 'front' as const, code: 'YZ', label: 'Front' },
  ];

  return (
    <div className="lupine-camera-command">
      <section className="lupine-camera-command__quick" aria-label="Camera quick views">
        <div className="lupine-command-section-label">Quick view</div>
        <div className="lupine-camera-command__presets">
          {presets.map(preset => (
            <button
              key={preset.id}
              type="button"
              className="lupine-camera-preset"
              aria-label={`${preset.label} camera view`}
              aria-pressed={cameraPreset === preset.id}
              onClick={() => setCameraPreset(preset.id)}
            >
              <span>{preset.code}</span>
              <small>{preset.label}</small>
            </button>
          ))}
          <button
            type="button"
            className="lupine-camera-preset"
            aria-label="Fit camera to molecule"
            onClick={fitCameraView}
          >
            <span>FIT</span>
            <small>Recenter</small>
          </button>
        </div>
      </section>
      <details className="lupine-camera-command__path">
        <summary style={{ padding: 16, cursor: 'pointer' }}>Camera animation</summary>
        <FlythroughPanel showCloseButton={false} embedded />
      </details>
    </div>
  );
}

function TelemetryCommandSurface() {
  const file = useStore(s => s.file);
  const frame = useStore(s => s.frame);

  if (!file) return null;
  return (
    <TelemetryPanel
      thermo={file.thermo ?? null}
      currentFrame={file.trajectory.frames[frame] ?? undefined}
      totalFrames={file.trajectory.totalFrames ?? 0}
      embedded
    />
  );
}

/**
 * Frame ↔ image sync, both directions, through the single store `frame`:
 * the panel renders the clamped store frame as the selected NEB image and
 * writes plot/stepper clicks back with `setFrame` — so transport buttons,
 * the scrubber, keyboard arrows, and the science panel all address the same
 * zero-based image of the reaction-path sequence.
 */
function ScienceCommandSurface() {
  const bundle = useStore(s => s.file?.science);
  const frame = useStore(s => s.frame);
  const setFrame = useStore(s => s.setFrame);

  if (!bundle) return null;
  const lastImage = Math.max(0, bundle.path.imageCount - 1);
  const currentImage = Math.max(0, Math.min(Math.floor(frame), lastImage));

  return <ScienceDeckPanel bundle={bundle} currentImage={currentImage} onImageChange={setFrame} />;
}
