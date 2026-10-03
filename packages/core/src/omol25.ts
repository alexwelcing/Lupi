/** A bounded, source-attributed OMol25 structure for the embedded viewer. */
import { getAtomicNumberBySymbol } from './elements';
import type { Frame } from './types';

export const OMOL25_MOLECULE_SCHEMA = 'lupi.omol25.v1' as const;
export const MAX_OMOL25_WIDGET_ATOMS = 1_000;

export interface Omol25Molecule {
  schemaVersion: typeof OMOL25_MOLECULE_SCHEMA;
  source: 'OMol25';
  collection: string;
  rowIndex: number;
  repository: string;
  coverage: 'complete' | 'indexed-preview';
  configurationId: string | null;
  propertyId: string | null;
  name: string;
  formula: string;
  sourceUrl: string;
  recordUrl: string;
  websiteUrl: string;
  retrievedAt: string;
  dimension: '3d';
  coordinateUnits: 'angstrom';
  atomIdKind: 'synthetic-row';
  bondTopology: 'not-provided';
  atoms: { ids: number[]; elements: number[]; positions: number[] };
  bonds: { aid1: []; aid2: []; order: [] };
}

export interface Omol25RowIdentity {
  rowIndex: number;
  repository: string;
  coverage: 'complete' | 'indexed-preview';
  configurationId: string | null;
  propertyId: string | null;
  name: string | null;
  formula: string;
  atomCount: number;
}

const COLLECTION = /^[a-z0-9-]+$/;
const REPOSITORY = /^colabfit\/OMol25_[A-Za-z0-9_]+$/;

export function omol25StructurePath(collection: string, rowIndex: number): string {
  if (!COLLECTION.test(collection) || !Number.isSafeInteger(rowIndex) || rowIndex < 0) {
    throw new Error('Invalid OMol25 collection or row index.');
  }
  return `/v1/datasets/omol25/${collection}/structures/${rowIndex}.xyz`;
}

/** XYZ supplies atomic numbers and coordinates, but no atom IDs or bonds. */
export function moleculeFromOmol25Xyz(
  xyz: string,
  collection: string,
  row: Omol25RowIdentity,
  retrievedAt = new Date().toISOString(),
): Omol25Molecule {
  const path = omol25StructurePath(collection, row.rowIndex);
  if (!REPOSITORY.test(row.repository) || !['complete', 'indexed-preview'].includes(row.coverage)) {
    throw new Error('Unsupported OMol25 source repository.');
  }
  const lines = xyz.trimEnd().split(/\r?\n/);
  const count = Number(lines[0]);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_OMOL25_WIDGET_ATOMS || count !== row.atomCount || lines.length !== count + 2) {
    throw new Error('OMol25 structure has an invalid atom count.');
  }
  if (!lines[1].includes(`OMol25 ${collection} row=${row.rowIndex}`) || !lines[1].includes('bonds=not-provided')) {
    throw new Error('OMol25 structure provenance does not match its row.');
  }
  const elements: number[] = [];
  const positions: number[] = [];
  for (const line of lines.slice(2)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== 4) throw new Error('OMol25 structure contains a malformed atom.');
    const element = getAtomicNumberBySymbol(tokens[0]);
    const coordinates = tokens.slice(1).map(Number);
    if (!element || coordinates.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000)) {
      throw new Error('OMol25 structure contains an unsupported atom or coordinate.');
    }
    elements.push(element);
    positions.push(...coordinates);
  }
  const websiteUrl = new URL('https://lupi.live/');
  websiteUrl.searchParams.set('load', path);
  return {
    schemaVersion: OMOL25_MOLECULE_SCHEMA,
    source: 'OMol25', collection, rowIndex: row.rowIndex,
    repository: row.repository, coverage: row.coverage,
    configurationId: row.configurationId, propertyId: row.propertyId,
    name: row.name || row.formula, formula: row.formula,
    sourceUrl: `https://huggingface.co/datasets/${row.repository}`,
    recordUrl: `https://lupi.live${path}`,
    websiteUrl: websiteUrl.toString(), retrievedAt,
    dimension: '3d', coordinateUnits: 'angstrom',
    atomIdKind: 'synthetic-row', bondTopology: 'not-provided',
    atoms: { ids: Array.from({ length: count }, (_, index) => index + 1), elements, positions },
    bonds: { aid1: [], aid2: [], order: [] },
  };
}

export function validateOmol25Molecule(value: unknown): Omol25Molecule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid OMol25 molecule.');
  const molecule = value as Omol25Molecule;
  if (molecule.schemaVersion !== OMOL25_MOLECULE_SCHEMA || molecule.source !== 'OMol25'
    || molecule.dimension !== '3d' || molecule.coordinateUnits !== 'angstrom'
    || molecule.atomIdKind !== 'synthetic-row' || molecule.bondTopology !== 'not-provided'
    || !REPOSITORY.test(molecule.repository) || !COLLECTION.test(molecule.collection)
    || !Number.isSafeInteger(molecule.rowIndex) || molecule.rowIndex < 0
    || typeof molecule.name !== 'string' || !molecule.name || typeof molecule.formula !== 'string' || !molecule.formula
    || !Array.isArray(molecule.atoms?.ids) || !Array.isArray(molecule.atoms?.elements) || !Array.isArray(molecule.atoms?.positions)
    || molecule.atoms.ids.length < 1 || molecule.atoms.ids.length > MAX_OMOL25_WIDGET_ATOMS
    || molecule.atoms.elements.length !== molecule.atoms.ids.length || molecule.atoms.positions.length !== molecule.atoms.ids.length * 3
    || molecule.atoms.ids.some((id, index) => id !== index + 1)
    || molecule.atoms.elements.some((number) => !Number.isInteger(number) || number < 1 || number > 118)
    || molecule.atoms.positions.some((position) => !Number.isFinite(position) || Math.abs(position) > 1_000_000)
    || !Array.isArray(molecule.bonds?.aid1) || molecule.bonds.aid1.length !== 0
    || !Array.isArray(molecule.bonds?.aid2) || molecule.bonds.aid2.length !== 0
    || !Array.isArray(molecule.bonds?.order) || molecule.bonds.order.length !== 0) {
    throw new Error('Invalid OMol25 molecule.');
  }
  const path = omol25StructurePath(molecule.collection, molecule.rowIndex);
  const websiteUrl = new URL('https://lupi.live/');
  websiteUrl.searchParams.set('load', path);
  if ((molecule.coverage !== 'complete' && molecule.coverage !== 'indexed-preview')
    || (molecule.configurationId !== null && (typeof molecule.configurationId !== 'string' || molecule.configurationId.length > 256))
    || (molecule.propertyId !== null && (typeof molecule.propertyId !== 'string' || molecule.propertyId.length > 256))
    || !Number.isFinite(Date.parse(molecule.retrievedAt))) throw new Error('Invalid OMol25 provenance.');
  if (molecule.sourceUrl !== `https://huggingface.co/datasets/${molecule.repository}`
    || molecule.recordUrl !== `https://lupi.live${path}`
    || molecule.websiteUrl !== websiteUrl.toString()) throw new Error('Invalid OMol25 source URLs.');
  return molecule;
}

export function frameFromOmol25Molecule(value: Omol25Molecule): Frame {
  const molecule = validateOmol25Molecule(value);
  const positions = molecule.atoms.positions;
  const boxBounds = new Float64Array([Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
  for (let index = 0; index < positions.length; index++) {
    const axis = (index % 3) * 2;
    boxBounds[axis] = Math.min(boxBounds[axis], positions[index] - 2);
    boxBounds[axis + 1] = Math.max(boxBounds[axis + 1], positions[index] + 2);
  }
  return {
    timestep: 0, natoms: molecule.atoms.ids.length, boxBounds,
    boxTilt: new Float64Array(3), triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: Int32Array.from(molecule.atoms.ids), types: Int32Array.from(molecule.atoms.elements),
    positions: Float32Array.from(positions), bonds: new Int32Array(0), properties: new Map(),
    identity: { kind: 'synthetic-row', unique: true },
    typeSemantics: { kind: 'atomic-number', provenance: 'xyz-element-token' },
    distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
  };
}
