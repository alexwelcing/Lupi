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
export type GistPrimitiveKind = 'sphere' | 'ellipsoid' | 'box' | 'cylinder' | 'capsule' | 'cone' | 'torus';

export const GIST_PRIMITIVE_KINDS: readonly GistPrimitiveKind[] = ['sphere', 'ellipsoid', 'box', 'cylinder', 'capsule', 'cone', 'torus'];

export interface GistPrimitive {
  kind: GistPrimitiveKind;
  /** A short role: body, stem, handle, lid, leg, spout. The first primitive is the body. */
  name: string;
  center: [number, number, number];
  /**
   * sphere: [radius, -, -] · ellipsoid: radii · box: half extents ·
   * cylinder: [radius, half height, -] · capsule: [radius, half length, -] ·
   * cone: [bottom radius, half height, top radius] · torus: [ring radius, tube radius, -].
   * Cylinders, capsules, and cones stand along Y; a torus lies flat in XZ.
   */
  size: [number, number, number];
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
  return {
    kind,
    name,
    center: triple(record.center, 0, -GIST_MAX_OFFSET, GIST_MAX_OFFSET),
    size,
    rotation: triple(record.rotation, 0, -360, 360),
    blend: clamp(finite(record.blend, 0.1), 0, GIST_MAX_BLEND),
    subtract: record.subtract === true,
  };
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
  }
}
