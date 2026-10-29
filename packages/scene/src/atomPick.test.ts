import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import { ELEMENT_DATA } from '@atlas/core';
import {
  PICK_BRUTE_FORCE_MAX_ATOMS,
  PICK_MAX_BONDS,
  PICK_TOLERANCE_PX,
  atomSilhouetteGapPx,
  buildAtomPickGeometry,
  pickAtom,
  pickTolerancePx,
  type AtomPickGeometry,
  type AtomPickGeometryInput,
  type AtomPickOptions,
  type AtomPickResult,
  type PickRect,
} from './atomPick';
import { SpatialHash3D } from './SpatialHash';

// ─── Fixtures ────────────────────────────────────────────────────────

const RECT: PickRect = { left: 20, top: 10, width: 800, height: 600 };
const SI = 14;
const O = 8;
const C = 6;
const H = 1;
const R_SI = ELEMENT_DATA[SI].displayRadius;
const R_O = ELEMENT_DATA[O].displayRadius;

type Vec3 = [number, number, number];

function frameOf(points: Vec3[], types: number[]): Frame {
  return {
    timestep: 0,
    natoms: points.length,
    boxBounds: new Float64Array([-50, 50, -50, 50, -50, 50]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: Int32Array.from(points, (_, i) => i + 1),
    types: Int32Array.from(types),
    typeSemantics: { kind: 'atomic-number', provenance: 'xyz-element-token' },
    distanceSemantics: { kind: 'angstrom', provenance: 'format-convention' },
    positions: Float32Array.from(points.flat()),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

/** SiO4: Si at the origin, four O on a tetrahedron at 1.61 Å. */
function sio4(): Frame {
  const d = 1.61 / Math.sqrt(3);
  return frameOf(
    [[0, 0, 0], [d, d, d], [d, -d, -d], [-d, d, -d], [-d, -d, d]],
    [SI, O, O, O, O],
  );
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function perspective(position: Vec3, target: Vec3 = [0, 0, 0], options: { near?: number; far?: number; fov?: number } = {}) {
  const camera = new THREE.PerspectiveCamera(options.fov ?? 50, RECT.width / RECT.height, options.near ?? 0.1, options.far ?? 5000);
  camera.position.set(...position);
  const dir = new THREE.Vector3(target[0] - position[0], target[1] - position[1], target[2] - position[2]).normalize();
  camera.up.set(0, Math.abs(dir.y) > 0.95 ? 0 : 1, Math.abs(dir.y) > 0.95 ? 1 : 0);
  camera.lookAt(...target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

function hashOf(frame: Frame, cell = 3.0): SpatialHash3D {
  const hash = new SpatialHash3D(cell);
  hash.build(frame.positions, frame.natoms);
  return hash;
}

/** Client px of a world point. */
function clientOf(camera: THREE.Camera, point: Vec3, rect: PickRect = RECT): [number, number] {
  const v = new THREE.Vector3(...point).project(camera);
  return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
}

/** CSS px per world unit at the point's depth (perspective). */
function pxPerUnitAt(camera: THREE.PerspectiveCamera, point: Vec3): number {
  const view = new THREE.Vector3(...point).applyMatrix4(camera.matrixWorldInverse);
  return (Math.abs(camera.projectionMatrix.elements[5]) * RECT.height) / 2 / -view.z;
}

function drawnRadii(frame: Frame, input: Partial<AtomPickGeometryInput> = {}): number[] {
  const scale = input.atomScale ?? 1;
  return Array.from(frame.types, (t, i) => {
    if (input.hiddenAtomTypes?.has(t)) return 0;
    if (input.loadedAtomCount !== undefined && i >= input.loadedAtomCount) return 0;
    return ELEMENT_DATA[t].displayRadius * scale * (input.atomTypeScales?.[t] ?? 1);
  });
}

/**
 * Ground truth, independent of the module: the front-most drawn sphere under
 * a client point (nearest entry t > 0; a sphere whose near tangent plane is
 * not past the near plane is not drawn).
 */
function frontMost(frame: Frame, radii: number[], camera: THREE.Camera, x: number, y: number): number {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(((x - RECT.left) / RECT.width) * 2 - 1, -((y - RECT.top) / RECT.height) * 2 + 1),
    camera,
  );
  const { origin, direction } = raycaster.ray;
  const near = (camera as THREE.PerspectiveCamera).near;
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < frame.natoms; i += 1) {
    const r = radii[i];
    if (!(r > 0)) continue;
    const c = new THREE.Vector3(frame.positions[3 * i], frame.positions[3 * i + 1], frame.positions[3 * i + 2]);
    const depth = -c.clone().applyMatrix4(camera.matrixWorldInverse).z;
    if (depth - r <= near) continue;
    const oc = origin.clone().sub(c);
    const b = oc.dot(direction);
    const disc = b * b - (oc.lengthSq() - r * r);
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < bestT) {
      bestT = t;
      best = i;
    }
  }
  return best;
}

const EXACT: AtomPickOptions = { soft: false };

function pick(
  geometry: AtomPickGeometry,
  hash: SpatialHash3D | null,
  camera: THREE.Camera,
  x: number,
  y: number,
  options?: AtomPickOptions,
  out?: AtomPickResult,
): number {
  return pickAtom(geometry, hash, camera, RECT, x, y, options, out);
}

// ─── The tolerance table ─────────────────────────────────────────────

describe('pick tolerance', () => {
  it('is 5 px for a mouse, 8 for a pen and 14 for a finger', () => {
    expect(PICK_TOLERANCE_PX).toEqual({ mouse: 5, pen: 8, touch: 14 });
    expect(pickTolerancePx('touch')).toBe(14);
    expect(pickTolerancePx('pen')).toBe(8);
    expect(pickTolerancePx('mouse')).toBe(5);
    expect(pickTolerancePx(undefined)).toBe(5);
    expect(pickTolerancePx('something')).toBe(5);
  });
});

// ─── The exact phase ─────────────────────────────────────────────────

describe('pickAtom: exact hits on what is drawn', () => {
  it('SiO4: every pixel whose front-most drawn sphere is Si picks Si, from many directions', () => {
    const frame = sio4();
    const hash = hashOf(frame);
    const random = rng(11);
    for (const atomScale of [1, 2]) {
      const geometry = buildAtomPickGeometry({ frame, atomScale });
      const radii = drawnRadii(frame, { atomScale });
      let siPixels = 0;
      let centresOnSi = 0;
      for (let view = 0; view < 40; view += 1) {
        // A random direction, 6-14 Å away.
        const u = random() * 2 - 1;
        const phi = random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const distance = 6 + random() * 8;
        const camera = perspective([s * Math.cos(phi) * distance, u * distance, s * Math.sin(phi) * distance]);
        const [cx, cy] = clientOf(camera, [0, 0, 0]);
        const halfPx = pxPerUnitAt(camera, [0, 0, 0]) * (1.61 + R_O * atomScale + 0.2);
        const steps = 30;
        for (let gy = -steps; gy <= steps; gy += 1) {
          for (let gx = -steps; gx <= steps; gx += 1) {
            const x = cx + (gx / steps) * halfPx;
            const y = cy + (gy / steps) * halfPx;
            const truth = frontMost(frame, radii, camera, x, y);
            if (truth < 0) continue;
            const viaHash = pick(geometry, hash, camera, x, y, EXACT);
            const brute = pick(geometry, null, camera, x, y, EXACT);
            expect(viaHash).toBe(truth);
            expect(brute).toBe(truth);
            if (truth === 0) siPixels += 1;
          }
        }
        // The centre pixel: Si unless an O sits right on the line of sight.
        const centreTruth = frontMost(frame, radii, camera, cx, cy);
        expect(pick(geometry, hash, camera, cx, cy)).toBe(centreTruth);
        if (centreTruth === 0) centresOnSi += 1;
      }
      expect(siPixels).toBeGreaterThan(2000);
      // An O hides the Si's centre only when the view runs nearly down its bond.
      expect(centresOnSi).toBeGreaterThanOrEqual(24);
    }
  });

  it('the nearer of two overlapping spheres wins, ties to the lower index', () => {
    const frame = frameOf([[0, 0, -2], [0.3, 0, 0], [0.3, 0, 0]], [SI, O, O]);
    const geometry = buildAtomPickGeometry({ frame });
    const camera = perspective([0, 0, 10]);
    const [x, y] = clientOf(camera, [0.3, 0, 0]);
    // Atoms 1 and 2 coincide (same entry t): the lower index.
    expect(pick(geometry, null, camera, x, y, EXACT)).toBe(1);
    // The big Si behind the small O still owns the pixels the O does not cover.
    const [sx, sy] = clientOf(camera, [-0.4, 0, -2]);
    expect(pick(geometry, null, camera, sx, sy, EXACT)).toBe(0);
  });

  it('atomScale and per-type scales grow the hit area', () => {
    const frame = frameOf([[0, 0, 0]], [SI]);
    const camera = perspective([0, 0, 10]);
    const [x, y] = clientOf(camera, [R_SI * 1.5, 0, 0]);
    expect(pick(buildAtomPickGeometry({ frame }), null, camera, x, y, EXACT)).toBe(-1);
    expect(pick(buildAtomPickGeometry({ frame, atomScale: 2 }), null, camera, x, y, EXACT)).toBe(0);
    expect(pick(buildAtomPickGeometry({ frame, atomTypeScales: { [SI]: 2 } }), null, camera, x, y, EXACT)).toBe(0);
    expect(pick(buildAtomPickGeometry({ frame, atomTypeScales: { [O]: 2 } }), null, camera, x, y, EXACT)).toBe(-1);
  });

  it('a hidden type is neither picked nor an occluder', () => {
    // An O right in front of the Si.
    const frame = frameOf([[0, 0, 0], [0, 0, 1.61]], [SI, O]);
    const camera = perspective([0, 0, 10]);
    const [x, y] = clientOf(camera, [0, 0, 0]);
    expect(pick(buildAtomPickGeometry({ frame }), null, camera, x, y, EXACT)).toBe(1);
    const hidden = buildAtomPickGeometry({ frame, hiddenAtomTypes: new Set([O]) });
    expect(pick(hidden, null, camera, x, y, EXACT)).toBe(0);
    expect(pick(hidden, hashOf(frame), camera, x, y)).toBe(0);
    const [ox, oy] = clientOf(camera, [R_SI + 0.25, 0, 1.61]);
    expect(pick(buildAtomPickGeometry({ frame, hiddenAtomTypes: new Set([O, SI]) }), null, camera, ox, oy)).toBe(-1);
  });

  it('atoms past the drawn count are neither picked nor occluders', () => {
    const frame = frameOf([[0, 0, 0], [0, 0, 1.61]], [SI, O]);
    const camera = perspective([0, 0, 10]);
    const [x, y] = clientOf(camera, [0, 0, 0]);
    const hash = hashOf(frame);
    expect(pick(buildAtomPickGeometry({ frame, loadedAtomCount: 1 }), hash, camera, x, y)).toBe(0);
    expect(pick(buildAtomPickGeometry({ frame, maxAtoms: 1 }), hash, camera, x, y)).toBe(0);
    expect(pick(buildAtomPickGeometry({ frame, loadedAtomCount: 0 }), hash, camera, x, y)).toBe(-1);
  });

  it('the hash march matches brute force on random rays at atomScale 1, 2 and 20', () => {
    const random = rng(5);
    const count = 2500;
    const points: Vec3[] = [];
    const types: number[] = [];
    const palette = [H, C, O, SI];
    for (let i = 0; i < count; i += 1) {
      points.push([(random() - 0.5) * 30, (random() - 0.5) * 30, (random() - 0.5) * 30]);
      types.push(palette[Math.floor(random() * palette.length)]);
    }
    const frame = frameOf(points, types);
    const hash = hashOf(frame);
    for (const atomScale of [1, 2, 20]) {
      const geometry = buildAtomPickGeometry({ frame, atomScale, atomTypeScales: { [H]: 1.5 } });
      let hits = 0;
      for (let view = 0; view < 12; view += 1) {
        const u = random() * 2 - 1;
        const phi = random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        const camera = perspective([s * Math.cos(phi) * 120, u * 120, s * Math.sin(phi) * 120], [
          (random() - 0.5) * 10, (random() - 0.5) * 10, (random() - 0.5) * 10,
        ]);
        for (let k = 0; k < 40; k += 1) {
          const x = RECT.left + random() * RECT.width;
          const y = RECT.top + random() * RECT.height;
          for (const pointerType of ['mouse', 'touch'] as const) {
            const out: AtomPickResult = { index: -1, via: 'miss', t: Number.NaN };
            const viaHash = pick(geometry, hash, camera, x, y, { pointerType }, out);
            const brute = pick(geometry, null, camera, x, y, { pointerType });
            expect(viaHash).toBe(brute);
            if (out.via === 'atom') hits += 1;
          }
        }
      }
      expect(hits).toBeGreaterThan(20);
    }
  });

  it('a camera 1100 Å away still picks (no march limit)', () => {
    const frame = frameOf([[0, 0, 0], [3, 0, 0]], [SI, O]);
    const hash = hashOf(frame);
    const geometry = buildAtomPickGeometry({ frame, atomScale: 4 });
    const camera = perspective([0, 0, 1100], [0, 0, 0], { fov: 5 });
    const [x, y] = clientOf(camera, [0, 0, 0]);
    const out: AtomPickResult = { index: -1, via: 'miss', t: Number.NaN };
    expect(pick(geometry, hash, camera, x, y, EXACT, out)).toBe(0);
    expect(out.via).toBe('atom');
    expect(out.t).toBeCloseTo(1100 - R_SI * 4, 3);
  });

  it('a sphere the camera is inside, or whose near side is inside the near plane, is not drawn', () => {
    // Atom 0 surrounds the camera, atom 1 straddles the near plane, atom 2 is behind both.
    const frame = frameOf([[0, 0, 9.9], [0, 0, 9.5], [0, 0, 0]], [SI, O, SI]);
    const camera = perspective([0, 0, 10], [0, 0, 0], { near: 0.2 });
    const [x, y] = clientOf(camera, [0, 0, 0]);
    expect(pick(buildAtomPickGeometry({ frame }), hashOf(frame), camera, x, y, EXACT)).toBe(2);
    // Moved clear of the near plane, atom 1 is drawn and in front.
    const clear = frameOf([[0, 0, 9.9], [0, 0, 8], [0, 0, 0]], [SI, O, SI]);
    expect(pick(buildAtomPickGeometry({ frame: clear }), hashOf(clear), camera, x, y, EXACT)).toBe(1);
  });

  it('atoms under the sub-pixel cull are not drawn', () => {
    const frame = frameOf([[0, 0, 0], [0, 0, -1]], [O, SI]);
    const camera = perspective([0, 0, 400]);
    const [x, y] = clientOf(camera, [0, 0, 0]);
    const unculled = buildAtomPickGeometry({ frame });
    expect(pick(unculled, null, camera, x, y, EXACT)).toBe(0);
    // O projects to ~0.53 device px at this depth, Si to ~0.9: a 0.7 px cull drops the O only.
    const culled = buildAtomPickGeometry({ frame, cullPixelRadius: 0.7 });
    expect(pick(culled, null, camera, x, y, { soft: false, bufferHeight: RECT.height })).toBe(1);
  });

  it('the hovered atom picks to its swollen rim, as the impostor draws it', () => {
    const frame = frameOf([[0, 0, 0]], [SI]);
    const geometry = buildAtomPickGeometry({ frame });
    const camera = perspective([0, 0, 4]);
    const rho = R_SI * pxPerUnitAt(camera, [0, 0, 0]);
    expect(rho).toBeGreaterThan(40);
    const [cx, cy] = clientOf(camera, [0, 0, 0]);
    const x = cx + rho * 1.03;
    expect(pick(geometry, null, camera, x, cy, EXACT)).toBe(-1);
    const swell = { hoverAtom: 0, hoverScale: 1.06, focusAtom: -1, focusScale: 1 };
    expect(pick(geometry, null, camera, x, cy, { soft: false, swell })).toBe(0);
    // Another atom's hover does not swell this one; a grab (1.08) does.
    expect(pick(geometry, null, camera, x, cy, { soft: false, swell: { ...swell, hoverAtom: 3 } })).toBe(-1);
    expect(pick(geometry, null, camera, x, cy, { soft: false, swell: { hoverAtom: -1, hoverScale: 1, focusAtom: 0, focusScale: 1.08 } })).toBe(0);
  });
});

// ─── Bonds ───────────────────────────────────────────────────────────

describe('pickAtom: drawn bonds', () => {
  // A (0) and B (1) bonded across the view, C (2) behind the bond's middle.
  const frame = frameOf([[-0.8, 0, 0], [0.8, 0, 0], [0, 0, -2]], [C, O, SI]);
  const bonds = { pairs: new Int32Array([0, 1]), kinds: null, radius: 0.12 };
  const camera = perspective([0, 0, 8]);

  it('a hit on a stick picks the atom whose half it is', () => {
    const geometry = buildAtomPickGeometry({ frame, bonds });
    const out: AtomPickResult = { index: -1, via: 'miss', t: Number.NaN };
    const [ax, ay] = clientOf(camera, [-0.2, 0.05, 0]);
    expect(pick(geometry, null, camera, ax, ay, EXACT, out)).toBe(0);
    expect(out.via).toBe('bond');
    const [bx, by] = clientOf(camera, [0.2, -0.05, 0]);
    expect(pick(geometry, hashOf(frame), camera, bx, by, EXACT, out)).toBe(1);
    expect(out.via).toBe('bond');
  });

  it('a stick in front of an atom occludes it; without the bonds the atom behind is picked', () => {
    const [x, y] = clientOf(camera, [0.05, 0, 0]);
    expect(frontMost(frame, drawnRadii(frame), camera, x, y)).toBe(2);
    expect(pick(buildAtomPickGeometry({ frame }), null, camera, x, y, EXACT)).toBe(2);
    expect(pick(buildAtomPickGeometry({ frame, bonds }), hashOf(frame), camera, x, y, EXACT)).toBe(1);
  });

  it('thinner kinds, per-bond radii, faded and degenerate bonds draw as drawn', () => {
    // 0.1 Å off the axis: inside the covalent 0.12 tube, outside a contact's 0.054.
    const [x, y] = clientOf(camera, [-0.2, 0.1, 0]);
    const hash = hashOf(frame);
    expect(pick(buildAtomPickGeometry({ frame, bonds }), hash, camera, x, y, EXACT)).toBe(0);
    expect(pick(buildAtomPickGeometry({ frame, bonds: { ...bonds, kinds: new Uint8Array([2]) } }), hash, camera, x, y, EXACT)).toBe(2);
    expect(pick(buildAtomPickGeometry({ frame, bonds: { ...bonds, radii: new Float32Array([0]) } }), hash, camera, x, y, EXACT)).toBe(2);
    // Fully faded at this depth (8 Å): a miss, as the shader discards it.
    expect(pick(buildAtomPickGeometry({ frame, bonds: { ...bonds, fadeStart: 1, fadeEnd: 2 } }), hash, camera, x, y, EXACT)).toBe(2);
    expect(pick(buildAtomPickGeometry({ frame, bonds: { ...bonds, fadeStart: 60, fadeEnd: 200 } }), hash, camera, x, y, EXACT)).toBe(0);
    // A pair naming one atom twice draws nothing.
    expect(pick(buildAtomPickGeometry({ frame, bonds: { ...bonds, pairs: new Int32Array([0, 0]) } }), hash, camera, x, y, EXACT)).toBe(2);
  });

  it('past PICK_MAX_BONDS drawn bonds, bonds neither pick nor occlude', () => {
    const [x, y] = clientOf(camera, [0.05, 0, 0]);
    const many = new Int32Array(2 * (PICK_MAX_BONDS + 1));
    many[0] = 0;
    many[1] = 1;
    const geometry = buildAtomPickGeometry({ frame, bonds: { ...bonds, pairs: many } });
    expect(geometry.bonds).toBeNull();
    expect(pick(geometry, hashOf(frame), camera, x, y, EXACT)).toBe(2);
  });

  it('a stick seen end-on is hit through its cap, at the end nearer the eye', () => {
    // Bonds only (the balls hidden), along the line of sight.
    const endOn = frameOf([[0, 0, 2], [0, 0, -2]], [C, C]);
    const geometry = buildAtomPickGeometry({ frame: endOn, bonds, hiddenAtomTypes: new Set([C]) });
    const out: AtomPickResult = { index: -1, via: 'miss', t: Number.NaN };
    const front = perspective([0, 0, 8]);
    // 0.0375 Å off the axis at the near cap (radius 0.12): a cap hit at t = 6.
    const [x, y] = clientOf(front, [0, 0.05, 0]);
    expect(pick(geometry, hashOf(endOn), front, x, y, EXACT, out)).toBe(0);
    expect(out.via).toBe('bond');
    expect(out.t).toBeCloseTo(6, 3);
    // 0.15 Å off at the near cap: the tube's side is hidden behind its cap.
    const [mx, my] = clientOf(front, [0, 0.2, 0]);
    expect(pick(geometry, hashOf(endOn), front, mx, my, EXACT)).toBe(-1);
    const back = perspective([0, 0, -8]);
    const [bx, by] = clientOf(back, [0, 0.05, 0]);
    expect(pick(geometry, null, back, bx, by, EXACT)).toBe(1);
  });
});

// ─── The soft phase ──────────────────────────────────────────────────

describe('pickAtom: near misses', () => {
  const frame = frameOf([[0, 0, 0]], [SI]);
  const camera = perspective([0, 0, 12]);
  const geometry = buildAtomPickGeometry({ frame });
  const hash = hashOf(frame);
  const [cx, cy] = clientOf(camera, [0, 0, 0]);
  const rho = R_SI * pxPerUnitAt(camera, [0, 0, 0]);
  const at = (gap: number): [number, number] => [cx + (rho + gap) * 0.6, cy - (rho + gap) * 0.8];

  it('picks an atom within the pointer tolerance of its silhouette, and nothing beyond it', () => {
    for (const h of [hash, null]) {
      const out: AtomPickResult = { index: -1, via: 'miss', t: Number.NaN };
      expect(pick(geometry, h, camera, ...at(3), { pointerType: 'mouse' }, out)).toBe(0);
      expect(out.via).toBe('soft');
      expect(pick(geometry, h, camera, ...at(6), { pointerType: 'mouse' })).toBe(-1);
      expect(pick(geometry, h, camera, ...at(6), { pointerType: 'pen' })).toBe(0);
      expect(pick(geometry, h, camera, ...at(10), { pointerType: 'pen' })).toBe(-1);
      expect(pick(geometry, h, camera, ...at(12), { pointerType: 'touch' })).toBe(0);
      expect(pick(geometry, h, camera, ...at(16), { pointerType: 'touch' })).toBe(-1);
      expect(pick(geometry, h, camera, ...at(3), { soft: false })).toBe(-1);
    }
  });

  it('prefers the nearest silhouette, then the nearer atom', () => {
    // Two atoms side by side; the pointer between them, nearer the left one.
    const pair = frameOf([[-1.5, 0, 0], [1.5, 0, 0]], [SI, SI]);
    const g = buildAtomPickGeometry({ frame: pair });
    const [lx, ly] = clientOf(camera, [-1.5 + R_SI, 0, 0]);
    const [rx] = clientOf(camera, [1.5 - R_SI, 0, 0]);
    expect(pick(g, hashOf(pair), camera, lx + 4, ly, { pointerType: 'touch' })).toBe(0);
    expect(pick(g, hashOf(pair), camera, rx - 4, ly, { pointerType: 'touch' })).toBe(1);
  });

  it('never picks an atom hidden behind another', () => {
    // A small Si fully behind a big O (scaled): every near miss around the
    // pair picks the O.
    const stack = frameOf([[0, 0, 0], [0.05, 0, -1.5]], [O, SI]);
    const g = buildAtomPickGeometry({ frame: stack, atomTypeScales: { [O]: 3, [SI]: 0.5 } });
    const h = hashOf(stack);
    const front = 3 * R_O * pxPerUnitAt(camera, [0, 0, 0]);
    const [ox, oy] = clientOf(camera, [0, 0, 0]);
    let soft = 0;
    for (let k = 0; k < 64; k += 1) {
      const a = (k / 64) * Math.PI * 2;
      for (const gap of [0.5, 2, 6, 10, 13.5]) {
        const x = ox + Math.cos(a) * (front + gap);
        const y = oy + Math.sin(a) * (front + gap);
        const index = pick(g, h, camera, x, y, { pointerType: 'touch' });
        expect(index).not.toBe(1);
        if (index === 0) soft += 1;
      }
    }
    expect(soft).toBeGreaterThan(200);
  });

  it('refuses a near miss whose atom edge toward the pointer is covered', () => {
    // A thin stick at depth 10 runs in front of the Si's left edge: the
    // pointer, 4 px left of that edge, is off both, but the Si's disc point
    // nearest it lies under the stick.
    const pxAt10 = 643.4 / 10;
    const stickX = -(R_SI * pxPerUnitAt(camera, [0, 0, 0]) - 1.3) / pxAt10;
    const covered = frameOf([[stickX, 5, 2], [stickX, -5, 2], [0, 0, 0]], [C, C, SI]);
    const stick = { pairs: new Int32Array([0, 1]), kinds: null, radius: 2.5 / pxAt10 };
    const g = buildAtomPickGeometry({ frame: covered, bonds: stick });
    const [sx, sy] = clientOf(camera, [0, 0, 0]);
    const siRho = R_SI * pxPerUnitAt(camera, [0, 0, 0]);
    const x = sx - siRho - 4;
    expect(pick(g, hashOf(covered), camera, x, sy, { soft: false })).toBe(-1);
    expect(pick(g, hashOf(covered), camera, x, sy, { pointerType: 'mouse' })).toBe(-1);
    expect(pick(g, null, camera, x, sy, { pointerType: 'mouse' })).toBe(-1);
    // Without the stick the same near miss picks the Si.
    expect(pick(buildAtomPickGeometry({ frame: covered }), hashOf(covered), camera, x, sy, { pointerType: 'mouse' })).toBe(2);
  });

  it('whatever a near miss picks is visible at its edge toward the pointer', () => {
    // A big front O covers the left edge of a Si behind it; the pointer is
    // left of both, nearer the Si's (covered) disc than the O's outline.
    const pairFrame = frameOf([[-0.9, 0, 1], [0, 0, 0]], [O, SI]);
    const g = buildAtomPickGeometry({ frame: pairFrame, atomTypeScales: { [O]: 2.5 } });
    const [sx, sy] = clientOf(camera, [0, 0, 0]);
    const siRho = R_SI * pxPerUnitAt(camera, [0, 0, 0]);
    // Straight above the Si: its nearest disc point is the Si's own top, uncovered.
    expect(pick(g, hashOf(pairFrame), camera, sx, sy - siRho - 3, { pointerType: 'mouse' })).toBe(1);
    // For every pointer, whatever is picked is front-most at its own disc point.
    for (let k = 0; k < 40; k += 1) {
      const a = (k / 40) * Math.PI * 2;
      const x = sx + Math.cos(a) * (siRho + 4);
      const y = sy + Math.sin(a) * (siRho + 4);
      const index = pick(g, hashOf(pairFrame), camera, x, y, { pointerType: 'touch' });
      if (index === 1) {
        // The Si was picked: its edge toward the pointer must be visible.
        const ex = sx + Math.cos(a) * (siRho - 1);
        const ey = sy + Math.sin(a) * (siRho - 1);
        expect(frontMost(pairFrame, [2.5 * R_O, R_SI], camera, ex, ey)).toBe(1);
      }
    }
  });
});

// ─── Stale hash, view offset, orthographic ───────────────────────────

describe('pickAtom: hash freshness and cameras', () => {
  it('a stale hash falls back to the drawn atoms, and an oversize stale frame picks nothing', () => {
    const before = frameOf([[0, 0, 0]], [SI]);
    const after = frameOf([[4, 0, 0]], [SI]);
    const hash = hashOf(before);
    const camera = perspective([0, 0, 12]);
    const [x, y] = clientOf(camera, [4, 0, 0]);
    expect(pick(buildAtomPickGeometry({ frame: after }), hash, camera, x, y)).toBe(0);
    hash.clear();
    expect(pick(buildAtomPickGeometry({ frame: after }), hash, camera, x, y)).toBe(0);

    const n = PICK_BRUTE_FORCE_MAX_ATOMS + 1;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      positions[3 * i] = (i % 1000) * 3;
      positions[3 * i + 1] = Math.floor(i / 1000) * 3;
      positions[3 * i + 2] = -50;
    }
    positions[0] = 4;
    positions[1] = 0;
    positions[2] = 0;
    const big: Frame = { ...after, natoms: n, positions, types: new Int32Array(n).fill(SI), ids: new Int32Array(n) };
    const geometry = buildAtomPickGeometry({ frame: big });
    const fresh = new SpatialHash3D(3.0);
    fresh.build(positions, n);
    expect(pick(geometry, fresh, camera, x, y)).toBe(0);
    const stale = new SpatialHash3D(3.0);
    stale.build(positions.slice(), n);
    expect(pick(geometry, stale, camera, x, y)).toBe(-1);
    expect(pick(geometry, null, camera, x, y)).toBe(-1);
  });

  it('picks through a view offset (the phone inset) like the drawn projection', () => {
    const frame = sio4();
    const geometry = buildAtomPickGeometry({ frame });
    const camera = perspective([5, 4, 7]);
    camera.setViewOffset(RECT.width, RECT.height, 0, 140, RECT.width, RECT.height);
    camera.updateMatrixWorld();
    const radii = drawnRadii(frame);
    let checked = 0;
    for (let i = 0; i < frame.natoms; i += 1) {
      const [x, y] = clientOf(camera, [frame.positions[3 * i], frame.positions[3 * i + 1], frame.positions[3 * i + 2]]);
      const truth = frontMost(frame, radii, camera, x, y);
      expect(pick(geometry, hashOf(frame), camera, x, y, EXACT)).toBe(truth);
      if (truth === i) checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('picks with an orthographic camera (parallel rays), exact and soft', () => {
    const frame = frameOf([[-2, 0, 0], [2, 0, 0], [2, 0, -3]], [SI, O, SI]);
    const geometry = buildAtomPickGeometry({ frame });
    const hash = hashOf(frame);
    const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const [lx, ly] = clientOf(camera, [-2, 0, 0]);
    expect(pick(geometry, hash, camera, lx, ly, EXACT)).toBe(0);
    // The O at (2, 0, 0) is in front of the Si at (2, 0, -3).
    const [rx, ry] = clientOf(camera, [2, 0, 0]);
    expect(pick(geometry, hash, camera, rx, ry, EXACT)).toBe(1);
    // Off the O but on the bigger Si behind it.
    const pxPerUnit = RECT.height / 12;
    expect(pick(geometry, hash, camera, rx + (R_O + 0.1) * pxPerUnit, ry, EXACT)).toBe(2);
    // A near miss off the left Si: 4 px outside its (exact) silhouette.
    expect(pick(geometry, hash, camera, lx - R_SI * pxPerUnit - 4, ly, { pointerType: 'mouse' })).toBe(0);
    expect(pick(geometry, hash, camera, lx - R_SI * pxPerUnit - 7, ly, { pointerType: 'mouse' })).toBe(-1);
  });

  it('measures an atom\'s silhouette gap in CSS px', () => {
    const frame = frameOf([[0, 0, 0]], [SI]);
    const geometry = buildAtomPickGeometry({ frame });
    const camera = perspective([0, 0, 12]);
    const [cx, cy] = clientOf(camera, [0, 0, 0]);
    // On the view axis the drawn outline is the tangent cone's circle,
    // r·f / √(D² − r²): a hair outside the section disc r·f / D.
    const rho = (R_SI * pxPerUnitAt(camera, [0, 0, 0]) * 12) / Math.sqrt(12 * 12 - R_SI * R_SI);
    expect(atomSilhouetteGapPx(geometry, camera, RECT, cx + rho + 7, cy, 0)).toBeCloseTo(7, 4);
    expect(atomSilhouetteGapPx(geometry, camera, RECT, cx, cy - rho - 3, 0)).toBeCloseTo(3, 4);
    expect(atomSilhouetteGapPx(geometry, camera, RECT, cx, cy, 0)).toBeCloseTo(-rho, 4);
    expect(atomSilhouetteGapPx(geometry, camera, RECT, cx, cy, 1)).toBe(Infinity);
    const hidden = buildAtomPickGeometry({ frame, hiddenAtomTypes: new Set([SI]) });
    expect(atomSilhouetteGapPx(hidden, camera, RECT, cx, cy, 0)).toBe(Infinity);
  });
});
