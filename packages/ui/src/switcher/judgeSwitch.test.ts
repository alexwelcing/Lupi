import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyJudgment, judgeSwitch, resetJudgeAvailability } from './judgeSwitch';
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
  it('promotes a confident best pick and sorts the rest by fit', () => {
    const { ordered, bestKey } = applyJudgment(list, { configured: true, best: { key: 'c', confidence: 0.9 }, fit: { a: 0.2, b: 0.8, c: 0.95 } });
    expect(ordered.map((c) => c.key)).toEqual(['c', 'b', 'a']);
    expect(bestKey).toBe('c');
  });
  it('treats a low-confidence best pick as a hint only', () => {
    const { ordered, bestKey } = applyJudgment(list, { configured: true, best: { key: 'c', confidence: 0.4 }, fit: {} });
    expect(ordered.map((c) => c.key)).toEqual(['a', 'b', 'c']);
    expect(bestKey).toBeNull();
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
  });
});
