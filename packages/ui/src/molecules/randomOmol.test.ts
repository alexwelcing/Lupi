import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openMolecule } = vi.hoisted(() => ({
  openMolecule: vi.fn(async (): Promise<{ ok: true; fileName: string; atomCount: number } | { ok: false; message: string }> => ({
    ok: false,
    message: 'Failed to fetch /v1/datasets/omol25/neutral-train/structures/1.xyz: 504',
  })),
}));
vi.mock('../viewer/openMolecule', () => ({ openMolecule }));

import { OMOL_SURPRISE_FAILURE } from '../landing/omolPicks';
import { useStore } from '../store';
import { OMOL25_RANDOM_FAILURE, OMOL25_RANDOM_ROWS, openRandomOmol25Molecule, randomOmol25Url, uniformRandomInt } from './randomOmol';

const URL_RE = /^\/v1\/datasets\/omol25\/neutral-train\/structures\/(\d+)\.xyz$/;

describe('random OMol25 structure', () => {
  beforeEach(() => openMolecule.mockClear());

  it('opens a neutral-train row by number, 0 ≤ n < 34,335,828, without an index', () => {
    expect(OMOL25_RANDOM_ROWS).toBe(34_335_828);
    for (let i = 0; i < 200; i += 1) {
      const match = URL_RE.exec(randomOmol25Url());
      expect(match).not.toBeNull();
      const n = Number(match![1]);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(34_335_828);
    }
    expect(randomOmol25Url(0)).toBe('/v1/datasets/omol25/neutral-train/structures/0.xyz');
    expect(randomOmol25Url(34_335_827)).toBe('/v1/datasets/omol25/neutral-train/structures/34335827.xyz');
  });

  it('draws uniformly: the top of the 32-bit range is rejected, not folded onto low rows', () => {
    const n = OMOL25_RANDOM_ROWS;
    const limit = 2 ** 32 - (2 ** 32 % n);
    const draws = [limit, 2 ** 32 - 1, 7];
    expect(uniformRandomInt(n, () => draws.shift()!)).toBe(7);
    expect(uniformRandomInt(n, () => limit - 1)).toBe(n - 1);
    expect(uniformRandomInt(n, () => 0)).toBe(0);
    expect(() => uniformRandomInt(0)).toThrow(RangeError);
  });

  it('reports a failed open in plain words, once, without retrying', async () => {
    const result = await openRandomOmol25Molecule();
    expect(openMolecule).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, message: OMOL25_RANDOM_FAILURE });
    expect(useStore.getState().error).toBe(OMOL25_RANDOM_FAILURE);
    expect(OMOL_SURPRISE_FAILURE).toBe(OMOL25_RANDOM_FAILURE);
  });
});
