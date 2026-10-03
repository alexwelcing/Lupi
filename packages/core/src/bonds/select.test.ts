import { describe, expect, it } from 'vitest';
import { DISTANCE_RECIPE_ID, MOLECULAR_RECIPE_ID, selectBondRecipe, type RecipeGateInput } from './index';

const omolFrame: RecipeGateInput = {
  natoms: 46,
  frameCount: 1,
  sourceBondCount: 0,
  inferenceAllowed: true,
  periodic: false,
  chemistry: { totalCharge: 0, spinMultiplicity: 1, source: 'record', domain: 'spice' },
  isOmol25Record: true,
  profile: 'auto',
};

describe('selectBondRecipe', () => {
  it.each<[string, Partial<RecipeGateInput>, ReturnType<typeof selectBondRecipe>]>([
    ['an OMol25 record on auto', {}, MOLECULAR_RECIPE_ID],
    ['source bonds win over everything', { sourceBondCount: 12, profile: 'molecular' }, 'source'],
    ['no inference when it is not allowed', { inferenceAllowed: false }, null],
    ['periodic undefined (not an XYZ frame)', { periodic: undefined }, DISTANCE_RECIPE_ID],
    ['periodic true (Lattice=)', { periodic: true }, DISTANCE_RECIPE_ID],
    ['more than 2,000 atoms', { natoms: 2001 }, DISTANCE_RECIPE_ID],
    ['exactly 2,000 atoms', { natoms: 2000 }, MOLECULAR_RECIPE_ID],
    ['the distance profile', { profile: 'distance' }, DISTANCE_RECIPE_ID],
    ['no declared chemistry on auto', { chemistry: null, isOmol25Record: false }, DISTANCE_RECIPE_ID],
    ['a single-frame file that declares chemistry', { isOmol25Record: false }, MOLECULAR_RECIPE_ID],
    ['a multi-frame file that declares chemistry, on auto', { frameCount: 40, isOmol25Record: false }, DISTANCE_RECIPE_ID],
    ['a multi-frame OMol25 record', { frameCount: 40 }, MOLECULAR_RECIPE_ID],
    ['forced molecular without chemistry', { profile: 'molecular', chemistry: undefined, isOmol25Record: false }, MOLECULAR_RECIPE_ID],
    ['forced molecular with periodic undefined', { profile: 'molecular', periodic: undefined }, DISTANCE_RECIPE_ID],
    ['forced molecular above 2,000 atoms', { profile: 'molecular', natoms: 5000 }, DISTANCE_RECIPE_ID],
  ])('%s', (_label, patch, expected) => {
    expect(selectBondRecipe({ ...omolFrame, ...patch })).toBe(expected);
  });
});
