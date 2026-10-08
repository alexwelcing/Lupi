import { describe, expect, it } from 'vitest';
import { INK_CONTOUR_PIPELINE_ID, INK_CONTOUR_TUNING } from '../postprocess/inkContour';
import {
  CAPTURE_RAW_PIPELINE,
  captureInkContourToSpec,
  captureLookFromSpec,
  captureLookIsEmpty,
  captureLookRunsPass,
  captureLookStructureKey,
  captureLookToSpec,
  resolveCaptureLook,
  type CaptureLookState,
} from './captureLook';

const STATE: CaptureLookState = {
  postprocessPreset: 'studio',
  postprocessIntensity: 1,
  effectOverrides: null,
  cameraPosition: [0, 0, 20],
  cameraTarget: [0, 0, 0],
};

describe('capture look', () => {
  it('applies the configured recipe and no contour while the look is lit', () => {
    const look = resolveCaptureLook({ ...STATE, inkStyle: 'off' }, { transparent: false });
    expect(captureLookIsEmpty(look)).toBe(false);
    expect(look.inkContour).toBeNull();
    expect(captureLookToSpec(look)).toMatchObject({ pipeline: 'viewer-look', toneMapping: 'neutral' });
  });

  it('sets the recipe aside under ink and keeps the contour, opaque or transparent', () => {
    for (const transparent of [false, true]) {
      const look = resolveCaptureLook({ ...STATE, inkStyle: 'hatch' }, { transparent });
      expect(captureLookIsEmpty(look)).toBe(true);
      expect(captureLookRunsPass(look)).toBe(true);
      expect(captureLookToSpec(look)).toEqual({
        pipeline: CAPTURE_RAW_PIPELINE,
        toneMapping: 'none',
        multisampling: 0,
        outputColorSpace: 'srgb',
      });
      expect(look.inkContour).toEqual({ inner: INK_CONTOUR_TUNING.innerLine, outer: INK_CONTOUR_TUNING.outerLine });
    }
  });

  it('round-trips the contour through view.ink', () => {
    const look = resolveCaptureLook({ ...STATE, inkStyle: 'flat' }, { transparent: false });
    const contour = captureInkContourToSpec(look.inkContour!);
    expect(contour).toEqual({ pipeline: INK_CONTOUR_PIPELINE_ID, inner: 1.3, outer: 2.6 });
    const back = captureLookFromSpec(captureLookToSpec(look), { pipeline: 'impostor-ink.v1', contour });
    expect(back).toEqual(look);
  });

  it('draws no contour for a spec without one (lit, or ink before the contour)', () => {
    const lit = resolveCaptureLook(STATE, { transparent: false });
    expect(captureLookFromSpec(captureLookToSpec(lit))).toEqual(lit);
    const before = captureLookFromSpec({ pipeline: 'raw-scene' }, { pipeline: 'impostor-ink.v1' });
    expect(before.inkContour).toBeNull();
    expect(captureLookRunsPass(before)).toBe(false);
    const unknown = captureLookFromSpec({ pipeline: 'raw-scene' }, {
      contour: { pipeline: 'ink-contour.v0', inner: 1, outer: 2 },
    });
    expect(unknown.inkContour).toBeNull();
  });

  it('builds a separate pass graph for the contour', () => {
    const lit = resolveCaptureLook({ ...STATE, postprocessPreset: 'diagram' }, { transparent: false });
    const ink = resolveCaptureLook({ ...STATE, postprocessPreset: 'diagram', inkStyle: 'flat' }, { transparent: false });
    expect(captureLookRunsPass(lit)).toBe(false);
    expect(captureLookStructureKey(ink, false, true)).not.toBe(captureLookStructureKey(lit, false, true));
  });
});
