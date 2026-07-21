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
  studio: 'Model',
  export: 'Capture',
  flythrough: 'Camera',
  telemetry: 'Analyze',
  equilibrium: 'Equilibrium Solve',
  mlipLongRun: 'MLIP Long Run',
};

export const PanelHost = memo(function PanelHost() {
  const fileLoaded = useStore(s => Boolean(s.file));
  const activePanel = useStore(s => s.activePanel);
  const studioDeck = useStore(s => s.studioDeck);

  if (!activePanel || !fileLoaded) return null;

  const title = activePanel === 'studio' && studioDeck === 'scene'
    ? 'World'
    : PANEL_TITLES[activePanel];

  return (
    <aside
      id="viewer-command-panel"
      className="lupine-command-panel"
      role="region"
      aria-label={`${title} command panel`}
      data-panel={activePanel}
      data-studio-deck={studioDeck ?? undefined}
    >
      <header className="lupine-command-panel__header">
        <span className="lupine-command-panel__accent" aria-hidden="true" />
        <span className="lupine-command-panel__title">{title}</span>
        <button
          type="button"
          className="lupine-command-panel__close"
          aria-label={`Close ${title} panel`}
          title="Close panel [Esc]"
          onClick={() => useStore.getState().setActivePanel(null)}
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
