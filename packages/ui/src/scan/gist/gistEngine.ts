import { compute, draw, frame, storage, type Compute, type Draw, type Gpu, type ShaderSource, type StorageBuffer, type Target } from 'vgpu';
import { GIST_MAX_PRIMITIVES, VOLUME_SIZE, type ColouredPoints, type Gist, type GistPrimitive, type Volume } from '@atlas/core/gist';

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
  /** Replace the volume: the photo's own silhouette inflated. Unioned with the gist's primitives, if any. */
  setVolume(volume: Volume | null): void;
  /**
   * Give every particle a 3D point of a reconstructed object, with its
   * colour, and start the assembly wave; `null` releases them back to the
   * volume or gist. Fewer points than particles are shared round-robin.
   */
  setHomes(points: ColouredPoints | null): void;
  /** Camera orbit rate in radians per second; 0 holds the front view. */
  setSpin(rate: number): void;
  /** The two colours the palette-wearing particles use (hex). */
  setPalette(main: string, accent: string): void;
  /** Reseed every particle from a photo (a flat sheet of pixels facing the camera) or back onto the ring. */
  setPhoto(photo: PhotoPixels | null): void;
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
  /** Born from a photo when given; otherwise on the ring. */
  photo?: PhotoPixels | null;
  /** Orbit speed in radians per second; 0 holds the camera at the front. */
  spin?: number;
}

export const GIST_PARTICLE_COUNT = 60_000;
export const PARTICLE_FLOATS = 16;
/** Floats per 3D home: position, packed colour, normal, pad. */
export const HOME_FLOATS = 8;
export const PRIM_FLOATS = 24;
const WORKGROUP = 64;
const KIND_INDEX: Record<GistPrimitive['kind'], number> = { sphere: 0, ellipsoid: 1, box: 2, cylinder: 3, capsule: 4, cone: 5, torus: 6, lathe: 7, arc: 8 };
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
    if (primitive.kind === 'lathe') {
      // A lathe stands upright; its twelve radii ride in the rotation slots.
      data.set((primitive.profile ?? []).slice(0, 12), base + 8);
    } else {
      const rows = rotationRows(primitive.rotation);
      data.set(rows[0], base + 8);
      data.set(rows[1], base + 12);
      data.set(rows[2], base + 16);
    }
    view.setUint32((base + 20) * 4, primitive.subtract ? 1 : 0, true);
  });
  return { data, count: primitives.length };
}

/** A small copy of the photo the particles are born from: RGBA bytes, row-major. */
export interface PhotoPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
  /** 1 where the pixel belongs to the object; those particles carry the photo's colour onto the shape. */
  mask?: Uint8Array;
  /** How the object is framed in the world: the sheet is scaled by `zoom` about `centre` (sheet units). */
  frame?: { zoom: number; centre: [number, number] };
}

/** World size of the photo sheet at zoom 1; the volume builder uses the same numbers. */
export const PHOTO_SHEET = { height: 2.6 };

/** Colour weight for a particle born on background: mostly palette, a little of the photo. */
const BACKGROUND_COLOR_WEIGHT = 40;
/** Share of the particles born on the object's own pixels when a mask singles it out. */
export const OBJECT_PARTICLE_SHARE = 0.7;


/**
 * Particles start on a whirling ring, the same one the kernel respawns onto,
 * or, with a photo, as the photo itself: each particle is born on a pixel of
 * a flat sheet facing the camera and carries that pixel's colour with it.
 */
export function seedParticles(count: number, random: () => number = Math.random, photo: PhotoPixels | null = null): Float32Array<ArrayBuffer> {
  const data = new Float32Array(new ArrayBuffer(count * PARTICLE_FLOATS * 4));
  const view = new DataView(data.buffer);
  const aspect = photo ? photo.width / Math.max(photo.height, 1) : 1;
  const sheetHeight = PHOTO_SHEET.height;
  const sheetWidth = sheetHeight * aspect;
  const zoom = photo?.frame?.zoom ?? 1;
  const centre = photo?.frame?.centre ?? [0, 0];
  // With a mask, most particles are born on the object and the rest on the
  // background, and the background ones come first in the buffer: the draw
  // has no depth test, so what is drawn last is what is seen, and the front
  // face must be the object's own pixels.
  const objectPixels: number[] = [];
  const backgroundPixels: number[] = [];
  if (photo?.mask) {
    for (let index = 0; index < photo.mask.length; index += 1) (photo.mask[index] === 1 ? objectPixels : backgroundPixels).push(index);
  }
  const weighted = objectPixels.length > 0 && backgroundPixels.length > 0;
  const objectCount = weighted ? Math.round(count * OBJECT_PARTICLE_SHARE) : 0;
  for (let index = 0; index < count; index += 1) {
    const base = index * PARTICLE_FLOATS;
    const seed = random();
    if (photo) {
      let px: number;
      let py: number;
      if (weighted) {
        const pool = index >= count - objectCount ? objectPixels : backgroundPixels;
        const pixel = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
        px = pixel % photo.width;
        py = (pixel - px) / photo.width;
      } else {
        px = Math.min(photo.width - 1, Math.floor(random() * photo.width));
        py = Math.min(photo.height - 1, Math.floor(random() * photo.height));
      }
      // Anywhere inside the pixel, so a few particles per pixel do not stack.
      const u = (px + random()) / photo.width;
      const v = (py + random()) / photo.height;
      const at = (py * photo.width + px) * 4;
      const onObject = !photo.mask || photo.mask[py * photo.width + px] === 1;
      const x = ((u - 0.5) * sheetWidth - centre[0]) * zoom;
      const y = ((0.5 - v) * sheetHeight - centre[1]) * zoom;
      data[base] = x;
      data[base + 1] = y;
      data[base + 2] = (random() - 0.5) * 0.08;
      const weight = onObject ? 255 : BACKGROUND_COLOR_WEIGHT;
      view.setUint32((base + 11) * 4, (photo.data[at] | (photo.data[at + 1] << 8) | (photo.data[at + 2] << 16) | (weight << 24)) >>> 0, true);
      // Home: the pixel's own place, a little in front, so the spring lands it on the front face there.
      if (onObject) {
        data[base + 12] = x;
        data[base + 13] = y;
        data[base + 14] = 0.9;
        data[base + 15] = 1;
      }
    } else {
      const ring = 1.15 + 0.45 * seed;
      const angle = random() * Math.PI * 2;
      data[base] = Math.cos(angle) * ring;
      data[base + 1] = (random() - 0.5) * 1.5;
      data[base + 2] = Math.sin(angle) * ring;
      // color 0: no photo, wear the palette.
    }
    data[base + 3] = seed;
    // vel = 0, glow = 0; the normal starts pointing up.
    data[base + 9] = 1;
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

export function createGistEngine({ gpu, target, shaders, count = GIST_PARTICLE_COUNT, aspect = () => 1, random = Math.random, photo = null, spin = 0.35 }: GistEngineDeps): GistEngine {
  const particles: StorageBuffer = storage(gpu, count * PARTICLE_FLOATS * 4, 'read-write');
  particles.write(seedParticles(count, random, photo));
  const prims: StorageBuffer = storage(gpu, GIST_MAX_PRIMITIVES * PRIM_FLOATS * 4, 'read');
  prims.write(packGist(null).data);
  const volumeCells = VOLUME_SIZE * VOLUME_SIZE * VOLUME_SIZE;
  const volumeBuffer: StorageBuffer = storage(gpu, volumeCells * 4, 'read');
  volumeBuffer.write(new Float32Array(new ArrayBuffer(volumeCells * 4)).fill(4));
  // The front face of the volume, one half depth per (x, y) column.
  const frontBuffer: StorageBuffer = storage(gpu, VOLUME_SIZE * VOLUME_SIZE * 4, 'read');
  frontBuffer.write(new Float32Array(new ArrayBuffer(VOLUME_SIZE * VOLUME_SIZE * 4)));
  let volumeInfo = { origin: [0, 0, 0] as [number, number, number], cell: 1, n: VOLUME_SIZE, active: 0 };
  // One 3D home per particle (32 bytes: xyz, a packed colour, a normal), for a reconstructed object.
  const homesBuffer: StorageBuffer = storage(gpu, count * HOME_FLOATS * 4, 'read');
  homesBuffer.write(new Float32Array(new ArrayBuffer(count * HOME_FLOATS * 4)));
  let homesInfo = { active: 0, since: 0 };
  let clock = 0;

  const state = { energy: 0, attract: 0, fade: 0 };
  const targets = { energy: 0, attract: 0, fade: 0 };
  let primCount = 0;
  let main: [number, number, number] = hexToRgb('#d5ef9c');
  let accent: [number, number, number] = hexToRgb('#84d7ff');
  let previous = 0;
  let started = 0;
  let disposed = false;
  const runSeed = random() * 100;
  // The orbit accumulates, so the rate can change without the camera jumping.
  let spinRate = spin;
  let orbit = 0;
  const eyeFor = (time: number): [number, number, number] => {
    return [Math.sin(orbit) * ORBIT_RADIUS, 1.1 + Math.sin(time * 0.31) * 0.3, Math.cos(orbit) * ORBIT_RADIUS];
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
      homesActive: homesInfo.active,
      homesSince: homesInfo.since,
      pad2: 0,
    };
  };

  const stepParams = (time: number, dt: number) => ({
    time,
    dt,
    energy: state.energy,
    attract: primCount > 0 || volumeInfo.active || homesInfo.active ? state.attract : 0,
    count,
    primCount,
    seed: runSeed,
    pad: 0,
    volumeOrigin: volumeInfo.origin,
    volumeCell: volumeInfo.cell,
    volumeN: volumeInfo.n,
    volumeActive: volumeInfo.active,
    homesActive: homesInfo.active,
    homesSince: homesInfo.since,
  });
  const step: Compute = compute(gpu, shaders.step, {
    label: 'Lupi gist step',
    set: {
      params: stepParams(0, 0),
      prims,
      particles,
      volume: volumeBuffer,
      front: frontBuffer,
      homes: homesBuffer,
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
    setPhoto(next) {
      particles.write(seedParticles(count, random, next));
    },
    setHomes(pointsCloud) {
      if (!pointsCloud || pointsCloud.count === 0) {
        homesInfo = { active: 0, since: 0 };
        return;
      }
      const data = new Float32Array(new ArrayBuffer(count * HOME_FLOATS * 4));
      const view = new DataView(data.buffer);
      for (let index = 0; index < count; index += 1) {
        // Spread the particles over the points in order (the points come far
        // to near, and so does the draw): a stride walk when there are more
        // points than particles, a repeat when fewer.
        const point = pointsCloud.count >= count ? Math.floor((index / count) * pointsCloud.count) : index % pointsCloud.count;
        const base = index * HOME_FLOATS;
        data[base] = pointsCloud.positions[point * 3];
        data[base + 1] = pointsCloud.positions[point * 3 + 1];
        data[base + 2] = pointsCloud.positions[point * 3 + 2];
        view.setUint32((base + 3) * 4, (pointsCloud.colors[point * 3] | (pointsCloud.colors[point * 3 + 1] << 8) | (pointsCloud.colors[point * 3 + 2] << 16) | (255 << 24)) >>> 0, true);
        data[base + 4] = pointsCloud.normals[point * 3] / 127;
        data[base + 5] = pointsCloud.normals[point * 3 + 1] / 127;
        data[base + 6] = pointsCloud.normals[point * 3 + 2] / 127;
      }
      homesBuffer.write(data);
      homesInfo = { active: 1, since: clock };
    },
    setSpin(rate) {
      spinRate = rate;
    },
    setPalette(mainHex, accentHex) {
      main = hexToRgb(mainHex);
      accent = hexToRgb(accentHex);
    },
    setVolume(volume) {
      if (!volume) {
        volumeInfo = { ...volumeInfo, active: 0 };
        return;
      }
      // The buffer is sized for VOLUME_SIZE³; a smaller grid is packed into its corner.
      const n = Math.min(volume.n, VOLUME_SIZE);
      const packed = new Float32Array(new ArrayBuffer(volumeCells * 4));
      if (volume.n === VOLUME_SIZE) {
        packed.set(volume.sdf);
      } else {
        packed.fill(4);
        for (let z = 0; z < n; z += 1) for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) packed[x + VOLUME_SIZE * (y + VOLUME_SIZE * z)] = volume.sdf[x + volume.n * (y + volume.n * z)];
      }
      volumeBuffer.write(packed);
      const front = new Float32Array(new ArrayBuffer(VOLUME_SIZE * VOLUME_SIZE * 4));
      if (volume.n === VOLUME_SIZE) {
        front.set(volume.front);
      } else {
        for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) front[x + VOLUME_SIZE * y] = volume.front[x + volume.n * y];
      }
      frontBuffer.write(front);
      volumeInfo = { origin: volume.origin, cell: volume.cell, n: VOLUME_SIZE, active: 1 };
    },
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
      clock = time;
      orbit += dt * spinRate;
      ease('energy');
      ease('attract');
      ease('fade', 0.08);
      step.set({ params: stepParams(time, dt) });
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
