import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { useStore, applyStateDelta, buildStateDelta } from './store';
import { resetStore } from './test-utils';
import { BG_PRESETS, getBgMedia } from './backgroundPresets';
import { remixScene, snapshotRemix, REMIX_KEYS } from './sceneRemix';

describe('presentation-only scene remix', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().setFile({ name: 'test.xyz', size: 100, trajectory: createMockTrajectory(2, 24), thermo: null });
  });
  it('preserves the existing color encoding when colors are locked, along with data and camera', () => {
    useStore.setState({ frame: 1, colorScheme: 'property', colorProperty: 'energy', selectedAtoms: [1], hiddenAtomTypes: new Set([6]) });
    const before = useStore.getState();
    const positions = before.file!.trajectory.frames[0].positions.slice();
    const backgrounds = new Set();
    const materials = new Set();
    for (let seed = 0; seed < 25; seed++) {
      let value = (seed + 1) * 9876543;
      const random = () => ((value = (value * 16807) % 2147483647) - 1) / 2147483646;
      const patch = remixScene(useStore.getState(), false, random, false);
      expect(Object.keys(patch).sort()).toEqual([...REMIX_KEYS].sort());
      expect(getBgMedia(BG_PRESETS[patch.backgroundPreset]).kind).toBe('gradient');
      expect(patch.backgroundPreset).not.toBe(useStore.getState().backgroundPreset);
      useStore.setState(patch);
      backgrounds.add(patch.backgroundPreset);
      materials.add(patch.materialPreset);
    }
    expect(backgrounds.size).toBeGreaterThan(6);
    expect(materials.size).toBeGreaterThan(3);
    for (const key of ['file', 'frame', 'colorScheme', 'colorProperty', 'selectedAtoms', 'hiddenAtomTypes', 'showBonds', 'atomScale', 'cameraPosition', 'cameraTarget'] as const) {
      expect(useStore.getState()[key]).toBe(before[key]);
    }
    expect(useStore.getState().file!.trajectory.frames[0].positions).toEqual(positions);
  });
  it('exactly restores custom visual settings, including effect overrides', () => {
    useStore.setState({ effectOverrides: { preset: 'paper', glow: true, glowStrength: .7 }, surfaceClearcoat: .67 });
    const before = snapshotRemix(useStore.getState());
    useStore.setState(remixScene(useStore.getState()));
    useStore.setState(before);
    expect(snapshotRemix(useStore.getState())).toEqual(before);
  });
  it('remixes atom colors by default, never repeats the palette, and restores its prior meaning on undo', () => {
    useStore.setState({ colorScheme: 'property', colorMode: 'property', colorProperty: 'energy' });
    const before = snapshotRemix(useStore.getState());
    const file = useStore.getState().file;
    for (let index = 0; index < 15; index++) {
      const previous = useStore.getState().colormap;
      useStore.setState(remixScene(useStore.getState(), false, () => index / 15));
      expect(useStore.getState().colormap).not.toBe(previous);
      expect(useStore.getState().file).toBe(file);
    }
    expect(useStore.getState()).toMatchObject({ colorScheme: 'colorway', colorMode: 'type', colorProperty: null });
    useStore.setState(before);
    expect(useStore.getState()).toMatchObject({ colorScheme: 'property', colorMode: 'property', colorProperty: 'energy' });
  });
  it('can select media only when explicitly included', () => {
    let foundMedia = false;
    for (let value = 0; value < 1; value += .01) {
      const patch = remixScene(useStore.getState(), true, () => value);
      foundMedia ||= getBgMedia(BG_PRESETS[patch.backgroundPreset]).kind !== 'gradient';
    }
    expect(foundMedia).toBe(true);
  });
  it('round-trips live effect overrides without exporting device power preferences', () => {
    const effectOverrides = { preset: 'paper' as const, glow: true, glowStrength: .85, toneMapping: 'reinhard' as const };
    useStore.setState({ effectOverrides, fullSceneEffects: true });
    const delta = buildStateDelta(useStore.getState());
    expect(applyStateDelta(delta).effectOverrides).toEqual(effectOverrides);
    expect(applyStateDelta(delta)).not.toHaveProperty('fullSceneEffects');
    useStore.getState().setPostprocessPreset('cinematic');
    expect(useStore.getState().effectOverrides).toBeNull();
  });
});
