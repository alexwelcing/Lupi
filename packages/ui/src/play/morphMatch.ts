/**
 * morphMatch.ts — the morph arrival's plan: which atom of the previous
 * molecule each atom of the new one starts from, and where that is.
 *
 * Pure (no three, no store, no clock): PlayLayer hands in both molecules'
 * positions and elements and the camera poses the screen showed them with,
 * and writes the plan into `@atlas/scene`'s displayMotion (`setDisplayMorph`).
 *
 * - Frames. Each molecule is put in its own view's frame: the camera's right,
 *   up and back axes around the anchor (the point on the view axis at the
 *   molecule centre's depth), divided by that depth. In perspective a point
 *   keeps its place on screen when all its view coordinates scale together,
 *   so the old molecule, drawn in the new view at the same frame coordinates,
 *   starts exactly where the screen showed it, at the size the camera fit
 *   gave it (the fit makes the depth ratio the ratio of the two radii). Where
 *   a view has no usable depth (an orthographic camera, a centre behind the
 *   camera) both molecules use their centre and radius instead.
 * - Matching, in that shared frame: same element first, then any element,
 *   each old atom used at most once while supply lasts. Nearest pairs win:
 *   candidate pairs come from a spatial grid, the shortest are assigned
 *   first, in rounds until one side runs out. For at most 500 new atoms,
 *   swaps that shorten the summed squared travel without losing a
 *   same-element pair (two new atoms trading partners, or a new atom taking
 *   an unused old one) run until none helps.
 * - Supply. New atoms past the old supply bud out of their nearest matched
 *   neighbour (they share its start); old atoms left over vanish at the
 *   switch.
 * - Stagger: the centre leaves first, the rim up to MORPH_TUNING.maxDelayS
 *   later, so the landing reads as a flow.
 *
 * Deterministic: the same inputs give the same plan (ties break by index).
 */

export type MorphVec3 = [number, number, number];

/** Tuning points (owner feedback). */
export const MORPH_TUNING = {
  /** Above this many atoms (either molecule) the switch uses the ordinary arrival. */
  maxAtoms: 20_000,
  /** New atoms at or under this get the swap improvement. */
  improveMaxAtoms: 500,
  /** The rim's departure delay after the centre's (s, Standard; Gentle halves it). */
  maxDelayS: 0.15,
  /** Candidate partners per new atom in the first round (doubling each round). */
  candidates: 4,
  /** Swap passes at most. */
  improvePasses: 8,
} as const;

/** How a camera showed a molecule. */
export interface MorphView {
  /** The camera position (Å). */
  eye: MorphVec3;
  /** The camera's right, up and back axes (unit, world). */
  right: MorphVec3;
  up: MorphVec3;
  back: MorphVec3;
  perspective: boolean;
  /** The molecule's centre and radius (Å). */
  center: MorphVec3;
  radius: number;
}

/** 'depth': anchored on the view axis and divided by its depth; 'radius': the centre and radius. */
export type MorphFrameMode = 'depth' | 'radius';

/** A view's morph frame: a frame point l sits at origin + axisX·l.x + axisY·l.y + axisZ·l.z. */
export interface MorphFrame {
  origin: MorphVec3;
  axisX: MorphVec3;
  axisY: MorphVec3;
  axisZ: MorphVec3;
  /** The depth or radius the frame divides by. */
  scale: number;
}

export interface MorphMolecule {
  /** Flat xyz (Å). */
  positions: ArrayLike<number>;
  /** Atomic number per atom; 0 is unknown and matches only in the any-element pass. */
  elements: ArrayLike<number>;
  count: number;
}

export interface MorphMatch {
  /** Per new atom: the old atom it starts from (a budded atom: its source's partner). */
  from: Int32Array;
  /** Per new atom: the new atom it buds from, or -1 when it has its own partner. */
  budFrom: Int32Array;
  sameElement: number;
  crossElement: number;
  budded: number;
  /** Old atoms without a partner. */
  vanished: number;
}

export interface MorphReport {
  atoms: number;
  previousAtoms: number;
  /** New atoms that start from an old atom of their own element. */
  sameElement: number;
  /** New atoms that start from an old atom of another element. */
  crossElement: number;
  /** New atoms that bud out of a matched neighbour. */
  budded: number;
  /** Old atoms that vanish at the switch. */
  vanished: number;
  frame: MorphFrameMode;
}

export interface MorphPlan {
  /** MORPH_TEXEL_STRIDE (4) floats per new atom: its start in the old frame (x, y, z) and its delay (s). */
  texels: Float32Array;
  /** The mode both frames use (the live view keeps it while the morph waits to start). */
  mode: MorphFrameMode;
  /** The new view's frame at planning time. */
  frame: MorphFrame;
  report: MorphReport;
}

const STRIDE = 4;
const MIN_DEPTH = 1e-3;

function sub3(a: MorphVec3, b: MorphVec3): MorphVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot3(a: MorphVec3, b: MorphVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The depth of the molecule centre along the view axis (forward is −back). */
export function morphDepth(view: MorphView): number {
  return -dot3(sub3(view.center, view.eye), view.back);
}

/** 'depth' when both views are perspective with the centre in front; otherwise 'radius'. */
export function morphFrameMode(previous: MorphView, next: MorphView): MorphFrameMode {
  const usable = (view: MorphView) => view.perspective && morphDepth(view) > MIN_DEPTH;
  return usable(previous) && usable(next) ? 'depth' : 'radius';
}

/** A view's morph frame in `mode`. */
export function morphFrame(view: MorphView, mode: MorphFrameMode): MorphFrame {
  let origin: MorphVec3;
  let scale: number;
  if (mode === 'depth') {
    const depth = Math.max(morphDepth(view), MIN_DEPTH);
    origin = [view.eye[0] - view.back[0] * depth, view.eye[1] - view.back[1] * depth, view.eye[2] - view.back[2] * depth];
    scale = depth;
  } else {
    origin = [view.center[0], view.center[1], view.center[2]];
    scale = Math.max(view.radius, MIN_DEPTH);
  }
  const axis = (v: MorphVec3): MorphVec3 => [v[0] * scale, v[1] * scale, v[2] * scale];
  return { origin, axisX: axis(view.right), axisY: axis(view.up), axisZ: axis(view.back), scale };
}

/** A molecule's positions in a view's frame (flat xyz). */
export function toMorphFrame(positions: ArrayLike<number>, count: number, view: MorphView, frame: MorphFrame): Float64Array {
  const out = new Float64Array(count * 3);
  const [ox, oy, oz] = frame.origin;
  const k = 1 / frame.scale;
  const { right: r, up: u, back: b } = view;
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3] - ox;
    const y = positions[i * 3 + 1] - oy;
    const z = positions[i * 3 + 2] - oz;
    out[i * 3] = (x * r[0] + y * r[1] + z * r[2]) * k;
    out[i * 3 + 1] = (x * u[0] + y * u[1] + z * u[2]) * k;
    out[i * 3 + 2] = (x * b[0] + y * b[1] + z * b[2]) * k;
  }
  return out;
}

// ─── A uniform grid over a subset of points ───────────────────────────

interface Grid {
  points: Float64Array;
  cell: number;
  min: MorphVec3;
  dims: [number, number, number];
  /** CSR: items of cell c are items[start[c] .. start[c + 1]). */
  start: Int32Array;
  items: Int32Array;
}

function buildGrid(points: Float64Array, ids: ArrayLike<number>): Grid {
  const n = ids.length;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let k = 0; k < n; k += 1) {
    const o = ids[k] * 3;
    const x = points[o], y = points[o + 1], z = points[o + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const ex = Math.max(maxX - minX, 1e-9), ey = Math.max(maxY - minY, 1e-9), ez = Math.max(maxZ - minZ, 1e-9);
  // About two points per cell, and never more cells than 8n.
  let cell = Math.max(Math.cbrt((ex * ey * ez * 2) / Math.max(1, n)), Math.max(ex, ey, ez) / 256, 1e-9);
  const dimsFor = (c: number): [number, number, number] => [
    Math.max(1, Math.ceil(ex / c)),
    Math.max(1, Math.ceil(ey / c)),
    Math.max(1, Math.ceil(ez / c)),
  ];
  let dims = dimsFor(cell);
  while (dims[0] * dims[1] * dims[2] > 8 * n + 8) {
    cell *= 1.5;
    dims = dimsFor(cell);
  }
  const cells = dims[0] * dims[1] * dims[2];
  const start = new Int32Array(cells + 1);
  const cellOf = new Int32Array(n);
  for (let k = 0; k < n; k += 1) {
    const o = ids[k] * 3;
    const cx = Math.min(dims[0] - 1, Math.floor((points[o] - minX) / cell));
    const cy = Math.min(dims[1] - 1, Math.floor((points[o + 1] - minY) / cell));
    const cz = Math.min(dims[2] - 1, Math.floor((points[o + 2] - minZ) / cell));
    const c = (cz * dims[1] + cy) * dims[0] + cx;
    cellOf[k] = c;
    start[c + 1] += 1;
  }
  for (let c = 0; c < cells; c += 1) start[c + 1] += start[c];
  const fill = start.slice(0, cells);
  const items = new Int32Array(n);
  for (let k = 0; k < n; k += 1) items[fill[cellOf[k]]++] = ids[k];
  return { points, cell, min: [minX, minY, minZ], dims, start, items };
}

/**
 * The (up to) `k` nearest grid points to (x, y, z) that `accept` lets
 * through, nearest first, into `outIds` / `outD2`; returns how many.
 */
function nearest(
  grid: Grid,
  x: number,
  y: number,
  z: number,
  k: number,
  accept: ((id: number) => boolean) | null,
  outIds: Int32Array,
  outD2: Float64Array,
): number {
  const { cell, min, dims, start, items, points } = grid;
  const cx = Math.floor((x - min[0]) / cell);
  const cy = Math.floor((y - min[1]) / cell);
  const cz = Math.floor((z - min[2]) / cell);
  // Rings closer than the grid hold no cells; rings past the farthest cell hold nothing new.
  const outside = (c: number, d: number) => (c < 0 ? -c : c > d - 1 ? c - (d - 1) : 0);
  const reach = (c: number, d: number) => Math.max(c, d - 1 - c);
  const r0 = Math.max(outside(cx, dims[0]), outside(cy, dims[1]), outside(cz, dims[2]));
  const r1 = Math.max(reach(cx, dims[0]), reach(cy, dims[1]), reach(cz, dims[2]));
  let found = 0;
  const consider = (c: number) => {
    for (let s = start[c], e = start[c + 1]; s < e; s += 1) {
      const id = items[s];
      if (accept && !accept(id)) continue;
      const o = id * 3;
      const dx = points[o] - x, dy = points[o + 1] - y, dz = points[o + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (found === k && (d2 > outD2[k - 1] || (d2 === outD2[k - 1] && id > outIds[k - 1]))) continue;
      // Insert in order (by distance, then id).
      let at = found < k ? found : k - 1;
      while (at > 0 && (outD2[at - 1] > d2 || (outD2[at - 1] === d2 && outIds[at - 1] > id))) {
        outD2[at] = outD2[at - 1];
        outIds[at] = outIds[at - 1];
        at -= 1;
      }
      outD2[at] = d2;
      outIds[at] = id;
      if (found < k) found += 1;
    }
  };
  for (let r = r0; r <= r1; r += 1) {
    for (let dz = -r; dz <= r; dz += 1) {
      const z1 = cz + dz;
      if (z1 < 0 || z1 >= dims[2]) continue;
      for (let dy = -r; dy <= r; dy += 1) {
        const y1 = cy + dy;
        if (y1 < 0 || y1 >= dims[1]) continue;
        const shell = Math.abs(dz) === r || Math.abs(dy) === r;
        for (let dx = -r; dx <= r; dx += shell ? 1 : 2 * r || 1) {
          const x1 = cx + dx;
          if (x1 < 0 || x1 >= dims[0]) continue;
          consider((z1 * dims[1] + y1) * dims[0] + x1);
        }
      }
    }
    // Every point of a farther ring is at least r cells away.
    if (found === k && outD2[k - 1] <= (r * cell) ** 2) break;
  }
  return found;
}

// ─── Matching ──────────────────────────────────────────────────────────

function d2Between(a: Float64Array, i: number, b: Float64Array, j: number): number {
  const dx = a[i * 3] - b[j * 3];
  const dy = a[i * 3 + 1] - b[j * 3 + 1];
  const dz = a[i * 3 + 2] - b[j * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/** Below this many candidate pairs a round tries every pair. */
const BRUTE_PAIRS = 16_384;

/**
 * Assign each new atom in `nextIds` an unused old atom from `prevIds`,
 * nearest pairs first, in rounds until one side runs out.
 */
function assignNearest(
  prev: Float64Array,
  next: Float64Array,
  nextIds: number[],
  prevIds: number[],
  from: Int32Array,
  used: Uint8Array,
): void {
  let nIds = nextIds;
  let pIds = prevIds;
  let k: number = MORPH_TUNING.candidates;
  while (nIds.length > 0 && pIds.length > 0) {
    const pairN: number[] = [];
    const pairP: number[] = [];
    const pairD: number[] = [];
    if (nIds.length * pIds.length <= BRUTE_PAIRS) {
      for (const n of nIds) {
        for (const p of pIds) {
          pairN.push(n);
          pairP.push(p);
          pairD.push(d2Between(next, n, prev, p));
        }
      }
    } else {
      const grid = buildGrid(prev, pIds);
      const kk = Math.min(k, pIds.length);
      const ids = new Int32Array(kk);
      const d2 = new Float64Array(kk);
      for (const n of nIds) {
        const found = nearest(grid, next[n * 3], next[n * 3 + 1], next[n * 3 + 2], kk, null, ids, d2);
        for (let c = 0; c < found; c += 1) {
          pairN.push(n);
          pairP.push(ids[c]);
          pairD.push(d2[c]);
        }
      }
    }
    const order = Array.from(pairD.keys());
    order.sort((a, b) => pairD[a] - pairD[b] || pairN[a] - pairN[b] || pairP[a] - pairP[b]);
    for (const c of order) {
      const n = pairN[c];
      const p = pairP[c];
      if (from[n] >= 0 || used[p]) continue;
      from[n] = p;
      used[p] = 1;
    }
    nIds = nIds.filter((n) => from[n] < 0);
    pIds = pIds.filter((p) => !used[p]);
    k = Math.min(k * 2, 64);
  }
}

const same = (a: number, b: number) => (a > 0 && a === b ? 1 : 0);

/**
 * Swaps that shorten the summed squared travel without losing a
 * same-element pair: two new atoms trading partners, or one taking an
 * unused old atom. Stops when a pass finds none.
 */
function improve(
  prev: Float64Array,
  next: Float64Array,
  prevElements: ArrayLike<number>,
  nextElements: ArrayLike<number>,
  from: Int32Array,
  used: Uint8Array,
): void {
  const matched: number[] = [];
  for (let n = 0; n < from.length; n += 1) if (from[n] >= 0) matched.push(n);
  const unused: number[] = [];
  for (let p = 0; p < used.length; p += 1) if (!used[p]) unused.push(p);
  const cost = (n: number, p: number) => d2Between(next, n, prev, p);
  const eps = 1e-12;
  for (let pass = 0; pass < MORPH_TUNING.improvePasses; pass += 1) {
    let improved = false;
    for (let a = 0; a < matched.length; a += 1) {
      const i = matched[a];
      for (let b = a + 1; b < matched.length; b += 1) {
        const j = matched[b];
        const pi = from[i];
        const pj = from[j];
        const sameNow = same(nextElements[i], prevElements[pi]) + same(nextElements[j], prevElements[pj]);
        const sameSwapped = same(nextElements[i], prevElements[pj]) + same(nextElements[j], prevElements[pi]);
        if (sameSwapped < sameNow) continue;
        if (cost(i, pj) + cost(j, pi) < cost(i, pi) + cost(j, pj) - eps) {
          from[i] = pj;
          from[j] = pi;
          improved = true;
        }
      }
      for (let u = 0; u < unused.length; u += 1) {
        const p = unused[u];
        const pi = from[i];
        if (same(nextElements[i], prevElements[p]) < same(nextElements[i], prevElements[pi])) continue;
        if (cost(i, p) < cost(i, pi) - eps) {
          from[i] = p;
          used[p] = 1;
          used[pi] = 0;
          unused[u] = pi;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
}

/**
 * Match the new molecule's atoms to the previous molecule's, both given in
 * one shared frame (flat xyz): same element first, then any element, each
 * old atom once; new atoms past the supply bud from their nearest matched
 * neighbour.
 */
export function matchMorph(
  previous: { points: Float64Array; elements: ArrayLike<number>; count: number },
  next: { points: Float64Array; elements: ArrayLike<number>; count: number },
): MorphMatch {
  const from = new Int32Array(next.count).fill(-1);
  const budFrom = new Int32Array(next.count).fill(-1);
  const used = new Uint8Array(previous.count);

  // Same element first, element by element (ascending, for determinism).
  const byElement = (elements: ArrayLike<number>, count: number) => {
    const groups = new Map<number, number[]>();
    for (let i = 0; i < count; i += 1) {
      const e = elements[i];
      if (!(e > 0)) continue;
      let list = groups.get(e);
      if (!list) groups.set(e, (list = []));
      list.push(i);
    }
    return groups;
  };
  const prevGroups = byElement(previous.elements, previous.count);
  const nextGroups = byElement(next.elements, next.count);
  for (const element of [...nextGroups.keys()].sort((a, b) => a - b)) {
    const pIds = prevGroups.get(element);
    if (pIds) assignNearest(previous.points, next.points, nextGroups.get(element)!, pIds, from, used);
  }

  // Then any element, from the old atoms left.
  const nRest: number[] = [];
  for (let n = 0; n < next.count; n += 1) if (from[n] < 0) nRest.push(n);
  const pRest: number[] = [];
  for (let p = 0; p < previous.count; p += 1) if (!used[p]) pRest.push(p);
  assignNearest(previous.points, next.points, nRest, pRest, from, used);

  if (next.count <= MORPH_TUNING.improveMaxAtoms) {
    improve(previous.points, next.points, previous.elements, next.elements, from, used);
  }

  let sameElement = 0;
  let crossElement = 0;
  const matchedIds: number[] = [];
  for (let n = 0; n < next.count; n += 1) {
    if (from[n] < 0) continue;
    matchedIds.push(n);
    if (same(next.elements[n], previous.elements[from[n]])) sameElement += 1;
    else crossElement += 1;
  }

  // Past the supply: bud out of the nearest matched new atom.
  let budded = 0;
  if (matchedIds.length > 0 && matchedIds.length < next.count) {
    const grid = buildGrid(next.points, matchedIds);
    const ids = new Int32Array(1);
    const d2 = new Float64Array(1);
    for (let n = 0; n < next.count; n += 1) {
      if (from[n] >= 0) continue;
      if (nearest(grid, next.points[n * 3], next.points[n * 3 + 1], next.points[n * 3 + 2], 1, null, ids, d2) === 0) continue;
      budFrom[n] = ids[0];
      from[n] = from[ids[0]];
      budded += 1;
    }
  }

  return { from, budFrom, sameElement, crossElement, budded, vanished: previous.count - sameElement - crossElement };
}

/**
 * The whole plan: both molecules into their views' frames, matched, and each
 * new atom's start (its partner's frame point) and delay. Null when either
 * molecule is empty.
 */
export function planMorph(
  previous: MorphMolecule & { view: MorphView },
  next: MorphMolecule & { view: MorphView },
): MorphPlan | null {
  if (!(previous.count > 0) || !(next.count > 0)) return null;
  const mode = morphFrameMode(previous.view, next.view);
  const prevFrame = morphFrame(previous.view, mode);
  const nextFrame = morphFrame(next.view, mode);
  const prevPoints = toMorphFrame(previous.positions, previous.count, previous.view, prevFrame);
  const nextPoints = toMorphFrame(next.positions, next.count, next.view, nextFrame);
  const match = matchMorph(
    { points: prevPoints, elements: previous.elements, count: previous.count },
    { points: nextPoints, elements: next.elements, count: next.count },
  );

  // The centre leaves first: the delay grows with the distance from the anchor.
  let rim = 0;
  for (let n = 0; n < next.count; n += 1) {
    rim = Math.max(rim, Math.hypot(nextPoints[n * 3], nextPoints[n * 3 + 1], nextPoints[n * 3 + 2]));
  }
  const texels = new Float32Array(next.count * STRIDE);
  for (let n = 0; n < next.count; n += 1) {
    const p = match.from[n];
    const o = n * STRIDE;
    if (p >= 0) {
      texels[o] = prevPoints[p * 3];
      texels[o + 1] = prevPoints[p * 3 + 1];
      texels[o + 2] = prevPoints[p * 3 + 2];
    } else {
      // Unreachable while the old molecule has atoms; start at home then.
      texels[o] = nextPoints[n * 3];
      texels[o + 1] = nextPoints[n * 3 + 1];
      texels[o + 2] = nextPoints[n * 3 + 2];
    }
    const r = Math.hypot(nextPoints[n * 3], nextPoints[n * 3 + 1], nextPoints[n * 3 + 2]);
    texels[o + 3] = rim > 0 ? MORPH_TUNING.maxDelayS * Math.min(1, r / rim) : 0;
  }

  return {
    texels,
    mode,
    frame: nextFrame,
    report: {
      atoms: next.count,
      previousAtoms: previous.count,
      sameElement: match.sameElement,
      crossElement: match.crossElement,
      budded: match.budded,
      vanished: match.vanished,
      frame: mode,
    },
  };
}

/** What a switch must have for the morph (the scene and page gates come from `canPlayScatter`). */
export interface MorphGateInput {
  /** The scene and page allow display motion and the comfort is not Still (`canPlayScatter`). */
  sceneAllows: boolean;
  /** `?arrival=0`: no arrival of any kind. */
  arrivalOff: boolean;
  /** Machine traffic: an MCP command ran just now, or the page carries `mcpCommand`, `command` or `batchExport`. */
  machine: boolean;
  /** The home hero's or a molecule page's drawing hands over (the relay): it inflates flat instead. */
  drawingHandOff: boolean;
  /** A saved view opens as saved. */
  savedView: boolean;
  /** What the screen showed before this molecule, or null (the first open). */
  previous: { natoms: number; resident: boolean; sameFile: boolean } | null;
  natoms: number;
}

/** True when this switch morphs: another molecule was on screen, whole and small enough, and nothing rules it out. */
export function shouldMorph(input: MorphGateInput): boolean {
  const previous = input.previous;
  if (!previous || previous.sameFile || !previous.resident) return false;
  if (!(previous.natoms > 0) || previous.natoms > MORPH_TUNING.maxAtoms) return false;
  if (!(input.natoms > 0) || input.natoms > MORPH_TUNING.maxAtoms) return false;
  if (!input.sceneAllows || input.arrivalOff || input.machine || input.drawingHandOff || input.savedView) return false;
  return true;
}
