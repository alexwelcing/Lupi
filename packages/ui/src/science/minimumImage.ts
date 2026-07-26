/**
 * Minimum-image unwrapping for periodic trajectories.
 *
 * NEB paths live in periodic cells: an atom that crosses a cell boundary
 * between two images will, under naive linear interpolation, fly the LONG way
 * backward through the whole cell instead of continuing its hop. Unwrapping
 * translates each frame's atoms by lattice vectors so every atom takes the
 * minimum-image path relative to the previous frame — the standard NEB
 * movie convention. Positions on the FIRST frame are never modified; each
 * subsequent frame is unwrapped relative to the already-unwrapped previous
 * frame (chained), so long paths accumulate correctly.
 *
 * This is a display transform for smooth playback — the discrete image
 * index, energies, and panel markers stay untouched and truthful.
 */
import type { Frame, Trajectory } from '@atlas/core';

/** 3x3 lattice from frame box bounds + tilt (rows a, b, c in Angstrom). */
export function latticeFromFrame(frame: Frame): [number, number, number, number, number, number, number, number, number] | null {
  const [xlo, xhi, ylo, yhi, zlo, zhi] = Array.from(frame.boxBounds);
  const [xy, xz, yz] = Array.from(frame.boxTilt);
  const lx = xhi - xlo, ly = yhi - ylo, lz = zhi - zlo;
  if (!(lx > 0 && ly > 0 && lz > 0)) return null;
  // LAMMPS-style: a = (lx,0,0), b = (xy,ly,0), c = (xz,yz,lz)
  return [lx, 0, 0, xy, ly, 0, xz, yz, lz];
}

/** Solve M x = b for a 3x3 matrix (rows). Returns null when singular. */
function solve3(m: [number, number, number, number, number, number, number, number, number], b: [number, number, number]): [number, number, number] | null {
  const [a, b1, c1, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b1 * (d * i - f * g) + c1 * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    ((e * i - f * h) * b[0] + (c1 * h - b1 * i) * b[1] + (b1 * f - c1 * e) * b[2]) * inv,
    ((f * g - d * i) * b[0] + (a * i - c1 * g) * b[1] + (c1 * d - a * f) * b[2]) * inv,
    ((d * h - e * g) * b[0] + (b1 * g - a * h) * b[1] + (a * e - b1 * d) * b[2]) * inv,
  ];
}

function matVec(m: [number, number, number, number, number, number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [
    a * v[0] + b * v[1] + c * v[2],
    d * v[0] + e * v[1] + f * v[2],
    g * v[0] + h * v[1] + i * v[2],
  ];
}

/** Unwrap one frame's positions to minimum-image relative to prevPos. */
export function minimumImageUnwrapFrame(prevPos: Float32Array, frame: Frame): Float32Array {
  const lattice = latticeFromFrame(frame);
  const out = new Float32Array(frame.positions);
  if (!lattice) return out;
  const n = Math.min(prevPos.length, out.length);
  for (let i = 0; i + 2 < n; i += 3) {
    const d: [number, number, number] = [
      out[i] - prevPos[i],
      out[i + 1] - prevPos[i + 1],
      out[i + 2] - prevPos[i + 2],
    ];
    const frac = solve3(lattice, d);
    if (!frac) return out;
    const shift: [number, number, number] = [
      Math.round(frac[0]),
      Math.round(frac[1]),
      Math.round(frac[2]),
    ];
    if (shift[0] !== 0 || shift[1] !== 0 || shift[2] !== 0) {
      const [sx, sy, sz] = matVec(lattice, shift);
      out[i] -= sx;
      out[i + 1] -= sy;
      out[i + 2] -= sz;
    }
  }
  return out;
}

/**
 * Chain-unwrap a whole trajectory: frame k is unwrapped relative to the
 * unwrapped frame k-1. Undefined slots (sparse residency) pass through.
 */
export function minimumImageUnwrapTrajectory(trajectory: Trajectory): Trajectory {
  const frames = trajectory.frames.map((f) => f);
  let prev: Float32Array | null = null;
  for (let k = 0; k < frames.length; k += 1) {
    const frame = frames[k];
    if (!frame) continue;
    if (prev == null) {
      prev = frame.positions;
      continue;
    }
    const unwrapped = minimumImageUnwrapFrame(prev, frame);
    frames[k] = { ...frame, positions: unwrapped };
    prev = unwrapped;
  }
  return { ...trajectory, frames };
}
