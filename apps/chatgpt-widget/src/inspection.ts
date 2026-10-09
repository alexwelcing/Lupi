import { getElementSpec } from '@atlas/core/elements';
import { BOND_KIND_NAMES } from '@atlas/core/bonds';
import type { MoleculeCard } from './toolResult';

export type InspectionTarget = { kind: 'atom'; index: number } | { kind: 'bond'; index: number };
export interface InspectionPair {
  index: number;
  a: number;
  b: number;
  kind: 'covalent' | 'coordination' | 'ionicContact' | 'source';
  distance: number;
  order: number | null;
  excess: number | null;
}

export function sameTarget(a: InspectionTarget | null, b: InspectionTarget | null): boolean {
  return a === b || Boolean(a && b && a.kind === b.kind && a.index === b.index);
}

/** Never insert inferred pairs into the source-only Frame.bonds array. */
export function inspectionPairs(card: MoleculeCard): InspectionPair[] {
  const perceived = card.perceivedBonds;
  const pairs = perceived?.pairs ?? card.frame.bonds;
  const result: InspectionPair[] = [];
  for (let index = 0; index < pairs.length / 2; index++) {
    const a = pairs[index * 2], b = pairs[index * 2 + 1];
    const kind = perceived ? BOND_KIND_NAMES[perceived.kinds[index]] : 'source';
    if (kind === 'ionicContact' && card.view.showContacts === false) continue;
    const p = card.frame.positions;
    result.push({
      index, a, b, kind,
      distance: Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]),
      order: perceived ? null : card.molecule.bonds.order[index],
      excess: perceived ? perceived.excess[index] : null,
    });
  }
  return result;
}

export const PAIR_LABEL = {
  source: 'Source bond', covalent: 'Estimated covalent bond',
  coordination: 'Estimated coordination', ionicContact: 'Estimated ionic contact',
} as const;

/** Values for both the local inspector and an explicit pinned model context.
 * Source coordinates are shown unchanged; no atomic charge is fabricated. */
export function inspectionDetails(card: MoleculeCard, target: InspectionTarget | null) {
  if (!target || !Number.isSafeInteger(target.index) || target.index < 0) return null;
  const m = card.molecule;
  const isOmol = m.schemaVersion === 'lupi.omol25.v1';
  const atomLabel = (i: number) => `${getElementSpec(m.atoms.elements[i]).symbol} ${m.atoms.ids[i]}`;
  const pairs = inspectionPairs(card);
  const lengthUnit = m.dimension === '3d' ? 'angstrom' : 'depiction';
  const provenance = card.perceivedBonds?.recipe ?? (isOmol ? 'source topology not provided' : 'PubChem source connection table');
  if (target.kind === 'bond') {
    const pair = pairs.find((p) => p.index === target.index);
    if (!pair) return null;
    return {
      kind: 'bond' as const, title: `${atomLabel(pair.a)} · ${atomLabel(pair.b)}`,
      label: PAIR_LABEL[pair.kind], provenance,
      atomIds: [m.atoms.ids[pair.a], m.atoms.ids[pair.b]],
      bondKind: pair.kind, sourceOrder: pair.order,
      // A 2D depiction is not a physical distance measurement.
      distance: m.dimension === '3d' ? pair.distance : null,
      lengthUnit, excess: pair.excess,
    };
  }
  if (target.index >= m.atoms.ids.length) return null;
  const i = target.index, element = getElementSpec(m.atoms.elements[i]);
  const neighbors = pairs.filter((p) => p.a === i || p.b === i).map((p) => {
    const other = p.a === i ? p.b : p.a;
    return { atomId: m.atoms.ids[other], symbol: getElementSpec(m.atoms.elements[other]).symbol,
      kind: p.kind, distance: m.dimension === '3d' ? p.distance : null, sourceOrder: p.order, pairIndex: p.index };
  });
  return {
    kind: 'atom' as const, title: `${element.name} · ${element.symbol}`, label: `Atom ${m.atoms.ids[i]}`,
    atomId: m.atoms.ids[i], atomIdKind: isOmol ? 'synthetic-row' : 'source-id',
    atomicNumber: m.atoms.elements[i], coordinates: m.atoms.positions.slice(i * 3, i * 3 + 3),
    coordinateUnits: m.coordinateUnits, provenance, neighbors,
  };
}
