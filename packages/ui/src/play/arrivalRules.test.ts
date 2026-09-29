import { describe, expect, it } from 'vitest';
import { canPlayScatter, shouldPlayArrival, type ArrivalRuleInput } from './arrivalRules';

const base: ArrivalRuleInput = {
  natoms: 60,
  totalFrames: 1,
  transmissionActive: false,
  playing: false,
  comfort: 'standard',
  hash: '',
  search: '?sim=c60_buckyball',
  pathname: '/',
  seenIds: [],
  galleryId: 'c60_buckyball',
  baton: null,
};

const play = (patch: Partial<ArrivalRuleInput>) => shouldPlayArrival({ ...base, ...patch });

describe('shouldPlayArrival', () => {
  it('condenses a first open', () => {
    expect(play({})).toBe('condense');
  });

  it('skips every excluded case', () => {
    const excluded: Array<Partial<ArrivalRuleInput>> = [
      { natoms: 20_001 },
      { natoms: 0 },
      { totalFrames: 2 },
      { totalFrames: 0 },
      { transmissionActive: true },
      { playing: true },
      { comfort: 'still' },
      { hash: '#/mcp' },
      { hash: '#/mcp?mcpCommand=iso' },
      { hash: '#/embed/mobile' },
      { search: '?sim=c60_buckyball&mcpCommand=iso' },
      { search: '?batchExport=true' },
      { search: '?s=abc' },
      { hash: '#/view/my-view' },
      { pathname: '/view/my-view' },
      { seenIds: ['c60_buckyball'] },
      { seenIds: new Set(['c60_buckyball']) },
    ];
    for (const patch of excluded) expect(play(patch), JSON.stringify(patch)).toBeNull();
  });

  it('?arrival=0 disables it and ?arrival=1 forces past session and comfort only', () => {
    expect(play({ search: '?sim=c60_buckyball&arrival=0' })).toBeNull();
    const forced = '?sim=c60_buckyball&arrival=1';
    expect(play({ search: forced, seenIds: ['c60_buckyball'] })).toBe('condense');
    expect(play({ search: forced, comfort: 'still' })).toBe('condense');
    expect(play({ search: forced, natoms: 50_000 })).toBeNull();
    expect(play({ search: forced, hash: '#/mcp' })).toBeNull();
  });

  it('inflates flat when the hero handed this molecule over', () => {
    expect(play({ baton: { galleryId: 'c60_buckyball', source: 'hero' } })).toBe('flat');
    expect(play({ baton: { galleryId: 'caffeine', source: 'hero' } })).toBe('condense');
    expect(play({ baton: { galleryId: 'c60_buckyball', source: 'tile' } })).toBe('condense');
  });
});

describe('canPlayScatter', () => {
  it('ignores the session rule but keeps the scene gates and Still', () => {
    expect(canPlayScatter({ ...base, seenIds: ['c60_buckyball'] })).toBe(true);
    expect(canPlayScatter({ ...base, playing: true })).toBe(false);
    expect(canPlayScatter({ ...base, comfort: 'still' })).toBe(false);
    expect(canPlayScatter({ ...base, natoms: 30_000 })).toBe(false);
  });
});
