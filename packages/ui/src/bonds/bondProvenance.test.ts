import { describe, expect, it } from 'vitest';
import { MOLECULAR_RECIPE_ID, type PerceivedBonds } from '@atlas/core/bonds';
import type { FrameChemistry, FrameSourceRecord } from '@atlas/core/types';
import { bondMethodCopy } from './BondMethodSection';
import { bondLegendCopy } from './BondLegendHUD';
import { omol25SourceRows } from '../omol25/Omol25SourceCard';
import { OMOL25_RANDOM_ROWS, uniformRandomInt } from '../molecules/randomOmol';
import { getPerceivedBonds } from './perceivedBonds';
import { frameFromAtoms, sodiumHexaaqua } from './bondFixtures.test-utils';

const RECORD: FrameSourceRecord = {
  dataset: 'omol25', collection: 'neutral-validation', row: 812, method: 'ωB97M-V',
  energyEv: -12345.678, maxForceEvPerA: 2.81, homoLumoGapEv: 8.34, license: 'CC-BY-4.0',
  source: 'colabfit/OMol25_neutral_validation',
};
const CHEMISTRY: FrameChemistry = { totalCharge: 0, spinMultiplicity: 1, source: 'record', domain: 'spice' };

function salt(): PerceivedBonds {
  const frame = frameFromAtoms(sodiumHexaaqua(), 'charge=1 multiplicity=1');
  return getPerceivedBonds(frame, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.45 })!;
}

describe('Learn: How these bonds were drawn', () => {
  it('states counts, inputs, what is not claimed, how sure, and the citable method', () => {
    const copy = bondMethodCopy(salt(), { chemistry: CHEMISTRY, sourceRecord: RECORD });
    expect(copy.paragraph.startsWith('Lupi infers these bonds; OMol25 provides none.')).toBe(true);
    expect(copy.counts).toBe('This structure: 12 bonds · 0 metal–ligand · 6 ionic contacts · 0 long bonds · 0 removed by the rule · 0 clashes.');
    expect(copy.inputs).toBe('Inputs from OMol25: charge 0, spin multiplicity 1 (from the record).');
    expect(copy.notClaimed).toBe('Not claimed: bond orders, hydrogen bonds.');
    expect(copy.longBonds).toBeNull();
    expect(copy.clashes).toBeNull();
    expect(copy.howSure).toMatch(/^On all 27,697 OMol25 neutral-validation structures: no hydrogen with two bonds, no over-valent atom, no covalent stick to an s-block ion; [\d.]+% of ions have 1 or more contacts\.$/);
    expect(copy.method).toContain('neutral-validation row 812');
  });

  it('adds the s-block–carbon clause, long bonds, clashes and the reaction-path caveat when they apply', () => {
    const base = salt();
    const counts = { ...base.counts, ionCarbonClose: 1, long: 2, clashes: 1 };
    const copy = bondMethodCopy({ ...base, counts }, {
      chemistry: { ...CHEMISTRY, source: 'split-definition', domain: 'reactivity' },
      sourceRecord: RECORD,
    });
    expect(copy.notClaimed).toBe('Not claimed: bond orders, hydrogen bonds, or carbon bonds to lithium or magnesium (organometallic s-block bonds are not drawn).');
    expect(copy.longBonds).toBe('2 bonds are more than 0.20 Å longer than usual: this is a snapshot away from equilibrium, or a bond is breaking.');
    expect(copy.clashes).toBe('Atoms closer than 0.40 Å — likely a coordinate problem in the source.');
    expect(copy.domainCaveat).toBe('Reaction-path snapshot: stretched bonds may be absent.');
    expect(copy.inputs).toContain('(by split definition)');
  });

  it('says the file, not OMol25, for other files, and scopes How sure to the validated tolerance', () => {
    const frame = frameFromAtoms(sodiumHexaaqua(), 'charge=1');
    const looser = getPerceivedBonds(frame, { recipe: MOLECULAR_RECIPE_ID, tolerance: 0.6 })!;
    const copy = bondMethodCopy(looser, frame);
    expect(copy.paragraph.startsWith('Lupi infers these bonds; the file provides none.')).toBe(true);
    expect(copy.inputs).toBe('Inputs from the file: charge +1, spin multiplicity not recorded (declared by the file).');
    expect(copy.howSure?.startsWith('At the default 0.45 Å tolerance, on all 27,697')).toBe(true);
  });
});

describe('bond legend copy', () => {
  it('names the inference, the adjusted tolerance and what the source supplied', () => {
    const omol = bondLegendCopy({ frame: { chemistry: CHEMISTRY, sourceRecord: RECORD }, mode: 'molecular', tolerance: 0.45 });
    expect(omol.title).toBe('Bonds inferred from DFT geometry · Lupi v1');
    expect(omol.collapsed).toBe('Inferred bonds');
    expect(omol.supplies).toBe('OMol25 supplies coordinates, charge 0 and spin multiplicity 1 — not bonds.');
    const adjusted = bondLegendCopy({ frame: { chemistry: CHEMISTRY, sourceRecord: RECORD }, mode: 'molecular', tolerance: 0.6 });
    expect(adjusted.collapsed).toBe('Inferred bonds · adjusted (+0.60 Å)');
    expect(bondLegendCopy({ frame: {}, mode: 'distance', tolerance: 0.45 }).collapsed).toBe('Distance-only guides');
  });
});

describe('OMol25 source card', () => {
  it('reads the record and chemistry the frame already holds', () => {
    const rows = omol25SourceRows({ chemistry: CHEMISTRY, sourceRecord: RECORD })!;
    expect(rows.record).toBe('Neutral validation (neutral-validation) · row 812');
    expect(rows.chargeSpin).toBe('neutral singlet (from the record)');
    expect(rows.gap).toBe('8.34 eV');
    expect(rows.force).toBe('Snapshot away from a minimum: largest force 2.8 eV/Å');
    expect(rows.energy).toContain('not comparable across formulas');
    expect(omol25SourceRows({ chemistry: CHEMISTRY })).toBeNull();
  });

  it('picks random rows inside the neutral training split', () => {
    // The card's Random OMol25 opens through molecules/randomOmol.
    const limit = 2 ** 32 - (2 ** 32 % OMOL25_RANDOM_ROWS);
    expect(uniformRandomInt(OMOL25_RANDOM_ROWS, () => 0)).toBe(0);
    expect(uniformRandomInt(OMOL25_RANDOM_ROWS, () => limit - 1)).toBe(34_335_827);
  });
});
