import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_Z1_SCIENCE_PATH_INDEX,
  scienceBundleForPathIndex,
  scienceGalleryIdForPathIndex,
  sciencePathIndexForGalleryId,
  validatedScienceFixture,
} from './scienceBundle';
import fixtureJson from './z1GoldenPanelFixture.json';

/** Deep clone so each corruption case starts from the real, valid fixture. */
const freshFixture = () => JSON.parse(JSON.stringify(fixtureJson));

describe('scienceBundle fixture binding', () => {
  it('resolves every golden path from the shipped, validated fixture', () => {
    const expected: Record<number, { pathId: string; imageCount: number }> = {
      16: { pathId: 'mp-760344_10_4_0_1_0', imageCount: 5 },
      0: { pathId: 'mp-761269_2_1_1_-1_0', imageCount: 7 },
      14: { pathId: 'mp-756912_1_1_1_0_0', imageCount: 7 },
      27: { pathId: 'mp-752552_0_7_0_0_1', imageCount: 5 },
    };
    for (const [index, want] of Object.entries(expected)) {
      const bundle = scienceBundleForPathIndex(Number(index));
      expect(bundle, `path ${index}`).not.toBeNull();
      expect(bundle!.path.pathId).toBe(want.pathId);
      expect(bundle!.path.imageCount).toBe(want.imageCount);
      expect(bundle!.fixture.campaign).toBeTruthy();
    }
  });

  it('carries the exact dense-extension sets from the campaign record', () => {
    // Reviewer-pinned values: evaluated-beyond-union indices per golden path.
    expect(scienceBundleForPathIndex(0)!.path.anchors.denseExtensionImages).toEqual([1, 5]);
    expect(scienceBundleForPathIndex(14)!.path.anchors.denseExtensionImages).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(scienceBundleForPathIndex(16)!.path.anchors.denseExtensionImages).toEqual([]);
    expect(scienceBundleForPathIndex(27)!.path.anchors.denseExtensionImages).toEqual([]);
  });

  it('keeps model / GPAW anchors / VASP as separate series with extrema and barriers', () => {
    for (const index of [16, 0, 27]) {
      const { path } = scienceBundleForPathIndex(index)!;
      const ids = path.series.map((s) => s.id);
      expect(ids).toContain('vasp-reference');
      expect(ids).toContain('gpaw-anchors');
      expect(ids.filter((id) => id.startsWith('model-'))).toHaveLength(4);
      for (const id of ids) {
        const ex = path.extrema[id];
        expect(ex, `extrema for ${id} on path ${index}`).toBeTruthy();
        expect(ex.argmin).toBeGreaterThanOrEqual(0);
        expect(ex.argmax).toBeGreaterThanOrEqual(0);
        expect(ex.argmin).toBeLessThan(path.imageCount);
        expect(ex.argmax).toBeLessThan(path.imageCount);
        expect(ex.barrierEv).not.toBeNull();
        expect(ex.tieRule).toBe('first-index');
      }
    }
    // Path 14: all four guides failed — no model series, honest 0-of-4 denominator.
    const fourteen = scienceBundleForPathIndex(14)!;
    expect(fourteen.path.series.map((s) => s.id).sort()).toEqual(['gpaw-anchors', 'vasp-reference']);
    expect(fourteen.path.quality.guidedModelCount).toBe(0);
    expect(fourteen.path.quality.modelDenominator).toBe(4);
  });

  it('returns null for an unknown path index without logging', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(scienceBundleForPathIndex(99)).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('fails closed on a corrupted fixture and logs the precise error paths', () => {
    const corrupted = freshFixture();
    corrupted.paths[0].series[0].points.pop();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(scienceBundleForPathIndex(16, corrupted)).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[science-panel] fixture invalid — failing closed:',
      expect.arrayContaining([expect.stringContaining('imageCount')]),
    );
    errorSpy.mockRestore();
  });

  it('fails closed on an unknown schema version', () => {
    const corrupted = freshFixture();
    corrupted.schema = 'lupi.z1-science-panel-fixture.v999';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(validatedScienceFixture(corrupted)).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[science-panel] fixture invalid — failing closed:',
      expect.arrayContaining([expect.stringContaining('$.schema')]),
    );
    errorSpy.mockRestore();
  });
});

describe('scienceBundle route ⇄ gallery mapping', () => {
  it('maps each golden path index to its gallery id', () => {
    expect(scienceGalleryIdForPathIndex(16)).toBe('z1_science_path_16');
    expect(scienceGalleryIdForPathIndex(0)).toBe('z1_science_path_0');
    expect(scienceGalleryIdForPathIndex(14)).toBe('z1_science_path_14');
    expect(scienceGalleryIdForPathIndex(27)).toBe('z1_science_path_27');
    expect(scienceGalleryIdForPathIndex(3)).toBeNull();
  });

  it('round-trips gallery id → path index', () => {
    for (const index of [16, 0, 14, 27]) {
      expect(sciencePathIndexForGalleryId(`z1_science_path_${index}`)).toBe(index);
    }
    expect(sciencePathIndexForGalleryId('c60_buckyball')).toBeNull();
  });

  it('keeps the default science route target inside the golden set', () => {
    expect(scienceGalleryIdForPathIndex(DEFAULT_Z1_SCIENCE_PATH_INDEX)).not.toBeNull();
  });
});
