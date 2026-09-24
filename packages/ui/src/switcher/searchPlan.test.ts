import { describe, expect, it } from 'vitest';
import type { SwitchJudgment } from './judgeSwitch';
import { EMPTY_CONTROLS, formatValue, organize, rowBadge, rowReason } from './searchPlan';
import { galleryPool, type SwitchCandidate } from './switchIndex';

// These run against the real gallery pool and the checked-in library facts,
// so they double as a check that the facts file still says what the
// switcher promises ("metal", "floats", "aerospace").
const pool = galleryPool();
const keys = (list: SwitchCandidate[]) => list.map((candidate) => candidate.key.replace('gallery:', ''));

function judgment(rank: Partial<NonNullable<SwitchJudgment['rank']>>): SwitchJudgment {
  return {
    configured: true,
    rank: {
      mode: { choice: 'filter', confidence: 0.99, ranking: 0.99 },
      property: { choice: 'other', confidence: 0.99 },
      has: {},
      kind: {},
      ...rank,
    },
  };
}

describe('organize', () => {
  it('stays out of the way with no filters, plan, or sort', () => {
    expect(organize(pool.slice(0, 3), pool, null)).toBeNull();
    expect(organize(pool.slice(0, 3), pool, { configured: true, best: null })).toBeNull();
  });

  it('filters the library by a tapped facet without Jev', () => {
    const organized = organize([], pool, null, { ...EMPTY_CONTROLS, chips: ['metal'] })!;
    expect(keys(organized.ordered)).toEqual(expect.arrayContaining(['al_polycrystal', 'sand_w_cascade', 'mlip_mg_slip_playthrough']));
    expect(keys(organized.ordered)).not.toContain('caffeine');
    expect(organized.filters).toEqual([{ id: 'metal', source: 'you', weight: 1 }]);
    expect(rowReason(organized, organized.rows['gallery:al_polycrystal'])).toBe('✓ metal');
  });

  it('turns Jev-read facets into removable filters and sorts by a measured value', () => {
    // "lightest metal": Jev reads metal and chooses density, lowest first.
    const read = judgment({ mode: { choice: 'least', confidence: 0.99, ranking: 0.99 }, property: { choice: 'density', confidence: 0.99 }, asks: { metal: 0.97, solid_rt: 0.4 }, kind: { 'gallery:al_polycrystal': 0.82, 'gallery:sand_w_cascade': 0.7, 'gallery:oxygen': 0.02 } });
    const organized = organize([], pool, read)!;
    expect(organized.filters).toEqual([{ id: 'metal', source: 'jev', weight: 0.97 }]);
    expect(organized.sort).toEqual({ by: 'density', direction: 'least' });
    expect(organized.sortSource).toBe('jev');
    expect(keys(organized.ordered)[0]).toBe('mlip_mg_slip_playthrough');
    expect(rowBadge(organized, organized.rows['gallery:mlip_mg_slip_playthrough'])).toEqual({ text: '1.74 g/cm³', kind: 'measured' });
    expect(organized.summary).toContain('density, lowest first');

    const dismissed = organize([], pool, read, { ...EMPTY_CONTROLS, dismissed: ['metal'] })!;
    // Without the facet, the live per-candidate group judgment decides who is compared.
    expect(dismissed.filters).toEqual([]);
    expect(keys(dismissed.ordered)).toEqual(['al_polycrystal', 'sand_w_cascade']);
    const flipped = organize([], pool, read, { ...EMPTY_CONTROLS, sort: { by: 'density', direction: 'most' } })!;
    expect(keys(flipped.ordered)[0]).toBe('sand_w_cascade');
    expect(flipped.sortSource).toBe('you');
  });

  it('keeps near misses of a soft reading, demoted and marked partial', () => {
    // "flammable liquid that floats": Jev over-reads "fuel" at 0.76.
    const read = judgment({ asks: { flammable: 0.98, liquid_rt: 0.96, floats: 0.92, fuel: 0.76 } });
    const organized = organize([], pool, read)!;
    const found = keys(organized.ordered);
    expect(found).toEqual(expect.arrayContaining(['limonene', 'benzene']));
    expect(found).not.toContain('water');
    const limonene = organized.rows['gallery:limonene'];
    expect(limonene.missing).toContain('fuel');
    expect(rowBadge(organized, limonene)).toEqual({ text: 'partial', kind: 'partial' });
    expect(rowReason(organized, limonene)).toContain('✗ fuel');
  });

  it('ignores facets implied by a named lookup', () => {
    const caffeine = judgment({ mode: { choice: 'lookup', confidence: 1, ranking: 0 }, asks: { alkaloid: 0.9, in_food: 0.85 } });
    expect(organize(pool.slice(0, 3), pool, caffeine)).toBeNull();
  });

  it('orders an unmeasurable superlative by Jev within the facet group', () => {
    const hardest = judgment({ mode: { choice: 'most', confidence: 0.99, ranking: 0.99 }, asks: { hard: 0.9 }, has: { 'gallery:diamond_crystal': 0.78, 'gallery:sand_w_cascade': 0.56 } });
    const organized = organize([], pool, hardest)!;
    expect(keys(organized.ordered)[0]).toBe('diamond_crystal');
    expect(rowBadge(organized, organized.rows['gallery:diamond_crystal'])).toEqual({ text: 'Jev 78%', kind: 'inferred' });
  });

  it('sorts the current list alone when only a sort is chosen', () => {
    const list = pool.filter((candidate) => ['water', 'glucose', 'caffeine'].includes(candidate.key.replace('gallery:', '')));
    const organized = organize(list, pool, null, { ...EMPTY_CONTROLS, sort: { by: 'molar_mass', direction: 'least' } })!;
    expect(keys(organized.ordered)).toEqual(['water', 'glucose', 'caffeine']);
  });

  it('formats values', () => {
    expect(formatValue('boiling_point', -183)).toBe('−183 °C');
    expect(formatValue('density', 0.00143)).toBe('0.0014 g/cm³');
    expect(formatValue('size', 953312)).toBe('953,312 atoms');
  });
});
