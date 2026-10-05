import { describe, expect, it } from 'vitest';

import { isScaleRoute, isScanRoute, libraryCollectionFromRoute, SCALE_PATH } from './viewerRoutes';

describe('scale route', () => {
  it('matches /scale with or without a trailing slash or query, and nothing near it', () => {
    expect(SCALE_PATH).toBe('/scale');
    expect(isScaleRoute('/scale')).toBe(true);
    expect(isScaleRoute('/scale/')).toBe(true);
    expect(isScaleRoute('/scale?ref=lsr1:TFNS')).toBe(true);
    expect(isScaleRoute('/scales')).toBe(false);
    expect(isScaleRoute('/scale/extra')).toBe(false);
    expect(isScaleRoute('/scan')).toBe(false);
    expect(isScaleRoute('/')).toBe(false);
  });

  it('leaves the routes around it alone', () => {
    expect(isScanRoute('/scale')).toBe(false);
    expect(libraryCollectionFromRoute('/scale')).toBe(null);
  });
});
