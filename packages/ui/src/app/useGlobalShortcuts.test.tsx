import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGlobalShortcuts } from './useGlobalShortcuts';
const state = vi.hoisted(() => ({ togglePlay: vi.fn(), setActivePanel: vi.fn(), setStudioDeck: vi.fn(), setViewMenuOpen: vi.fn(), setStudyLensOpen: vi.fn() }));
vi.mock('../store', () => ({ useStore: { getState: () => state } }));
function Controls() {
  useGlobalShortcuts(false, () => {});
  return <button>Remix scene</button>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('viewer shortcut ownership', () => {
  it('does not cancel Space on a native action', () => {
    render(<Controls />);
    const canceled = !fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(canceled).toBe(false);
    expect(state.togglePlay).not.toHaveBeenCalled();
  });
  it('keeps scene Space and panel Escape shortcuts available', () => {
    render(<Controls />);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(state.togglePlay).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' });
    expect(state.setActivePanel).toHaveBeenCalledWith(null);
  });
});
