import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { ViewerPanelBody } from './ViewerPanelBody';
import { useStore } from './store';
import { playStore } from './play/playStore';
import { resetStore } from './test-utils';
import { createMockTrajectory } from '@atlas/core/test-utils';

function load(frames = 1) {
  const trajectory = createMockTrajectory(frames, 3);
  for (const f of trajectory.frames) {
    f.ids = new Int32Array([10, 20, 30]);
    f.types = new Int32Array([6, 7, 8]);
    f.identity = { kind: 'source-id', unique: true };
    f.typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
    f.distanceSemantics = { kind: 'angstrom', provenance: 'source-declared' };
    f.positions = new Float32Array([0, 0, 0, 3, 4, 0, 0, 0, 2]);
  }
  useStore.getState().setFile({ name: 'test.xyz', size: 0, thermo: null, trajectory });
  useStore.setState({ activePanel: 'telemetry', playing: true });
}
function DataPanel() {
  const activePanel = useStore(s => s.activePanel);
  return <ViewerPanelBody activePanel={activePanel} studioDeck={null} />;
}
function choose(letter: string, label: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: `Choose atom ${letter}` }));
  fireEvent.click(screen.getByRole('button', { name: label }));
}
beforeEach(() => { cleanup(); resetStore(); });
describe('Data measurement workspace', () => {
  it('preserves ordinary atom selection when leaving Data without measuring', () => {
    load(); useStore.setState({ selectedAtoms: [1] }); render(<DataPanel />);
    act(() => useStore.setState({ activePanel: null }));
    expect(useStore.getState().selectedAtoms).toEqual([1]);
  });
  it('has no measurement controls outside Data and disarms when Data closes or changes', () => {
    load(); render(<DataPanel />);
    expect(screen.queryByRole('button', { name: 'Measure', exact: true })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Distance A–B' }));
    choose('A', /C · ID 10/); choose('B', /N · ID 20/);
    fireEvent.click(screen.getByRole('button', { name: 'Choose atom A' }));
    const measurement = useStore.getState().measurement;
    act(() => useStore.setState({ activePanel: null }));
    expect(useStore.getState()).toMatchObject({ measurementTool: null, measurementTarget: null, measurement });
    expect(screen.queryByRole('region', { name: 'Measure atoms' })).toBeNull();
    act(() => useStore.setState({ activePanel: 'telemetry' }));
    expect(screen.getByText('5.000 Å')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose atom A' }));
    act(() => useStore.setState({ activePanel: 'equilibrium' }));
    expect(useStore.getState().measurementTool).toBeNull();
    expect(useStore.getState().measurement).toBe(measurement);
  });
  it('starts picking A with one visible action and keeps exact selection available', () => {
    load(); render(<DataPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Distance A–B', exact: true }));
    expect(useStore.getState()).toMatchObject({ playing: false, measurementTool: 'distance', measurementTarget: 0, activePanel: 'telemetry' });
    expect((screen.getByRole('button', { name: 'Choose atom B' }) as HTMLButtonElement).disabled).toBe(true);
    choose('A', /C · ID 10/);
    choose('B', /N · ID 20/);
    expect(screen.getByText('5.000 Å')).toBeTruthy();
    expect(useStore.getState().measurementTool).toBeNull();
    choose('A', /O · ID 30/);
    expect(screen.getByText('5.385 Å')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear measurement' }));
    expect(useStore.getState().measurement).toBeNull();
    expect(screen.getByRole('button', { name: 'Distance A–B', exact: true })).toBeTruthy();
  });
  it('pauses at the middle source frame and preserves stable endpoints', () => {
    load(5);
    useStore.getState().file!.trajectory.frames[2].positions[3] = 6;
    useStore.getState().file!.trajectory.frames[2].positions[4] = 8;
    render(<DataPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Distance A–B', exact: true }));
    choose('A', /C · ID 10/); choose('B', /N · ID 20/);
    fireEvent.click(screen.getByRole('button', { name: 'Middle frame' }));
    expect(useStore.getState()).toMatchObject({ frame: 2, playing: false });
    expect(screen.getByText('10.00 Å')).toBeTruthy();
    expect(screen.getByText(/Δ \+5.000 Å vs capture frame 1/)).toBeTruthy();
  });
  it('does not pretend row-only references track a trajectory or unknown units are Å', () => {
    load(3);
    for (const frame of useStore.getState().file!.trajectory.frames) {
      frame.identity = undefined;
      frame.distanceSemantics = undefined;
    }
    render(<DataPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Distance A–B', exact: true }));
    choose('A', /C · row 1/); choose('B', /N · row 2/);
    expect(screen.getByText('5.000 source units')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Middle frame' }));
    expect(screen.queryByText(/Δ/)).toBeNull();
    expect(screen.getByText(/cannot be matched honestly/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Capture frame' }));
    expect(screen.getByText('5.000 source units')).toBeTruthy();
  });

  it('reveals an explicitly chosen hidden atom and restores picking when rearming', () => {
    load(); useStore.setState({ hiddenAtomTypes: new Set([7, 8]) });
    render(<DataPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Distance A–B', exact: true }));
    choose('A', /C · ID 10/);
    choose('B', /N · ID 20.*hidden: reveal/);
    expect([...useStore.getState().hiddenAtomTypes]).toEqual([8]);
    playStore.getState().setVerb('tug');
    playStore.getState().setTrayOpen(true);
    fireEvent.click(screen.getByRole('button', { name: 'Choose atom A' }));
    expect(playStore.getState()).toMatchObject({ verb: 'orbit', trayOpen: false });
    expect(screen.getByRole('textbox', { name: 'Find atom' })).toBeTruthy();
  });

});
