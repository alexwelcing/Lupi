import { describe, expect, it } from 'vitest';
import { LOCAL_MOLECULES, QUICK_PICK_IDS, scoreLocalMolecule, searchLocalMolecules } from './moleculeIndex';

describe('moleculeIndex', () => {
  it('exposes every directly openable gallery molecule, quick picks first', () => {
    expect(LOCAL_MOLECULES.length).toBeGreaterThan(90);
    expect(LOCAL_MOLECULES.map((m) => m.id)).not.toContain('billion_atom_block');
    const leading = LOCAL_MOLECULES.slice(0, 5).map((m) => m.id);
    expect(leading).toEqual(QUICK_PICK_IDS.slice(0, 5));
    const caffeine = LOCAL_MOLECULES.find((m) => m.id === 'caffeine')!;
    expect(caffeine.image).toBe('/learn/caffeine.svg');
    expect(caffeine.atoms).toBe(24);
    expect(new Set(LOCAL_MOLECULES.map((m) => m.id)).size).toBe(LOCAL_MOLECULES.length);
  });

  it('matches on the first letters and ranks title prefixes above metadata', () => {
    const hits = searchLocalMolecules('caf');
    expect(hits[0]?.id).toBe('caffeine');
    expect(searchLocalMolecules('wat')[0]?.id).toBe('water');
    expect(searchLocalMolecules('')).toEqual([]);
    expect(searchLocalMolecules('zzzz')).toEqual([]);
    const benzene = LOCAL_MOLECULES.find((m) => m.id === 'benzene')!;
    expect(scoreLocalMolecule(benzene, 'benzene')).toBe(100);
    expect(scoreLocalMolecule(benzene, 'benz')).toBe(90);
    expect(scoreLocalMolecule(benzene, 'nope')).toBe(0);
  });

  it('finds molecules by formula', () => {
    expect(searchLocalMolecules('C6H6').map((m) => m.id)).toContain('benzene');
  });
});
