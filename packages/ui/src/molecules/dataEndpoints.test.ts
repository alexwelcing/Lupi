import { describe, expect, it } from 'vitest';
import { nistCatalogUrl, nistDemoUrl, scienceDataUrl } from './dataEndpoints';

describe('scientific data endpoints', () => {
  it('resolves relative NIST demo paths under the same configured catalog base', () => {
    expect(nistCatalogUrl()).toBe('/nist/nist_catalog.json');
    expect(nistDemoUrl('demos/Fe/example.glimbin')).toBe('/nist/demos/Fe/example.glimbin');
    expect(nistDemoUrl('/demos/Cu/example.glimbin')).toBe('/nist/demos/Cu/example.glimbin');
  });

  it('preserves externally hosted NIST demos and same-origin science routes', () => {
    expect(nistDemoUrl('https://storage.googleapis.com/lupi-nist/example.glimbin'))
      .toBe('https://storage.googleapis.com/lupi-nist/example.glimbin');
    expect(scienceDataUrl('v1/datasets/research')).toBe('/v1/datasets/research');
  });
});
