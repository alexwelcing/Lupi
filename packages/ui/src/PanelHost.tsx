/**
 * PanelHost - deterministic command panel beside the viewer command deck.
 *
 * The molecular viewport is the primary workspace, so tool surfaces stay on a
 * known edge instead of opening as draggable windows over unrelated controls.
 *
 * On a phone the panel floats over the full-bleed canvas (panels/usePhoneSheet):
 * held upright it is a bottom sheet with a handle and Peek, Half and Full
 * detents, held sideways a column on the right, and either way the molecule
 * moves into the room it leaves (camera/viewInset.ts). Desktop is unchanged.
 */
import { memo, useCallback } from 'react';
import { IconClose } from './icons';
import { useStore, type AppState } from './store';
import { ViewerPanelBody } from './ViewerPanelBody';
import { usePhoneSheet } from './panels/usePhoneSheet';

const PANEL_TITLES: Record<NonNullable<AppState['activePanel']>, string> = {
  studio: 'Style',
  export: 'Export',
  flythrough: 'Camera',
  telemetry: 'Data',
  science: 'Reaction path',
  equilibrium: 'Equilibrium Solve',
  mlipLongRun: 'MLIP Long Run',
  elements: 'Switch molecule',
  settings: 'Settings',
};

/** Panels that open without a loaded file (reference/app-level surfaces). */
const FILELESS_PANELS: ReadonlySet<string> = new Set(['elements', 'settings']);

export const PanelHost = memo(function PanelHost({ stowed = false }: { stowed?: boolean }) {
  const file = useStore(s => s.file);
  const activePanel = useStore(s => s.activePanel);
  const studioDeck = useStore(s => s.studioDeck);
  const visible = Boolean(activePanel) && (Boolean(file) || FILELESS_PANELS.has(activePanel ?? ''));

  // A swipe down past Peek closes the panel, as the close button does.
  const dismiss = useCallback(() => useStore.getState().setActivePanel(null), []);
  const sheet = usePhoneSheet({
    id: 'panel',
    memoryKey: activePanel ?? 'none',
    open: visible && !stowed,
    onDismiss: dismiss,
  });

  if (!activePanel || !visible) return null;

  const title = PANEL_TITLES[activePanel];
  const autoHeight = activePanel === 'telemetry' && !file?.thermo?.runs.length;

  return (
    <aside
      id="viewer-command-panel"
      ref={sheet.sheetRef}
      className="lupine-command-panel"
      role="region"
      aria-label={`${title} command panel`}
      data-panel={activePanel}
      data-studio-deck={studioDeck ?? undefined}
      data-auto-height={autoHeight || undefined}
      {...sheet.sheetProps}
    >
      {sheet.mode === 'sheet' && <button {...sheet.handleProps} aria-controls="viewer-command-panel" />}
      <header className="lupine-command-panel__header" {...(sheet.mode === 'sheet' ? sheet.gripProps : {})}>
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
