import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StudioControlDeck } from './StudioControlDeck';
import { useStore } from './store';
import { resetStore } from './test-utils';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { snapshotRemix } from './sceneRemix';
describe('focused style controls', () => {
  beforeEach(() => {
    resetStore();
    const trajectory = createMockTrajectory(1, 24);
    trajectory.frames[0].typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
    trajectory.frames[0].distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };
    useStore.getState().setFile({ name: 'test.xyz', size: 100, trajectory, thermo: null });
  });
  afterEach(cleanup);
  it('changes only the requested viewer setting', () => {
    render(<StudioControlDeck mode="molecule" />);
    const previous = useStore.getState().showBonds;
    fireEvent.click(screen.getByRole('button', { name: 'Paper look' }));
    expect(useStore.getState().backgroundPreset).toBe('white');
    fireEvent.click(screen.getByRole('button', { name: 'All visual mods' }));
    fireEvent.click(screen.getByText('Structure guides'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bond guides' }));
    expect(useStore.getState().showBonds).toBe(!previous);
    fireEvent.change(screen.getByRole('slider', { name: 'Atom size' }), {
      target: { value: '1.5' },
    });
    expect(useStore.getState().atomScale).toBe(1.5);
    fireEvent.click(screen.getByRole('button', { name: 'Light', exact: true }));
    fireEvent.change(screen.getByRole('slider', { name: 'Light direction' }), { target: { value: '-45' } });
    expect(useStore.getState().keyLightAzimuth).toBe(-45);
    fireEvent.click(screen.getByRole('button', { name: 'Back to looks' }));
    expect(screen.getByText(/Custom look/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Paper look' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText(/Equilibrium|New run|Research/)).toBeNull();
  });
  it('starts with four real look choices and keeps fine controls secondary', () => {
    render(<StudioControlDeck mode="scene" />);
    expect(screen.getAllByRole('button', { name: / look$/ })).toHaveLength(4);
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Studio look' }));
    expect(screen.getByRole('button', { name: 'Studio look' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('remixes and undoes a custom scene even after closing the panel', () => {
    const view = render(<StudioControlDeck mode="scene" />);
    const before = snapshotRemix(useStore.getState());
    expect(screen.getByRole('checkbox', { name: 'Keep atom colors' })).toHaveProperty('checked', false);
    expect(screen.getByRole('button', { name: 'Undo remix' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Remix scene' }));
    expect(snapshotRemix(useStore.getState())).not.toEqual(before);
    expect(useStore.getState().colorScheme).toBe('colorway');
    expect(useStore.getState().colormap).not.toBe(before.colormap);
    view.unmount();
    render(<StudioControlDeck mode="scene" />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo remix' }));
    expect(snapshotRemix(useStore.getState())).toEqual(before);
  });
  it('can keep an existing data color encoding while remixing the scene', () => {
    useStore.setState({ colorScheme: 'property', colorMode: 'property', colorProperty: 'energy', colormap: 'inferno' });
    render(<StudioControlDeck mode="scene" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep atom colors' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remix scene' }));
    expect(useStore.getState()).toMatchObject({ colorScheme: 'property', colorMode: 'property', colorProperty: 'energy', colormap: 'inferno' });
  });
  it('exposes the complete background/material catalogs and live effects', () => {
    render(<StudioControlDeck mode="scene" />);
    fireEvent.click(screen.getByRole('button', { name: 'All visual mods' }));
    expect(screen.getByRole('combobox', { name: 'Material recipe' }).querySelectorAll('option:not([disabled])')).toHaveLength(10);
    fireEvent.change(screen.getByRole('combobox', { name: 'Atom finish' }), { target: { value: 'metallic' } });
    expect(useStore.getState().materialPreset).toBe('metallic');
    fireEvent.click(screen.getByRole('button', { name: 'Backdrop', exact: true }));
    expect(screen.getByRole('combobox', { name: 'Background library' }).querySelectorAll('option').length).toBeGreaterThan(30);
    fireEvent.click(screen.getByRole('button', { name: 'Sphere', exact: true }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Atmosphere shape' }), { target: { value: 'sphere' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Atmosphere visibility' }), { target: { value: '.4' } });
    expect(useStore.getState().filterShellOpacity).toBe(.4);
    fireEvent.click(screen.getByRole('button', { name: 'Effects', exact: true }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Glow', exact: true }));
    expect(useStore.getState().effectOverrides).toMatchObject({ preset: 'paper', glow: true });
  });
  it('does not offer inferred bonds or properties for unidentified data', () => {
    useStore.getState().setFile({ name: 'opaque.dump', size: 100, trajectory: createMockTrajectory(1, 24), thermo: null });
    render(<StudioControlDeck mode="molecule" />);
    fireEvent.click(screen.getByRole('button', { name: 'All visual mods' }));
    fireEvent.click(screen.getByText('Structure guides'));
    expect(screen.getByRole('checkbox', { name: 'Bond guides' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('option', { name: 'Property', exact: true })).toHaveProperty('disabled', true);
  });
});
