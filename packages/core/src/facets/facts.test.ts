import { describe, expect, it } from 'vitest';
import {
  FACT_STORE_FLOOR,
  QUERY_EXCLUDED_FACETS,
  derivedFacts,
  enrichmentRequest,
  facetCounts,
  facetMatch,
  facetScore,
  mergeFacts,
  missingFacets,
  parseFacetMap,
  queryFacetQuestions,
  readEnrichment,
  readQueryFacets,
  requiredFacets,
  subjectHash,
} from './facts';
import { FACETS, facetById, taxonomyFingerprint } from './taxonomy';

describe('taxonomy', () => {
  it('has unique ids, a label, and a predicate for every facet', () => {
    expect(new Set(FACETS.map((facet) => facet.id)).size).toBe(FACETS.length);
    for (const facet of FACETS) {
      expect(facet.label).toBeTruthy();
      expect(facet.predicate).toMatch(/^[a-z]/);
    }
    expect(facetById('metal')?.group).toBe('kind');
    expect(taxonomyFingerprint()).toMatch(/^facets-v1:[0-9a-f]{8}$/);
  });
});

describe('enrichment', () => {
  it('asks one Noul per facet about the entry, and keeps only the likely ones', () => {
    const request = enrichmentRequest({ title: 'Caffeine', formula: 'C8H10N4O2' });
    expect(Object.keys(request.questions)).toEqual(FACETS.map((facet) => facet.id));
    expect(request.state).toEqual({ entry: { title: 'Caffeine', formula: 'C8H10N4O2' } });
    const answers = Object.fromEntries(FACETS.map((facet) => [facet.id, { type: 'noul' as const, noul: facet.id === 'alkaloid' ? 0.914 : 0.1 }]));
    expect(readEnrichment({ model: 'jev-1.13.0', answers })).toEqual({ alkaloid: 0.91 });
  });

  it('changes the subject hash only when the subject changes', () => {
    const a = subjectHash({ title: 'Water', formula: 'H2O', evidence: { density_g_per_cm3: 0.997 } });
    expect(subjectHash({ formula: 'H2O', title: 'Water', evidence: { density_g_per_cm3: 0.997 } })).toBe(a);
    expect(subjectHash({ title: 'Water', formula: 'H2O', evidence: { density_g_per_cm3: 1 } })).not.toBe(a);
  });
});

describe('derived facts', () => {
  it('lets the reference sheet decide phase, melting, solubility, and floating', () => {
    expect(derivedFacts({ phase: 'solid', density: 2.7, meltingPoint: 660, water: 'insoluble' })).toEqual({
      gas_rt: 0, liquid_rt: 0, solid_rt: 0.99, high_melting: 0, water_soluble: 0, floats: 0,
    });
    expect(derivedFacts({ phase: 'solid', density: 0.917, water: 'miscible' }).floats).toBe(0.95); // ice
    expect(derivedFacts({ phase: 'liquid', density: 0.789, water: 'miscible' }).floats).toBe(0); // ethanol mixes in
    expect(derivedFacts({ phase: 'liquid', density: 0.841, water: 'insoluble' }).floats).toBe(0.95); // limonene
    expect(derivedFacts({ phase: 'liquid', density: 0.9 }).floats).toBeUndefined(); // unknown: Jev decides
    expect(derivedFacts(undefined)).toEqual({});
  });

  it('overrides Jev and drops what falls under the floor', () => {
    // Jev said aluminium floats at 0.59; the sheet says 2.70 g/cm³.
    expect(mergeFacts({ metal: 0.97, floats: 0.59 }, { floats: 0, solid_rt: 0.99 })).toEqual({ metal: 0.97, solid_rt: 0.99 });
  });
});

describe('query facets', () => {
  it('never asks whether a request wants a small molecule', () => {
    const ids = Object.keys(queryFacetQuestions());
    expect(ids).toHaveLength(FACETS.length - QUERY_EXCLUDED_FACETS.length);
    expect(ids).not.toContain('ask:small_molecule');
    expect(JSON.stringify(queryFacetQuestions())).toContain('`request.query`');
  });

  it('reads and thresholds what the request asks for', () => {
    const answers = { 'ask:metal': { type: 'noul' as const, noul: 0.97 }, 'ask:aerospace': { type: 'noul' as const, noul: 0.72 }, 'ask:toxic': { type: 'noul' as const, noul: 0.1 } };
    const asked = readQueryFacets({ model: 'jev-1.13.0', answers });
    expect(asked).toEqual({ metal: 0.97, aerospace: 0.72 });
    expect(requiredFacets(asked)).toEqual(['metal', 'aerospace']);
    expect(requiredFacets(asked, 0.9)).toEqual(['metal']);
    expect(parseFacetMap({ metal: 0.5, nope: 1, toxic: 2 })).toEqual({ metal: 0.5 });
  });
});

describe('matching', () => {
  const limonene = { flammable: 0.81, liquid_rt: 0.99, floats: 0.95 };

  it('scores a soft AND that demotes rather than deletes an over-read facet', () => {
    const asks = { flammable: 0.95, liquid_rt: 0.98, floats: 0.87, fuel: 0.9 };
    const score = facetScore(limonene, asks);
    expect(score).toBeGreaterThan(0.05);
    expect(score).toBeLessThan(0.2);
    expect(facetScore(limonene, { flammable: 0.95, liquid_rt: 0.98, floats: 0.87 })).toBeGreaterThan(0.75);
    expect(facetScore(limonene, { metal: 1 })).toBe(0);
    expect(facetScore(undefined, { metal: 0.9 })).toBe(0);
    expect(facetScore(undefined, {})).toBe(1);
    expect(missingFacets(limonene, asks)).toEqual(['fuel']);
  });

  it('keeps the hard AND and the counts for chips and coverage', () => {
    expect(facetMatch(limonene, ['floats', 'liquid_rt'])).toBe(0.95);
    expect(facetMatch(limonene, ['floats', 'metal'])).toBe(0);
    expect(facetMatch(undefined, [])).toBe(1);
    expect(Object.fromEntries(facetCounts([limonene, { floats: 0.4 }, undefined]))).toEqual({ flammable: 1, liquid_rt: 1, floats: 1 });
    expect(FACT_STORE_FLOOR).toBeLessThan(0.5);
  });
});
