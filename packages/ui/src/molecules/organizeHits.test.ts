import { describe, expect, it } from 'vitest';
import { organizeHits } from './organizeHits';
import type { MoleculeHit } from './types';

const hit = (id: string, source: MoleculeHit['source'] = 'gallery', formula?: string): MoleculeHit => ({ id, source, title: id, formula, load: { kind: 'url', url: `/${id}.xyz` } });

describe('organizeHits', () => {
  const hits = [hit('caffeine', 'gallery', 'C8H10N4O2'), hit('al_polycrystal'), hit('sand_w_cascade'), hit('mlip_mg_slip_playthrough'), hit('aspirin', 'pubchem', 'C9H8O4')];

  it('leaves hits alone without facets or a sort, but attaches facts', () => {
    const organized = organizeHits(hits, {});
    expect(organized.map((h) => h.id)).toEqual(hits.map((h) => h.id));
    expect(organized[0].facts?.facets).toContain('alkaloid');
    expect(organized[0].facts?.molarMass).toBeCloseTo(194.2, 1);
    expect(organized[4].facts).toEqual({ facets: [], molarMass: expect.closeTo(180.16, 1) });
  });

  it('filters by facets and sorts by a measured value', () => {
    const metals = organizeHits(hits, { facets: ['metal', 'not-a-facet'], sortBy: 'density', order: 'asc' });
    expect(metals.map((h) => h.id)).toEqual(['mlip_mg_slip_playthrough', 'al_polycrystal', 'sand_w_cascade']);
    expect(metals[0].facts?.density).toBe(1.738);
    const aircraft = organizeHits(hits, { facets: ['metal', 'aerospace'] });
    expect(aircraft.map((h) => h.id)).toEqual(expect.arrayContaining(['al_polycrystal', 'mlip_mg_slip_playthrough']));
    expect(aircraft.map((h) => h.id)).not.toContain('sand_w_cascade');
  });

  it('sorts hits without a value last', () => {
    const byMass = organizeHits(hits, { sortBy: 'molar_mass' });
    expect(byMass.slice(0, 2).map((h) => h.id)).toEqual(['caffeine', 'aspirin']);
  });
});
