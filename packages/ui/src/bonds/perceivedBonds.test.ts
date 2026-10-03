import { describe, expect, it } from 'vitest';
import { BOND_KIND, DISTANCE_RECIPE_ID, MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import { createMockFrame } from '@atlas/core/test-utils';
import { getPerceivedBonds, resolveFrameRecipe } from './perceivedBonds';
import { frameFromAtoms, sodiumHexaaqua } from './bondFixtures.test-utils';

describe('getPerceivedBonds', () => {
  it('returns the same object for the same frame, recipe and τ, and a new one when τ changes', () => {
    const frame = frameFromAtoms(sodiumHexaaqua(), 'charge=1 multiplicity=1');
    const first = getPerceivedBonds(frame, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.45 });
    expect(first).not.toBeNull();
    expect(getPerceivedBonds(frame, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.45 })).toBe(first);
    const looser = getPerceivedBonds(frame, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.6 });
    expect(looser).not.toBe(first);
    expect(looser?.params.tolerance).toBe(0.6);
    expect(getPerceivedBonds(frame, { recipe: DISTANCE_RECIPE_ID, tolerance: 0.45 })).not.toBe(first);
  });

  it('draws [Na(H₂O)₆]⁺ as 12 covalent O–H and 6 dotted Na···O contacts, no Na stick', () => {
    const frame = frameFromAtoms(sodiumHexaaqua(), 'charge=1 multiplicity=1');
    const p = getPerceivedBonds(frame, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.45 })!;
    expect(p.counts.covalent).toBe(12);
    expect(p.counts.ionicContact).toBe(6);
    for (let k = 0; k < p.count; k += 1) {
      if (p.pairs[2 * k] === 0) expect(p.kinds[k]).toBe(BOND_KIND.ionicContact);
    }
  });

  it('is null above 2,000 atoms or when an atom type has no element', () => {
    const big = createMockFrame({ natoms: 2001 });
    expect(getPerceivedBonds(big, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.45 })).toBeNull();
    const opaque = { ...createMockFrame({ natoms: 4 }), typeSemantics: { kind: 'opaque', provenance: 'lammps-type-id' } } as const;
    expect(getPerceivedBonds(opaque, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.45 })).toBeNull();
  });
});

describe('resolveFrameRecipe', () => {
  const salt = () => frameFromAtoms(sodiumHexaaqua(), 'charge=1 multiplicity=1');

  it('auto picks molecular for a single non-periodic frame that declares chemistry', () => {
    const frame = salt();
    expect(frame.periodic).toBe(false);
    expect(resolveFrameRecipe(frame, { profile: 'auto', frameCount: 1 })).toBe(MOLECULAR_RECIPE_ID);
    expect(resolveFrameRecipe(frame, { profile: 'auto', frameCount: 5 })).toBe(DISTANCE_RECIPE_ID);
    expect(resolveFrameRecipe(frame, { profile: 'distance', frameCount: 1 })).toBe(DISTANCE_RECIPE_ID);
  });

  it('keeps distance without chemistry on auto, and molecular when forced', () => {
    const plain = frameFromAtoms(sodiumHexaaqua(), 'water around sodium');
    expect(plain.chemistry).toBeUndefined();
    expect(resolveFrameRecipe(plain, { profile: 'auto', frameCount: 1 })).toBe(DISTANCE_RECIPE_ID);
    expect(resolveFrameRecipe(plain, { profile: 'molecular', frameCount: 1 })).toBe(MOLECULAR_RECIPE_ID);
  });

  it('lets source bonds win and periodic or unparsed frames stay on distance', () => {
    const frame = salt();
    expect(resolveFrameRecipe({ ...frame, bonds: new Int32Array([0, 1]) }, { profile: 'molecular', frameCount: 1 })).toBe('source');
    expect(resolveFrameRecipe({ ...frame, periodic: true }, { profile: 'molecular', frameCount: 1 })).toBe(DISTANCE_RECIPE_ID);
    expect(resolveFrameRecipe({ ...frame, periodic: undefined }, { profile: 'auto', frameCount: 1 })).toBe(DISTANCE_RECIPE_ID);
  });
});
