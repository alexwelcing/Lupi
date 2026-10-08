/** A bounded, source-attributed OMol25 structure for the embedded viewer. */
import { getAtomicNumberBySymbol } from '../elements';
import type { Frame, FrameChemistry } from '../types';
import { DEFAULT_BOND_TOLERANCE, MOLECULAR_RECIPE_ID, perceiveBonds, type PerceivedBonds } from '../bonds';

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
  /** Whole-structure charge and spin from the edge XYZ comment, never per-atom charges. */
  chemistry?: FrameChemistry;
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
  const chemistry = chemistryFromOmol25Comment(lines[1]);
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
    atomIdKind: 'synthetic-row', bondTopology: 'not-provided', chemistry,
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
  if (molecule.chemistry !== undefined) validateChemistry(molecule.chemistry);
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
    periodic: false,
    ...(molecule.chemistry ? { chemistry: molecule.chemistry } : {}),
  };
}

/** Do not read ColabFit's unrelated multiplicity column. The edge has already
 * converted property_metadata.spin into the declared XYZ multiplicity. */
function chemistryFromOmol25Comment(comment: string): FrameChemistry {
  const fields = new Map(comment.split(' | ').map((part) => {
    const at = part.indexOf('=');
    return [part.slice(0, at), part.slice(at + 1)];
  }));
  const source = fields.get('charge_source') ?? 'unavailable';
  const result = {
    totalCharge: fields.has('charge') ? Number(fields.get('charge')) : null,
    spinMultiplicity: fields.has('multiplicity') ? Number(fields.get('multiplicity')) : null,
    source,
    domain: fields.get('data_id') ?? null,
  };
  validateChemistry(result);
  return result as FrameChemistry;
}

function validateChemistry(value: unknown): asserts value is FrameChemistry {
  if (!value || typeof value !== 'object') throw new Error('Invalid OMol25 chemistry.');
  const c = value as FrameChemistry;
  if (!['record', 'split-definition', 'unavailable'].includes(c.source)
    || c.totalCharge !== null && (!Number.isSafeInteger(c.totalCharge) || Math.abs(c.totalCharge) > 1000)
    || c.spinMultiplicity !== null && (!Number.isSafeInteger(c.spinMultiplicity) || c.spinMultiplicity < 1 || c.spinMultiplicity > 2001)
    || c.source === 'unavailable' && (c.totalCharge !== null || c.spinMultiplicity !== null)
    || c.domain !== null && (typeof c.domain !== 'string' || c.domain.length > 256)) {
    throw new Error('Invalid OMol25 chemistry.');
  }
}

/** The same released recipe and Float32 coordinates as the standalone viewer.
 * Estimated pairs NEVER become molecule.bonds or Frame.bonds (source-only).
 * Charge/spin are provenance, not inputs to this geometry-based v1 recipe. */
export function estimateOmol25Bonds(value: Omol25Molecule): PerceivedBonds {
  const molecule = validateOmol25Molecule(value);
  return perceiveBonds({
    atomicNumbers: molecule.atoms.elements,
    positions: Float32Array.from(molecule.atoms.positions),
    natoms: molecule.atoms.ids.length,
    recipe: MOLECULAR_RECIPE_ID,
    tolerance: DEFAULT_BOND_TOLERANCE,
  });
}

/** Counts describe the inferred graph, not the source and not a confidence score.
 * Ionic contacts are reported separately and never added to bondCount. */
export function omol25BondSummary(p: PerceivedBonds) {
  const { covalent, coordination, ionicContact, ...evidence } = p.counts;
  return {
    bondSource: 'inferred' as const,
    sourceBondTopology: 'not-provided' as const,
    bondRecipe: p.recipe,
    bondCount: covalent + coordination,
    contactCount: ionicContact,
    bondKinds: { covalent, coordination, ionicContact },
    bondEvidence: evidence,
    bondParameters: { ...p.params },
    bondOrders: 'not-estimated' as const,
  };
}
