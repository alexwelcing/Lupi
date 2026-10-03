import {
  ACUTE_ANGLE_DEG,
  CLASH_FLOOR_A,
  DEFAULT_BOND_TOLERANCE,
  ION_CONTACT_MARGIN_A,
} from './classes';
import { clampBondTolerance } from './perceive';
import { DISTANCE_RECIPE_ID, MOLECULAR_RECIPE_ID, type BondRecipeId } from './types';

const angstrom = (value: number) => `${value.toFixed(2)} Å`;

/**
 * The Learn paragraph "How these bonds were drawn", written from the same
 * constants the recipe runs on so the copy cannot drift from the rule.
 */
export function bondMethodParagraph(params?: { tolerance?: number }): string {
  const tolerance = clampBondTolerance(params?.tolerance ?? DEFAULT_BOND_TOLERANCE);
  return [
    'Lupi infers these bonds; OMol25 provides none.',
    `Two atoms are bonded when they are closer than their covalent radii (Cordero 2008) plus ${angstrom(tolerance)}, and never closer than ${angstrom(CLASH_FLOOR_A)}.`,
    'Each hydrogen keeps only its least-stretched partner, the one closest relative to its usual bond length.',
    `When two bonds leave a non-metal atom less than ${ACUTE_ANGLE_DEG}° apart, the more stretched one is dropped.`,
    'An atom over its usual valence loses its most stretched bonds first.',
    'Lithium, sodium, potassium, magnesium and calcium are treated as ions: they get dotted ionic contacts to nearby oxygen, nitrogen, sulfur, phosphorus and halogen atoms, never bonds.',
    'Transition metals get dashed coordination lines.',
  ].join(' ');
}

/** The "Copy method" citation: the recipe, its parameters and, for an OMol25 record, the source row. */
export function bondMethodSentence(opts: {
  recipe: BondRecipeId;
  tolerance: number;
  collection?: string | null;
  row?: number | null;
}): string {
  const tolerance = clampBondTolerance(opts.tolerance);
  const method = opts.recipe === MOLECULAR_RECIPE_ID
    ? `Bonds inferred by Lupi (${MOLECULAR_RECIPE_ID}: Cordero 2008 covalent radii + ${angstrom(tolerance)}; `
      + 'one least-stretched partner per H; valence caps; s-block ionic contacts at Shannon 1976 ionic-radius sums '
      + `(N: CN4; P: Pauling) + ${angstrom(ION_CONTACT_MARGIN_A)}).`
    : `Bond guides drawn by Lupi (${DISTANCE_RECIPE_ID}: Cordero 2008 covalent radii + ${angstrom(tolerance)}, distance only).`;
  if (!opts.collection || opts.row === null || opts.row === undefined) return method;
  return `${method} Coordinates, charge and spin: OMol25 (Levine et al., arXiv:2505.08762, CC BY 4.0), ${opts.collection} row ${opts.row}.`;
}
