import { describe, expect, it } from 'vitest';

import {
  isScienceDemoRoute,
  isSciencePanelRoute,
  sciencePathIndexFromRoute,
} from './viewerRoutes';

describe('science panel normalized routes', () => {
  it('matches the canonical #/science/<index> form', () => {
    expect(isSciencePanelRoute('/science/16')).toBe(true);
    expect(isSciencePanelRoute('/science/27')).toBe(true);
    expect(isSciencePanelRoute('/science/')).toBe(false);
    expect(isSciencePanelRoute('/science/x16')).toBe(false);
    expect(isSciencePanelRoute('/science/16/extra')).toBe(false);
    expect(isSciencePanelRoute('/demo/science-panel')).toBe(false);
  });

  it('parses the zero-based path index from the canonical route', () => {
    expect(sciencePathIndexFromRoute('/science/16')).toBe(16);
    expect(sciencePathIndexFromRoute('/science/0')).toBe(0);
    expect(sciencePathIndexFromRoute('/science/27?path=16')).toBe(27);
    expect(sciencePathIndexFromRoute('/science/-1')).toBeNull();
    expect(sciencePathIndexFromRoute('/science/1.5')).toBeNull();
    expect(sciencePathIndexFromRoute('/demo/science-panel')).toBeNull();
    expect(sciencePathIndexFromRoute('/')).toBeNull();
  });

  it('keeps the legacy demo forms working as aliases', () => {
    expect(isScienceDemoRoute('/', '?demo=science-panel')).toBe(true);
    expect(isScienceDemoRoute('/demo/science-panel', '')).toBe(true);
    expect(isScienceDemoRoute('/science/27', '')).toBe(true);
    expect(isScienceDemoRoute('/', '')).toBe(false);
  });
});
