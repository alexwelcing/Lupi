import { describe, expect, it } from 'vitest';
import { MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import { objectFactsForFile } from './objectFactsForFile';
import { getPerceivedBonds, molecularBondPairs } from '../bonds/perceivedBonds';
import { frameFromAtoms, potassiumSulfonate } from '../bonds/bondFixtures.test-utils';

describe('objectFactsForFile with the molecular graph', () => {
  it('finds no ring through K⁺ once the bonds come from the molecular recipe', () => {
    const frame = frameFromAtoms(potassiumSulfonate(), 'charge=0 multiplicity=1');
    const potassium = 5;
    // Object Facts' own ×1.15 distance bonds close rings through the ion.
    const distance = objectFactsForFile(frame)!;
    expect(distance.rings.some((ring) => ring.atoms.includes(potassium))).toBe(true);

    const perceived = getPerceivedBonds(frame, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.45 })!;
    const molecular = objectFactsForFile(frame, { bondPairs: molecularBondPairs(perceived) })!;
    expect(molecular.rings.some((ring) => ring.atoms.includes(potassium))).toBe(false);
    expect(molecular.provenance.method).toContain('supplied bond');
  });
});
