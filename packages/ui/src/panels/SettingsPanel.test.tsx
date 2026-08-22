/**
 * SettingsPanel tests — persistence toggle, reset-to-defaults, and the
 * per-atom-type rows for a loaded file.
 */
import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { SettingsPanel } from './SettingsPanel';
import { resetStore, getStoreState, setStoreState } from '../test-utils';

function loadMockFile() {
  const trajectory = createMockTrajectory(1, 4);
  const frame = trajectory.frames[0];
  frame.types = new Int32Array([29, 29, 8, 8]);
  frame.typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
  frame.distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };
  setStoreState({ file: { name: 'mock.xyz', size: 128, trajectory, thermo: null } });
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flips the persistSettings store flag from the toggle', () => {
    render(<SettingsPanel />);

    const toggle = screen.getByRole('switch', { name: 'Remember settings on this device' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(getStoreState().persistSettings).toBe(false);

    fireEvent.click(screen.getByRole('switch', { name: 'Remember settings on this device' }));
    expect(getStoreState().persistSettings).toBe(true);
  });

  it('resets a changed setting to defaults via the danger button (confirm accepted)', () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    getStoreState().setPostprocessPreset('cinematic');
    render(<SettingsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all settings to defaults' }));

    expect(getStoreState().postprocessPreset).toBe('studio');
  });

  it('does not reset when the confirm dialog is declined', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    getStoreState().setPostprocessPreset('cinematic');
    render(<SettingsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all settings to defaults' }));

    expect(getStoreState().postprocessPreset).toBe('cinematic');
  });

  it('shows an empty hint when no file is loaded', () => {
    render(<SettingsPanel />);
    expect(screen.getByText(/Load a molecule or run/)).toBeTruthy();
  });

  it('renders a row per present atom type and toggles visibility through the store', () => {
    loadMockFile();
    render(<SettingsPanel />);

    const cuToggle = screen.getByRole('switch', { name: 'Cu visible' });
    const oToggle = screen.getByRole('switch', { name: 'O visible' });
    expect(screen.getByText(/Copper/)).toBeTruthy();
    expect(screen.getByText(/Oxygen/)).toBeTruthy();
    expect(cuToggle.getAttribute('aria-checked')).toBe('true');
    expect(oToggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(cuToggle);
    expect(getStoreState().hiddenAtomTypes.has(29)).toBe(true);
    expect(getStoreState().hiddenAtomTypes.has(8)).toBe(false);
    expect(screen.getByRole('switch', { name: 'Cu visible' }).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(getStoreState().hiddenAtomTypes.size).toBe(0);
  });

  it('drives the per-type radius scale through the store', () => {
    loadMockFile();
    render(<SettingsPanel />);

    const slider = screen.getByLabelText('Cu radius', { exact: false });
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(getStoreState().atomTypeScales[29]).toBe(1.5);
  });
});
