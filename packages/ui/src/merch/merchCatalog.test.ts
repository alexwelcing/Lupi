import { describe, it, expect } from 'vitest';
import {
  MERCH_PRODUCTS,
  molCode,
  skuFor,
  titleFor,
  handleFor,
  tagsFor,
  priceTier,
  printSpecFor,
} from './merchCatalog';

describe('molCode', () => {
  it('uses the codes already seeded in the store', () => {
    expect(molCode('caffeine')).toBe('CAF');
    expect(molCode('Creatine')).toBe('CRE');
    expect(molCode('serotonin')).toBe('SER');
    expect(molCode('MCP: Caffeine')).toBe('CAF');
  });
  it('falls back to a stable 3-letter code for unknown molecules', () => {
    expect(molCode('Xenon')).toBe('XEN');
    expect(molCode('Li')).toBe('LIX');
  });
});

describe('SKU / title / handle match the store conventions', () => {
  it('reproduces the existing Caffeine Mug variant SKUs exactly', () => {
    const mug = MERCH_PRODUCTS.mug;
    const skus = mug.buildVariants().map((v) => skuFor('Caffeine', mug, v));
    expect(skus).toEqual(['LUPI-CAF-MUG-11oz', 'LUPI-CAF-MUG-15oz']);
  });
  it('reproduces the tee SKU shape (size + color code)', () => {
    const tee = MERCH_PRODUCTS.tee;
    const first = tee.buildVariants()[0];
    expect(skuFor('Creatine', tee, first)).toBe('LUPI-CRE-TEE-S-BLK');
  });
  it('builds titles and handles like the seeded drafts', () => {
    expect(titleFor('caffeine', MERCH_PRODUCTS.mug)).toBe('Caffeine Molecule Mug');
    expect(handleFor('serotonin', MERCH_PRODUCTS.poster)).toBe('serotonin-molecule-poster');
  });
});

describe('pricing tiers', () => {
  it('maps prices to the store tier-N tags', () => {
    expect(priceTier(16.99)).toBe('tier-1');
    expect(priceTier(24.99)).toBe('tier-2');
    expect(priceTier(29.99)).toBe('tier-3');
    expect(priceTier(39.99)).toBe('tier-4');
  });
  it('tags a listing with category, molecule, and tier', () => {
    const tags = tagsFor('Caffeine', MERCH_PRODUCTS.mug);
    expect(tags).toContain('mug');
    expect(tags).toContain('molecule art');
    expect(tags).toContain('caffeine');
    expect(tags).toContain('tier-1');
  });
});

describe('Gooten print specs', () => {
  it('gives each mug size its own wrap dimensions', () => {
    const mug = MERCH_PRODUCTS.mug;
    const [oz11, oz15] = mug.buildVariants();
    expect(printSpecFor(mug, oz11).widthPx).toBe(2700);
    expect(printSpecFor(mug, oz15).widthPx).toBe(2963);
  });
  it('scales poster print files per size at 300 DPI', () => {
    const poster = MERCH_PRODUCTS.poster;
    const big = poster.buildVariants().find((v) => v.title === '24x36')!;
    const spec = printSpecFor(poster, big);
    expect(spec.widthPx).toBe(7200);   // 24in * 300
    expect(spec.heightPx).toBe(10800); // 36in * 300
    expect(spec.background).not.toBe('transparent'); // posters print opaque
  });
});
