import { compute, draw, frame, storage, type Compute, type Draw, type Gpu, type ShaderSource, type StorageBuffer, type Target } from 'vgpu';
import { GIST_MAX_PRIMITIVES, type Gist, type GistPrimitive } from '@atlas/core/gist';

/**
 * The gist engine: a few thousand particles that whirl, then flow onto the
 * surface of the gist and stay there, shimmering, while a camera orbits.
 * One vgpu compute kernel moves them, one instanced draw shows them; the
 * gist itself is a 96-byte-per-primitive storage buffer that can be
 * rewritten at any time, which is what makes Jev's sculpting moves read as
 * the shape morphing in place.
 *
 * Runtime-neutral on purpose: a `Gpu`, a `Target`, and the two shader
 * sources come in, so the same code runs against `vgpu/node` headless with
 * pixels read back, and against a canvas in the browser (`gistParticles.ts`).
 */
export interface GistEngine {
  /** Replace the shape. `null` keeps the particles whirling with nothing to settle on. */
  setGist(gist: Gist | null): void;
  /** Swirl strength target, 0..1. */
  setEnergy(value: number): void;
  /** Pull-to-surface target, 0..1. */
  setAttract(value: number): void;
  /** Overall opacity target, 0..1. */
  setFade(value: number): void;
  /** Advance one frame at `now` milliseconds. Returns true while something is still moving or visible. */
  tick(now: number): boolean;
  readonly state: { energy: number; attract: number; fade: number };
  readonly particles: StorageBuffer;
  dispose(): void;
}

export interface GistEngineDeps {
  gpu: Gpu;
  target: Target;
  shaders: { step: string | ShaderSource; points: string | ShaderSource };
  count?: number;
  aspect?: () => number;
  /** Deterministic runs (headless checks) pass their own generator. */
  random?: () => number;
}

export const GIST_PARTICLE_COUNT = 60_000;
export const PARTICLE_FLOATS = 12;
export const PRIM_FLOATS = 24;
const WORKGROUP = 64;
const KIND_INDEX: Record<GistPrimitive['kind'], number> = { sphere: 0, ellipsoid: 1, box: 2, cylinder: 3, capsule: 4, cone: 5, torus: 6 };
const ORBIT_RADIUS = 4.6;
const FOV_DEGREES = 34;
const EASE = 0.06;
/** Disc radius in world units at rest; with 60k particles on a 2-unit object the discs tile. */
const DISC_SIZE = 0.011;

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return [0.84, 0.94, 0.61];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Rows of the rotation matrix for X, then Y, then Z Euler angles in degrees. */
export function rotationRows(rotation: [number, number, number]): [number[], number[], number[]] {
  const [ax, ay, az] = rotation.map((degrees) => (degrees * Math.PI) / 180);
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  const cz = Math.cos(az);
  const sz = Math.sin(az);
  // R = Rz * Ry * Rx
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

/** Pack a gist into the primitive storage layout (`Prim` in gist-step.wgsl). */
export function packGist(gist: Gist | null): { data: Float32Array<ArrayBuffer>; count: number } {
  const data = new Float32Array(new ArrayBuffer(GIST_MAX_PRIMITIVES * PRIM_FLOATS * 4));
  const view = new DataView(data.buffer);
  const primitives = gist?.primitives.slice(0, GIST_MAX_PRIMITIVES) ?? [];
  primitives.forEach((primitive, index) => {
    const base = index * PRIM_FLOATS;
    data.set(primitive.center, base);
    view.setUint32((base + 3) * 4, KIND_INDEX[primitive.kind], true);
    data.set(primitive.size, base + 4);
    data[base + 7] = primitive.blend;
    const rows = rotationRows(primitive.rotation);
    data.set(rows[0], base + 8);
    data.set(rows[1], base + 12);
    data.set(rows[2], base + 16);
    view.setUint32((base + 20) * 4, primitive.subtract ? 1 : 0, true);
  });
  return { data, count: primitives.length };
}

/** Particles start on a whirling ring, the same one the kernel respawns onto. */
export function seedParticles(count: number, random: () => number = Math.random): Float32Array<ArrayBuffer> {
  const data = new Float32Array(new ArrayBuffer(count * PARTICLE_FLOATS * 4));
  for (let index = 0; index < count; index += 1) {
    const base = index * PARTICLE_FLOATS;
    const seed = random();
    const ring = 1.15 + 0.45 * seed;
    const angle = random() * Math.PI * 2;
    data[base] = Math.cos(angle) * ring;
    data[base + 1] = (random() - 0.5) * 1.5;
    data[base + 2] = Math.sin(angle) * ring;
    data[base + 3] = seed;
    // vel = 0, glow = 0; the normal starts pointing up, the hue is fixed at spawn.
    data[base + 9] = 1;
    data[base + 11] = random();
  }
  return data;
}

/** Column-major view-projection for a camera at `eye` looking at the origin, WebGPU depth 0..1. */
export function viewProjection(eye: [number, number, number], aspect: number, fovDegrees = FOV_DEGREES, near = 0.1, far = 60): Float32Array {
  const [ex, ey, ez] = eye;
  const len = Math.hypot(ex, ey, ez) || 1;
  // Forward is from the eye to the origin.
  const fx = -ex / len;
  const fy = -ey / len;
  const fz = -ez / len;
  // Right = forward × up (up is +Y).
  let rx = fy * 0 - fz * 1;
  let ry = fz * 0 - fx * 0;
  let rz = fx * 1 - fy * 0;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  // True up = right × forward.
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const view = new Float32Array([
    rx, ux, -fx, 0,
    ry, uy, -fy, 0,
    rz, uz, -fz, 0,
    -(rx * ex + ry * ey + rz * ez), -(ux * ex + uy * ey + uz * ez), fx * ex + fy * ey + fz * ez, 1,
  ]);
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const projection = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ]);
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += projection[k * 4 + row] * view[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function createGistEngine({ gpu, target, shaders, count = GIST_PARTICLE_COUNT, aspect = () => 1, random = Math.random }: GistEngineDeps): GistEngine {
  const particles: StorageBuffer = storage(gpu, count * PARTICLE_FLOATS * 4, 'read-write');
  particles.write(seedParticles(count, random));
  const prims: StorageBuffer = storage(gpu, GIST_MAX_PRIMITIVES * PRIM_FLOATS * 4, 'read');
  prims.write(packGist(null).data);

  const state = { energy: 0, attract: 0, fade: 0 };
  const targets = { energy: 0, attract: 0, fade: 0 };
  let primCount = 0;
  let main: [number, number, number] = hexToRgb('#d5ef9c');
  let accent: [number, number, number] = hexToRgb('#84d7ff');
  let previous = 0;
  let started = 0;
  let disposed = false;
  const runSeed = random() * 100;
  const eyeFor = (time: number): [number, number, number] => {
    const angle = time * 0.35;
    return [Math.sin(angle) * ORBIT_RADIUS, 1.1 + Math.sin(time * 0.31) * 0.3, Math.cos(angle) * ORBIT_RADIUS];
  };
  /** Key light rides above and to the left of the camera, so the lit side always faces the viewer. */
  const lightFor = (eye: [number, number, number]): [number, number, number] => {
    const angle = Math.atan2(eye[0], eye[2]) + 0.7;
    const light: [number, number, number] = [Math.sin(angle) * 0.8, 0.9, Math.cos(angle) * 0.8];
    const len = Math.hypot(...light) || 1;
    return [light[0] / len, light[1] / len, light[2] / len];
  };
  const cameraUniform = (time: number) => {
    const eye = eyeFor(time);
    return {
      viewProjection: viewProjection(eye, aspect()),
      main,
      aspect: aspect(),
      accent,
      size: DISC_SIZE,
      light: lightFor(eye),
      time,
      eye,
      attract: state.attract,
      fade: state.fade,
      pad0: 0,
      pad1: 0,
      pad2: 0,
    };
  };

  const step: Compute = compute(gpu, shaders.step, {
    label: 'Lupi gist step',
    set: {
      params: { time: 0, dt: 0, energy: 0, attract: 0, count, primCount: 0, seed: runSeed, pad: 0 },
      prims,
      particles,
    },
  });
  const points: Draw = draw(gpu, {
    shader: shaders.points,
    label: 'Lupi gist points',
    instances: count,
    vertices: 6,
    blend: 'premultiplied',
    set: {
      camera: cameraUniform(0),
      particles,
    },
  });

  const ease = (key: keyof typeof state, rate = EASE) => {
    state[key] += (targets[key] - state[key]) * rate;
    if (Math.abs(targets[key] - state[key]) < 0.002) state[key] = targets[key];
  };

  return {
    state,
    particles,
    setGist(gist) {
      const packed = packGist(gist);
      prims.write(packed.data);
      primCount = packed.count;
      if (gist) {
        main = hexToRgb(gist.palette[0]);
        accent = hexToRgb(gist.palette[1]);
      }
    },
    setEnergy(value) {
      targets.energy = Math.max(0, Math.min(1, value));
    },
    setAttract(value) {
      targets.attract = Math.max(0, Math.min(1, value));
    },
    setFade(value) {
      targets.fade = Math.max(0, Math.min(1, value));
    },
    tick(now) {
      if (disposed) return false;
      if (!started) {
        started = now;
        previous = now;
      }
      const dt = Math.min(Math.max((now - previous) / 1000, 0), 0.05);
      previous = now;
      const time = (now - started) / 1000;
      ease('energy');
      ease('attract');
      ease('fade', 0.08);
      step.set({ params: { time, dt, energy: state.energy, attract: primCount > 0 ? state.attract : 0, count, primCount, seed: runSeed, pad: 0 } });
      step.dispatch(Math.ceil(count / WORKGROUP));
      points.set({ camera: cameraUniform(time) });
      frame(gpu, (pass) => pass.pass(target, points));
      return state.fade > 0.001 || targets.fade > 0 || state.energy > 0.001 || targets.energy > 0;
    },
    dispose() {
      disposed = true;
    },
  };
}
