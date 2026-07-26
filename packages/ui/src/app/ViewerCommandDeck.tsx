import { memo, type ReactNode } from 'react';
import { useStore } from '../store';
import {
  IconExport,
  IconFlythrough,
  IconStudy,
  IconTelemetryTool,
  LupiGlyph,
} from '../icons';

type ViewerCommand = 'visuals' | 'analyze' | 'science' | 'camera' | 'capture' | 'learn';

const COMMANDS: Array<{
  id: ViewerCommand;
  label: string;
  shortcut: string;
  icon: ReactNode;
  requiresScience?: boolean;
}> = [
  { id: 'visuals', label: 'Visuals', shortcut: '1', icon: <IconVisuals /> },
  { id: 'analyze', label: 'Analyze', shortcut: '2', icon: <IconTelemetryTool /> },
  { id: 'science', label: 'Science', shortcut: '6', icon: <IconScience />, requiresScience: true },
  { id: 'camera', label: 'Camera', shortcut: '3', icon: <IconFlythrough /> },
  { id: 'capture', label: 'Capture', shortcut: '4', icon: <IconExport /> },
  { id: 'learn', label: 'Learn', shortcut: '5', icon: <IconStudy /> },
];

function commandIsActive(
  command: ViewerCommand,
  activePanel: ReturnType<typeof useStore.getState>['activePanel'],
  studyLensOpen: boolean,
) {
  switch (command) {
    case 'visuals': return activePanel === 'studio';
    case 'analyze': return activePanel === 'telemetry';
    case 'science': return activePanel === 'science';
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
  const studyLensOpen = useStore(s => s.studyLensOpen);
  const hasScience = useStore(s => Boolean(s.file?.science));

  const activate = (command: ViewerCommand) => {
    const state = useStore.getState();
    const alreadyActive = commandIsActive(command, state.activePanel, state.studyLensOpen);

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
      case 'visuals':
        state.setStudioDeck(state.studioDeck === 'scene' ? 'scene' : 'molecule');
        if (state.activePanel !== 'studio') state.setActivePanel('studio');
        break;
      case 'analyze':
        state.setStudioDeck(null);
        state.setActivePanel('telemetry');
        break;
      case 'science':
        state.setStudioDeck(null);
        state.setActivePanel('science');
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
      {COMMANDS.filter(command => !command.requiresScience || hasScience).map(command => {
        const active = commandIsActive(command.id, activePanel, studyLensOpen);
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

function IconScience() {
  return (
    <LupiGlyph>
      <path d="M6.5 16.5 10 11l2.4 2.2L17.5 6.5" />
      <circle cx="6.5" cy="16.5" r="1.2" />
      <circle cx="10" cy="11" r="1.2" />
      <circle cx="12.4" cy="13.2" r="1.2" />
      <circle cx="17.5" cy="6.5" r="1.2" />
    </LupiGlyph>
  );
}

function IconVisuals() {
  return (
    <LupiGlyph>
      <circle cx="8" cy="12" r="2" />
      <circle cx="15.8" cy="8.2" r="1.7" />
      <circle cx="15.8" cy="16" r="1.7" />
      <path d="m9.8 11 4.3-2.1M9.8 13l4.3 2.1" />
    </LupiGlyph>
  );
}
