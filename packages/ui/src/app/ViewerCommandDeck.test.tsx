import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { useStore } from '../store';
import { resetStore } from '../test-utils';
import { ViewerCommandDeck } from './ViewerCommandDeck';

function loadMolecule() {
  useStore.getState().setFile({
    name: 'water.xyz',
    size: 128,
    trajectory: createMockTrajectory(3, 3),
    thermo: null,
  });
}

describe('ViewerCommandDeck', () => {
  beforeEach(() => {
    resetStore();
    loadMolecule();
  });

  it('maps the visible game commands to one canonical surface at a time', () => {
    render(<ViewerCommandDeck compact={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Model command' }));
    expect(useStore.getState().activePanel).toBe('studio');
    expect(useStore.getState().studioDeck).toBe('molecule');

    fireEvent.click(screen.getByRole('button', { name: 'World command' }));
    expect(useStore.getState().activePanel).toBe('studio');
    expect(useStore.getState().studioDeck).toBe('scene');

    fireEvent.click(screen.getByRole('button', { name: 'Capture command' }));
    expect(useStore.getState().activePanel).toBe('export');
    expect(useStore.getState().studioDeck).toBeNull();
    expect(useStore.getState().studyLensOpen).toBe(false);
  });

  it('makes Learn exclusive and lets an active command close itself', () => {
    render(<ViewerCommandDeck compact />);

    const analyze = screen.getByRole('button', { name: 'Analyze command' });
    fireEvent.click(analyze);
    expect(useStore.getState().activePanel).toBe('telemetry');
    expect(analyze.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(analyze);
    expect(useStore.getState().activePanel).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Learn command' }));
    expect(useStore.getState().activePanel).toBeNull();
    expect(useStore.getState().studyLensOpen).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Camera command' }));
    expect(useStore.getState().activePanel).toBe('flythrough');
    expect(useStore.getState().studyLensOpen).toBe(false);
  });
});
