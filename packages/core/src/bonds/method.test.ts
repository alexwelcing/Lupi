import { describe, expect, it } from 'vitest';
import {
  CLASH_FLOOR_A,
  DEFAULT_BOND_TOLERANCE,
  DISTANCE_RECIPE_ID,
  MOLECULAR_RECIPE_ID,
  bondMethodParagraph,
  bondMethodSentence,
} from './index';

describe('bond method copy', () => {
  it('writes the Learn paragraph from the recipe constants', () => {
    const paragraph = bondMethodParagraph();
    expect(paragraph).toContain('least-stretched');
    expect(paragraph).toContain('most stretched bonds');
    expect(paragraph).toContain('45°');
    expect(paragraph).toContain(`plus ${DEFAULT_BOND_TOLERANCE.toFixed(2)} Å`);
    expect(paragraph).toContain(`never closer than ${CLASH_FLOOR_A.toFixed(2)} Å`);
    expect(paragraph.startsWith('Lupi infers these bonds; OMol25 provides none.')).toBe(true);
    expect(bondMethodParagraph({ tolerance: 0.6 })).toContain('plus 0.60 Å');
  });

  it('cites the recipe, its parameters and the OMol25 row', () => {
    const sentence = bondMethodSentence({ recipe: MOLECULAR_RECIPE_ID, tolerance: 0.45, collection: 'neutral-validation', row: 273 });
    expect(sentence).toBe(
      'Bonds inferred by Lupi (lupi-bonds.molecular.v1: Cordero 2008 covalent radii + 0.45 Å; one least-stretched partner per H; '
      + 'valence caps; s-block ionic contacts at Shannon 1976 ionic-radius sums (N: CN4; P: Pauling) + 0.35 Å). '
      + 'Coordinates, charge and spin: OMol25 (Levine et al., arXiv:2505.08762, CC BY 4.0), neutral-validation row 273.',
    );
    expect(bondMethodSentence({ recipe: MOLECULAR_RECIPE_ID, tolerance: 0.6 })).not.toContain('OMol25');
    expect(bondMethodSentence({ recipe: DISTANCE_RECIPE_ID, tolerance: 0.45 })).toContain(DISTANCE_RECIPE_ID);
  });
});
