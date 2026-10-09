import { MOLECULAR_RECIPE_MAX_ATOMS } from './classes';
import { DISTANCE_RECIPE_ID, MOLECULAR_RECIPE_ID, type BondRecipeId, type RecipeGateInput } from './types';

/**
 * Which bond rule a frame gets. Source bonds always win; then the molecular
 * recipe needs a non-periodic XYZ frame (`periodic === false`, which only the
 * XYZ parser sets) of at most 2,000 atoms. Forced, it applies to any such
 * frame; on auto it also needs declared chemistry and a single frame or an
 * OMol25 record. Everything else keeps the distance recipe.
 */
export function selectBondRecipe(input: RecipeGateInput): BondRecipeId | 'source' | null {
  if (input.sourceBondCount > 0) return 'source';
  if (!input.inferenceAllowed) return null;
  if (input.profile === 'distance' || input.natoms > MOLECULAR_RECIPE_MAX_ATOMS || input.periodic !== false) {
    return DISTANCE_RECIPE_ID;
  }
  if (input.profile === 'molecular') return MOLECULAR_RECIPE_ID;
  if (input.chemistry && (input.frameCount === 1 || input.isOmol25Record)) return MOLECULAR_RECIPE_ID;
  return DISTANCE_RECIPE_ID;
}
