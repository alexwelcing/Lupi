/**
 * A "gist": the geometric essence of an object as a handful of blended signed
 * distance primitives. Not a mesh, not a point cloud: just enough shape for a
 * cloud of particles to settle into something a person recognises at a
 * glance. Y is up, the object sits roughly inside a 2-unit cube centred at
 * the origin, and every size is a half-extent or a radius.
 *
 * The vocabulary is deliberately tiny so that a vision model can write one
 * in a few hundred tokens, a compute shader can evaluate it in a few dozen
 * instructions, and Jev can judge a described edit to it in one call.
 */
export type GistPrimitiveKind = 'sphere' | 'ellipsoid' | 'box' | 'cylinder' | 'capsule' | 'cone' | 'torus' | 'lathe' | 'arc';

export const GIST_PRIMITIVE_KINDS: readonly GistPrimitiveKind[] = ['sphere', 'ellipsoid', 'box', 'cylinder', 'capsule', 'cone', 'torus', 'lathe', 'arc'];

/** Radii a lathe carries, top to bottom; the same count as the silhouette profile's bands. */
export const LATHE_BANDS = 12;

export interface GistPrimitive {
  kind: GistPrimitiveKind;
  /** A short role: body, stem, handle, lid, leg, spout. The first primitive is the body. */
  name: string;
  center: [number, number, number];
  /**
   * sphere: [radius, -, -] · ellipsoid: radii · box: half extents ·
   * cylinder: [radius, half height, -] · capsule: [radius, half length, -] ·
   * cone: [bottom radius, half height, top radius] · torus: [ring radius, tube radius, -] ·
   * lathe: [radius scale, half height, -] with `profile` · arc: [bend radius, tube radius, half angle in radians].
   * Cylinders, capsules, cones, and lathes stand along Y; a torus lies flat in XZ; an arc bends in XY, opening upward.
   */
  size: [number, number, number];
  /** Lathe only: `LATHE_BANDS` radii from the top of the body to the bottom, in world units; the outline revolved. */
  profile?: number[];
  /** Degrees about X, Y, Z, applied in that order. */
  rotation: [number, number, number];
  /** Smooth-union radius joining this primitive to the rest: 0 hard, 0.4 very soft. */
  blend: number;
  /** Carve this shape out of the others (a dimple, a hollow). */
  subtract: boolean;
}

export interface Gist {
  /** What the shape is meant to read as: "apple", "wood screw", "coffee mug". */
  label: string;
  /** How sure the model is that the label is right, 0..1. */
  confidence: number;
  primitives: GistPrimitive[];
  /** Two hex colours: the object's main colour and an accent. */
  palette: [string, string];
}

export const GIST_MAX_PRIMITIVES = 12;
export const GIST_MIN_SIZE = 0.03;
export const GIST_MAX_SIZE = 1.6;
export const GIST_MAX_OFFSET = 1.8;
export const GIST_MAX_BLEND = 0.5;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DEFAULT_PALETTE: [string, string] = ['#d5ef9c', '#84d7ff'];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function triple(value: unknown, fallback: number, min: number, max: number): [number, number, number] {
  const list = Array.isArray(value) ? value : [];
  return [clamp(finite(list[0], fallback), min, max), clamp(finite(list[1], fallback), min, max), clamp(finite(list[2], fallback), min, max)];
}

export function normalizePrimitive(raw: unknown, index: number): GistPrimitive | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === 'string' && (GIST_PRIMITIVE_KINDS as readonly string[]).includes(record.kind) ? (record.kind as GistPrimitiveKind) : null;
  if (!kind) return null;
  const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim().toLowerCase().slice(0, 24) : index === 0 ? 'body' : `part ${index + 1}`;
  const size = triple(record.size, 0.3, GIST_MIN_SIZE, GIST_MAX_SIZE);
  if (kind === 'cone') size[2] = clamp(finite((record.size as unknown[] | undefined)?.[2], 0), 0, GIST_MAX_SIZE);
  if (kind === 'arc') size[2] = clamp(finite((record.size as unknown[] | undefined)?.[2], 1), 0.2, Math.PI);
  const primitive: GistPrimitive = {
    kind,
    name,
    center: triple(record.center, 0, -GIST_MAX_OFFSET, GIST_MAX_OFFSET),
    size,
    rotation: triple(record.rotation, 0, -360, 360),
    blend: clamp(finite(record.blend, 0.1), 0, GIST_MAX_BLEND),
    subtract: record.subtract === true,
  };
  if (kind === 'lathe') {
    const raw = Array.isArray(record.profile) ? record.profile : [];
    const profile: number[] = [];
    for (let band = 0; band < LATHE_BANDS; band += 1) profile.push(clamp(finite(raw[band], raw.length ? 0 : 0.3), 0, GIST_MAX_SIZE));
    if (profile.every((radius) => radius < GIST_MIN_SIZE)) return null;
    primitive.profile = profile;
    primitive.size[0] = clamp(primitive.size[0], 0.2, 3);
  }
  return primitive;
}

/**
 * A body turned from the photo's silhouette profile (widths as fractions of
 * height, top to bottom). The exact outline the camera saw, as a solid of
 * revolution, standing `height` tall.
 */
export function latheFromProfile(profile: number[], height = 1.8, name = 'body'): GistPrimitive {
  const radii: number[] = [];
  for (let band = 0; band < LATHE_BANDS; band += 1) {
    const at = (band / (LATHE_BANDS - 1)) * (profile.length - 1);
    const lower = Math.floor(at);
    const upper = Math.min(profile.length - 1, lower + 1);
    const width = profile[lower] + (profile[upper] - profile[lower]) * (at - lower);
    radii.push(clamp((width / 2) * height, 0, GIST_MAX_SIZE));
  }
  return { kind: 'lathe', name, center: [0, 0, 0], size: [1, height / 2, 0], rotation: [0, 0, 0], blend: 0.08, subtract: false, profile: radii };
}

/** Coerce a model's JSON into a bounded gist. Returns null when there is no usable body. */
export function normalizeGist(raw: unknown): Gist | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label.trim().slice(0, 60) : '';
  const primitives = Array.isArray(record.primitives)
    ? record.primitives.map((entry, index) => normalizePrimitive(entry, index)).filter((entry): entry is GistPrimitive => entry !== null).slice(0, GIST_MAX_PRIMITIVES)
    : [];
  if (!label || primitives.length === 0 || primitives.every((primitive) => primitive.subtract)) return null;
  if (primitives[0].subtract) {
    // The body must be additive; move the first additive primitive to the front.
    const bodyIndex = primitives.findIndex((primitive) => !primitive.subtract);
    const [body] = primitives.splice(bodyIndex, 1);
    primitives.unshift(body);
  }
  const paletteRaw = Array.isArray(record.palette) ? record.palette : [];
  const palette: [string, string] = [
    typeof paletteRaw[0] === 'string' && HEX_COLOR.test(paletteRaw[0]) ? paletteRaw[0].toLowerCase() : DEFAULT_PALETTE[0],
    typeof paletteRaw[1] === 'string' && HEX_COLOR.test(paletteRaw[1]) ? paletteRaw[1].toLowerCase() : DEFAULT_PALETTE[1],
  ];
  return { label, confidence: clamp(finite(record.confidence, 0), 0, 1), primitives, palette };
}

export function cloneGist(gist: Gist): Gist {
  return {
    label: gist.label,
    confidence: gist.confidence,
    palette: [gist.palette[0], gist.palette[1]],
    primitives: gist.primitives.map((primitive) => ({
      ...primitive,
      center: [...primitive.center] as [number, number, number],
      size: [...primitive.size] as [number, number, number],
      rotation: [...primitive.rotation] as [number, number, number],
      ...(primitive.profile ? { profile: [...primitive.profile] } : {}),
    })),
  };
}

/** Rough volume, for picking the body and for describing shares. */
export function primitiveVolume(primitive: GistPrimitive): number {
  const [a, b, c] = primitive.size;
  switch (primitive.kind) {
    case 'sphere':
      return (4 / 3) * Math.PI * a ** 3;
    case 'ellipsoid':
      return (4 / 3) * Math.PI * a * b * c;
    case 'box':
      return 8 * a * b * c;
    case 'cylinder':
      return Math.PI * a * a * 2 * b;
    case 'capsule':
      return Math.PI * a * a * 2 * b + (4 / 3) * Math.PI * a ** 3;
    case 'cone':
      return (Math.PI * 2 * b * (a * a + a * c + c * c)) / 3;
    case 'torus':
      return 2 * Math.PI * Math.PI * a * b * b;
    case 'lathe': {
      const radii = primitive.profile ?? [];
      const slice = (2 * b) / Math.max(radii.length, 1);
      return radii.reduce((sum, radius) => sum + Math.PI * (radius * a) ** 2 * slice, 0);
    }
    case 'arc':
      return Math.PI * b * b * (2 * c * a);
  }
}

/** The main additive primitive: the first one, by contract. */
export function gistBody(gist: Gist): GistPrimitive {
  return gist.primitives.find((primitive) => !primitive.subtract) ?? gist.primitives[0];
}

/** Axis-aligned extent of the additive primitives, ignoring rotation; enough for placing parts. */
export function gistBounds(gist: Gist): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const primitive of gist.primitives) {
    if (primitive.subtract) continue;
    const extent = primitiveExtent(primitive);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], primitive.center[axis] - extent[axis]);
      max[axis] = Math.max(max[axis], primitive.center[axis] + extent[axis]);
    }
  }
  if (!Number.isFinite(min[0])) return { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
  return { min, max };
}

export function primitiveExtent(primitive: GistPrimitive): [number, number, number] {
  const [a, b, c] = primitive.size;
  switch (primitive.kind) {
    case 'sphere':
      return [a, a, a];
    case 'ellipsoid':
    case 'box':
      return [a, b, c];
    case 'cylinder':
      return [a, b, a];
    case 'capsule':
      return [a, a + b, a];
    case 'cone':
      return [Math.max(a, c), b, Math.max(a, c)];
    case 'torus':
      return [a + b, b, a + b];
    case 'lathe': {
      const widest = Math.max(...(primitive.profile ?? [0.3])) * a;
      return [widest, b, widest];
    }
    case 'arc':
      return [a * Math.sin(Math.min(c, Math.PI / 2)) + b, a + b, b];
  }
}
