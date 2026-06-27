/**
 * ViewerPanelBody — single source of truth for which component renders for a
 * given `activePanel`.
 *
 * Previously this 7-way switch was copy-pasted in two places: PanelHost (the
 * desktop dockable window) and the mobile bottom sheet in App.tsx. The two
 * copies had already drifted (e.g. the export panel showed a redundant close
 * button on mobile), which is exactly the divergence a shared body prevents.
 * Callers supply only the chrome wrapper + close/mode callbacks; the body reads
 * file/frame/thermo from the store itself.
 */
import { useStore, type AppState } from './store';
import { ViewerControlsDrawer, type ViewerControlMode } from './ViewerControlsDrawer';
import { FigureExportPanel } from './panels/FigureExportPanel';
import { FlythroughPanel } from './panels/FlythroughPanel';
import { TelemetryPanel } from './panels/TelemetryPanel';
import { EquilibriumSolveWorkbench } from './EquilibriumSolveWorkbench';
import { SearchPanel } from './panels/SearchPanel';
import { MlipLongRunWorkbench } from './MlipLongRunWorkbench';

export interface ViewerPanelBodyProps {
  activePanel: AppState['activePanel'];
  studioDeck: ViewerControlMode | null;
  onModeChange: (mode: ViewerControlMode) => void;
  /** Studio drawer renders its own header + mode tabs only inside the mobile
   *  sheet; the desktop dock supplies that chrome via its title bar. */
  showChrome: boolean;
}

export function ViewerPanelBody({ activePanel, studioDeck, onModeChange, showChrome }: ViewerPanelBodyProps) {
  const file = useStore(s => s.file);
  const frame = useStore(s => s.frame);

  if (!activePanel || !file) return null;

  switch (activePanel) {
    case 'studio':
      return (
        <ViewerControlsDrawer
          activeMode={studioDeck ?? 'molecule'}
          onModeChange={onModeChange}
          showChrome={showChrome}
        />
      );
    case 'export':
      return <FigureExportPanel showCloseButton={false} />;
    case 'flythrough':
      return <FlythroughPanel showCloseButton={false} />;
    case 'telemetry':
      return (
        <TelemetryPanel
          thermo={file.thermo ?? null}
          currentFrame={file.trajectory.frames[frame] ?? undefined}
          totalFrames={file.trajectory.totalFrames ?? 0}
        />
      );
    case 'equilibrium':
      return <EquilibriumSolveWorkbench />;
    case 'mlipLongRun':
      return <MlipLongRunWorkbench />;
    case 'search':
      return <SearchPanel showCloseButton={false} />;
    default:
      return null;
  }
}
