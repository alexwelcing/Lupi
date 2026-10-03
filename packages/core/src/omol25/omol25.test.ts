import { describe, expect, it } from 'vitest';
import {
  OMOL25_CITATION,
  OMOL25_COLLECTIONS,
  OMOL25_COLLECTION_IDS,
  OMOL25_COORDINATE_TRUTH,
  OMOL25_FEATURED_SCHEMA,
  OMOL25_MASTHEAD_BOND_SENTENCE,
  OMOL25_NEUTRAL_ELEMENTS,
  OMOL25_PAPER_URL,
  isOmol25Url,
  omolAttribution,
  omolBondTruth,
  omolCardTruth,
  omolChargeSourcePhrase,
  omolChargeSpin,
  omolDomainCaveat,
  omolDomainLabel,
  omolFeaturedCoverage,
  omolGeometryState,
  omolPickKey,
  omolShelfPick,
  omolSpinWord,
  omolStructurePath,
  omolTitle,
  parseOmolFormula,
  parseOmolStructurePath,
  validateOmolFeaturedFile,
  validateOmolFeaturedPick,
  validateOmolShelfPicks,
  type OmolFeaturedPickV1,
} from './index';

function pick(overrides: Partial<OmolFeaturedPickV1> = {}): OmolFeaturedPickV1 {
  return {
    id: 'omol25_nv_273',
    collection: 'neutral-validation',
    dataset: 'colabfit/OMol25_neutral_validation',
    row: 273,
    configurationId: 'CO_8517675436137263722228071',
    propertyId: 'PO_1005851510665885380677870',
    formula: 'C21H15KN4O4S',
    atoms: 46,
    elements: ['C', 'H', 'K', 'N', 'O', 'S'],
    shelf: 'salt-complexes',
    home: true,
    domain: 'orbnet_denali',
    domainLabel: 'OrbNet Denali',
    charge: 0,
    spinMultiplicity: 1,
    chargeSource: 'record',
    energyEv: -63330.86111298835,
    maxForceEvPerA: 3.0829408336136006,
    homoLumoGapEv: 6.386757202393212,
    title: 'C21H15KN4O4S',
    name: null,
    xyz: '/datasets/omol25/featured/omol25_nv_273.xyz',
    edge: '/v1/datasets/omol25/neutral-validation/structures/273.xyz',
    ink: '/og/omol25/omol25_nv_273-ink.svg',
    sha256: 'a'.repeat(64),
    fetchedAt: '2026-10-03T12:00:00.000Z',
    bondRecipe: 'lupi-bonds.molecular.v1',
    ...overrides,
  };
}

describe('OMol25 collections', () => {
  it('lists the five collections with the source row counts', () => {
    expect(OMOL25_COLLECTION_IDS).toEqual([
      'neutral-train', 'neutral-validation', 'all-train-preview', 'train-4m-preview', 'validation-preview',
    ]);
    expect(OMOL25_COLLECTIONS.map((c) => c.sourceRows)).toEqual([34_335_828, 27_697, 101_666_280, 3_986_754, 2_762_021]);
    expect(OMOL25_COLLECTIONS.map((c) => c.hfEstimatedRows)).toEqual([34_335_828, 27_697, 65_331_709, 2_657_915, 1_842_258]);
    expect(OMOL25_COLLECTIONS.map((c) => c.indexedRows)).toEqual([34_335_828, 27_697, 841_736, 1_000_000, 800_000]);
    expect(OMOL25_COLLECTIONS.every((c) => c.license === 'CC-BY-4.0')).toBe(true);
    expect(OMOL25_COLLECTIONS.filter((c) => c.coverage === 'complete').map((c) => c.id)).toEqual(['neutral-train', 'neutral-validation']);
    expect(OMOL25_NEUTRAL_ELEMENTS).toHaveLength(17);
  });
});

describe('OMol25 truth strings', () => {
  it('match the frozen contract exactly', () => {
    expect(OMOL25_CITATION).toBe('Levine et al. 2025, The Open Molecules 2025 (OMol25) Dataset, arXiv:2505.08762');
    expect(OMOL25_PAPER_URL).toBe('https://arxiv.org/abs/2505.08762');
    expect(OMOL25_COORDINATE_TRUTH).toBe('Source DFT coordinates (ωB97M-V/def2-TZVPD, OMol25).');
    expect(omolBondTruth()).toBe(
      'OMol25 supplies no bonds. Lines are Lupi\'s inference (lupi-bonds.molecular.v1): dotted lines are ionic contacts, dashed lines metal coordination.',
    );
    expect(omolCardTruth()).toBe('Source DFT coordinates, charge and spin. OMol25 supplies no bonds; Lupi infers them and labels them.');
    expect(OMOL25_MASTHEAD_BOND_SENTENCE).toBe('OMol25 supplies no bond topology; Lupi infers bonds with a published rule and labels them.');
  });

  it('keep the phrases existing tests and pages pin', () => {
    expect(OMOL25_MASTHEAD_BOND_SENTENCE).toContain('OMol25 supplies no bond topology');
    expect(omolBondTruth()).toContain('OMol25 supplies no bonds');
    expect(omolCardTruth()).toContain('OMol25 supplies no bonds');
    expect(omolAttribution()).toContain('arXiv:2505.08762');
    expect(omolAttribution()).toContain('CC BY 4.0');
  });

  it('states the geometry from the largest force', () => {
    expect(omolGeometryState(3.0829)).toBe('Snapshot away from a minimum: largest force 3.1 eV/Å');
    expect(omolGeometryState(0.5)).toBe('Snapshot away from a minimum: largest force 0.5 eV/Å');
    expect(omolGeometryState(0.3612)).toBe('Near a minimum: largest force 0.36 eV/Å');
    expect(omolGeometryState(null)).toBeNull();
    expect(omolGeometryState(Number.NaN)).toBeNull();
  });

  it('words charge and spin without the ColabFit multiplicity column', () => {
    expect(omolChargeSpin({ totalCharge: 0, spinMultiplicity: 1, source: 'record' })).toBe('neutral singlet');
    expect(omolChargeSpin({ totalCharge: 1, spinMultiplicity: 2, source: 'record' })).toBe('charge +1 · doublet');
    expect(omolChargeSpin({ totalCharge: -2, spinMultiplicity: 3, source: 'record' })).toBe('charge −2 · triplet');
    expect(omolChargeSpin({ totalCharge: 0, spinMultiplicity: 1, source: 'unavailable' })).toBe('charge and spin not recorded');
    expect(omolChargeSpin({ totalCharge: null, spinMultiplicity: 2, source: 'file-declared' })).toBe('doublet');
    expect(omolSpinWord(4)).toBe('quartet');
    expect(omolSpinWord(11)).toBe('spin multiplicity 11');
    expect(omolChargeSourcePhrase('split-definition')).toBe('by split definition');
    expect(omolChargeSourcePhrase('record')).toBe('from the record');
  });

  it('adds the reaction-path caveat only for reaction-path domains', () => {
    for (const domain of ['reactivity', 'trans1x', 'rgd']) {
      expect(omolDomainCaveat(domain)).toBe('Reaction-path snapshot: stretched bonds may be absent.');
    }
    expect(omolDomainCaveat('spice')).toBeNull();
    expect(omolDomainCaveat(null)).toBeNull();
    expect(omolDomainLabel('orbnet_denali')).toBe('OrbNet Denali');
    expect(omolDomainLabel('new_subset')).toBe('new subset');
    expect(omolDomainLabel(null)).toBe('OMol25');
  });
});

describe('OMol25 URLs', () => {
  it('builds keys, titles and edge paths', () => {
    expect(omolPickKey(273)).toBe('omol25_nv_273');
    expect(omolTitle('C21H15KN4O4S')).toBe('C21H15KN4O4S (OMol25)');
    expect(omolStructurePath('neutral-train', 5)).toBe('/v1/datasets/omol25/neutral-train/structures/5.xyz');
  });

  it('parses edge and featured paths, relative or absolute', () => {
    expect(parseOmolStructurePath('/v1/datasets/omol25/neutral-train/structures/5.xyz'))
      .toEqual({ collection: 'neutral-train', row: 5, featured: false });
    expect(parseOmolStructurePath('https://lupi.live/v1/datasets/omol25/validation-preview/structures/2.xyz?x=1'))
      .toEqual({ collection: 'validation-preview', row: 2, featured: false });
    expect(parseOmolStructurePath('/datasets/omol25/featured/omol25_nv_273.xyz'))
      .toEqual({ collection: 'neutral-validation', row: 273, featured: true });
    expect(isOmol25Url('https://lupi.live/datasets/omol25/featured/omol25_nv_0.xyz')).toBe(true);
  });

  it('rejects unknown collections, rows past the index and other dataset paths', () => {
    expect(parseOmolStructurePath('/v1/datasets/omol25/not-real/structures/5.xyz')).toBeNull();
    expect(parseOmolStructurePath('/v1/datasets/omol25/neutral-validation/structures/27697.xyz')).toBeNull();
    expect(parseOmolStructurePath('/datasets/omol25/featured/omol25_nv_99999.xyz')).toBeNull();
    expect(isOmol25Url('/datasets/omol25/neutral-validation.v4.json')).toBe(false);
    expect(isOmol25Url('/gallery/curated/caffeine.xyz')).toBe(false);
    expect(isOmol25Url('//lupi.live/v1/datasets/omol25/neutral-train/structures/5.xyz')).toBe(false);
    expect(isOmol25Url('javascript:alert(1)')).toBe(false);
  });
});

describe('featured picks contract', () => {
  it('accepts a well-formed pick and file', () => {
    expect(validateOmolFeaturedPick(pick())).toEqual([]);
    expect(validateOmolFeaturedFile({
      schema: OMOL25_FEATURED_SCHEMA,
      license: 'CC-BY-4.0',
      citation: OMOL25_CITATION,
      picks: [pick(), pick({ id: 'omol25_nv_0', row: 0, xyz: '/datasets/omol25/featured/omol25_nv_0.xyz', edge: '/v1/datasets/omol25/neutral-validation/structures/0.xyz', ink: '/og/omol25/omol25_nv_0-ink.svg' })],
    })).toEqual([]);
  });

  it('rejects broken fields', () => {
    expect(validateOmolFeaturedPick(pick({ atoms: 45 }))).toEqual([expect.stringContaining('formula atom count')]);
    expect(validateOmolFeaturedPick(pick({ id: 'omol25_nv_272' }))).toEqual([expect.stringContaining('id must be')]);
    expect(validateOmolFeaturedPick(pick({ title: 'Potassium salt' }))).toEqual([expect.stringContaining('Hill formula')]);
    expect(validateOmolFeaturedPick(pick({ xyz: '/datasets/omol25/x.xyz' }))).toEqual([expect.stringContaining('xyz must be')]);
    expect(validateOmolFeaturedPick(pick({ elements: ['C', 'H', 'K', 'N', 'O', 'Fe'] }))).toHaveLength(1);
    expect(validateOmolFeaturedPick({ ...pick(), bondRecipe: 'lupi-bonds.distance.v1' })).toHaveLength(1);
    expect(validateOmolFeaturedFile({ schema: 'x', license: 'CC-BY-4.0', citation: OMOL25_CITATION, picks: [pick(), pick()] }))
      .toEqual(expect.arrayContaining([expect.stringContaining('schema'), expect.stringContaining('duplicate id')]));
  });

  it('derives the landing slice and validates it', () => {
    const shelf = omolShelfPick(pick());
    expect(shelf).toEqual({
      id: 'omol25_nv_273',
      title: 'C21H15KN4O4S',
      formula: 'C21H15KN4O4S',
      atoms: 46,
      elements: ['C', 'H', 'K', 'N', 'O', 'S'],
      shelf: 'salt-complexes',
      home: true,
      domainLabel: 'OrbNet Denali',
      charge: 0,
      spinMultiplicity: 1,
      file: '/datasets/omol25/featured/omol25_nv_273.xyz',
      ink: '/og/omol25/omol25_nv_273-ink.svg',
    });
    expect(validateOmolShelfPicks([shelf])).toEqual([]);
    expect(validateOmolShelfPicks([])).toEqual([]);
    expect(validateOmolShelfPicks([{ ...shelf, file: '/elsewhere.xyz' }])).toHaveLength(1);
  });

  it('reports element and shelf coverage', () => {
    const coverage = omolFeaturedCoverage([pick(), pick({ shelf: 'small', home: false, elements: ['B', 'H'] })]);
    expect(coverage.home).toBe(1);
    expect(coverage.shelves['salt-complexes']).toBe(1);
    expect(coverage.emptyShelves).toEqual(['drug-like', 'amino-acid-ligand', 'conformers', 'off-equilibrium']);
    expect(coverage.missingElements).toEqual(['F', 'P', 'Cl', 'Br', 'I', 'Si', 'Li', 'Na', 'Mg', 'Ca']);
  });

  it('parses Hill formulas', () => {
    expect(parseOmolFormula('CH4Cl2O6P2')).toEqual([['C', 1], ['H', 4], ['Cl', 2], ['O', 6], ['P', 2]]);
    expect(parseOmolFormula('C2H6O C')).toBeNull();
    expect(parseOmolFormula('CHC')).toBeNull();
  });
});
