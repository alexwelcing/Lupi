import { getElementSpec, type Frame } from '@atlas/core';
import {
  frameFromPubChemMolecule,
  validatePubChemMolecule,
  type PubChemMolecule,
} from '@atlas/core/pubchem';

export interface MoleculeView {
  style: 'ball-and-stick' | 'spacefill';
  highlightAtomIds: number[];
  highlightElements: string[];
}

export interface MoleculeCard {
  molecule: PubChemMolecule;
  frame: Frame;
  structureRef: string;
  view: MoleculeView;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseView(value: unknown, molecule: PubChemMolecule): MoleculeView {
  const data = object(value);
  if (!data || (data.style !== 'ball-and-stick' && data.style !== 'spacefill')) {
    throw new Error('The viewer received unsupported display options. Ask Lupi to show the molecule again.');
  }
  const selected = data.highlightAtomIds;
  if (!Array.isArray(selected) || selected.length > molecule.atoms.ids.length) {
    throw new Error('The viewer received an invalid atom selection.');
  }
  const sourceIds = new Set(molecule.atoms.ids);
  if (!selected.every((id): id is number => typeof id === 'number' && Number.isInteger(id) && sourceIds.has(id))) {
    throw new Error('The atom selection does not belong to this PubChem structure.');
  }
  const elements = data.highlightElements ?? [];
  const sourceSymbols = new Set(molecule.atoms.elements.map((number) => getElementSpec(number).symbol));
  if (!Array.isArray(elements) || !elements.every((symbol): symbol is string => typeof symbol === 'string' && sourceSymbols.has(symbol))) {
    throw new Error('The element selection does not belong to this PubChem structure.');
  }
  const selectedIds = new Set(selected);
  if (elements.some((symbol) => molecule.atoms.ids.some((id, index) =>
    getElementSpec(molecule.atoms.elements[index]).symbol === symbol && !selectedIds.has(id)))) {
    throw new Error('The named element selection and selected source atom IDs disagree.');
  }
  return {
    style: data.style,
    highlightAtomIds: [...new Set(selected)].sort((a, b) => a - b),
    highlightElements: [...new Set(elements)].sort(),
  };
}

/** Parse a complete per-call result. Never infer identity from a previous
 * widget, the last compound in a global store, or model-authored geometry. */
export function readMoleculeToolResult(value: unknown): MoleculeCard {
  const result = object(value);
  const summary = object(result?.structuredContent);
  const metadata = object(result?._meta);
  if (result?.isError || summary?.status !== 'shown') {
    throw new Error('This request did not return a molecule to display. Ask Lupi to resolve the PubChem name or CID again.');
  }
  const molecule = validatePubChemMolecule(metadata?.molecule);
  if (summary.cid !== molecule.cid || summary.name !== molecule.name ||
      (summary.dimension !== undefined && summary.dimension !== molecule.dimension)) {
    throw new Error('The visible structure and tool summary disagree. The card has not rendered that result.');
  }
  const facts: Record<string, unknown> = {
    formula: molecule.formula, sourceUrl: molecule.sourceUrl,
    recordUrl: molecule.recordUrl, coordinateUnits: molecule.coordinateUnits,
    atomCount: molecule.atoms.ids.length, bondCount: molecule.bonds.aid1.length,
  };
  if (Object.entries(facts).some(([key, expected]) => summary[key] !== undefined && summary[key] !== expected)) {
    throw new Error('The source record and model-readable molecule facts disagree.');
  }
  const structureRef = summary.structureRef;
  const referenceParts = typeof structureRef === 'string' ? /^pubchem:(\d+):(3d|2d):[a-f0-9]{64}$/.exec(structureRef) : null;
  if (!referenceParts || Number(referenceParts[1]) !== molecule.cid || referenceParts[2] !== molecule.dimension) {
    throw new Error('The molecule is missing its stable structure reference. Ask Lupi to resolve it again.');
  }
  const view = parseView(metadata?.view, molecule);
  const modelView = parseView(summary.view, molecule);
  if (JSON.stringify(view) !== JSON.stringify(modelView)) {
    throw new Error('The visible atom selection and tool summary disagree. Ask Lupi to show the molecule again.');
  }
  return { molecule, frame: frameFromPubChemMolecule(molecule), structureRef: structureRef as string, view };
}

export function elementAtomIds(molecule: PubChemMolecule, atomicNumber: number): number[] {
  return molecule.atoms.ids.filter((_id, index) => molecule.atoms.elements[index] === atomicNumber);
}

/** Highlight geometry is a subset of the retrieved record, with the same
 * source atom IDs, elements and positions. The full frame retains all bonds. */
export function selectedAtomFrame(frame: Frame, sourceAtomIds: readonly number[]): Frame | null {
  if (!sourceAtomIds.length) return null;
  const selected = new Set(sourceAtomIds);
  const indices = Array.from(frame.ids).flatMap((id, index) => selected.has(id) ? [index] : []);
  if (!indices.length) return null;
  return {
    ...frame,
    natoms: indices.length,
    ids: new Int32Array(indices.map((index) => frame.ids[index])),
    types: new Int32Array(indices.map((index) => frame.types[index])),
    positions: new Float32Array(indices.flatMap((index) => Array.from(frame.positions.subarray(index * 3, index * 3 + 3)))),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}
