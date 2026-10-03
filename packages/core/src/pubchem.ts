/**
 * Shared, runtime-neutral PubChem retrieval and source-geometry boundary.
 *
 * No viewer store, analytics, chemistry inference, or application cache lives
 * here. Names resolve to CIDs before structure retrieval; source atom IDs,
 * coordinates, and bond orders survive the server-to-widget JSON boundary.
 *
 * Source contracts: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest and
 * https://www.ncbi.nlm.nih.gov/IEB/ToolBox/CPP_DOC/asn_spec/pcsubstance.asn.html
 */
import type { Frame } from './types';

export const PUBCHEM_PUG_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
export const PUBCHEM_MOLECULE_SCHEMA = 'lupi.pubchem.v1' as const;

export interface PubChemCompoundRef {
  name?: string;
  cid?: number;
}

export interface PubChemMolecule {
  schemaVersion: typeof PUBCHEM_MOLECULE_SCHEMA;
  cid: number;
  /** PubChem summary-page Title when retrieved through this module. */
  name: string;
  /** Source formula; 2D connection tables may leave hydrogens implicit. */
  formula: string;
  sourceUrl: string;
  recordUrl: string;
  retrievedAt: string;
  dimension: '3d' | '2d';
  coordinateUnits: 'angstrom' | 'depiction';
  atoms: { ids: number[]; elements: number[]; positions: number[] };
  bonds: { aid1: number[]; aid2: number[]; order: number[] };
}

export interface PubChemBounds {
  maxAtoms?: number;
  maxBonds?: number;
  maxResponseBytes?: number;
  maxCandidates?: number;
}

export interface PubChemFetchOptions extends PubChemBounds {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  /** Total deadline for lookup, metadata, and geometry together. */
  timeoutMs?: number;
  now?: () => Date;
}

export interface PubChemRecordContext {
  expectedCid?: number;
  /** Supply metadata from the CID-matched PubChem property table. */
  name?: string;
  formula?: string;
  recordUrl?: string;
  retrievedAt?: string;
  expectedDimension?: '3d' | '2d';
}

export type PubChemResolution =
  | { status: 'resolved'; molecule: PubChemMolecule }
  | { status: 'ambiguous'; cids: number[] };

export type PubChemErrorCode =
  | 'invalid_input' | 'not_found' | 'ambiguous' | 'timeout' | 'aborted'
  | 'upstream_error' | 'invalid_response' | 'too_large';

export class PubChemError extends Error {
  readonly code: PubChemErrorCode;
  readonly status?: number;
  readonly cids?: number[];
  constructor(code: PubChemErrorCode, message: string, details: { status?: number; cids?: number[] } = {}) {
    super(message);
    this.name = 'PubChemError';
    this.code = code;
    this.status = details.status;
    this.cids = details.cids;
  }
}

export const PUBCHEM_DEFAULT_BOUNDS: Readonly<Required<PubChemBounds>> = Object.freeze({
  maxAtoms: 5_000,
  maxBonds: 10_000,
  maxResponseBytes: 2_000_000,
  maxCandidates: 25,
});

type JsonObject = Record<string, unknown>;
const MAX_SOURCE_ID = 2_147_483_647; // The viewer stores source IDs as Int32.
const MAX_COORDINATE = 1_000_000;
// PC-BondType: no conversion of source orders to an inferred bond type.
const BOND_ORDERS = new Set([1, 2, 3, 4, 5, 6, 7, 255]);

function invalid(message: string): never {
  throw new PubChemError('invalid_response', message);
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`PubChem ${label} is missing or invalid.`);
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`PubChem ${label} must be an array.`);
  return value;
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    invalid(`PubChem ${label} must be a supported positive integer.`);
  }
  return value;
}

function textValue(value: unknown, label: string, maxLength = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(`PubChem ${label} is missing or invalid.`);
  }
  return value.trim();
}

function limits(options: PubChemBounds = {}): typeof PUBCHEM_DEFAULT_BOUNDS {
  const result = { ...PUBCHEM_DEFAULT_BOUNDS };
  for (const key of Object.keys(result) as Array<keyof typeof result>) {
    const value = options[key] ?? result[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > 20_000_000) {
      throw new PubChemError('invalid_input', `Invalid PubChem ${key} limit.`);
    }
    result[key] = value;
  }
  return result;
}

function sourceLink(cid: number): string {
  return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
}

function recordLink(cid: number, dimension: '2d' | '3d'): string {
  return `${PUBCHEM_PUG_BASE}/compound/cid/${cid}/record/JSON?record_type=${dimension}`;
}

/** Validate untrusted widget/cache JSON and return only the public fields. */
export function validatePubChemMolecule(value: unknown, bounds: PubChemBounds = {}): PubChemMolecule {
  const cap = limits(bounds);
  const molecule = object(value, 'molecule');
  if (molecule.schemaVersion !== PUBCHEM_MOLECULE_SCHEMA) invalid('Unsupported PubChem molecule schema.');
  const cid = positiveInteger(molecule.cid, 'CID');
  const dimension = molecule.dimension;
  if (dimension !== '2d' && dimension !== '3d') invalid('PubChem coordinate dimension must be 2d or 3d.');
  const coordinateUnits = dimension === '3d' ? 'angstrom' : 'depiction';
  if (molecule.coordinateUnits !== coordinateUnits) invalid('PubChem coordinate units do not match the dimension.');
  if (molecule.sourceUrl !== sourceLink(cid) || molecule.recordUrl !== recordLink(cid, dimension)) {
    invalid('PubChem source URLs do not match the compound identity and coordinate record.');
  }
  const retrievedAt = textValue(molecule.retrievedAt, 'retrieval timestamp', 40);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt))) {
    invalid('PubChem retrieval timestamp must be an ISO UTC timestamp.');
  }
  const atoms = object(molecule.atoms, 'atoms');
  const sourceIds = array(atoms.ids, 'atom IDs');
  const sourceElements = array(atoms.elements, 'elements');
  const sourcePositions = array(atoms.positions, 'coordinates');
  if (sourceIds.length < 1) invalid('PubChem returned no atoms.');
  if (sourceIds.length > cap.maxAtoms) throw new PubChemError('too_large', `PubChem structure exceeds ${cap.maxAtoms} atoms.`);
  if (sourceElements.length !== sourceIds.length || sourcePositions.length !== sourceIds.length * 3) {
    invalid('PubChem atom and coordinate array lengths do not match.');
  }
  const ids = sourceIds.map((id) => positiveInteger(id, 'atom ID', MAX_SOURCE_ID));
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) invalid('PubChem atom IDs must be unique.');
  const elements = sourceElements.map((element) => positiveInteger(element, 'atomic number', 118));
  const positions = sourcePositions.map((position, index) => {
    if (typeof position !== 'number' || !Number.isFinite(position) || Math.abs(position) > MAX_COORDINATE) {
      invalid('PubChem coordinates must be finite numbers within the supported bounds.');
    }
    if (dimension === '2d' && index % 3 === 2 && position !== 0) invalid('PubChem 2D coordinates must have z = 0.');
    return position;
  });
  const bonds = object(molecule.bonds, 'bonds');
  const sourceAid1 = array(bonds.aid1, 'bond aid1');
  const sourceAid2 = array(bonds.aid2, 'bond aid2');
  const sourceOrder = array(bonds.order, 'bond orders');
  if (sourceAid1.length > cap.maxBonds) throw new PubChemError('too_large', `PubChem structure exceeds ${cap.maxBonds} bonds.`);
  if (sourceAid2.length !== sourceAid1.length || sourceOrder.length !== sourceAid1.length) {
    invalid('PubChem bond endpoint and order array lengths do not match.');
  }
  const aid1 = sourceAid1.map((id) => positiveInteger(id, 'bond atom ID', MAX_SOURCE_ID));
  const aid2 = sourceAid2.map((id) => positiveInteger(id, 'bond atom ID', MAX_SOURCE_ID));
  const pairs = new Set<string>();
  const order = sourceOrder.map((value, index) => {
    if (typeof value !== 'number' || !BOND_ORDERS.has(value)) invalid('PubChem returned an unsupported source bond order.');
    const a = aid1[index], b = aid2[index];
    if (!idSet.has(a) || !idSet.has(b) || a === b) invalid('PubChem bond references an invalid atom.');
    const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (pairs.has(pair)) invalid('PubChem returned a duplicate bond.');
    pairs.add(pair);
    return value;
  });
  return {
    schemaVersion: PUBCHEM_MOLECULE_SCHEMA, cid,
    name: textValue(molecule.name, 'compound name'),
    formula: textValue(molecule.formula, 'molecular formula'),
    sourceUrl: sourceLink(cid), recordUrl: recordLink(cid, dimension), retrievedAt,
    dimension, coordinateUnits, atoms: { ids, elements, positions }, bonds: { aid1, aid2, order },
  };
}

function recordProperty(compound: JsonObject, label: string, name?: string): string | undefined {
  if (!Array.isArray(compound.props)) return undefined;
  for (const entry of compound.props) {
    const prop = object(entry, 'property');
    const urn = object(prop.urn, 'property URN');
    if (urn.label === label && (name === undefined || urn.name === name)) {
      const value = object(prop.value, 'property value');
      if (typeof value.sval === 'string') return value.sval;
    }
  }
  return undefined;
}

/** Parse exactly one CID record. Coordinate ordering follows coords.aid. */
export function parsePubChemRecord(
  value: unknown,
  context: PubChemRecordContext = {},
  bounds: PubChemBounds = {},
): PubChemMolecule {
  const compounds = array(object(value, 'record').PC_Compounds, 'compound records');
  if (compounds.length !== 1) invalid('PubChem must return exactly one resolved compound.');
  const compound = object(compounds[0], 'compound');
  const cid = positiveInteger(object(object(compound.id, 'identifier').id, 'compound identifier').cid, 'CID');
  if (context.expectedCid !== undefined && cid !== context.expectedCid) invalid('PubChem returned a different CID from the resolved compound.');
  const atoms = object(compound.atoms, 'atoms');
  const ids = array(atoms.aid, 'atom IDs');
  const elements = array(atoms.element, 'elements');
  const cap = limits(bounds);
  if (ids.length > cap.maxAtoms) throw new PubChemError('too_large', `PubChem structure exceeds ${cap.maxAtoms} atoms.`);
  if (!ids.length || elements.length !== ids.length) invalid('PubChem atom array lengths do not match.');
  const coordinateSets = array(compound.coords, 'coordinates');
  if (!coordinateSets.length) invalid('PubChem returned a record without atom coordinates.');
  const coords = object(coordinateSets[0], 'coordinate set');
  const types = array(coords.type, 'coordinate type flags');
  if (types.some((flag) => typeof flag !== 'number' || !Number.isInteger(flag))) invalid('PubChem coordinate flags must be integers.');
  if (types.includes(1) === types.includes(2)) invalid('PubChem must identify exactly one coordinate dimension.');
  const dimension = types.includes(2) ? '3d' : '2d';
  if (context.expectedDimension && dimension !== context.expectedDimension) invalid('PubChem returned the wrong coordinate dimension.');
  const unitFlags = types.filter((flag) => [10, 11, 12, 13, 14, 255].includes(flag as number));
  if (unitFlags.length !== 1) invalid('PubChem must identify one coordinate unit convention.');
  if (dimension === '3d' && unitFlags[0] !== 10) invalid('PubChem 3D coordinates must be source-declared angstroms.');
  const coordinateIds = array(coords.aid, 'coordinate atom IDs');
  if (coordinateIds.length !== ids.length) invalid('PubChem coordinate atom IDs do not cover all atoms.');
  const indexById = new Map<number, number>();
  coordinateIds.forEach((aid, index) => {
    const id = positiveInteger(aid, 'coordinate atom ID', MAX_SOURCE_ID);
    if (indexById.has(id)) invalid('PubChem coordinate atom IDs must be unique.');
    indexById.set(id, index);
  });
  const conformers = array(coords.conformers, 'conformers');
  if (!conformers.length) invalid('PubChem returned a record without atom coordinates.');
  const conformer = object(conformers[0], 'conformer');
  const xs = array(conformer.x, 'x coordinates');
  const ys = array(conformer.y, 'y coordinates');
  const zs = dimension === '3d' ? array(conformer.z, 'z coordinates') : undefined;
  if (xs.length !== ids.length || ys.length !== ids.length || (zs && zs.length !== ids.length)) {
    invalid('PubChem record is missing coordinates for some atoms.');
  }
  if (dimension === '2d' && conformer.z !== undefined) {
    const suppliedZs = array(conformer.z, '2D z coordinates');
    if (suppliedZs.length !== ids.length || suppliedZs.some((z) => z !== 0)) invalid('PubChem 2D record has inconsistent z coordinates.');
  }
  const positions: unknown[] = [];
  for (const aid of ids) {
    const index = indexById.get(positiveInteger(aid, 'atom ID', MAX_SOURCE_ID));
    if (index === undefined) invalid('PubChem coordinates reference a different atom ID set.');
    positions.push(xs[index], ys[index], zs ? zs[index] : 0);
  }
  // A missing bonds section is a valid source record with no bonds (e.g. a
  // single atom). A partially supplied section is rejected by the validator.
  const bonds = compound.bonds === undefined ? { aid1: [], aid2: [], order: [] } : object(compound.bonds, 'bonds');
  return validatePubChemMolecule({
    schemaVersion: PUBCHEM_MOLECULE_SCHEMA, cid,
    name: context.name ?? recordProperty(compound, 'IUPAC Name', 'Preferred') ?? `PubChem CID ${cid}`,
    // Some full 3D records omit this metadata. The network path always passes
    // the CID-matched source formula; standalone parsers expose its absence.
    formula: context.formula ?? recordProperty(compound, 'Molecular Formula') ?? 'Unknown',
    sourceUrl: sourceLink(cid),
    recordUrl: context.recordUrl ?? recordLink(cid, dimension),
    retrievedAt: context.retrievedAt ?? new Date().toISOString(),
    dimension, coordinateUnits: dimension === '3d' ? 'angstrom' : 'depiction',
    atoms: { ids, elements, positions }, bonds,
  }, bounds);
}

/** Convert checked source geometry to the existing Lupi renderer Frame. */
export function frameFromPubChemMolecule(value: PubChemMolecule): Frame {
  const molecule = validatePubChemMolecule(value);
  const { ids, elements, positions } = molecule.atoms;
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const pairs = new Int32Array(molecule.bonds.aid1.length * 2);
  for (let i = 0; i < molecule.bonds.aid1.length; i++) {
    pairs[i * 2] = indexById.get(molecule.bonds.aid1[i])!;
    pairs[i * 2 + 1] = indexById.get(molecule.bonds.aid2[i])!;
  }
  const boxBounds = new Float64Array([Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
  for (let i = 0; i < positions.length; i++) {
    const axis = (i % 3) * 2;
    boxBounds[axis] = Math.min(boxBounds[axis], positions[i] - 2);
    boxBounds[axis + 1] = Math.max(boxBounds[axis + 1], positions[i] + 2);
  }
  return {
    timestep: 0, natoms: ids.length, boxBounds, boxTilt: new Float64Array(3), triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'], ids: Int32Array.from(ids), types: Int32Array.from(elements),
    positions: Float32Array.from(positions), bonds: pairs, properties: new Map(),
    identity: { kind: 'source-id', unique: true },
    typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    distanceSemantics: molecule.coordinateUnits === 'angstrom'
      ? { kind: 'angstrom', provenance: 'source-declared' }
      : { kind: 'unknown', provenance: 'legacy-unknown' },
  };
}

function validateReference(ref: PubChemCompoundRef): { name: string } | { cid: number } {
  if (!ref || typeof ref !== 'object') throw new PubChemError('invalid_input', 'A PubChem name or CID is required.');
  if (ref.cid !== undefined) {
    if (!Number.isSafeInteger(ref.cid) || ref.cid < 1) throw new PubChemError('invalid_input', 'A PubChem CID must be a positive integer.');
    if (ref.name !== undefined && (typeof ref.name !== 'string' || ref.name.trim())) {
      throw new PubChemError('invalid_input', 'Provide either a PubChem name or a CID, not both.');
    }
    return { cid: ref.cid };
  }
  if (typeof ref.name !== 'string' || !ref.name.trim() || ref.name.length > 200 || /[\u0000-\u001f\u007f]/.test(ref.name)) {
    throw new PubChemError('invalid_input', 'A PubChem name must contain 1–200 characters.');
  }
  return { name: ref.name.trim() };
}

async function boundedJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new PubChemError('too_large', `PubChem response exceeds ${maxBytes} bytes.`);
  }
  if (!response.body) invalid('PubChem returned an empty response.');
  const reader = response.body.getReader();
  const onAbort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new PubChemError('too_large', `PubChem response exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return invalid('PubChem returned invalid JSON.'); }
}

/**
 * One bounded operation; the race also covers injected transports that ignore
 * AbortSignal. Callers own any shared rate limiting and validated caching.
 */
export async function resolvePubChemMolecule(ref: PubChemCompoundRef, options: PubChemFetchOptions = {}): Promise<PubChemResolution> {
  const input = validateReference(ref);
  const cap = limits(options);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new PubChemError('invalid_input', 'Invalid PubChem deadline.');
  if (options.signal?.aborted) throw new PubChemError('aborted', 'PubChem lookup was cancelled.');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new PubChemError('upstream_error', 'PubChem network access is unavailable.');
  const expiresAt = performance.now() + timeoutMs;
  const controller = new AbortController();
  let stopped: PubChemError | undefined;
  let rejectDeadline: (error: PubChemError) => void;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const stop = (code: 'timeout' | 'aborted') => {
    if (stopped) return;
    stopped = new PubChemError(code, code === 'timeout' ? 'PubChem lookup timed out. Try again.' : 'PubChem lookup was cancelled.');
    controller.abort(stopped);
    rejectDeadline(stopped);
  };
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  const onAbort = () => stop('aborted');
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const checkActive = () => {
    // Microtasks and synchronous parsing can finish before an overdue timer
    // runs. Check the monotonic deadline at each boundary as well.
    if (!stopped && performance.now() >= expiresAt) stop('timeout');
    if (stopped) throw stopped;
    if (controller.signal.aborted) throw new PubChemError('aborted', 'PubChem lookup was cancelled.');
  };
  const request = async (url: string): Promise<unknown> => {
    checkActive();
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
    checkActive();
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 404) throw new PubChemError('not_found', 'PubChem did not find the requested record.', { status: 404 });
      if (response.status === 504) throw new PubChemError('timeout', 'PubChem reported an upstream timeout. Try again.', { status: 504 });
      throw new PubChemError('upstream_error', `PubChem is unavailable (HTTP ${response.status}). Try again later.`, { status: response.status });
    }
    if (response.status !== 200) invalid(`PubChem returned unexpected HTTP ${response.status}.`);
    const json = await boundedJson(response, cap.maxResponseBytes, controller.signal);
    checkActive();
    return json;
  };
  const run = async (): Promise<PubChemResolution> => {
    let cid: number;
    if ('cid' in input) cid = input.cid;
    else {
      let lookup: unknown;
      try { lookup = await request(`${PUBCHEM_PUG_BASE}/compound/name/${encodeURIComponent(input.name)}/cids/JSON?name_type=complete`); }
      catch (error) {
        if (error instanceof PubChemError && error.code === 'not_found') {
          throw new PubChemError('not_found', `PubChem has no compound named "${input.name}". Try another spelling or a CID.`, { status: 404 });
        }
        throw error;
      }
      const values = array(object(object(lookup, 'name lookup').IdentifierList, 'identifier list').CID, 'resolved CIDs');
      if (values.length > cap.maxCandidates) throw new PubChemError('too_large', 'PubChem returned too many possible compounds. Use a more specific name or a CID.');
      const cids = [...new Set(values.map((value) => positiveInteger(value, 'resolved CID')))];
      if (!cids.length) throw new PubChemError('not_found', `PubChem has no compound named "${input.name}".`, { status: 404 });
      if (cids.length > 1) return { status: 'ambiguous', cids };
      cid = cids[0];
    }
    const structure = async () => {
      let dimension: '3d' | '2d' = '3d';
      let record: unknown;
      try { record = await request(recordLink(cid, '3d')); }
      catch (error) {
        if (!(error instanceof PubChemError) || error.code !== 'not_found' || error.status !== 404) throw error;
        dimension = '2d';
        record = await request(recordLink(cid, '2d'));
      }
      return { record, dimension };
    };
    const [geometry, propertiesJson] = await Promise.all([
      structure(),
      request(`${PUBCHEM_PUG_BASE}/compound/cid/${cid}/property/Title,MolecularFormula/JSON`),
    ]);
    const properties = array(object(object(propertiesJson, 'property response').PropertyTable, 'property table').Properties, 'properties');
    if (properties.length !== 1) invalid('PubChem metadata must describe exactly one compound.');
    const propertiesRow = object(properties[0], 'compound properties');
    if (positiveInteger(propertiesRow.CID, 'metadata CID') !== cid) invalid('PubChem metadata does not match the resolved CID.');
    checkActive();
    const molecule = parsePubChemRecord(geometry.record, {
      expectedCid: cid, expectedDimension: geometry.dimension,
      name: textValue(propertiesRow.Title, 'compound title'), formula: textValue(propertiesRow.MolecularFormula, 'molecular formula'),
      recordUrl: recordLink(cid, geometry.dimension), retrievedAt: (options.now?.() ?? new Date()).toISOString(),
    }, options);
    checkActive();
    return { status: 'resolved', molecule };
  };
  try { return await Promise.race([run(), deadline]); }
  catch (error) {
    controller.abort();
    if (error instanceof PubChemError) throw error;
    throw new PubChemError('upstream_error', 'Unable to retrieve the compound from PubChem. Try again.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** Browser convenience wrapper: ambiguity is explicit and never auto-selected. */
export async function fetchPubChemMolecule(ref: PubChemCompoundRef, options: PubChemFetchOptions = {}): Promise<PubChemMolecule> {
  const result = await resolvePubChemMolecule(ref, options);
  if (result.status === 'ambiguous') {
    throw new PubChemError('ambiguous', `PubChem found multiple compounds. Choose a CID: ${result.cids.join(', ')}.`, { cids: result.cids });
  }
  return result.molecule;
}
