import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterOmolRecords, searchOmolValidationPage, type OmolRecord } from './omol';

function record(i: number, formula: string): OmolRecord {
  return { id: `nval-${i}`, formula, elements: [...new Set(formula.match(/[A-Z][a-z]?/g) ?? [])].sort(), natoms: 12, gap: null, src: 'x' };
}

// 60 substring matches ("C6H6O…") ahead of the one exact "C6H6" at row 60.
const RECORDS = [...Array.from({ length: 60 }, (_, i) => record(i, `C6H6O${(i % 3) + 1}`)), record(60, 'C6H6'), record(61, 'CH4')];

afterEach(() => vi.unstubAllGlobals());

describe('OMol25 validation search ranking', () => {
  it('puts exact formula matches first, before the page is cut', () => {
    const ranked = filterOmolRecords(RECORDS, { text: 'C6H6' });
    expect(ranked).toHaveLength(61);
    expect(ranked[0].id).toBe('nval-60');
    expect(ranked.slice(1).map((r) => r.id)).toEqual(RECORDS.slice(0, 60).map((r) => r.id));
  });

  it('keeps index order when nothing matches exactly', () => {
    expect(filterOmolRecords(RECORDS, { text: 'C6H6O2' }).map((r) => r.id).slice(0, 2)).toEqual(['nval-1', 'nval-4']);
    expect(filterOmolRecords(RECORDS, { text: '' })).toHaveLength(RECORDS.length);
  });

  it('shows the exact match on the first page and reports the total for paging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ records: RECORDS }) }));
    const first = await searchOmolValidationPage({ text: 'c6h6', limit: 36 });
    expect(first.total).toBe(61);
    expect(first.hits).toHaveLength(36);
    expect(first.hits[0].id).toBe('nval-60');
    const last = await searchOmolValidationPage({ text: 'c6h6', limit: 36 }, 36);
    expect(last.hits).toHaveLength(25);
    expect(last.hits.some((hit) => hit.id === 'nval-60')).toBe(false);
  });
});
