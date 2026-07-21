import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { getStoreState, resetStore } from '../test-utils';
import { MoleculeControls } from './MoleculeControls';

function loadStructure(atomCount: number, properties: string[] = [], chemical = true) {
  const trajectory = createMockTrajectory(1, atomCount);
  const frame = trajectory.frames[0]!;
  if (chemical) {
    frame.typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
    frame.distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };
  }
  for (const property of properties) {
    frame.properties.set(property, new Float32Array(atomCount));
  }
  getStoreState().setFile({
    name: `structure-${atomCount}.xyz`,
    size: atomCount * 16,
    trajectory,
    thermo: null,
  });
}

describe('MoleculeControls presets', () => {
  beforeEach(() => resetStore());
  afterEach(() => cleanup());

  it('puts task-based presets before fine-grained rendering controls', () => {
    loadStructure(24);
    render(<MoleculeControls />);

    expect(screen.getByText('Presets')).toBeTruthy();
    const bondsPreset = screen.getByTestId('model-preset-bonds');
    expect(bondsPreset.getAttribute('aria-label')).toMatch(/distance-inferred connections/i);
    expect(screen.queryByText('Show distance-inferred connections between nearby atoms.')).toBeNull();

    fireEvent.focus(bondsPreset);
    expect(screen.getByText('Show distance-inferred connections between nearby atoms.')).toBeTruthy();
    fireEvent.blur(bondsPreset);
    expect(screen.queryByText('Show distance-inferred connections between nearby atoms.')).toBeNull();
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
    fireEvent.click(screen.getByTestId('model-preset-space'));

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

    const propertyPreset = screen.getByTestId('model-preset-property');
    expect(propertyPreset.getAttribute('aria-disabled')).toBe('true');
    expect(propertyPreset.getAttribute('title')).toMatch(/needs per-atom data/i);

    fireEvent.click(propertyPreset);
    expect(screen.getByText(/Load a trajectory with charge, energy, force magnitude/i)).toBeTruthy();
    expect(getStoreState().colorScheme).not.toBe('property');
  });

  it('uses a valid fallback when Property map replaces a stale property selection', () => {
    loadStructure(24, ['energy', 'charge']);
    getStoreState().setColorProperty('missing-property');
    render(<MoleculeControls />);

    expect(screen.getByTestId('model-preset-property').getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(screen.getByTestId('model-preset-property'));

    const updated = getStoreState();
    expect(updated.colorScheme).toBe('property');
    expect(updated.colorProperty).toBe('energy');
    expect(updated.colormap).toBe('viridis');
    expect(screen.getByTestId('model-preset-property').getAttribute('aria-pressed')).toBe('true');
  });

  it('blocks bond inference at 25k atoms and preserves diagram rendering at 200k', () => {
    loadStructure(25_000);
    render(<MoleculeControls />);

    expect(screen.getByTestId('model-preset-bonds').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('model-preset-balanced'));
    expect(getStoreState().showBonds).toBe(false);
    expect(getStoreState().postprocessPreset).toBe('paper');

    act(() => loadStructure(200_000));
    fireEvent.click(screen.getByTestId('model-preset-space'));

    expect(getStoreState().showBonds).toBe(false);
    expect(getStoreState().postprocessPreset).toBe('diagram');
    expect(screen.getByRole('status').textContent).toContain('Diagram rendering stays on');
  });

  it('uses type colorway and disables inferred bonds for opaque coordinates', () => {
    loadStructure(24, [], false);
    render(<MoleculeControls />);

    expect(getStoreState().colorScheme).toBe('colorway');
    expect(screen.queryByRole('button', { name: 'Element colors' })).toBeNull();
    const bondsPreset = screen.getByTestId('model-preset-bonds');
    expect(bondsPreset.getAttribute('aria-disabled')).toBe('true');
    expect(bondsPreset.getAttribute('title')).toMatch(/mapped elements with Ångström coordinates/i);
  });
});
