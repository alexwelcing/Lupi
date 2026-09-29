/**
 * symmetryDetents.ts — the views a coast clicks into, from Object Facts.
 *
 * A DetentProvider for the camera rig: the molecule's ring faces (labelled
 * with a verified n-fold axis when one runs through them, "Pentagon face-on ·
 * 5-fold axis"), planar face and edge views, and principal axes as the
 * fallback. Each detent is a view direction, normalize(camera − target).
 *
 * - `capture` (a coast slowing below the rig's capture speed): the detent
 *   within `captureRadiusDeg` of the view, in the forward half-space of the
 *   view's motion (a coast never clicks backwards while it is still moving),
 *   closest to where the coast is heading: the view advanced along its motion
 *   by `LOOKAHEAD_S` of travel. With no motion (the coast's last frame) it is
 *   simply the nearest within the radius, so C60, whose 32 faces cover every
 *   direction within 24°, always lands face-on. Off while a measurement tool
 *   is active (a click there must not move the atoms under the cursor).
 * - `step` (the arrow keys): the neighbouring detent whose on-screen offset
 *   best matches the arrow, preferring the nearest and the straightest.
 *
 * Pure math: no three.js, no DOM, no store (the measurement check is
 * injected).
 */
import type { ObjectFactsV1 } from '@atlas/core/objectFacts';
import type { Detent, DetentProvider, Vec3 } from './rigApi';

export const SYMMETRY_DETENTS = {
  /** How far ahead (s of travel at the current speed) capture looks for the detent to land on. */
  lookaheadS: 0.2,
  /** A step ignores detents closer than this to the current view (deg): that is where it already is. */
  minStepDeg: 4,
  /** A step only goes to detents within this angle of the arrow's direction on screen (deg). */
  maxStepOffDeg: 75,
  /** Cost weight for an off-direction step: angle · (1 + k·(1 − cos φ)). */
  stepBendCost: 2,
} as const;

const DEG = Math.PI / 180;

export interface SymmetryDetentsOptions {
  /** True while capture must not happen (a measurement tool is active). */
  captureDisabled?: () => boolean;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(v: ArrayLike<number>): Vec3 | null {
  const m = Math.hypot(v[0], v[1], v[2]);
  if (!(m > 1e-12) || !Number.isFinite(m)) return null;
  return [v[0] / m, v[1] / m, v[2] / m];
}

export class SymmetryDetents implements DetentProvider {
  readonly captureRadiusDeg: number;
  readonly detents: ReadonlyArray<Detent>;
  private readonly captureCos: number;
  private readonly captureDisabled: () => boolean;

  constructor(facts: Pick<ObjectFactsV1, 'detents' | 'captureRadiusDeg'>, options: SymmetryDetentsOptions = {}) {
    const radius = Number.isFinite(facts.captureRadiusDeg) && facts.captureRadiusDeg > 0 ? facts.captureRadiusDeg : 12;
    this.captureRadiusDeg = radius;
    this.captureCos = Math.cos(radius * DEG);
    const detents: Detent[] = [];
    for (const d of facts.detents) {
      const dir = unit(d.dir);
      if (!dir) continue;
      detents.push({ dir, label: d.label, kind: d.kind, ...(d.order != null ? { order: d.order } : {}) });
    }
    this.detents = detents;
    this.captureDisabled = options.captureDisabled ?? (() => false);
  }

  capture(viewDir: Vec3, viewDirVelocity: Vec3 | null): Detent | null {
    if (this.detents.length === 0) return null;
    let disabled = false;
    try {
      disabled = this.captureDisabled();
    } catch {
      disabled = false;
    }
    if (disabled) return null;
    const view = unit(viewDir);
    if (!view) return null;
    // The motion in the tangent plane (a velocity has no radial part, but be safe).
    let motion: Vec3 | null = null;
    let speed = 0;
    if (viewDirVelocity) {
      const radial = dot(viewDirVelocity, view);
      const tangent: Vec3 = [
        viewDirVelocity[0] - radial * view[0],
        viewDirVelocity[1] - radial * view[1],
        viewDirVelocity[2] - radial * view[2],
      ];
      speed = Math.hypot(tangent[0], tangent[1], tangent[2]);
      motion = speed > 1e-6 ? [tangent[0] / speed, tangent[1] / speed, tangent[2] / speed] : null;
    }
    // Where the coast is heading: the view advanced along its motion.
    let aim = view;
    if (motion) {
      const ahead = Math.min(speed * SYMMETRY_DETENTS.lookaheadS, (this.captureRadiusDeg * DEG) / 2);
      const c = Math.cos(ahead);
      const s = Math.sin(ahead);
      aim = [view[0] * c + motion[0] * s, view[1] * c + motion[1] * s, view[2] * c + motion[2] * s];
    }
    let best: Detent | null = null;
    let bestCos = -2;
    for (const detent of this.detents) {
      if (dot(detent.dir, view) < this.captureCos) continue;
      if (motion && dot(detent.dir, motion) < -1e-9) continue;
      const c = dot(detent.dir, aim);
      if (c > bestCos) {
        bestCos = c;
        best = detent;
      }
    }
    return best;
  }

  step(viewDir: Vec3, screenRight: Vec3, screenUp: Vec3, dx: number, dy: number): Detent | null {
    const view = unit(viewDir);
    const wantLength = Math.hypot(dx, dy);
    if (!view || !(wantLength > 0)) return null;
    const wx = dx / wantLength;
    const wy = dy / wantLength;
    const minCos = Math.cos(SYMMETRY_DETENTS.minStepDeg * DEG);
    const offCos = Math.cos(SYMMETRY_DETENTS.maxStepOffDeg * DEG);
    let best: Detent | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const detent of this.detents) {
      const along = dot(detent.dir, view);
      if (along > minCos) continue;
      // Its direction on screen: the tangent of the great circle from the view to it.
      const tx = detent.dir[0] - along * view[0];
      const ty = detent.dir[1] - along * view[1];
      const tz = detent.dir[2] - along * view[2];
      const sx = tx * screenRight[0] + ty * screenRight[1] + tz * screenRight[2];
      const sy = tx * screenUp[0] + ty * screenUp[1] + tz * screenUp[2];
      const sLength = Math.hypot(sx, sy);
      if (!(sLength > 1e-9)) continue;
      const cosOff = (sx * wx + sy * wy) / sLength;
      if (cosOff < offCos) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, along)));
      const cost = angle * (1 + SYMMETRY_DETENTS.stepBendCost * (1 - cosOff));
      if (cost < bestCost) {
        bestCost = cost;
        best = detent;
      }
    }
    return best;
  }

  /** The detent nearest the view and its angle (deg), or null without detents. */
  nearest(viewDir: Vec3): { detent: Detent; angleDeg: number } | null {
    const view = unit(viewDir);
    if (!view) return null;
    let best: Detent | null = null;
    let bestCos = -2;
    for (const detent of this.detents) {
      const c = dot(detent.dir, view);
      if (c > bestCos) {
        bestCos = c;
        best = detent;
      }
    }
    return best ? { detent: best, angleDeg: Math.acos(Math.max(-1, Math.min(1, bestCos))) / DEG } : null;
  }
}
