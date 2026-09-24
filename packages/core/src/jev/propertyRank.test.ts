import { describe, expect, it } from 'vitest';
import {
  formulaCounts,
  molarMass,
  parsePropertyEvidence,
  planPropertyRank,
  propertyRankQuestions,
  rankable,
  rankByPlan,
  readPropertyRankAnswers,
  type PropertyRankJudgment,
} from './propertyRank';

const judgment = (mode: string, property: string, has: Record<string, number>, kind: Record<string, number>, confidence = 0.99): PropertyRankJudgment => ({
  mode: { choice: mode as PropertyRankJudgment['mode']['choice'], confidence },
  property: { choice: property as PropertyRankJudgment['property']['choice'], confidence },
  has,
  kind,
});

describe('formula arithmetic', () => {
  it('counts plain, parenthesized, and subscript formulas', () => {
    expect(Object.fromEntries(formulaCounts('C8H10N4O2')!)).toEqual({ C: 8, H: 10, N: 4, O: 2 });
    expect(Object.fromEntries(formulaCounts('Ca(OH)2')!)).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(Object.fromEntries(formulaCounts('H₂O')!)).toEqual({ H: 2, O: 1 });
    expect(formulaCounts('Xx2')).toBeNull();
    expect(formulaCounts('caffeine')).toBeNull();
    expect(formulaCounts('C6(H')).toBeNull();
  });

  it('computes molar mass from the element table', () => {
    expect(molarMass('H2O')).toBeCloseTo(18.02, 1);
    expect(molarMass('C6H12O6')).toBeCloseTo(180.16, 1);
    expect(molarMass('NaCl')).toBeCloseTo(58.44, 1);
    expect(molarMass(undefined)).toBeUndefined();
    expect(molarMass('not a formula')).toBeUndefined();
  });
});

describe('evidence', () => {
  it('keeps known fields in range and drops the rest', () => {
    expect(parsePropertyEvidence({ substance: ' aluminium ', phase: 'solid', density: 2.7, meltingPoint: 660.3, water: 'insoluble', extra: 1 })).toEqual({
      substance: 'aluminium',
      phase: 'solid',
      density: 2.7,
      meltingPoint: 660.3,
      water: 'insoluble',
    });
    expect(parsePropertyEvidence({ phase: 'plasma', density: -1, boilingPoint: Number.NaN })).toBeUndefined();
    expect(parsePropertyEvidence('solid')).toBeUndefined();
  });
});

describe('questions', () => {
  it('ranks only known substances', () => {
    expect(rankable({ formula: 'H2O' })).toBe(true);
    expect(rankable({ evidence: { substance: 'aluminium' } })).toBe(true);
    expect(rankable({})).toBe(false);
    expect(rankable({ formula: 'QR' })).toBe(false);
  });

  it('asks two Nouls per candidate and keeps the request text out of every instruction', () => {
    const questions = propertyRankQuestions(['gallery:water', 'gallery:benzene']);
    expect(Object.keys(questions)).toEqual(['rank_mode', 'rank_property', 'has:gallery:water', 'kind:gallery:water', 'has:gallery:benzene', 'kind:gallery:benzene']);
    expect(JSON.stringify(questions)).toContain('`request.query`');
  });

  it('reads answers back and refuses a result missing the choices', () => {
    const answers = {
      rank_mode: { type: 'choice' as const, choice: 'filter', probabilities: { filter: 0.64, lookup: 0.21, most: 0.07, least: 0.01, none: 0.07 }, confidence: 0.991 },
      rank_property: { type: 'choice' as const, choice: 'density', probabilities: {}, confidence: 0.9999 },
      'has:a': { type: 'noul' as const, noul: 0.8123 },
      'kind:a': { type: 'noul' as const, noul: 0.4 },
    };
    expect(readPropertyRankAnswers({ model: 'jev-1.13.0', answers }, ['a'])).toEqual({
      mode: { choice: 'filter', confidence: 0.991, ranking: 0.72 },
      property: { choice: 'density', confidence: 1, measured: 1 },
      has: { a: 0.812 },
      kind: { a: 0.4 },
    });
    expect(readPropertyRankAnswers({ model: 'jev-1.13.0', answers: { 'has:a': answers['has:a'] } }, ['a'])).toBeNull();
  });
});

describe('planning', () => {
  it('maps mode and property to a plan, and stays out of the way when unsure', () => {
    expect(planPropertyRank(judgment('most', 'density', {}, {}))).toEqual({ kind: 'measured', direction: 'most', property: 'density' });
    expect(planPropertyRank(judgment('least', 'other', {}, {}))).toEqual({ kind: 'judged', direction: 'least' });
    expect(planPropertyRank(judgment('filter', 'density', {}, {}))).toEqual({ kind: 'filter', property: 'density' });
    expect(planPropertyRank(judgment('lookup', 'other', {}, {}))).toBeNull();
    expect(planPropertyRank(judgment('most', 'density', {}, {}, 0.4))).toBeNull();
    expect(planPropertyRank(null)).toBeNull();
    // Chosen at low confidence, but "other" is unlikely: still a measured plan.
    const unsure = judgment('most', 'molar_mass', {}, {}, 0.99);
    expect(planPropertyRank({ ...unsure, property: { choice: 'molar_mass', confidence: 0.46, measured: 0.7 } })).toEqual({ kind: 'measured', direction: 'most', property: 'molar_mass' });
    expect(planPropertyRank({ ...unsure, property: { choice: 'molar_mass', confidence: 0.46, measured: 0.5 } })).toEqual({ kind: 'judged', direction: 'most' });
    // "sweet": the chosen label alone is under the gate; the summed ranking probability is not.
    const sweet = judgment('filter', 'other', {}, {}, 0.55);
    expect(planPropertyRank(sweet)).toBeNull();
    expect(planPropertyRank({ ...sweet, mode: { ...sweet.mode, ranking: 0.72 } })).toEqual({ kind: 'filter', property: 'other' });
    expect(planPropertyRank({ ...judgment('lookup', 'other', {}, {}, 0.4), mode: { choice: 'lookup', confidence: 0.4, ranking: 0.6 } })).toBeNull();
  });
});

describe('ranking', () => {
  // Shapes taken from the live 2026-09-24 probes: Jev ranked diamond above
  // tungsten for "most dense", so the number decides, not the probability.
  const items = [
    { key: 'tungsten', value: 19.25 },
    { key: 'diamond', value: 3.51 },
    { key: 'magnesium', value: 1.738 },
    { key: 'aluminium', value: 2.7 },
    { key: 'oxygen', value: 0.00143 },
    { key: 'cantor', value: undefined },
  ];
  const kind = { tungsten: 0.7, magnesium: 0.84, aluminium: 0.82, cantor: 0.73, diamond: 0.04, oxygen: 0.02 };
  const has = { tungsten: 0.3, diamond: 0.55, magnesium: 0.2, aluminium: 0.2, cantor: 0.4, oxygen: 0.1 };

  it('sorts the compared group by the measured value, unknowns after', () => {
    const lightest = rankByPlan(items, { kind: 'measured', direction: 'least', property: 'density' }, judgment('least', 'density', has, kind));
    expect(lightest.map((row) => row.key)).toEqual(['magnesium', 'aluminium', 'tungsten', 'cantor']);
    expect(lightest[0]).toEqual({ key: 'magnesium', value: 1.738, basis: 'measured' });
    expect(lightest[3]).toEqual({ key: 'cantor', probability: 0.4, basis: 'inferred' });
    const heaviest = rankByPlan(items, { kind: 'measured', direction: 'most', property: 'density' }, judgment('most', 'density', has, kind));
    expect(heaviest[0].key).toBe('tungsten');
  });

  it('orders by Jev when the property has no number', () => {
    const hardest = rankByPlan(items, { kind: 'judged', direction: 'most' }, judgment('most', 'other', { tungsten: 0.56, diamond: 0.77 }, { tungsten: 0.8, diamond: 0.9 }));
    expect(hardest.map((row) => row.key)).toEqual(['diamond', 'tungsten']);
    expect(hardest.every((row) => row.basis === 'inferred')).toBe(true);
  });

  it('filters by the literal reading, most likely first, and leaves unjudged candidates out', () => {
    const floats = rankByPlan(
      [...items, { key: 'ice' }, { key: 'unasked' }],
      { kind: 'filter', property: 'density' },
      judgment('filter', 'density', { ice: 0.88, oxygen: 0.5, tungsten: 0.04, diamond: 0.1 }, {}),
    );
    expect(floats.map((row) => row.key)).toEqual(['ice', 'oxygen']);
    expect(floats[0].probability).toBe(0.88);
  });
});
