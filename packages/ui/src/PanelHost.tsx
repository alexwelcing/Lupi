/**
 * PanelHost - deterministic command panel beside the viewer command deck.
 *
 * The molecular viewport is the primary workspace, so tool surfaces stay on a
 * known edge instead of opening as draggable windows over unrelated controls.
 */
import { memo } from 'react';
import { IconClose } from './icons';
import { useStore, type AppState } from './store';
import { ViewerPanelBody } from './ViewerPanelBody';

const PANEL_TITLES: Record<NonNullable<AppState['activePanel']>, string> = {
  studio: 'Style',
  export: 'Export',
  flythrough: 'Camera',
  telemetry: 'Data',
  science: 'Reaction path',
  equilibrium: 'Equilibrium Solve',
  mlipLongRun: 'MLIP Long Run',
  elements: 'Elements',
  settings: 'Settings',
};

/** Panels that open without a loaded file (reference/app-level surfaces). */
const FILELESS_PANELS: ReadonlySet<string> = new Set(['elements', 'settings']);

export const PanelHost = memo(function PanelHost() {
  const file = useStore(s => s.file);
  const activePanel = useStore(s => s.activePanel);
  const studioDeck = useStore(s => s.studioDeck);

  if (!activePanel || (!file && !FILELESS_PANELS.has(activePanel))) return null;

  const title = PANEL_TITLES[activePanel];
  const autoHeight = activePanel === 'telemetry' && !file?.thermo?.runs.length;

  return (
    <aside
      id="viewer-command-panel"
      className="lupine-command-panel"
      role="region"
      aria-label={`${title} command panel`}
      data-panel={activePanel}
      data-studio-deck={studioDeck ?? undefined}
      data-auto-height={autoHeight || undefined}
    >
      <header className="lupine-command-panel__header">
        <span className="lupine-command-panel__accent" aria-hidden="true" />
        <span className="lupine-command-panel__title">{title}</span>
        <button
          type="button"
          className="lupine-command-panel__close"
          aria-label={`Close ${title} panel`}
          title="Close panel [Esc]"
          onClick={() => {
            const trigger = document.querySelector<HTMLButtonElement>('.lupine-command-slot[aria-pressed="true"]');
            useStore.getState().setActivePanel(null);
            trigger?.focus();
          }}
        >
          <IconClose size={14} />
        </button>
      </header>
      <div className="lupine-command-panel__body">
        <ViewerPanelBody activePanel={activePanel} studioDeck={studioDeck} />
      </div>
    </aside>
  );
});
