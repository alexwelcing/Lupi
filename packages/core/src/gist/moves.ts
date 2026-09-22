import {
  GIST_MAX_BLEND,
  GIST_MAX_PRIMITIVES,
  GIST_MAX_SIZE,
  GIST_MIN_SIZE,
  cloneGist,
  gistBody,
  gistBounds,
  type Gist,
  type GistPrimitive,
} from './types';

/**
 * Sculpting moves: the small, named edits Jev chooses between. Each move is
 * a pure function of the gist, described in plain words so a judgment over
 * text can pick one. The set offered for a gist is deterministic, so the
 * edge and the browser agree on what `move: "add-stem"` means without
 * shipping the shape twice.
 */
export interface GistMove {
  id: string;
  /** One line, for Jev's criteria and for the log. */
  description: string;
}

export const GIST_KEEP_MOVE = 'keep';
/** Moves that only change proportions; the policy damps these once the measured mismatch is small. */
export const GIST_PROPORTION_MOVES: readonly string[] = ['flatten', 'stretch', 'widen', 'slim'];
export const GIST_MAX_MOVES = 12;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const scaleSize = (primitive: GistPrimitive, factors: [number, number, number]): void => {
  if (primitive.kind === 'lathe') {
    // A lathe is its profile: width lives in the radius scale, height in the half height.
    primitive.size[0] = clamp(primitive.size[0] * factors[0], 0.2, 3);
    primitive.size[1] = clamp(primitive.size[1] * factors[1], GIST_MIN_SIZE, GIST_MAX_SIZE);
    return;
  }
  if (primitive.kind === 'arc') {
    primitive.size[0] = clamp(primitive.size[0] * factors[1], GIST_MIN_SIZE, GIST_MAX_SIZE);
    primitive.size[1] = clamp(primitive.size[1] * factors[0], GIST_MIN_SIZE, GIST_MAX_SIZE);
    return;
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (primitive.kind === 'cone' && axis === 2) {
      primitive.size[2] = clamp(primitive.size[2] * factors[axis], 0, GIST_MAX_SIZE);
    } else {
      primitive.size[axis] = clamp(primitive.size[axis] * factors[axis], GIST_MIN_SIZE, GIST_MAX_SIZE);
    }
  }
};
const hasPart = (gist: Gist, name: string): boolean => gist.primitives.some((primitive) => primitive.name === name);
const lastPart = (gist: Gist): GistPrimitive | null => {
  for (let index = gist.primitives.length - 1; index > 0; index -= 1) {
    if (gist.primitives[index] !== gistBody(gist)) return gist.primitives[index];
  }
  return null;
};

/**
 * The moves Jev may choose from for this gist, keep excluded. Proportion
 * moves are small steps that can be repeated; the loop doubles them when
 * the measured mismatch is large. Parts are offered only while absent, and
 * only where they make sense on this body.
 */
export function applicableMoves(gist: Gist): GistMove[] {
  const body = gistBody(gist);
  const moves: GistMove[] = [
    { id: 'flatten', description: 'Flatten the body top to bottom so it is squatter and wider than it is tall (a small step; can be repeated).' },
    { id: 'stretch', description: 'Stretch the body vertically so it is taller and narrower (a small step; can be repeated).' },
    { id: 'widen', description: 'Widen the body sideways in both horizontal directions (a small step; can be repeated).' },
    { id: 'slim', description: 'Slim the body sideways so it is narrower (a small step; can be repeated).' },
  ];
  if (body.blend < 0.3) moves.push({ id: 'soften', description: 'Soften every join so parts flow into each other with no seams.' });
  else moves.push({ id: 'sharpen', description: 'Sharpen the joins so parts meet crisply.' });
  const room = gist.primitives.length < GIST_MAX_PRIMITIVES;
  if (room && !hasPart(gist, 'stem')) moves.push({ id: 'add-stem', description: 'Add a short thin stem sticking up from the top of the body.' });
  if (room && !hasPart(gist, 'neck')) moves.push({ id: 'add-neck', description: 'Add a narrow neck rising from the top of the body, like a bottle or a vase.' });
  if (room && !hasPart(gist, 'handle')) moves.push({ id: 'add-handle', description: 'Add a loop handle on one side of the body.' });
  if (room && !hasPart(gist, 'base')) moves.push({ id: 'add-base', description: 'Add a flat wide base under the body.' });
  if (room && !hasPart(gist, 'dimple')) moves.push({ id: 'dimple', description: 'Press a dimple into the top of the body.' });
  if (room && !hasPart(gist, 'cap')) moves.push({ id: 'add-cap', description: 'Add a wide flat cap on top of the body, like a screw head, a lid, or a mushroom cap.' });
  if (body.kind === 'cylinder' || body.kind === 'cone') moves.push({ id: 'taper', description: 'Taper the body so it narrows toward the top.' });
  if (body.kind === 'box') moves.push({ id: 'round', description: 'Round the body off into a cylinder of the same size.' });
  if (body.kind === 'cylinder' || body.kind === 'capsule' || body.kind === 'ellipsoid' || body.kind === 'cone') {
    moves.push({ id: 'bend', description: 'Bend the body into a curve, like a banana, a horn, or a hook.' });
  }
  if (body.kind === 'arc') moves.push({ id: 'bend', description: 'Bend the body further into a tighter curve.' });
  if (room && !hasPart(gist, 'hollow') && (body.kind === 'cylinder' || body.kind === 'cone' || body.kind === 'box')) {
    moves.push({ id: 'hollow', description: 'Hollow the body out from the top, like a cup or a bowl.' });
  }
  const removable = lastPart(gist);
  if (removable) moves.push({ id: `remove-${removable.name}`, description: `Remove the ${removable.name}; it does not belong.` });
  return moves.slice(0, GIST_MAX_MOVES);
}

const powered = (factors: [number, number, number], strength: number): [number, number, number] =>
  [factors[0] ** strength, factors[1] ** strength, factors[2] ** strength];

/** What the photo measured, so a part can be sized from it instead of guessed. */
export interface MoveContext {
  /** Silhouette widths of the whole photo, top to bottom, as fractions of height. */
  photoProfile?: number[] | null;
  /** The body alone, same units; where the photo is wider than this, something sticks out. */
  bodyProfile?: number[] | null;
}

/**
 * Where the photo's silhouette bulges past the body on one side: the bands
 * it spans and how far it sticks out, in fractions of the object's height.
 */
export function protrusion(context: MoveContext | undefined): { first: number; last: number; depth: number; bands: number } | null {
  const photo = context?.photoProfile;
  const body = context?.bodyProfile;
  if (!photo || !body || photo.length === 0) return null;
  const bands = Math.min(photo.length, body.length);
  let first = -1;
  let last = -1;
  let depth = 0;
  for (let band = 0; band < bands; band += 1) {
    const extra = photo[band] - body[band];
    if (extra > 0.06) {
      if (first < 0) first = band;
      last = band;
      depth = Math.max(depth, extra);
    }
  }
  if (first < 0 || last - first < 1) return null;
  return { first, last, depth, bands };
}

/**
 * Apply a move by id. `strength` scales proportion moves (2 doubles the
 * step, for when the measured mismatch is large). `context` carries the
 * photo's measurements so a handle lands where the silhouette bulges.
 * Returns null for `keep`, an unknown id, or a move the gist does not offer.
 */
export function applyMove(gist: Gist, moveId: string, strength = 1, context?: MoveContext): Gist | null {
  if (moveId === GIST_KEEP_MOVE) return null;
  if (!applicableMoves(gist).some((move) => move.id === moveId)) return null;
  const next = cloneGist(gist);
  const body = gistBody(next);
  const bounds = gistBounds(next);
  const top = bounds.max[1];
  const bottom = bounds.min[1];
  const height = Math.max(top - bottom, 0.1);
  const halfWidth = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) / 2;
  const step = Math.max(1, Math.min(3, strength));
  // A sphere has one radius; a proportion move needs three, so it becomes an ellipsoid first.
  if (body.kind === 'sphere' && GIST_PROPORTION_MOVES.includes(moveId)) {
    body.kind = 'ellipsoid';
    body.size = [body.size[0], body.size[0], body.size[0]];
  }
  switch (moveId) {
    case 'flatten':
      scaleSize(body, powered([1.08, 0.78, 1.08], step));
      break;
    case 'stretch':
      scaleSize(body, powered([0.92, 1.28, 0.92], step));
      break;
    case 'widen':
      scaleSize(body, powered([1.22, 1, 1.22], step));
      break;
    case 'slim':
      scaleSize(body, powered([0.82, 1, 0.82], step));
      break;
    case 'round':
      body.kind = 'cylinder';
      body.size = [Math.max(body.size[0], body.size[2]), body.size[1], 0];
      break;
    case 'bend':
      if (body.kind === 'arc') {
        body.size[2] = Math.min(Math.PI * 0.85, body.size[2] * 1.3);
      } else {
        // A tube as long as the body was tall, bent through about a third of a turn, opening upward.
        const halfLength = body.kind === 'ellipsoid' ? body.size[1] : body.size[1] + (body.kind === 'capsule' ? body.size[0] : 0);
        const radius = body.kind === 'ellipsoid' ? Math.min(body.size[0], body.size[2]) * 0.6 : body.kind === 'cone' ? (body.size[0] + body.size[2]) / 2 : body.size[0];
        const angle = 0.95;
        body.kind = 'arc';
        body.size = [Math.max(GIST_MIN_SIZE, halfLength / angle), Math.max(GIST_MIN_SIZE, radius), angle];
        body.rotation = [0, 0, 180];
      }
      break;
    case 'taper':
      if (body.kind === 'cylinder') {
        body.kind = 'cone';
        body.size = [body.size[0], body.size[1], body.size[0] * 0.55];
      } else {
        body.size[2] = Math.max(0, body.size[2] * 0.55);
      }
      break;
    case 'add-cap':
      next.primitives.push({
        kind: 'cylinder',
        name: 'cap',
        center: [0, top + 0.05, 0],
        size: [Math.min(GIST_MAX_SIZE, Math.max(halfWidth * 1.6, 0.12)), 0.06, 0],
        rotation: [0, 0, 0],
        blend: 0.03,
        subtract: false,
      });
      break;
    case 'add-neck':
      next.primitives.push({
        kind: 'cylinder',
        name: 'neck',
        center: [0, top + (top - bottom) * 0.22, 0],
        size: [Math.max(GIST_MIN_SIZE, halfWidth * 0.3), Math.max(0.1, (top - bottom) * 0.24), 0],
        rotation: [0, 0, 0],
        blend: 0.12,
        subtract: false,
      });
      break;
    case 'soften':
      for (const primitive of next.primitives) primitive.blend = clamp(primitive.blend + 0.12, 0, GIST_MAX_BLEND);
      break;
    case 'sharpen':
      for (const primitive of next.primitives) primitive.blend = clamp(primitive.blend * 0.4, 0, GIST_MAX_BLEND);
      break;
    case 'add-stem':
      next.primitives.push({
        kind: 'cylinder',
        name: 'stem',
        center: [0, top + 0.12, 0],
        size: [Math.max(GIST_MIN_SIZE, halfWidth * 0.06), 0.16, 0],
        rotation: [0, 0, 12],
        blend: 0.05,
        subtract: false,
      });
      break;
    case 'add-handle': {
      const bulge = protrusion(context);
      if (bulge) {
        // Measured: the loop spans the bands where the photo bulges past the body,
        // and reaches out as far as the bulge does.
        const yTop = top - (bulge.first / bulge.bands) * height;
        const yBottom = top - ((bulge.last + 1) / bulge.bands) * height;
        const ring = Math.max(0.1, (yTop - yBottom) / 2);
        const tube = Math.max(GIST_MIN_SIZE, Math.min(0.12, (bulge.depth * height) / 4));
        next.primitives.push({
          kind: 'torus',
          name: 'handle',
          center: [bounds.max[0] - tube, (yTop + yBottom) / 2, 0],
          size: [Math.min(ring, Math.max(0.1, bulge.depth * height - tube)), tube, 0],
          rotation: [90, 0, 0],
          blend: 0.06,
          subtract: false,
        });
      } else {
        next.primitives.push({
          kind: 'torus',
          name: 'handle',
          center: [bounds.max[0] + 0.05, (top + bottom) / 2, 0],
          size: [Math.max(0.12, height * 0.28), Math.max(GIST_MIN_SIZE, halfWidth * 0.08), 0],
          rotation: [90, 0, 0],
          blend: 0.06,
          subtract: false,
        });
      }
      break;
    }
    case 'add-base':
      next.primitives.push({
        kind: 'cylinder',
        name: 'base',
        center: [0, bottom - 0.04, 0],
        size: [Math.min(GIST_MAX_SIZE, halfWidth * 1.15), 0.05, 0],
        rotation: [0, 0, 0],
        blend: 0.08,
        subtract: false,
      });
      break;
    case 'dimple':
      next.primitives.push({
        kind: 'sphere',
        name: 'dimple',
        center: [0, top + halfWidth * 0.18, 0],
        size: [Math.max(0.08, halfWidth * 0.32), 0, 0],
        rotation: [0, 0, 0],
        blend: 0.08,
        subtract: true,
      });
      break;
    case 'hollow': {
      const inner: GistPrimitive = {
        ...body,
        name: 'hollow',
        center: [body.center[0], body.center[1] + body.size[1] * 0.18, body.center[2]],
        size: [body.size[0] * 0.8, body.size[1], body.size[2] * 0.8],
        rotation: [...body.rotation] as [number, number, number],
        blend: 0.04,
        subtract: true,
      };
      next.primitives.push(inner);
      break;
    }
    default: {
      if (moveId.startsWith('remove-')) {
        const name = moveId.slice('remove-'.length);
        const index = next.primitives.findIndex((primitive, position) => position > 0 && primitive.name === name);
        if (index <= 0) return null;
        next.primitives.splice(index, 1);
        break;
      }
      return null;
    }
  }
  return next;
}

const KIND_WORDS: Record<GistPrimitive['kind'], string> = {
  sphere: 'sphere',
  ellipsoid: 'ellipsoid',
  box: 'box',
  cylinder: 'cylinder',
  capsule: 'capsule',
  cone: 'cone',
  torus: 'ring',
  lathe: 'turned body',
  arc: 'bent tube',
};

function sizeWords(primitive: GistPrimitive): string {
  const [a, b, c] = primitive.size;
  const fmt = (value: number) => value.toFixed(2);
  switch (primitive.kind) {
    case 'sphere':
      return `radius ${fmt(a)}`;
    case 'ellipsoid':
      return `radii ${fmt(a)} wide, ${fmt(b)} tall, ${fmt(c)} deep`;
    case 'box':
      return `${fmt(a * 2)} wide, ${fmt(b * 2)} tall, ${fmt(c * 2)} deep`;
    case 'cylinder':
      return `radius ${fmt(a)}, ${fmt(b * 2)} tall`;
    case 'capsule':
      return `radius ${fmt(a)}, ${fmt(b * 2 + a * 2)} long`;
    case 'cone':
      return `${fmt(a)} radius at the bottom, ${fmt(c)} at the top, ${fmt(b * 2)} tall`;
    case 'torus':
      return `ring radius ${fmt(a)}, tube radius ${fmt(b)}`;
    case 'lathe': {
      const radii = primitive.profile ?? [];
      const widest = Math.max(...radii, 0) * a;
      const top = (radii[0] ?? 0) * a;
      const bottom = (radii[radii.length - 1] ?? 0) * a;
      return `its outline revolved: ${fmt(widest * 2)} at the widest, ${fmt(top * 2)} at the top, ${fmt(bottom * 2)} at the bottom, ${fmt(b * 2)} tall`;
    }
    case 'arc':
      return `bend radius ${fmt(a)}, tube radius ${fmt(b)}, curving through ${Math.round((c * 2 * 180) / Math.PI)} degrees`;
  }
}

function placement(primitive: GistPrimitive, body: GistPrimitive): string {
  if (primitive === body) return 'at the centre';
  if (primitive.subtract) {
    if (primitive.name === 'hollow') return 'hollowing the body out from the top';
    if (primitive.name === 'dimple') return 'pressed into the top of the body';
    return 'carved into the body';
  }
  const [dx, dy, dz] = [primitive.center[0] - body.center[0], primitive.center[1] - body.center[1], primitive.center[2] - body.center[2]];
  const parts: string[] = [];
  if (dy > 0.08) parts.push('above the body');
  else if (dy < -0.08) parts.push('below the body');
  if (Math.abs(dx) > 0.08 || Math.abs(dz) > 0.08) parts.push('to one side');
  if (parts.length === 0) parts.push('inside the body');
  return parts.join(', ');
}

/**
 * The shape in words, for Jev's `state`. Numbers stay so the judgment can
 * reason about proportions; the vocabulary stays small so the prompt stays
 * short. Deterministic for a given gist.
 */
export function describeGist(gist: Gist): string {
  const body = gistBody(gist);
  const lines = gist.primitives.map((primitive) => {
    const verb = primitive.subtract ? 'carved out' : 'solid';
    const tilt = primitive.rotation.some((degrees) => Math.abs(degrees) > 1) ? `, rotated ${primitive.rotation.map((degrees) => Math.round(degrees)).join('/')} degrees` : '';
    const join = primitive === body ? '' : primitive.blend >= 0.2 ? ', blended smoothly in' : ', joined crisply';
    return `${primitive.name}: ${verb} ${KIND_WORDS[primitive.kind]}, ${sizeWords(primitive)}, ${placement(primitive, body)}${tilt}${join}`;
  });
  return lines.join('. ') + '.';
}
