import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { useStore } from '../store';
import { resetStore } from '../test-utils';
import { ViewerCommandDeck } from './ViewerCommandDeck';
import { scienceBundleForPathIndex } from '../science/scienceBundle';

function loadMolecule(withScience = false) {
  useStore.getState().setFile({
    name: 'water.xyz',
    size: 128,
    trajectory: createMockTrajectory(3, 3),
    thermo: null,
    science: withScience ? scienceBundleForPathIndex(16)! : undefined,
  });
}

describe('ViewerCommandDeck', () => {
  beforeEach(() => {
    resetStore();
    loadMolecule();
  });

  it('maps the visible game commands to one canonical surface at a time', () => {
    render(<ViewerCommandDeck compact={false} />);

    expect(screen.getAllByRole('button')).toHaveLength(6);

    const visuals = screen.getByRole('button', { name: 'Visuals command' });
    fireEvent.click(visuals);
    expect(useStore.getState().activePanel).toBe('studio');
    expect(useStore.getState().studioDeck).toBe('molecule');

    fireEvent.click(visuals);
    expect(useStore.getState().activePanel).toBeNull();

    useStore.getState().setStudioDeck('scene');
    fireEvent.click(visuals);
    expect(useStore.getState().activePanel).toBe('studio');
    expect(useStore.getState().studioDeck).toBe('scene');

    fireEvent.click(screen.getByRole('button', { name: 'Capture command' }));
    expect(useStore.getState().activePanel).toBe('export');
    expect(useStore.getState().studioDeck).toBeNull();
    expect(useStore.getState().studyLensOpen).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Elements command' }));
    expect(useStore.getState().activePanel).toBe('elements');
    expect(useStore.getState().studioDeck).toBeNull();
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

  it('shows the Science command only for science-bound loads and maps it to the science panel', () => {
    const { unmount } = render(<ViewerCommandDeck compact={false} />);
    // Ordinary molecule: no Science command.
    expect(screen.queryByRole('button', { name: 'Science command' })).toBeNull();
    unmount();

    loadMolecule(true);
    render(<ViewerCommandDeck compact={false} />);
    const science = screen.getByRole('button', { name: 'Science command' });
    fireEvent.click(science);
    expect(useStore.getState().activePanel).toBe('science');
    expect(science.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(science);
    expect(useStore.getState().activePanel).toBeNull();
  });
});
