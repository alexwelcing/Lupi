import { describe, expect, it, vi } from 'vitest';
import {
  fetchPubChemMolecule, frameFromPubChemMolecule, parsePubChemRecord,
  resolvePubChemMolecule, validatePubChemMolecule,
} from './pubchem';

// Small protocol fixtures. Live release acceptance uses independently
// retrieved PubChem records; these unit fixtures do not claim a live fetch.
const WATER = {
  PC_Compounds: [{
    id: { id: { cid: 962 } },
    atoms: { aid: [17, 5, 9], element: [8, 1, 1] },
    bonds: { aid1: [17, 17], aid2: [5, 9], order: [1, 1] },
    coords: [{
      type: [2, 5, 10], aid: [9, 17, 5],
      conformers: [{ x: [-0.76, 0, 0.76], y: [0.59, 0, 0.59], z: [0, 0, 0] }],
    }],
  }],
};
const CONTEXT = { expectedCid: 962, name: 'Water', formula: 'H2O', retrievedAt: '2026-09-29T20:00:00.000Z' };
const PROPERTIES = { PropertyTable: { Properties: [{ CID: 962, Title: 'Water', MolecularFormula: 'H2O' }] } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function flatRecord() {
  return {
    PC_Compounds: [{
      ...WATER.PC_Compounds[0],
      coords: [{ type: [1, 5, 255], aid: [9, 17, 5], conformers: [{ x: [-0.76, 0, 0.76], y: [0.59, 0, 0.59] }] }],
    }],
  };
}
function successfulFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/cids/')) return response({ IdentifierList: { CID: [962] } });
    if (url.includes('/property/')) return response(PROPERTIES);
    return response(WATER);
  });
}

describe('PubChem source geometry', () => {
  it('maps coordinates by source AID and preserves source IDs through Frame conversion', () => {
    const molecule = parsePubChemRecord(WATER, CONTEXT);
    expect(molecule.atoms).toEqual({ ids: [17, 5, 9], elements: [8, 1, 1], positions: [0, 0, 0, 0.76, 0.59, 0, -0.76, 0.59, 0] });
    expect(molecule.bonds).toEqual(WATER.PC_Compounds[0].bonds);
    expect(molecule).toMatchObject({ cid: 962, name: 'Water', formula: 'H2O', dimension: '3d', coordinateUnits: 'angstrom' });
    const frame = frameFromPubChemMolecule(molecule);
    expect(Array.from(frame.ids)).toEqual([17, 5, 9]);
    expect(Array.from(frame.bonds)).toEqual([0, 1, 0, 2]);
    expect(frame.identity).toEqual({ kind: 'source-id', unique: true });
    expect(frame.distanceSemantics).toEqual({ kind: 'angstrom', provenance: 'source-declared' });
    expect(frame.boxBounds[0]).toBeCloseTo(-2.76);
    expect(frame.positions[3]).toBeCloseTo(0.76);
  });

  it('preserves source bond orders including quadruple and unknown without aromatic reinterpretation', () => {
    const record = structuredClone(WATER);
    record.PC_Compounds[0].bonds.order = [4, 255];
    expect(parsePubChemRecord(record, CONTEXT).bonds.order).toEqual([4, 255]);
  });

  it('labels source 2D coordinates as a depiction and never gives them physical units', () => {
    const molecule = parsePubChemRecord(flatRecord(), { ...CONTEXT, expectedDimension: '2d' });
    expect(molecule.dimension).toBe('2d');
    expect(molecule.coordinateUnits).toBe('depiction');
    expect(molecule.recordUrl).toContain('record_type=2d');
    expect(molecule.atoms.positions.filter((_, i) => i % 3 === 2)).toEqual([0, 0, 0]);
    expect(frameFromPubChemMolecule(molecule).distanceSemantics?.kind).toBe('unknown');
  });

  it('rejects a supplied dimension or CID that disagrees with the retrieved source', () => {
    expect(() => parsePubChemRecord(WATER, { ...CONTEXT, expectedDimension: '2d' })).toThrow(/dimension/);
    expect(() => parsePubChemRecord(WATER, { ...CONTEXT, expectedCid: 439378 })).toThrow(/different CID/);
  });

  it.each([
    ['missing coordinates', (record: typeof WATER) => { record.PC_Compounds[0].coords = []; }],
    ['ambiguous dimension', (record: typeof WATER) => { record.PC_Compounds[0].coords[0].type = [1, 2, 5, 10]; }],
    ['unknown physical units', (record: typeof WATER) => { record.PC_Compounds[0].coords[0].type = [2, 5, 255]; }],
    ['missing coordinate ID', (record: typeof WATER) => { record.PC_Compounds[0].coords[0].aid = [17, 5, 88]; }],
    ['duplicate coordinate ID', (record: typeof WATER) => { record.PC_Compounds[0].coords[0].aid = [17, 5, 5]; }],
    ['non-finite coordinate', (record: typeof WATER) => { record.PC_Compounds[0].coords[0].conformers[0].x[0] = Infinity; }],
    ['missing coordinate', (record: typeof WATER) => { record.PC_Compounds[0].coords[0].conformers[0].z = []; }],
    ['duplicate atom ID', (record: typeof WATER) => { record.PC_Compounds[0].atoms.aid = [17, 5, 5]; }],
    ['unsupported element', (record: typeof WATER) => { record.PC_Compounds[0].atoms.element[0] = 119; }],
    ['missing bond order', (record: typeof WATER) => { record.PC_Compounds[0].bonds.order = [1]; }],
    ['bad bond endpoint', (record: typeof WATER) => { record.PC_Compounds[0].bonds.aid2[0] = 99; }],
    ['self bond', (record: typeof WATER) => { record.PC_Compounds[0].bonds.aid2[0] = 17; }],
    ['duplicate bond', (record: typeof WATER) => { record.PC_Compounds[0].bonds.aid2[1] = 5; }],
    ['invalid bond code', (record: typeof WATER) => { record.PC_Compounds[0].bonds.order[0] = 8; }],
  ])('rejects %s without filling gaps or inferring source values', (_, mutate) => {
    const record = structuredClone(WATER);
    mutate(record);
    expect(() => parsePubChemRecord(record, CONTEXT)).toThrow();
  });

  it('rejects extra compounds and enforces public geometry bounds', () => {
    expect(() => parsePubChemRecord({ PC_Compounds: [...WATER.PC_Compounds, ...WATER.PC_Compounds] }, CONTEXT)).toThrow(/exactly one/);
    expect(() => parsePubChemRecord(WATER, CONTEXT, { maxAtoms: 2 })).toThrow(/exceeds 2 atoms/);
    expect(() => parsePubChemRecord(WATER, CONTEXT, { maxBonds: 1 })).toThrow(/exceeds 1 bonds/);
  });

  it('revalidates the serialized widget boundary, copies arrays, and checks provenance URLs', () => {
    const molecule = parsePubChemRecord(WATER, CONTEXT);
    const checked = validatePubChemMolecule(JSON.parse(JSON.stringify(molecule)));
    expect(checked).toEqual(molecule);
    expect(checked.atoms.ids).not.toBe(molecule.atoms.ids);
    expect(() => frameFromPubChemMolecule({ ...molecule, sourceUrl: 'https://example.com/' })).toThrow(/source URLs/);
    expect(() => validatePubChemMolecule({ ...molecule, coordinateUnits: 'depiction' })).toThrow(/units/);
    expect(() => validatePubChemMolecule({ ...molecule, retrievedAt: 'yesterday' })).toThrow(/timestamp/);
  });
});

describe('PubChem lookup boundary', () => {
  it('resolves the name first, fetches geometry by verified CID, and uses source metadata', async () => {
    const fetcher = successfulFetch();
    const result = await resolvePubChemMolecule({ name: ' dihydrogen oxide ' }, { fetch: fetcher, now: () => new Date(CONTEXT.retrievedAt) });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('expected resolved result');
    expect(result.molecule.name).toBe('Water');
    expect(result.molecule.retrievedAt).toBe(CONTEXT.retrievedAt);
    expect(fetcher.mock.calls).toHaveLength(3);
    expect(String(fetcher.mock.calls[0][0])).toContain('/name/dihydrogen%20oxide/cids/JSON?name_type=complete');
    expect(fetcher.mock.calls.slice(1).every(([input]) => String(input).includes('/cid/962/'))).toBe(true);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('cache-control')).toBe('no-cache');
  });

  it('performs direct CID retrieval without a name lookup', async () => {
    const fetcher = successfulFetch();
    const molecule = await fetchPubChemMolecule({ cid: 962 }, { fetch: fetcher });
    expect(molecule.cid).toBe(962);
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(fetcher.mock.calls.every(([input]) => !String(input).includes('/name/'))).toBe(true);
  });

  it('surfaces ambiguity before any metadata or coordinate retrieval', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ IdentifierList: { CID: [962, 2519] } }));
    expect(await resolvePubChemMolecule({ name: 'ambiguous test name' }, { fetch: fetcher })).toEqual({ status: 'ambiguous', cids: [962, 2519] });
    expect(fetcher.mock.calls).toHaveLength(1);
    await expect(fetchPubChemMolecule({ name: 'ambiguous test name' }, { fetch: fetcher })).rejects.toMatchObject({ code: 'ambiguous', cids: [962, 2519] });
  });

  it('bounds candidate lists instead of silently choosing a result', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ IdentifierList: { CID: [1, 2, 3] } }));
    await expect(resolvePubChemMolecule({ name: 'broad query' }, { fetch: fetcher, maxCandidates: 2 })).rejects.toMatchObject({ code: 'too_large' });
    expect(fetcher.mock.calls).toHaveLength(1);
  });

  it('reports name not found without creating any geometry', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ Fault: { Code: 'PUGREST.NotFound' } }, 404));
    await expect(resolvePubChemMolecule({ name: 'unobtainium' }, { fetch: fetcher })).rejects.toMatchObject({ code: 'not_found', status: 404, message: expect.stringContaining('unobtainium') });
    expect(fetcher.mock.calls).toHaveLength(1);
  });

  it('falls back to source 2D only after a missing 3D record', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/property/')) return response(PROPERTIES);
      if (url.includes('record_type=3d')) return response({}, 404);
      return response(flatRecord());
    });
    const molecule = await fetchPubChemMolecule({ cid: 962 }, { fetch: fetcher });
    expect(molecule.dimension).toBe('2d');
    expect(molecule.coordinateUnits).toBe('depiction');
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('record_type=2d'))).toHaveLength(1);
  });

  it.each([400, 429, 500, 503, 504])('does not replace an HTTP %i failure with a different structure', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/property/') ? response(PROPERTIES) : response({}, status));
    await expect(fetchPubChemMolecule({ cid: 962 }, { fetch: fetcher })).rejects.toMatchObject({ status });
    expect(fetcher.mock.calls.some(([input]) => String(input).includes('record_type=2d'))).toBe(false);
  });

  it('rejects metadata whose identity disagrees with geometry', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('/property/')
      ? response({ PropertyTable: { Properties: [{ CID: 2519, Title: 'Caffeine', MolecularFormula: 'C8H10N4O2' }] } })
      : response(WATER));
    await expect(fetchPubChemMolecule({ cid: 962 }, { fetch: fetcher })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('caps streamed and declared response bytes before parsing', async () => {
    const huge = new Response('x'.repeat(300));
    await expect(resolvePubChemMolecule({ name: 'water' }, { fetch: async () => huge, maxResponseBytes: 100 })).rejects.toMatchObject({ code: 'too_large' });
    const declared = new Response('{}', { headers: { 'content-length': '9999' } });
    await expect(resolvePubChemMolecule({ name: 'water' }, { fetch: async () => declared, maxResponseBytes: 100 })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('rejects HTML success bodies as malformed JSON', async () => {
    await expect(resolvePubChemMolecule({ name: 'water' }, { fetch: async () => new Response('<html>unavailable</html>') })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('enforces the deadline even when fetch ignores abort', async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await expect(resolvePubChemMolecule({ name: 'water' }, { fetch: fetcher, timeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish?.(response({ IdentifierList: { CID: [962] } }));
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(fetcher.mock.calls).toHaveLength(1);
  });

  it('applies the same deadline to a stalled response body', async () => {
    const body = new ReadableStream<Uint8Array>({ start() {} });
    await expect(resolvePubChemMolecule({ name: 'water' }, { fetch: async () => new Response(body), timeoutMs: 5 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects completion after the deadline even before an overdue timer can run', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      const until = performance.now() + 10;
      while (performance.now() < until) { /* Simulate a synchronous transport task. */ }
      return response({ IdentifierList: { CID: [962] } });
    });
    await expect(resolvePubChemMolecule({ name: 'water' }, { fetch: fetcher, timeoutMs: 2 })).rejects.toMatchObject({ code: 'timeout' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation before network access', async () => {
    const fetcher = successfulFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(resolvePubChemMolecule({ name: 'water' }, { fetch: fetcher, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{ cid: 0 }, { cid: 1.5 }, { name: '' }, { name: 'x'.repeat(201) }, { name: 'water\n' }, { name: 'water', cid: 962 }])('rejects invalid reference %j before network access', async (ref) => {
    const fetcher = successfulFetch();
    await expect(resolvePubChemMolecule(ref, { fetch: fetcher })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
