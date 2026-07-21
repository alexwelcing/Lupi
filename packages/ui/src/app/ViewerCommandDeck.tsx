import { memo, type ReactNode } from 'react';
import { useStore } from '../store';
import {
  IconExport,
  IconFlythrough,
  IconStudy,
  IconTelemetryTool,
  LupiGlyph,
} from '../icons';

type ViewerCommand = 'model' | 'world' | 'analyze' | 'camera' | 'capture' | 'learn';

const COMMANDS: Array<{
  id: ViewerCommand;
  label: string;
  shortcut: string;
  icon: ReactNode;
}> = [
  { id: 'model', label: 'Model', shortcut: '1', icon: <IconModel /> },
  { id: 'world', label: 'World', shortcut: '2', icon: <IconWorld /> },
  { id: 'analyze', label: 'Analyze', shortcut: '3', icon: <IconTelemetryTool /> },
  { id: 'camera', label: 'Camera', shortcut: '4', icon: <IconFlythrough /> },
  { id: 'capture', label: 'Capture', shortcut: '5', icon: <IconExport /> },
  { id: 'learn', label: 'Learn', shortcut: '6', icon: <IconStudy /> },
];

function commandIsActive(
  command: ViewerCommand,
  activePanel: ReturnType<typeof useStore.getState>['activePanel'],
  studioDeck: ReturnType<typeof useStore.getState>['studioDeck'],
  studyLensOpen: boolean,
) {
  switch (command) {
    case 'model': return activePanel === 'studio' && (studioDeck ?? 'molecule') === 'molecule';
    case 'world': return activePanel === 'studio' && studioDeck === 'scene';
    case 'analyze': return activePanel === 'telemetry';
    case 'camera': return activePanel === 'flythrough';
    case 'capture': return activePanel === 'export';
    case 'learn': return studyLensOpen;
  }
}

/**
 * One stable, game-style command deck for every viewer size.
 *
 * The old shell split navigation between two desktop rails and a different
 * mobile tab bar. This deck owns the complete task hierarchy and guarantees
 * that only one large surface is active at a time.
 */
export const ViewerCommandDeck = memo(function ViewerCommandDeck({ compact }: { compact: boolean }) {
  const activePanel = useStore(s => s.activePanel);
  const studioDeck = useStore(s => s.studioDeck);
  const studyLensOpen = useStore(s => s.studyLensOpen);

  const activate = (command: ViewerCommand) => {
    const state = useStore.getState();
    const alreadyActive = commandIsActive(command, state.activePanel, state.studioDeck, state.studyLensOpen);

    state.setViewMenuOpen(false);
    if (command === 'learn') {
      state.setActivePanel(null);
      state.setStudioDeck(null);
      state.setStudyLensOpen(!alreadyActive);
      return;
    }

    state.setStudyLensOpen(false);
    if (alreadyActive) {
      state.setActivePanel(null);
      return;
    }

    switch (command) {
      case 'model':
        state.setStudioDeck('molecule');
        if (state.activePanel !== 'studio') state.setActivePanel('studio');
        break;
      case 'world':
        state.setStudioDeck('scene');
        if (state.activePanel !== 'studio') state.setActivePanel('studio');
        break;
      case 'analyze':
        state.setStudioDeck(null);
        state.setActivePanel('telemetry');
        break;
      case 'camera':
        state.setStudioDeck(null);
        state.setActivePanel('flythrough');
        break;
      case 'capture':
        state.setStudioDeck(null);
        state.setActivePanel('export');
        break;
    }
  };

  return (
    <nav
      className="lupine-command-deck"
      data-compact={compact}
      role="toolbar"
      aria-label="Viewer commands"
    >
      {COMMANDS.map(command => {
        const active = commandIsActive(command.id, activePanel, studioDeck, studyLensOpen);
        return (
          <button
            key={command.id}
            type="button"
            className="lupine-command-slot"
            data-command={command.id}
            aria-label={`${command.label} command`}
            aria-keyshortcuts={command.shortcut}
            aria-pressed={active}
            aria-expanded={active}
            aria-controls={command.id === 'learn' ? 'viewer-study-panel' : 'viewer-command-panel'}
            title={`${command.label} [${command.shortcut}]`}
            onClick={() => activate(command.id)}
          >
            <span className="lupine-command-slot__key" aria-hidden="true">{command.shortcut}</span>
            <span className="lupine-command-slot__icon" aria-hidden="true">{command.icon}</span>
            <span className="lupine-command-slot__label">{command.label}</span>
          </button>
        );
      })}
    </nav>
  );
});

function IconModel() {
  return (
    <LupiGlyph>
      <circle cx="8" cy="12" r="2" />
      <circle cx="15.8" cy="8.2" r="1.7" />
      <circle cx="15.8" cy="16" r="1.7" />
      <path d="m9.8 11 4.3-2.1M9.8 13l4.3 2.1" />
    </LupiGlyph>
  );
}

function IconWorld() {
  return (
    <LupiGlyph>
      <circle cx="12" cy="12" r="5.2" />
      <path d="M7.2 10.2h9.6M7.2 13.8h9.6" opacity="0.72" />
      <path d="M12 6.8c1.7 1.45 2.55 3.18 2.55 5.2s-.85 3.75-2.55 5.2M12 6.8C10.3 8.25 9.45 9.98 9.45 12s.85 3.75 2.55 5.2" opacity="0.72" />
    </LupiGlyph>
  );
}
