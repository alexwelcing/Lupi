import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { resetStore } from './test-utils';
import { useStore } from './store';
import { currentSceneLook, inkStyleForLook, lookForInkStyle, SCENE_LOOKS, sceneLookPatch } from './sceneLooks';
import { PAPER_PLATE_PRESET_ID, SAGE_PLATE_PRESET_ID } from './backgroundPresets';

describe('learner scene looks', () => {
  beforeEach(resetStore);
  it.each(SCENE_LOOKS)('$id changes appearance without changing science or the camera', ({ id }) => {
    const file = { name: 'source.xyz', size: 100, trajectory: createMockTrajectory(2, 24), thermo: null };
    useStore.getState().setFile(file);
    useStore.setState({ frame: 1, colorMode: 'property', colorProperty: 'energy', showBonds: false, selectedAtoms: [2], hiddenAtomTypes: [8], atomScale: 1.4 });
    const before = useStore.getState();
    useStore.setState(sceneLookPatch(id, 24));
    const after = useStore.getState();
    for (const key of ['file', 'frame', 'colorMode', 'colorProperty', 'showBonds', 'selectedAtoms', 'hiddenAtomTypes', 'atomScale', 'cameraPosition', 'cameraTarget'] as const) {
      expect(after[key]).toBe(before[key]);
    }
    expect(currentSceneLook(after)).toBe(id);
    expect(after).toMatchObject({ bloom: false, dof: false, environmentPreset: 'softbox' });
  });
  it.each(SCENE_LOOKS)('$id keeps one rig at every scale', ({ id }) => {
    expect(sceneLookPatch(id, 200_000)).toEqual(sceneLookPatch(id, 24));
  });
  it('maps each ink shading to its Look and back; every other Look is lit', () => {
    for (const style of ['flat', 'hatch', 'engrave', 'halftone'] as const) {
      const look = lookForInkStyle(style);
      expect(inkStyleForLook(look)).toBe(style);
      expect(sceneLookPatch(look, 24).inkStyle).toBe(style);
    }
    expect(lookForInkStyle('off')).toBe('studio');
    for (const id of ['studio', 'paper', 'night', 'prism'] as const) expect(inkStyleForLook(id)).toBe('off');
    expect(sceneLookPatch('ink', 24).backgroundPreset).toBe(SAGE_PLATE_PRESET_ID);
    for (const id of ['sketch', 'engrave', 'halftone'] as const) {
      expect(sceneLookPatch(id, 24).backgroundPreset).toBe(PAPER_PLATE_PRESET_ID);
    }
  });
  it('a new molecule keeps an Engrave or Halftone look', () => {
    for (const id of ['engrave', 'halftone'] as const) {
      useStore.setState(sceneLookPatch(id, 24));
      useStore.getState().setFile({ name: `${id}.xyz`, size: 100, trajectory: createMockTrajectory(1, 24), thermo: null });
      expect(useStore.getState().inkStyle).toBe(id);
      expect(currentSceneLook(useStore.getState())).toBe(id);
    }
  });
  it('saved scene state remains authoritative after a fresh file default', () => {
    useStore.setState(sceneLookPatch('night', 24));
    useStore.setState({ keyLightAzimuth: -65, atomScale: 1.25 });
    const encoded = useStore.getState().encodeToURL();
    useStore.getState().setFile({ name: 'restored.xyz', size: 100, trajectory: createMockTrajectory(1, 24), thermo: null });
    expect(currentSceneLook(useStore.getState())).toBe('studio');
    useStore.getState().decodeFromURL(encoded);
    expect(useStore.getState()).toMatchObject({ backgroundPreset: 'slate', keyLightAzimuth: -65, atomScale: 1.25 });
    expect(currentSceneLook(useStore.getState())).toBeNull();
  });
});
