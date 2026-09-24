import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyJudgment, buildJudgePool, formatMeasure, judgeSwitch, resetJudgeAvailability } from './judgeSwitch';
import type { SwitchCandidate } from './switchIndex';

const candidate = (key: string): SwitchCandidate => ({ key, title: key, elements: [], atoms: 1, source: 'gallery', detail: '', open: async () => undefined });
const list = [candidate('a'), candidate('b'), candidate('c')];

afterEach(() => {
  vi.unstubAllGlobals();
  resetJudgeAvailability();
});

describe('applyJudgment', () => {
  it('leaves the deterministic order alone without a configured judgment', () => {
    expect(applyJudgment(list, null).ordered.map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(applyJudgment(list, { configured: false }).bestKey).toBeNull();
  });
  it('promotes a confident best pick, keeps the rest in order, and demotes only clear misfits', () => {
    const { ordered, bestKey, hint } = applyJudgment(list, { configured: true, best: { key: 'c', confidence: 0.9 }, fit: { a: 0.2, b: 0.8, c: 0.95 } });
    expect(ordered.map((c) => c.key)).toEqual(['c', 'b', 'a']);
    expect(bestKey).toBe('c');
    expect(hint).toBeNull();
    const stable = applyJudgment(list, { configured: true, best: null, fit: { a: 0.6, b: 0.9, c: 0.5 } });
    expect(stable.ordered.map((c) => c.key)).toEqual(['a', 'b', 'c']);
  });
  it('pulls a confident best pick in from the pool when the typed text never matched it', () => {
    const { ordered, bestKey } = applyJudgment(list, { configured: true, best: { key: 'glucose', confidence: 0.9 }, fit: { a: 0.1, b: 0.5 } }, [candidate('glucose')]);
    expect(ordered.map((c) => c.key)).toEqual(['glucose', 'b', 'c', 'a']);
    expect(bestKey).toBe('glucose');
  });
  it('treats a low-confidence best pick as a hint only', () => {
    const { ordered, bestKey, hint } = applyJudgment(list, { configured: true, best: { key: 'c', confidence: 0.4 }, fit: {} });
    expect(ordered.map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(bestKey).toBeNull();
    expect(hint?.key).toBe('c');
    expect(applyJudgment(list, { configured: true, best: { key: 'c', confidence: 0.1 }, fit: {} }).hint).toBeNull();
  });
});

describe('property ranking', () => {
  const material = (key: string, density?: number): SwitchCandidate => ({ ...candidate(key), evidence: density === undefined ? undefined : { density } });
  const metals = [material('tungsten', 19.25), material('magnesium', 1.738), material('diamond', 3.51), material('aluminium', 2.7)];
  const rank = (mode: string, property: string, has: Record<string, number>, kind: Record<string, number>) => ({
    configured: true,
    best: { key: 'diamond', confidence: 0.9 },
    rank: { mode: { choice: mode, confidence: 0.99 }, property: { choice: property, confidence: 0.99 }, has, kind },
  }) as never;

  it('ranks the compared group by the reference value and labels each row', () => {
    const applied = applyJudgment([], rank('least', 'density', {}, { tungsten: 0.7, magnesium: 0.84, aluminium: 0.82, diamond: 0.04 }), metals);
    expect(applied.ordered.map((c) => c.key)).toEqual(['magnesium', 'aluminium', 'tungsten']);
    expect(applied.bestKey).toBeNull();
    expect(applied.ranking?.summary).toContain('density, lowest first');
    expect(formatMeasure(applied.ranking!.plan, applied.ranking!.rows.magnesium)).toBe('1.74 g/cm³');
    expect(formatMeasure({ kind: 'measured', direction: 'least', property: 'boiling_point' }, { key: 'o2', value: -183, basis: 'measured' })).toBe('−183 °C');
    expect(formatMeasure({ kind: 'measured', direction: 'most', property: 'density' }, { key: 'cuzr', probability: 0.16, basis: 'inferred' })).toBe('no data');
  });

  it('filters by Jev and shows its probability', () => {
    const applied = applyJudgment(metals, rank('filter', 'other', { aluminium: 0.77, magnesium: 0.57, tungsten: 0.1 }, {}), []);
    expect(applied.ordered.map((c) => c.key)).toEqual(['aluminium', 'magnesium']);
    expect(formatMeasure(applied.ranking!.plan, applied.ranking!.rows.aluminium)).toBe('Jev 77%');
  });

  it('falls back to the ordinary judgment for lookups and empty rankings', () => {
    expect(applyJudgment(metals, rank('lookup', 'other', {}, {})).bestKey).toBe('diamond');
    expect(applyJudgment(metals, rank('filter', 'other', { tungsten: 0.1 }, {})).ranking).toBeUndefined();
  });
});

describe('judgeSwitch', () => {
  it('stops asking after the edge reports it is not configured', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ configured: false }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await judgeSwitch({ query: 'x', elements: [], candidates: list })).toEqual({ configured: false });
    expect(await judgeSwitch({ query: 'x', elements: [], candidates: list })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('treats a non-JSON answer (no edge at all) as no judgment and never asks again', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await judgeSwitch({ query: 'x', elements: [], candidates: list })).toBeNull();
    expect(await judgeSwitch({ query: 'x', elements: [], candidates: list })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('sends the bounded request shape and returns the judgment', async () => {
    let sent: { candidates: unknown[]; query: string } | null = null;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ configured: true, best: { key: 'a', confidence: 0.8 } }), { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await judgeSwitch({ query: 'x', elements: [], candidates: list })).toMatchObject({ configured: true, best: { key: 'a' } });
    expect(sent!.query).toBe('x');
    expect(sent!.candidates[0]).toEqual({ key: 'a', title: 'a', elements: [], atoms: 1, source: 'gallery' });
    const pool = buildJudgePool(list, [candidate('a'), candidate('z')]);
    expect(pool.map((c) => `${c.key}:${c.fit}`)).toEqual(['a:true', 'b:true', 'c:true', 'z:false']);
  });
});
