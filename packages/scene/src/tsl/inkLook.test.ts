import { afterEach, describe, expect, it } from 'vitest';
import { beginCaptureRender } from '../captureGuards';
import { INK_LOOK, INK_LOOK_COLORS, inkLookInkHex, inkLookTarget, isInkLookFading, setInkLookTarget } from './inkLook';

describe('the Illustrate look target', () => {
  afterEach(() => {
    setInkLookTarget({ mix: 0, hatch: 0, weight: 1 });
    INK_LOOK.uInkMix.value = 0;
    INK_LOOK.uInkChalk.value = 0;
  });

  it('keeps the chalk weight, and absent shadings are 0', () => {
    setInkLookTarget({ mix: 1, hatch: 0, chalk: 1, weight: 1.2 });
    expect(inkLookTarget()).toEqual({ mix: 1, hatch: 0, engrave: 0, halftone: 0, chalk: 1, weight: 1.2 });
    setInkLookTarget({ mix: 1, hatch: 1, weight: 1 });
    expect(inkLookTarget().chalk).toBe(0);
  });

  it('renders every capture at the configured chalk weight, never a fade', () => {
    setInkLookTarget({ mix: 1, hatch: 0, chalk: 1, weight: 1 });
    INK_LOOK.uInkMix.value = 1;
    INK_LOOK.uInkChalk.value = 0.3;
    expect(isInkLookFading()).toBe(true);
    const restore = beginCaptureRender();
    expect(INK_LOOK.uInkChalk.value).toBe(1);
    restore();
    expect(INK_LOOK.uInkChalk.value).toBe(0.3);
  });

  it('draws Chalk in chalk and every other drawing in the house ink', () => {
    expect(inkLookInkHex('chalk')).toBe(INK_LOOK_COLORS.chalk);
    for (const shading of ['flat', 'hatch', 'engrave', 'halftone']) expect(inkLookInkHex(shading)).toBe(INK_LOOK_COLORS.ink);
    expect(INK_LOOK_COLORS.chalk).not.toBe(INK_LOOK_COLORS.ink);
  });
});
