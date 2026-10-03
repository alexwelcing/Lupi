import { afterEach, describe, expect, it, vi } from 'vitest';
import { LUPI_MCP_TOOL_MAP } from './tools';

afterEach(() => {
  vi.unstubAllGlobals();
});

function page(rows: unknown[]) {
  return {
    dataset: 'validation-preview',
    repository: 'colabfit/OMol25_validation',
    coverage: 'indexed-preview',
    indexedRows: 800_000,
    estimatedRows: 1_842_258,
    sourceRows: 2_762_021,
    offset: 0,
    limit: 1,
    returnedRows: rows.length,
    matchedRows: 800_000,
    partial: true,
    query: null,
    formula: null,
    rows,
  };
}

describe('lupi.browse_collection', () => {
  it('passes record charge, spin, domain and gap through and labels viewer bonds as inferred', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => page([{
        rowIndex: 0,
        id: 'CO_1',
        configurationId: 'CO_1',
        propertyId: 'PO_1',
        formula: 'C30H40N4Pr',
        reducedFormula: 'C30H40N4Pr',
        elements: ['C', 'H', 'N', 'Pr'],
        atomCount: 75,
        multiplicity: 1,
        charge: 1,
        spinMultiplicity: 3,
        chargeSource: 'record',
        domain: 'metal_complexes',
        homoLumoGapEv: 2.5,
        method: 'ωB97M-V',
        software: 'ORCA',
        energy: -1,
        maxForceNorm: 1.2,
        name: null,
        loadUrl: '/v1/datasets/omol25/validation-preview/structures/0.xyz',
        coordinateProvenance: 'source',
        bondTopology: 'not-provided',
      }]),
    }));

    const tool = LUPI_MCP_TOOL_MAP.get('lupi.browse_collection')!;
    const result = await tool.handler({ id: 'b1', tool: 'lupi.browse_collection', arguments: { collection: 'validation-preview', limit: 1 } });

    expect(result.sourceTruth).toEqual({
      coordinates: 'source',
      bondTopology: 'not-provided',
      viewerBonds: { recipe: 'lupi-bonds.molecular.v1', provenance: 'inferred' },
    });
    expect(result.sourceRows).toBe(2_762_021);
    const [molecule] = result.molecules as Array<Record<string, unknown>>;
    expect(molecule).toMatchObject({
      charge: 1,
      spinMultiplicity: 3,
      chargeSource: 'record',
      domain: 'metal_complexes',
      homoLumoGapEv: 2.5,
      subtitle: '75 atoms · ωB97M-V · charge +1 · triplet',
    });
    expect(molecule).not.toHaveProperty('multiplicity');
  });

  it('rejects a collection the core module does not list', async () => {
    const tool = LUPI_MCP_TOOL_MAP.get('lupi.browse_collection')!;
    await expect(tool.handler({ id: 'b2', tool: 'lupi.browse_collection', arguments: { collection: 'everything' } }))
      .rejects.toThrow(/neutral-train, neutral-validation, all-train-preview, train-4m-preview, validation-preview/);
  });
});
