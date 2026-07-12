import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { getStoreState, resetStore } from '../test-utils';
import { MoleculeControls } from './MoleculeControls';

function loadStructure(atomCount: number, properties: string[] = []) {
  const trajectory = createMockTrajectory(1, atomCount);
  for (const property of properties) {
    trajectory.frames[0].properties.set(property, new Float32Array(atomCount));
  }
  getStoreState().setFile({
    name: `structure-${atomCount}.xyz`,
    size: atomCount * 16,
    trajectory,
    thermo: null,
  });
}

describe('MoleculeControls quick views', () => {
  beforeEach(() => resetStore());
  afterEach(() => cleanup());

  it('puts task-based presets before fine-grained rendering controls', () => {
    loadStructure(24);
    render(<MoleculeControls />);

    expect(screen.getByText('Quick views')).toBeTruthy();
    expect(screen.getByTestId('quick-view-bonds')).toBeTruthy();
    expect(screen.queryByText('Schematic')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Fine-tune structure' }));
    expect(screen.getByText('Schematic')).toBeTruthy();
  }, 10_000);

  it('changes structure presentation without changing the background or lighting', () => {
    loadStructure(24);
    const state = getStoreState();
    state.setBackgroundPreset('warm');
    state.setEnvironmentPreset('warehouse');
    state.setAmbientLightIntensity(0.37);
    state.setDirLightIntensity(1.73);
    state.setRimLightIntensity(0.61);

    render(<MoleculeControls />);
    fireEvent.click(screen.getByTestId('quick-view-space'));

    const updated = getStoreState();
    expect(updated.atomScale).toBe(1.35);
    expect(updated.showBonds).toBe(false);
    expect(updated.colorScheme).toBe('element');
    expect(updated.backgroundPreset).toBe('warm');
    expect(updated.environmentPreset).toBe('warehouse');
    expect(updated.ambientLightIntensity).toBe(0.37);
    expect(updated.dirLightIntensity).toBe(1.73);
    expect(updated.rimLightIntensity).toBe(0.61);
  });

  it('disables Property map when the structure has no per-atom data', () => {
    loadStructure(24);
    render(<MoleculeControls />);

    expect((screen.getByTestId('quick-view-property') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('quick-view-property').getAttribute('title')).toBe(
      'This structure has no per-atom data.',
    );
  });

  it('uses a valid fallback when Property map replaces a stale property selection', () => {
    loadStructure(24, ['energy', 'charge']);
    getStoreState().setColorProperty('missing-property');
    render(<MoleculeControls />);

    expect((screen.getByTestId('quick-view-property') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('quick-view-property'));

    const updated = getStoreState();
    expect(updated.colorScheme).toBe('property');
    expect(updated.colorProperty).toBe('energy');
    expect(updated.colormap).toBe('viridis');
    expect(screen.getByTestId('quick-view-property').getAttribute('aria-pressed')).toBe('true');
  });

  it('blocks bond inference at 25k atoms and preserves diagram rendering at 200k', () => {
    loadStructure(25_000);
    render(<MoleculeControls />);

    expect((screen.getByTestId('quick-view-bonds') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('quick-view-balanced'));
    expect(getStoreState().showBonds).toBe(false);
    expect(getStoreState().postprocessPreset).toBe('paper');

    act(() => loadStructure(200_000));
    fireEvent.click(screen.getByTestId('quick-view-space'));

    expect(getStoreState().showBonds).toBe(false);
    expect(getStoreState().postprocessPreset).toBe('diagram');
    expect(screen.getByRole('status').textContent).toContain('Diagram rendering stays on');
  });
});
