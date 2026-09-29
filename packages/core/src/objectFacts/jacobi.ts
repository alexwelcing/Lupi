import type { Vec3 } from './types';

/** Row-major symmetric 3×3 matrix; only the upper triangle is read. */
export type SymMat3 = [[number, number, number], [number, number, number], [number, number, number]];

export interface SymEigen3 {
  /** Eigenvalues, ascending. */
  values: Vec3;
  /** Unit eigenvectors for `values`, forming a right-handed frame (det = +1). */
  vectors: [Vec3, Vec3, Vec3];
}

const PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
];

/**
 * Cyclic Jacobi eigen-solve of a symmetric 3×3 matrix. Eigenvalues come back
 * ascending; the eigenvector frame is made right-handed by flipping the last
 * column when det(V) < 0, so `quat.fromMat3(V)` is a proper rotation.
 */
export function jacobiEigenSymmetric3(m: SymMat3): SymEigen3 {
  const a = [
    [m[0][0], m[0][1], m[0][2]],
    [m[0][1], m[1][1], m[1][2]],
    [m[0][2], m[1][2], m[2][2]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const scale = Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300;

  for (let sweep = 0; sweep < 64; sweep += 1) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off <= 1e-15 * scale) break;
    for (const [p, q] of PAIRS) {
      const apq = a[p][q];
      if (Math.abs(apq) <= 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * apq);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      // A ← Pᵀ A P and V ← V P with P the (p, q) plane rotation [c s; -s c].
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      a[p][q] = 0;
      a[q][p] = 0;
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }

  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  const values: Vec3 = [a[order[0]][order[0]], a[order[1]][order[1]], a[order[2]][order[2]]];
  const vectors = order.map((col) => unit([v[0][col], v[1][col], v[2][col]])) as [Vec3, Vec3, Vec3];
  const [x, y, z] = vectors;
  const det =
    x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
  if (det < 0) vectors[2] = [-z[0], -z[1], -z[2]];
  return { values, vectors };
}

function unit(u: Vec3): Vec3 {
  const len = Math.hypot(u[0], u[1], u[2]);
  return len > 0 ? [u[0] / len, u[1] / len, u[2] / len] : u;
}
