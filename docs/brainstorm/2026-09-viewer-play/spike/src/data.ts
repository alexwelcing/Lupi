// Scene data for the spike: caffeine (24 atoms), a random N-atom cloud, and a
// hand-built depth-intersection fixture whose expected image is ray-cast on the
// CPU by the Playwright verifier (tools/verify.mjs).

export interface AtomSet {
  count: number;
  positions: Float32Array; // xyz
  targets: Float32Array | null; // xyz, null = alias positions (static frame)
  types: Uint8Array; // palette slot (atomic number)
  occlusion?: Uint8Array; // 0..255 openness
  props?: Uint16Array; // normalized property
}

export interface BondSet {
  count: number;
  starts: Float32Array;
  ends: Float32Array;
  radius: Float32Array;
  colorStart: Uint8Array; // RGBA8, sRGB
  colorEnd: Uint8Array;
}

// CPK colours (display sRGB) and ball-and-stick display radii, indexed by atomic number.
export const CPK: Record<number, [number, number, number]> = {
  1: [255, 255, 255],
  6: [144, 144, 144],
  7: [48, 80, 248],
  8: [255, 13, 13],
  16: [255, 255, 48],
  26: [224, 102, 51],
  29: [200, 128, 51],
  79: [255, 209, 35],
};
export const DISPLAY_RADIUS: Record<number, number> = {
  1: 0.25, 6: 0.4, 7: 0.38, 8: 0.37, 16: 0.5, 26: 0.55, 29: 0.55, 79: 0.6,
};
const COVALENT: Record<number, number> = { 1: 0.31, 6: 0.76, 7: 0.71, 8: 0.66 };

// PubChem CID 2519 3D conformer (caffeine), Angstrom.
const CAFFEINE_XYZ = `O 0.4700 2.5688 0.0006
O -3.1271 -0.4436 -0.0003
N -0.9686 -1.3125 0.0000
N 2.2182 0.1412 -0.0003
N -1.3477 1.0797 -0.0001
N 1.4119 -1.9372 0.0002
C 0.8579 0.2592 -0.0008
C 0.3897 -1.0264 -0.0004
C 0.0307 1.4220 -0.0006
C -1.9061 -0.2495 -0.0004
C 2.5032 -1.1998 0.0003
C -1.4276 -2.6960 0.0008
C 3.1926 1.2061 0.0003
C -2.2969 2.1881 0.0007
H 3.5163 -1.5787 0.0008
H -1.0451 -3.1973 -0.8937
H -2.5186 -2.7596 0.0011
H -1.0447 -3.1963 0.8957
H 4.1992 0.7801 0.0002
H 3.0468 1.8092 -0.8992
H 3.0466 1.8083 0.9004
H -1.8087 3.1651 -0.0003
H -2.9322 2.1027 0.8881
H -2.9346 2.1021 -0.8849`;

const Z: Record<string, number> = { H: 1, C: 6, N: 7, O: 8 };

export function caffeine(): { atoms: AtomSet; bonds: BondSet } {
  const rows = CAFFEINE_XYZ.trim().split('\n').map((l) => l.trim().split(/\s+/));
  const n = rows.length;
  const positions = new Float32Array(n * 3);
  const types = new Uint8Array(n);
  rows.forEach((r, i) => {
    types[i] = Z[r[0]];
    positions.set([+r[1], +r[2], +r[3]], i * 3);
  });
  // Distance-inferred bonds (covalent radii sum x 1.2), two-tone split like Lupi.
  const s: number[] = [], e: number[] = [], cs: number[] = [], ce: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = positions[i * 3] - positions[j * 3];
      const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < (COVALENT[types[i]] + COVALENT[types[j]]) * 1.2) {
        s.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        e.push(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
        cs.push(...CPK[types[i]], 255);
        ce.push(...CPK[types[j]], 255);
      }
    }
  }
  const bc = s.length / 3;
  return {
    atoms: { count: n, positions, targets: null, types },
    bonds: {
      count: bc,
      starts: new Float32Array(s),
      ends: new Float32Array(e),
      radius: new Float32Array(bc).fill(0.12),
      colorStart: new Uint8Array(cs),
      colorEnd: new Uint8Array(ce),
    },
  };
}

// Deterministic PRNG (mulberry32) so the cloud is identical on both backends.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cloud(count: number, radius: number): AtomSet {
  const rand = rng(1234);
  const pool = [1, 6, 7, 8, 16, 26, 29, 79];
  const positions = new Float32Array(count * 3);
  const targets = new Float32Array(count * 3);
  const types = new Uint8Array(count);
  const occlusion = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    // Uniform in a ball.
    let x, y, z;
    do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; } while (x * x + y * y + z * z > 1);
    positions.set([x * radius, y * radius, z * radius], i * 3);
    // Target: pulled toward a flattened disc so uProgress visibly morphs the cloud.
    targets.set([x * radius * 1.2, y * radius * 0.25, z * radius * 1.2], i * 3);
    types[i] = pool[Math.floor(rand() * pool.length)];
    occlusion[i] = 255 - Math.floor(160 * Math.sqrt(1 - Math.min(1, x * x + y * y + z * z)));
  }
  return { count, positions, targets, types, occlusion };
}

// ── Depth-intersection fixture ────────────────────────────────────────
// Flat, unlit primaries so every pixel can be classified. The verifier
// (tools/verify.mjs) imports FIXTURE and ray-casts the same scene on the CPU.
export const FIXTURE = {
  // palette slot -> flat sRGB colour and radius
  slots: {
    1: { color: [255, 0, 0], radius: 1.0 },
    2: { color: [0, 0, 255], radius: 0.8 },
    3: { color: [255, 0, 255], radius: 0.5 },
    4: { color: [255, 255, 0], radius: 0.3 },
    5: { color: [0, 255, 255], radius: 0.3 },
  } as Record<number, { color: [number, number, number]; radius: number }>,
  // Atom 0 is interpolated: position -> target by uProgress (0.5 in the test).
  atoms: [
    { slot: 1, pos: [-1.2, 0.0, 0.0], target: [0.0, 0.0, 0.0] },
    { slot: 2, pos: [0.4, 0.2, 0.5], target: [0.4, 0.2, 0.5] },
    { slot: 3, pos: [-0.2, -0.7, 0.9], target: [-0.2, -0.7, 0.9] },
    { slot: 4, pos: [1.8, -1.2, -0.5], target: [1.8, -1.2, -0.5] },
    { slot: 5, pos: [1.0, -1.6, 1.0], target: [1.0, -1.6, 1.0] },
  ],
  progress: 0.5,
  bonds: [
    { a: 1, b: 3, radius: 0.15, colorStart: [255, 128, 0], colorEnd: [128, 0, 255] },
    { a: 3, b: 4, radius: 0.15, colorStart: [255, 128, 0], colorEnd: [128, 0, 255] },
  ],
  // An ordinary rasterized mesh (MeshBasicNodeMaterial) slicing atom 0:
  // an axis-aligned rectangle in the plane z = planeZ.
  plane: { z: 0.15, x0: -2.4, x1: -0.7, y0: -1.4, y1: 1.4, color: [0, 255, 0] },
  camera: { position: [2.2, 1.6, 6.0], target: [0, -0.2, 0], fov: 40, near: 0.5, far: 30, orthoHalfHeight: 2.4 },
  size: { width: 640, height: 480 },
};

export function fixtureAtoms(): { atoms: AtomSet; bonds: BondSet } {
  const n = FIXTURE.atoms.length;
  const positions = new Float32Array(n * 3);
  const targets = new Float32Array(n * 3);
  const types = new Uint8Array(n);
  FIXTURE.atoms.forEach((a, i) => {
    positions.set(a.pos, i * 3);
    targets.set(a.target, i * 3);
    types[i] = a.slot;
  });
  const bc = FIXTURE.bonds.length;
  const bonds: BondSet = {
    count: bc,
    starts: new Float32Array(bc * 3),
    ends: new Float32Array(bc * 3),
    radius: new Float32Array(bc),
    colorStart: new Uint8Array(bc * 4),
    colorEnd: new Uint8Array(bc * 4),
  };
  FIXTURE.bonds.forEach((b, i) => {
    bonds.starts.set(FIXTURE.atoms[b.a].pos, i * 3);
    bonds.ends.set(FIXTURE.atoms[b.b].pos, i * 3);
    bonds.radius[i] = b.radius;
    bonds.colorStart.set([...b.colorStart, 255], i * 4);
    bonds.colorEnd.set([...b.colorEnd, 255], i * 4);
  });
  return { atoms: { count: n, positions, targets, types }, bonds };
}
