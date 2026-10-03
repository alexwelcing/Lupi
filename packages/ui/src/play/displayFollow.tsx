/**
 * displayFollow — overlays ride display motion with their atoms.
 *
 * The arrival, the poke ripple, Scatter, Tug, Burst and Heat move atoms and
 * bonds on the GPU (`@atlas/scene` tsl/displayMotion.ts), never in
 * `frame.positions`. Labels, selection rings, the atom card's anchor,
 * measurements and trails are placed on the CPU from rest positions, so on
 * their own they would stay behind while the atoms fly. Here they follow:
 *
 * - An overlay registers a follower: the rest points it hangs on (a few
 *   atoms' frame positions) and how to apply an offset to itself.
 * - One job (`DisplayFollowDriver`, LUPI_PHASE.overlays, right after the
 *   uniforms job of this frame) evaluates the CPU twin of the GPU offset
 *   (tsl/displayMotionTwin.ts) for those points only, while the master
 *   weight is above 0. A handful of atoms, once per drawn frame: cheap.
 * - When the motion ends (weight exactly 0), every displaced follower gets
 *   `apply(null)` once and snaps back exactly to rest, and the loop is asked
 *   for a couple more frames so DOM-anchored cards (drei Html reads its
 *   anchor a phase earlier) settle too.
 * - Captures never see it: a capture guard puts every follower back at rest
 *   inside each capture render and restores the live offset afterwards, the
 *   way displayMotion zeroes the GPU weight. A recording suspends display
 *   motion, which brings the twin to zero. Exports, MCP artifacts,
 *   thumbnails and video therefore keep rest truth.
 *
 * 'steady' followers (text and cards) take only a fifth of Heat's jiggle, so
 * a label stays readable on a warm atom; rings, lines and trails follow
 * every term exactly.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import type * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import {
  LUPI_JOB,
  LUPI_PHASE,
  displayOffsetTwin,
  isLupiDisplayMotionActive,
  readTwinState,
  registerCaptureGuard,
  requestLupiFrames,
  type TwinTermScales,
  type TwinVec3,
} from '@atlas/scene';
import { registerPlayDevHook } from './devHooks';

/** How an overlay follows: every term ('exact') or with Heat's jiggle damped ('steady'). */
export type DisplayFollowMode = 'exact' | 'steady';

export interface DisplayFollower {
  /**
   * The rest points (Å, flat xyz) the overlay hangs on, read on every moving
   * frame: an atom's own frame position, so the twin hashes the same seed
   * the GPU does. Null or empty: nothing to follow right now.
   */
  points(): ArrayLike<number> | null;
  /**
   * Place the overlay: `offsets` holds one display offset per point (flat
   * xyz, Å, in the molecule group's space), or null at rest (put it back
   * exactly where it was).
   */
  apply(offsets: Float64Array | null): void;
  mode?: DisplayFollowMode;
}

/** Steady overlays (text, cards) keep a fifth of Heat's jiggle. */
export const STEADY_HEAT = 0.2;
const STEADY_TERMS: TwinTermScales = { heat: STEADY_HEAT };

interface Entry {
  source: { current: DisplayFollower };
  /** Last offsets applied (flat xyz). */
  buffer: Float64Array;
  /** Points in the last application. */
  count: number;
  /** An offset is applied (anything but exact rest). */
  displaced: boolean;
}

const entries = new Set<Entry>();
const scratchRest: TwinVec3 = [0, 0, 0];
let moving = false;
let lastMaxOffset = 0;

function view(entry: Entry): Float64Array {
  return entry.buffer.subarray(0, entry.count * 3);
}

function settle(entry: Entry): boolean {
  if (!entry.displaced) return false;
  entry.displaced = false;
  entry.count = 0;
  try {
    entry.source.current.apply(null);
  } catch (error) {
    console.error('[lupi] display follower threw', error);
  }
  return true;
}

/** Put every displaced overlay back at rest; asks for frames if any moved. */
function settleAll(): void {
  let any = false;
  for (const entry of entries) any = settle(entry) || any;
  lastMaxOffset = 0;
  if (any) requestLupiFrames();
}

function place(entry: Entry, state: ReturnType<typeof readTwinState>): number {
  const follower = entry.source.current;
  const points = follower.points();
  const count = points ? Math.floor(points.length / 3) : 0;
  if (count === 0) {
    settle(entry);
    return 0;
  }
  if (entry.buffer.length < count * 3) entry.buffer = new Float64Array(count * 3);
  const terms = follower.mode === 'steady' ? STEADY_TERMS : undefined;
  const out = entry.buffer;
  let max = 0;
  for (let i = 0; i < count; i += 1) {
    scratchRest[0] = points![i * 3];
    scratchRest[1] = points![i * 3 + 1];
    scratchRest[2] = points![i * 3 + 2];
    const offset = displayOffsetTwin(state, scratchRest, scratchRest, terms);
    out[i * 3] = offset[0];
    out[i * 3 + 1] = offset[1];
    out[i * 3 + 2] = offset[2];
    const length = Math.hypot(offset[0], offset[1], offset[2]);
    if (length > max) max = length;
  }
  entry.count = count;
  entry.displaced = true;
  try {
    follower.apply(view(entry));
  } catch (error) {
    console.error('[lupi] display follower threw', error);
  }
  return max;
}

/**
 * One step of the follow driver: place every follower from this frame's
 * uniforms while display motion runs; snap them back once it stops (or when
 * `enabled` is false: the glass renderer draws atoms without the offset).
 */
export function stepDisplayFollow(enabled = true): void {
  if (!enabled || !isLupiDisplayMotionActive()) {
    if (moving) settleAll();
    moving = false;
    return;
  }
  moving = true;
  if (entries.size === 0) return;
  const state = readTwinState();
  let max = 0;
  for (const entry of entries) max = Math.max(max, place(entry, state));
  lastMaxOffset = max;
}

/** Register a follower (held by reference, so it can be updated in place); returns the unregister. */
export function registerDisplayFollower(source: { current: DisplayFollower }): () => void {
  const entry: Entry = { source, buffer: new Float64Array(3), count: 0, displaced: false };
  entries.add(entry);
  // Joining mid-motion: placed on the next drawn frame.
  if (moving) requestLupiFrames();
  return () => {
    entries.delete(entry);
    settle(entry);
  };
}

/** Follow display motion from a component: `follower` may change on every render. */
export function useDisplayFollower(follower: DisplayFollower): void {
  const source = useRef(follower);
  source.current = follower;
  useEffect(() => registerDisplayFollower(source), []);
}

// Every raster capture (exports, MCP rasters, thumbnails) sees the overlays at
// rest, and gets the live placement back afterwards.
registerCaptureGuard({
  begin: () => {
    const displaced: Array<{ entry: Entry; offsets: Float64Array }> = [];
    for (const entry of entries) {
      if (!entry.displaced) continue;
      displaced.push({ entry, offsets: view(entry).slice() });
      try {
        entry.source.current.apply(null);
      } catch (error) {
        console.error('[lupi] display follower threw', error);
      }
    }
    return () => {
      for (const { entry, offsets } of displaced) {
        if (!entries.has(entry) || !entry.displaced) continue;
        try {
          entry.source.current.apply(offsets);
        } catch (error) {
          console.error('[lupi] display follower threw', error);
        }
      }
    };
  },
});

export interface DisplayFollowDriverProps {
  /** False keeps every overlay at rest (the refractive-glass renderer has no display offset). */
  enabled?: boolean;
}

/**
 * The follow job, inside the viewer Canvas (one per canvas, next to the
 * PlayLayer). Runs after this frame's display-motion uniforms.
 */
export function DisplayFollowDriver({ enabled = true }: DisplayFollowDriverProps): null {
  const live = useRef(enabled);
  live.current = enabled;
  useFrame(() => stepDisplayFollow(live.current), { phase: LUPI_PHASE.overlays, id: LUPI_JOB.displayFollow });
  useEffect(() => {
    const offHook = registerPlayDevHook('follow', () => {
      let displaced = 0;
      let points = 0;
      for (const entry of entries) {
        if (!entry.displaced) continue;
        displaced += 1;
        points += entry.count;
      }
      return { moving, followers: entries.size, displaced, points, maxOffset: lastMaxOffset };
    });
    return () => {
      offHook();
      settleAll();
      moving = false;
    };
  }, []);
  return null;
}

/** An atom's rest position (its frame coordinates) into `out`; false for an index outside the frame. */
export function atomRestPoint(frame: Frame, atom: number, out: Float64Array, at = 0): boolean {
  if (!(atom >= 0 && atom < frame.natoms)) return false;
  out[at] = frame.positions[atom * 3];
  out[at + 1] = frame.positions[atom * 3 + 1];
  out[at + 2] = frame.positions[atom * 3 + 2];
  return true;
}

export interface FollowAtomProps {
  frame: Frame;
  atom: number;
  /** Text and cards: Heat's jiggle damped (STEADY_HEAT). */
  steady?: boolean;
  children?: ReactNode;
}

/**
 * A group that rides one atom's display offset. Its children keep their rest
 * coordinates (the group adds only the offset), so wrapping an overlay is all
 * it takes. At rest the group sits at exactly (0, 0, 0).
 */
export function FollowAtom({ frame, atom, steady = false, children }: FollowAtomProps) {
  const group = useRef<THREE.Group>(null);
  const point = useMemo(() => new Float64Array(3), []);
  useDisplayFollower({
    mode: steady ? 'steady' : 'exact',
    points: () => (atomRestPoint(frame, atom, point) ? point : null),
    apply: (offsets) => {
      const node = group.current;
      if (!node) return;
      if (offsets) node.position.set(offsets[0], offsets[1], offsets[2]);
      else node.position.set(0, 0, 0);
    },
  });
  return <group ref={group}>{children}</group>;
}
