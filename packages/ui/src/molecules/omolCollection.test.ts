import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  OMOL25_COLLECTIONS,
  omolShelfPick,
  validateOmolFeaturedFile,
  validateOmolShelfPicks,
  type OmolFeaturedFileV1,
} from '@atlas/core/omol25';
import { deriveFacets, omolProvider, type OmolRecord } from './providers/omol';
import { PERIODIC_TABLE } from './periodicTable';
import {
  FALLBACK_OMOL_COLLECTIONS,
  OmolSlowError,
  RemoteOmolWarmingError,
  remoteOmolHit,
  remoteOmolPage,
  type RemoteOmolRow,
} from './remoteOmol';
import { OMOL_PICKS } from '../landing/omolShelf.data';

// A tiny fixture shaped like the real OMol25 neutral-validation records:
// gap is null across the slice and src is a single constant — the facet
// derivation must NOT surface either as a navigable facet.
const FIXTURE = [
  { id: 'nval-0', formula: 'CH4', elements: ['C', 'H'], natoms: 5, gap: null, energy: -40, src: 'DS_x' },
  { id: 'nval-1', formula: 'H2O', elements: ['H', 'O'], natoms: 3, gap: null, energy: -76, src: 'DS_x' },
  { id: 'nval-2', formula: 'C2H6O', elements: ['C', 'H', 'O'], natoms: 9, gap: null, energy: -154, src: 'DS_x', functionalGroups: ['alcohol-phenol'] },
  { id: 'nval-3', formula: 'C3H6O', elements: ['C', 'H', 'O'], natoms: 10, gap: null, energy: -193, src: 'DS_x', functionalGroups: ['ketone'] },
] satisfies OmolRecord[];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OMol25 — deriveFacets', () => {
  it('counts each element across the structures that contain it', () => {
    const f = deriveFacets(FIXTURE);
    const count = (el: string) => f.elementCounts.find((e) => e.element === el)?.count;
    expect(count('H')).toBe(4); // in all four
    expect(count('C')).toBe(3); // CH4 + C2H6O + C3H6O
    expect(count('O')).toBe(3); // H2O + C2H6O + C3H6O
  });

  it('orders elements by descending count (H first here)', () => {
    const f = deriveFacets(FIXTURE);
    expect(f.elementCounts[0].element).toBe('H');
    // monotonic non-increasing
    for (let i = 1; i < f.elementCounts.length; i++) {
      expect(f.elementCounts[i - 1].count).toBeGreaterThanOrEqual(f.elementCounts[i].count);
    }
  });

  it('reports the atom-count range and median', () => {
    const f = deriveFacets(FIXTURE);
    expect(f.total).toBe(4);
    expect(f.natoms.min).toBe(3);
    expect(f.natoms.max).toBe(10);
    expect(f.natoms.median).toBe(9);
  });

  it('reports functional-group counts when records carry geometry-derived tags', () => {
    const f = deriveFacets(FIXTURE);
    expect(f.functionalGroupCounts).toEqual([
      {
        id: 'alcohol-phenol',
        label: 'Alcohols & Phenols',
        family: 'Oxygen groups',
        color: '#34d399',
        count: 1,
      },
      {
        id: 'ketone',
        label: 'Ketones',
        family: 'Carbonyl groups',
        color: '#f472b6',
        count: 1,
      },
    ]);
  });

  it('does NOT derive a gap or src facet (both are unusable in this slice)', () => {
    const f = deriveFacets(FIXTURE);
    expect(f).not.toHaveProperty('gap');
    expect(f).not.toHaveProperty('src');
    // only the real facets exist
    expect(Object.keys(f).sort()).toEqual(['elementCounts', 'functionalGroupCounts', 'natoms', 'total']);
  });

  it('handles an empty record set without throwing', () => {
    const f = deriveFacets([]);
    expect(f.total).toBe(0);
    expect(f.elementCounts).toEqual([]);
    expect(f.functionalGroupCounts).toEqual([]);
    expect(f.natoms).toEqual({ min: 0, max: 0, median: 0 });
  });
});

describe('OMol25 — periodic table layout', () => {
  it('places every cell in a valid 18-column grid slot with a unique symbol', () => {
    const seen = new Set<string>();
    for (const cell of PERIODIC_TABLE) {
      expect(cell.col, cell.symbol).toBeGreaterThanOrEqual(1);
      expect(cell.col, cell.symbol).toBeLessThanOrEqual(18);
      expect(cell.row, cell.symbol).toBeGreaterThanOrEqual(1);
      expect(seen.has(cell.symbol)).toBe(false);
      seen.add(cell.symbol);
    }
  });

  it('includes every element OMol25 actually uses', () => {
    const omolElements = ['H', 'C', 'O', 'N', 'S', 'F', 'Cl', 'Br', 'P', 'I', 'Si', 'B', 'K', 'Li', 'Na', 'Ca', 'Mg'];
    const symbols = new Set(PERIODIC_TABLE.map((c) => c.symbol));
    for (const el of omolElements) {
      expect(symbols.has(el), `periodic table missing ${el}`).toBe(true);
    }
  });

  it('does not place two cells in the same (col,row) slot', () => {
    const slots = new Set<string>();
    for (const cell of PERIODIC_TABLE) {
      const key = `${cell.col}:${cell.row}`;
      expect(slots.has(key), `${cell.symbol} collides at ${key}`).toBe(false);
      slots.add(key);
    }
  });
});

describe('OMol25 provider search', () => {
  it('filters records by functional group and returns group metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ records: FIXTURE }),
    }));

    const hits = await omolProvider.search({ text: '', functionalGroups: ['ketone'], limit: 10 });

    expect(hits.map((hit) => hit.id)).toEqual(['nval-3']);
    expect(hits[0].functionalGroups).toEqual(['ketone']);
    expect(hits[0].tags).toContain('Ketones');
  });
});

describe('OMol25 — compact v4 index bound to edge rows', () => {
  it('expands compact rows, derives elements from the formula, unpacks group masks, and opens through the edge', async () => {
    const { parseOmolIndex, omolStructureUrl } = await import('./providers/omol');
    const records = parseOmolIndex({
      schema: 'lupi.omol25-validation-index.v4',
      structureUrl: '/v1/datasets/omol25/neutral-validation/structures/{row}.xyz',
      groups: ['alcohol-phenol', 'ketone'],
      records: [
        ['C2H6O', 9, 1],
        ['C3H6O', 10, 2],
        ['CH4', 5],
      ],
    });
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ id: 'nval-0', formula: 'C2H6O', elements: ['C', 'H', 'O'], natoms: 9, functionalGroups: ['alcohol-phenol'] });
    expect(records[1].functionalGroups).toEqual(['ketone']);
    expect(records[2].functionalGroups).toBeUndefined();
    expect(omolStructureUrl('nval-1234')).toBe('/v1/datasets/omol25/neutral-validation/structures/1234.xyz');
  });

  it('still reads legacy v3 object records', async () => {
    const { parseOmolIndex } = await import('./providers/omol');
    expect(parseOmolIndex({ records: FIXTURE })).toHaveLength(FIXTURE.length);
    expect(parseOmolIndex({ records: 'nope' })).toEqual([]);
  });
});

function remoteRow(overrides: Partial<RemoteOmolRow> = {}): RemoteOmolRow {
  return {
    rowIndex: 273,
    id: 'CO_85',
    configurationId: 'CO_85',
    propertyId: 'PO_10',
    formula: 'C21H15KN4O4S',
    reducedFormula: 'C21H15KN4O4S',
    elements: ['C', 'H', 'K', 'N', 'O', 'S'],
    atomCount: 46,
    multiplicity: 1,
    charge: 0,
    spinMultiplicity: 1,
    chargeSource: 'record',
    domain: 'orbnet_denali',
    homoLumoGapEv: 6.39,
    method: 'ωB97M-V',
    software: 'ORCA',
    energy: -63330.86,
    maxForceNorm: 3.08,
    name: null,
    loadUrl: '/v1/datasets/omol25/neutral-validation/structures/273.xyz',
    coordinateProvenance: 'source',
    bondTopology: 'not-provided',
    ...overrides,
  };
}

describe('OMol25 — remote rows as library hits', () => {
  it('words charge and spin from the record and never shows the ColabFit multiplicity', () => {
    const neutral = remoteOmolHit(remoteRow({ multiplicity: 3 }));
    expect(neutral.subtitle).toBe('46 atoms · ωB97M-V · neutral singlet');

    const cation = remoteOmolHit(remoteRow({ charge: 1, spinMultiplicity: 2, multiplicity: 1 }));
    expect(cation.subtitle).toBe('46 atoms · ωB97M-V · charge +1 · doublet');

    const olderEdge = remoteOmolHit(remoteRow({
      multiplicity: 2, charge: undefined, spinMultiplicity: undefined, chargeSource: undefined, domain: undefined,
    }));
    expect(olderEdge.subtitle).toBe('46 atoms · ωB97M-V');

    const unavailable = remoteOmolHit(remoteRow({ charge: null, spinMultiplicity: null, chargeSource: 'unavailable', metaTruncated: true }));
    expect(unavailable.subtitle).toBe('46 atoms · ωB97M-V');

    for (const hit of [neutral, cation, olderEdge, unavailable]) expect(hit.subtitle).not.toMatch(/multiplicity/);
    expect(neutral.subtitle).not.toContain('charge +1');
  });

  it('fills provenance and the geometry notice from the shared truth module', () => {
    const hit = remoteOmolHit(remoteRow());
    expect(hit.provenance).toEqual({
      sourceUrl: 'https://huggingface.co/datasets/colabfit/OMol25_neutral_validation',
      doi: '10.48550/arXiv.2505.08762',
      citation: 'Levine et al. 2025, The Open Molecules 2025 (OMol25) Dataset, arXiv:2505.08762',
      license: 'CC-BY-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    });
    expect(hit.notice).toBe('Snapshot away from a minimum: largest force 3.1 eV/Å.');
    expect(hit.tags).toContain('orbnet_denali');

    const reaction = remoteOmolHit(remoteRow({ domain: 'trans1x', maxForceNorm: 0.2 }));
    expect(reaction.notice).toBe('Near a minimum: largest force 0.20 eV/Å. Reaction-path snapshot: stretched bonds may be absent.');
    expect(remoteOmolHit(remoteRow({ maxForceNorm: null })).notice).toBeUndefined();
  });

  it('takes its fallback collections from @atlas/core/omol25', () => {
    expect(FALLBACK_OMOL_COLLECTIONS.map((c) => c.id)).toEqual(OMOL25_COLLECTIONS.map((c) => c.id));
    expect(FALLBACK_OMOL_COLLECTIONS.find((c) => c.id === 'all-train-preview')).toMatchObject({
      repository: 'colabfit/OMol25_train',
      estimatedRows: 65_331_709,
      sourceRows: 101_666_280,
      rowsUrl: '/v1/datasets/omol25/all-train-preview/rows',
    });
  });

  it('maps an edge 504 slow to OmolSlowError and keeps warming as its own error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      json: async () => ({ status: 'slow', error: 'did not answer within 9 seconds.', timeoutSeconds: 9 }),
    }));
    const slow = remoteOmolPage({ collection: 'neutral-train', formula: 'C6H6' });
    await expect(slow).rejects.toBeInstanceOf(OmolSlowError);
    await expect(slow).rejects.toMatchObject({ timeoutSeconds: 9 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 202,
      json: async () => ({ status: 'warming', error: 'Index warming.', retryAfterSeconds: 15 }),
    }));
    await expect(remoteOmolPage({ collection: 'neutral-train', formula: 'C6H6' })).rejects.toBeInstanceOf(RemoteOmolWarmingError);
  });
});

describe('OMol25 — featured picks data', () => {
  const featuredPath = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/public/datasets/omol25/featured.v1.json');

  it('ships landing data that passes the shape validator', () => {
    expect(validateOmolShelfPicks(OMOL_PICKS)).toEqual([]);
  });

  it('keeps featured.v1.json and the landing data in step', () => {
    if (!existsSync(featuredPath)) {
      // Before the featured build runs, the landing data is the empty stub.
      expect(OMOL_PICKS).toEqual([]);
      return;
    }
    const file = JSON.parse(readFileSync(featuredPath, 'utf8')) as OmolFeaturedFileV1;
    expect(validateOmolFeaturedFile(file)).toEqual([]);
    expect(OMOL_PICKS).toEqual(file.picks.map(omolShelfPick));
  });
});
