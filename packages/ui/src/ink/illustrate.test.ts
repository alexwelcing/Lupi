import { beforeEach, describe, expect, it } from 'vitest';
import { resetStore } from '../test-utils';
import { useStore } from '../store';
import {
  chooseInkStyle,
  inkParamValue,
  inkStyleLabel,
  intakeInkParam,
  rememberInkStyle,
  setIllustrate,
  toggleIllustrate,
} from './illustrate';

describe('the Illustrate look on and off', () => {
  beforeEach(() => {
    resetStore();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('gives each shading its short-link letter, and none while lit', () => {
    expect(inkParamValue('off')).toBeNull();
    expect(inkParamValue('flat')).toBe('f');
    expect(inkParamValue('hatch')).toBe('h');
    expect(inkParamValue('engrave')).toBe('e');
    expect(inkParamValue('halftone')).toBe('d');
    useStore.getState().setInkStyle('halftone');
    expect(inkParamValue()).toBe('d');
  });

  it('takes ?ink= from the address bar for every shading and drops it', () => {
    for (const [letter, style] of [['f', 'flat'], ['h', 'hatch'], ['e', 'engrave'], ['d', 'halftone']] as const) {
      resetStore();
      window.history.replaceState({}, '', `/?sim=caffeine&ink=${letter}`);
      expect(intakeInkParam()).toBe(true);
      expect(useStore.getState().inkStyle).toBe(style);
      expect(window.location.search).toBe('?sim=caffeine');
    }
    resetStore();
    window.history.replaceState({}, '', '/?ink=x');
    expect(intakeInkParam()).toBe(false);
    expect(useStore.getState().inkStyle).toBe('off');
    expect(window.location.search).toBe('');
    expect(intakeInkParam()).toBe(false);
  });

  it('brings back the last shading used when Ink turns on again', () => {
    setIllustrate(true);
    expect(useStore.getState().inkStyle).toBe('flat');
    for (const style of ['engrave', 'halftone', 'hatch'] as const) {
      chooseInkStyle(style);
      toggleIllustrate();
      expect(useStore.getState().inkStyle).toBe('off');
      toggleIllustrate();
      expect(useStore.getState().inkStyle).toBe(style);
    }
    // A Look sets the shading directly; Ink off then on still brings it back.
    useStore.getState().setInkStyle('engrave');
    setIllustrate(false);
    setIllustrate(true);
    expect(useStore.getState().inkStyle).toBe('engrave');
    // So does a Look followed by a lit Look (the ink driver remembers each drawing).
    useStore.getState().setInkStyle('halftone');
    rememberInkStyle('halftone');
    useStore.getState().setInkStyle('off');
    rememberInkStyle('off');
    toggleIllustrate();
    expect(useStore.getState().inkStyle).toBe('halftone');
  });

  it('names every shading for the pill', () => {
    expect(['off', 'flat', 'hatch', 'engrave', 'halftone'].map((style) => inkStyleLabel(style as never)))
      .toEqual(['Lit', 'Illustrate', 'Sketch', 'Engrave', 'Halftone']);
  });
});
