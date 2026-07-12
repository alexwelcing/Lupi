import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { useStore } from '../store';
import { resetStore } from '../test-utils';
import { MobileShell } from './MobileShell';

vi.mock('../ViewerPanelBody', () => ({
  ViewerPanelBody: () => <div data-testid="viewer-panel-body" />,
}));

vi.mock('../StudyLensPanel', () => ({
  StudyLensPanel: () => <div data-testid="study-guide" />,
}));

function loadMolecule() {
  useStore.getState().setFile({
    name: 'water.xyz',
    size: 128,
    trajectory: createMockTrajectory(1, 3),
    thermo: null,
  });
}

describe('MobileShell', () => {
  beforeEach(() => {
    resetStore();
    loadMolecule();
  });

  it('keeps Style, View, and Learn surfaces mutually exclusive', () => {
    render(<MobileShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Style controls' }));
    expect(useStore.getState().activePanel).toBe('studio');
    expect(useStore.getState().studioDeck).toBe('molecule');
    expect(useStore.getState().viewMenuOpen).toBe(false);
    expect(useStore.getState().studyLensOpen).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Camera view' }));
    expect(useStore.getState().activePanel).toBeNull();
    expect(useStore.getState().viewMenuOpen).toBe(true);
    expect(useStore.getState().studyLensOpen).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Study Guide' }));
    expect(useStore.getState().activePanel).toBeNull();
    expect(useStore.getState().viewMenuOpen).toBe(false);
    expect(useStore.getState().studyLensOpen).toBe(true);
  });

  it('does not mark Style active for Export and returns Export to structure controls', () => {
    useStore.setState({ activePanel: 'studio', studioDeck: 'export' });
    render(<MobileShell />);

    const styleButton = screen.getByRole('button', { name: 'Style controls' });
    expect(styleButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(styleButton);
    expect(useStore.getState().activePanel).toBe('studio');
    expect(useStore.getState().studioDeck).toBe('molecule');
    expect(styleButton.getAttribute('aria-pressed')).toBe('true');
  });
});
