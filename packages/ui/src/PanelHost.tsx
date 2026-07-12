/**
 * PanelHost - renders the active viewer tool panel as a dockable window.
 *
 * On desktop this replaces the fixed right-side sheet with a floating,
 * draggable, resizable, snap-to-edge palette. On mobile the caller still
 * renders the bottom sheet; this component renders nothing when invisible.
 *
 * The panel body itself is shared with the mobile sheet via ViewerPanelBody —
 * this component only owns the desktop dock chrome (title, size, position).
 */
import { useStore, type AppState, type ViewerControlMode } from './store';
import { DockableWindow } from './DockableWindow';
import { ViewerPanelBody } from './ViewerPanelBody';

interface PanelHostProps {
  activePanel: AppState['activePanel'];
  studioDeck: ViewerControlMode | null;
  onOpenStudioDeck: (mode: ViewerControlMode) => void;
  onClose: () => void;
}

const TITLES: Record<NonNullable<PanelHostProps['activePanel']>, string> = {
  studio: 'Structure',
  export: 'Export',
  flythrough: 'Camera Path',
  telemetry: 'Analyze Data',
  equilibrium: 'Equilibrium Solve',
  mlipLongRun: 'MLIP Long Run',
};

const INITIALS: Record<NonNullable<PanelHostProps['activePanel']>, { x?: number; y?: number; w?: number; h?: number }> = {
  studio: { x: undefined, y: undefined, w: 400, h: 720 },
  export: { x: undefined, y: undefined, w: 420, h: 680 },
  flythrough: { x: undefined, y: undefined, w: 400, h: 620 },
  telemetry: { x: undefined, y: undefined, w: 400, h: 580 },
  equilibrium: { x: undefined, y: undefined, w: 460, h: 720 },
  mlipLongRun: { x: undefined, y: undefined, w: 460, h: 720 },
};

export function PanelHost({ activePanel, studioDeck, onOpenStudioDeck, onClose }: PanelHostProps) {
  const file = useStore(s => s.file);

  if (!activePanel || !file) return null;

  const title = activePanel === 'studio'
    ? studioDeck === 'scene'
      ? 'Background'
      : studioDeck === 'export'
        ? 'Export'
        : 'Structure'
    : TITLES[activePanel];

  return (
    <DockableWindow
      key={activePanel}
      title={title}
      onClose={onClose}
      initial={INITIALS[activePanel]}
      minW={320}
      minH={240}
    >
      <ViewerPanelBody
        activePanel={activePanel}
        studioDeck={studioDeck}
        onModeChange={onOpenStudioDeck}
        showChrome={false}
      />
    </DockableWindow>
  );
}
