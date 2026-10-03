/**
 * Hand-built XYZ texts for the bond unit tests (strategy §2.13 geometries),
 * parsed through the real XYZ parser so frames carry chemistry and
 * `periodic: false` exactly as a loaded file does.
 */
import { parseXyzText } from '@atlas/parsers';
import type { Frame } from '@atlas/core/types';

type Atom = [symbol: string, x: number, y: number, z: number];

const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** A water whose O sits `distance` from `center` along `axis`, both H pointing away. */
function water(center: number[], axis: number[], distance: number): Atom[] {
  const o = center.map((c, i) => c + axis[i] * distance);
  const helper = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const dot = helper[0] * axis[0] + helper[1] * axis[1] + helper[2] * axis[2];
  const f0 = helper.map((h, i) => h - dot * axis[i]);
  const fl = Math.hypot(f0[0], f0[1], f0[2]);
  const f = f0.map((c) => c / fl);
  const half = (104.5 / 2) * (Math.PI / 180);
  const h = (sign: number) => o.map((c, i) => c + 0.96 * (Math.cos(half) * axis[i] + sign * Math.sin(half) * f[i]));
  return [['O', o[0], o[1], o[2]], ['H', ...h(1)] as Atom, ['H', ...h(-1)] as Atom];
}

/** [Na(H₂O)₆]⁺ at `center`: 6 Na···O contacts at 2.40 Å, 12 O–H bonds. */
export function sodiumHexaaqua(center: number[] = [0, 0, 0]): Atom[] {
  return [['Na', center[0], center[1], center[2]], ...AXES.flatMap((axis) => water(center, axis, 2.4))];
}

/** cis-[PtCl₂(NH₃)₂] at `center`: 4 Pt coordination bonds, 6 N–H bonds. */
export function cisplatin(center: number[] = [0, 0, 0]): Atom[] {
  const at = (s: string, v: number[]): Atom => [s, center[0] + v[0], center[1] + v[1], center[2] + v[2]];
  const atoms: Atom[] = [at('Pt', [0, 0, 0]), at('N', [2.05, 0, 0]), at('N', [0, 2.05, 0]), at('Cl', [-2.32, 0, 0]), at('Cl', [0, -2.32, 0])];
  const amine = (n: number[], e: number[], u: number[], v: number[]) => {
    for (let k = 0; k < 3; k += 1) {
      const t = (2 * Math.PI * k) / 3;
      const side = u.map((c, i) => c * Math.cos(t) + v[i] * Math.sin(t));
      atoms.push(at('H', n.map((c, i) => c + 1.01 * (0.334 * e[i] + 0.943 * side[i]))));
    }
  };
  amine([2.05, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  amine([0, 2.05, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
  return atoms;
}

export function xyzText(atoms: readonly Atom[], comment: string): string {
  return [
    String(atoms.length),
    comment,
    ...atoms.map(([s, x, y, z]) => `${s} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`),
    '',
  ].join('\n');
}

/** One parsed frame; `comment` decides chemistry (e.g. `charge=1 multiplicity=1`). */
export function frameFromAtoms(atoms: readonly Atom[], comment = 'charge=0 multiplicity=1'): Frame {
  return parseXyzText(xyzText(atoms, comment)).frames[0];
}
