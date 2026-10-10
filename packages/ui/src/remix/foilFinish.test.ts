import { describe, expect, it } from 'vitest';
import { FOIL_FINISH_ID } from '@atlas/scene';
import { FOIL_KINDS, parseRemixCode, remixFoil } from './code';

describe('Foil finishes', () => {
  it('maps every finish a code can carry to its shader branch', () => {
    expect(FOIL_KINDS).toEqual(['holo', 'gold', 'pearl']);
    expect(FOIL_KINDS.map((kind) => FOIL_FINISH_ID[kind])).toEqual([1, 2, 3]);
  });

  it('keeps the first code per finish with both flags off (frozen r1)', () => {
    const foilOf = (text: string) => {
      const parse = parseRemixCode(text);
      if (!parse.ok) throw new Error(text);
      return remixFoil(parse.code);
    };
    expect(foilOf('r1-00012')).toBe('holo');
    expect(foilOf('r1-0004P')).toBe('gold');
    expect(foilOf('r1-00002')).toBe('pearl');
    expect(foilOf('r1-00001')).toBeNull();
  });
});
