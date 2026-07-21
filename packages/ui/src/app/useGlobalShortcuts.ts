import { useEffect } from 'react';
import { useStore } from '../store';

export function useGlobalShortcuts(commandPaletteOpen: boolean, setCommandPaletteOpen: (open: boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K opens the command palette from anywhere.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }

      if (commandPaletteOpen) return; // palette owns its own keyboard nav

      const target = e.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const state = useStore.getState();
      const currentFile = state.file;
      const isResearch = Boolean(currentFile?.name?.startsWith('research_') || currentFile?.sourceUrl?.includes('/research/'));

      if (e.key === ' ' && !isResearch) { e.preventDefault(); state.togglePlay(); }
      if (e.key === 'ArrowRight') state.nextFrame();
      if (e.key === 'ArrowLeft') state.prevFrame();
      if (e.key === 'Escape') {
        state.setActivePanel(null);
        state.setStudioDeck(null);
        state.setViewMenuOpen(false);
        state.setStudyLensOpen(false);
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault();
        state.setViewMenuOpen(false);
        state.setStudyLensOpen(e.key === '6');
        if (e.key === '1') {
          state.setStudioDeck('molecule');
          if (state.activePanel !== 'studio') state.setActivePanel('studio');
        } else if (e.key === '2') {
          state.setStudioDeck('scene');
          if (state.activePanel !== 'studio') state.setActivePanel('studio');
        } else if (e.key === '3') {
          state.setStudioDeck(null);
          state.setActivePanel('telemetry');
        } else if (e.key === '4') {
          state.setStudioDeck(null);
          state.setActivePanel('flythrough');
        } else if (e.key === '5') {
          state.setStudioDeck(null);
          state.setActivePanel('export');
        } else {
          state.setStudioDeck(null);
          state.setActivePanel(null);
        }
      }
      if (e.key === 'v' && !e.metaKey && !e.ctrlKey) {
        state.setViewMenuOpen(false);
        state.setStudioDeck(state.studioDeck ?? 'molecule');
        state.setActivePanel('studio');
      }
      if (e.key === 'x' && !e.metaKey && !e.ctrlKey) {
        state.setStudioDeck(null);
        state.setActivePanel('export');
      }
      if (e.key === 'b' && !e.metaKey && !e.ctrlKey) state.toggleBonds();
      if (e.key === 't' && !e.metaKey && !e.ctrlKey) {
        state.setStudioDeck(null);
        state.setActivePanel('telemetry');
      }
    };
    window.addEventListener('keydown', handler);

    // Track Shift for the click-to-annotate flow. AtomPicker's onClick can't
    // see the original DOM event, so we mirror the modifier on a global
    // ambient flag the click handler reads. Released-on-blur to avoid
    // sticky state when the user alt-tabs while holding shift.
    const shiftDown = (e: KeyboardEvent) => { if (e.key === 'Shift') (window as any).__atlasShiftHeld = true; };
    const shiftUp = (e: KeyboardEvent) => { if (e.key === 'Shift') (window as any).__atlasShiftHeld = false; };
    const blurReset = () => { (window as any).__atlasShiftHeld = false; };
    window.addEventListener('keydown', shiftDown);
    window.addEventListener('keyup', shiftUp);
    window.addEventListener('blur', blurReset);

    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keydown', shiftDown);
      window.removeEventListener('keyup', shiftUp);
      window.removeEventListener('blur', blurReset);
    };
  }, [commandPaletteOpen, setCommandPaletteOpen]);
}
