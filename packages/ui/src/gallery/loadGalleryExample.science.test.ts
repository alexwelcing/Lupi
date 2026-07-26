import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { useStore } from '../store';
import { resetStore } from '../test-utils';
import { EXAMPLES, type GalleryExample } from './catalog';
import { attachScienceBundle } from './loadGalleryExample';

const z1 = (id: string): GalleryExample => {
  const example = EXAMPLES.find((e) => e.id === id);
  if (!example) throw new Error(`gallery entry ${id} missing`);
  return example;
};

function loadMockFile(frameCount: number) {
  useStore.getState().setFile({
    name: 'z1-path-16.extxyz',
    size: 10315,
    trajectory: createMockTrajectory(frameCount, 51),
    thermo: null,
  });
}

describe('attachScienceBundle (gallery load path)', () => {
  beforeEach(() => resetStore());

  it('attaches the validated bundle and opens the SCIENCE deck section', () => {
    loadMockFile(5);
    attachScienceBundle(z1('z1_science_path_16'));

    const state = useStore.getState();
    expect(state.file?.science?.path.pathIndex).toBe(16);
    expect(state.file?.science?.path.imageCount).toBe(5);
    expect(state.activePanel).toBe('science');
  });

  it('binds every golden gallery entry to its own path', () => {
    for (const [id, index, frames] of [
      ['z1_science_path_16', 16, 5],
      ['z1_science_path_0', 0, 7],
      ['z1_science_path_14', 14, 7],
      ['z1_science_path_27', 27, 5],
    ] as const) {
      resetStore();
      loadMockFile(frames);
      attachScienceBundle(z1(id));
      expect(useStore.getState().file?.science?.path.pathIndex).toBe(index);
    }
  });

  it('keeps the SCIENCE section open when a second science path loads over the first', () => {
    loadMockFile(5);
    attachScienceBundle(z1('z1_science_path_16'));
    expect(useStore.getState().activePanel).toBe('science');
    // The toggling setter would have closed it; the load path must not.
    loadMockFile(7);
    attachScienceBundle(z1('z1_science_path_0'));
    const state = useStore.getState();
    expect(state.activePanel).toBe('science');
    expect(state.file?.science?.path.pathIndex).toBe(0);
  });

  it('fails closed — no science — when the trajectory frame count disagrees with the image count', () => {
    loadMockFile(4); // path 16 declares 5 NEB images
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    attachScienceBundle(z1('z1_science_path_16'));

    const state = useStore.getState();
    expect(state.file?.science).toBeUndefined();
    expect(state.activePanel).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[science-panel] trajectory/science mismatch — failing closed:'),
    );
    errorSpy.mockRestore();
  });

  it('is a no-op for ordinary gallery entries', () => {
    loadMockFile(5);
    const plain = EXAMPLES.find((e) => e.sciencePathIndex == null && e.available && !e.route)!;
    attachScienceBundle(plain);
    expect(useStore.getState().file?.science).toBeUndefined();
    expect(useStore.getState().activePanel).toBeNull();
  });
});
