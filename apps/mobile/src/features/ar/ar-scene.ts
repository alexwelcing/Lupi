import {
  ELEMENT_DATA,
  getElementSpecBySymbol,
  type ElementData,
} from "@atlas/core/elements";

export const MOLECULE_AR_SCENE_VERSION = "lupi.ar-scene.v1" as const;
export const NATIVE_AR_MAX_ATOMS = 512;
export const NATIVE_AR_MAX_BONDS = 2_048;
export const NATIVE_AR_TARGET_EXTENT_METERS = 0.32;

const MAX_XYZ_TEXT_LENGTH = 250_000;
const MAX_COORDINATE_ABS = 1_000_000;
const MAX_COORDINATE_TOKEN_LENGTH = 32;
const BOND_TOLERANCE_ANGSTROM = 0.45;
const MIN_BOND_DISTANCE_ANGSTROM = 0.1;

export type ArVector3 = [number, number, number];

export interface MoleculeArAtom {
  atomicNumber: number;
  color: string;
  element: string;
  index: number;
  name: string;
  positionAngstrom: ArVector3;
  positionMeters: ArVector3;
  radiusMeters: number;
}

export interface MoleculeArBond {
  a: number;
  b: number;
}

export interface MoleculeArScene {
  version: typeof MOLECULE_AR_SCENE_VERSION;
  molecule: {
    atomCount: number;
    formula?: string;
    id?: string;
    name: string;
  };
  units: "angstrom";
  targetExtentMeters: number;
  extentMeters: ArVector3;
  atoms: MoleculeArAtom[];
  bonds: MoleculeArBond[];
  source: {
    bridgeVersion?: string;
    moleculeKey: string;
  };
}

export interface MoleculeArSceneMetadata {
  bridgeVersion?: string;
  expectedAtomCount?: number;
  formula?: string;
  id?: string;
  moleculeKey: string;
  name: string;
}

interface ParsedAtom {
  atomicNumber: number;
  element: string;
  position: ArVector3;
  spec: ElementData;
}

const ATOMIC_NUMBER_BY_SYMBOL = new Map(
  Object.entries(ELEMENT_DATA).map(([atomicNumber, spec]) => [
    spec.symbol,
    Number(atomicNumber),
  ]),
);

export function moleculeArSceneFromExportResult(
  result: Record<string, unknown> | undefined,
  metadata: MoleculeArSceneMetadata,
): MoleculeArScene {
  const exported = asRecord(result?.export);
  if (exported?.format !== "xyz" || typeof exported.contents !== "string") {
    throw new Error("The viewer did not return a valid XYZ frame for AR.");
  }

  return moleculeArSceneFromXyz(exported.contents, metadata);
}

export function moleculeArSceneFromXyz(
  xyz: string,
  metadata: MoleculeArSceneMetadata,
): MoleculeArScene {
  if (!metadata.moleculeKey.trim()) {
    throw new Error("The AR molecule identity is missing.");
  }
  if (!metadata.name.trim()) {
    throw new Error("The AR molecule name is missing.");
  }
  if (xyz.length > MAX_XYZ_TEXT_LENGTH) {
    throw new Error("This structure is too large to prepare for native AR.");
  }

  const normalized = xyz
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const lines = normalized.split("\n");
  const atomCount = Number(lines[0]?.trim());
  if (!Number.isSafeInteger(atomCount) || atomCount < 1) {
    throw new Error("The AR export has an invalid atom count.");
  }
  if (atomCount > NATIVE_AR_MAX_ATOMS) {
    throw new Error(
      `Native room view currently supports up to ${NATIVE_AR_MAX_ATOMS.toLocaleString()} atoms; this structure has ${atomCount.toLocaleString()}.`,
    );
  }
  if (
    metadata.expectedAtomCount !== undefined &&
    metadata.expectedAtomCount !== atomCount
  ) {
    throw new Error(
      "The molecule changed while its AR scene was being prepared. Try again.",
    );
  }
  if (lines.length < atomCount + 2) {
    throw new Error("The AR export is missing atom rows.");
  }

  const parsedAtoms: ParsedAtom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const row = lines[index + 2]?.trim().split(/\s+/) ?? [];
    const element = canonicalElementSymbol(row[0]);
    const coordinates = row.slice(1, 4);
    if (!element || coordinates.length !== 3) {
      throw new Error(`AR atom row ${index + 1} is invalid.`);
    }
    const spec = getElementSpecBySymbol(element);
    const atomicNumber = ATOMIC_NUMBER_BY_SYMBOL.get(element);
    if (!spec || atomicNumber === undefined) {
      throw new Error(`Element ${element} is not supported by native AR.`);
    }
    if (
      !coordinates.every(
        (coordinate) =>
          coordinate.length <= MAX_COORDINATE_TOKEN_LENGTH &&
          Number.isFinite(Number(coordinate)) &&
          Math.abs(Number(coordinate)) <= MAX_COORDINATE_ABS,
      )
    ) {
      throw new Error(`AR atom row ${index + 1} has invalid coordinates.`);
    }
    parsedAtoms.push({
      atomicNumber,
      element,
      position: coordinates.map(Number) as ArVector3,
      spec,
    });
  }

  const bounds = moleculeBounds(parsedAtoms.map((atom) => atom.position));
  const maximumSpan = Math.max(...bounds.span, 1);
  const metersPerAngstrom = NATIVE_AR_TARGET_EXTENT_METERS / maximumSpan;
  const atoms = parsedAtoms.map(
    (atom, index): MoleculeArAtom => ({
      atomicNumber: atom.atomicNumber,
      color: atom.spec.color,
      element: atom.element,
      index,
      name: atom.spec.name,
      positionAngstrom: atom.position,
      positionMeters: subtractAndScale(
        atom.position,
        bounds.center,
        metersPerAngstrom,
      ),
      radiusMeters: clamp(
        atom.spec.displayRadius * metersPerAngstrom,
        0.006,
        0.03,
      ),
    }),
  );
  const bonds = inferMoleculeBonds(parsedAtoms);

  return {
    version: MOLECULE_AR_SCENE_VERSION,
    molecule: {
      atomCount,
      ...(metadata.formula?.trim()
        ? { formula: metadata.formula.trim().slice(0, 96) }
        : {}),
      ...(metadata.id?.trim() ? { id: metadata.id.trim().slice(0, 128) } : {}),
      name: metadata.name.trim().slice(0, 160),
    },
    units: "angstrom",
    targetExtentMeters: NATIVE_AR_TARGET_EXTENT_METERS,
    extentMeters: bounds.span.map(
      (span) => span * metersPerAngstrom,
    ) as ArVector3,
    atoms,
    bonds,
    source: {
      ...(metadata.bridgeVersion
        ? { bridgeVersion: metadata.bridgeVersion.slice(0, 128) }
        : {}),
      moleculeKey: metadata.moleculeKey,
    },
  };
}

export function atomDistanceAngstrom(
  first: MoleculeArAtom,
  second: MoleculeArAtom,
): number {
  return distance(first.positionAngstrom, second.positionAngstrom);
}

function inferMoleculeBonds(atoms: ParsedAtom[]): MoleculeArBond[] {
  const bonds: MoleculeArBond[] = [];
  for (let a = 0; a < atoms.length; a += 1) {
    for (let b = a + 1; b < atoms.length; b += 1) {
      const separation = distance(atoms[a].position, atoms[b].position);
      const cutoff =
        atoms[a].spec.radius + atoms[b].spec.radius + BOND_TOLERANCE_ANGSTROM;
      if (separation >= MIN_BOND_DISTANCE_ANGSTROM && separation <= cutoff) {
        bonds.push({ a, b });
        if (bonds.length > NATIVE_AR_MAX_BONDS) {
          throw new Error(
            "This structure has too many bonds for the current native AR renderer.",
          );
        }
      }
    }
  }
  return bonds;
}

function moleculeBounds(positions: ArVector3[]): {
  center: ArVector3;
  span: ArVector3;
} {
  const minimum: ArVector3 = [Infinity, Infinity, Infinity];
  const maximum: ArVector3 = [-Infinity, -Infinity, -Infinity];
  for (const position of positions) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], position[axis]);
      maximum[axis] = Math.max(maximum[axis], position[axis]);
    }
  }
  return {
    center: minimum.map(
      (value, axis) => (value + maximum[axis]) / 2,
    ) as ArVector3,
    span: minimum.map((value, axis) => maximum[axis] - value) as ArVector3,
  };
}

function subtractAndScale(
  value: ArVector3,
  origin: ArVector3,
  scale: number,
): ArVector3 {
  return value.map(
    (coordinate, axis) => (coordinate - origin[axis]) * scale,
  ) as ArVector3;
}

function canonicalElementSymbol(value: string | undefined): string | null {
  if (!value || !/^[A-Za-z]{1,3}$/.test(value)) return null;
  return `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function distance(first: ArVector3, second: ArVector3): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
