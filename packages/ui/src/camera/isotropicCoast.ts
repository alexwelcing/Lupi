/**
 * isotropicCoast.ts — the default coast: the molecule keeps turning about
 * the release axis and slows to a stop.
 *
 * Deceleration is viscous (time constant `tau`, the spec's 1.2 s) plus a
 * constant friction `friction` (rad/s²). Pure exponential decay never ends:
 * from a real flick (3–10 rad/s) it creeps for 4–6 s, and every tap in that
 * creep is a catch instead of a pick. The friction term brings any flick to
 * rest in finite time (≈1.2 s from 3 rad/s, ≈2.3 s from 10 rad/s) and makes
 * the last few degrees read as a marble rolling to a halt:
 *
 *   dω/dt = −ω/τ − c  →  ω(t) = (ω₀ + cτ)·e^{−t/τ} − cτ,  stopping at t* = τ·ln(1 + ω₀/(cτ))
 *
 * Integrated exactly per step, so the result does not depend on the step.
 */
import type { CoastModel, Vec3 } from './rigApi';

export const ISOTROPIC_COAST = {
  /** Viscous time constant (s). */
  tau: 1.2,
  /** Constant friction (rad/s²). */
  friction: 1.5,
} as const;

export function createIsotropicCoast({
  tau = ISOTROPIC_COAST.tau,
  friction = ISOTROPIC_COAST.friction,
}: { tau?: number; friction?: number } = {}): CoastModel {
  let ax = 0;
  let ay = 0;
  let az = 1;
  let speed = 0;
  const ct = Math.max(0, friction) * tau;

  return {
    begin(omegaWorld: Vec3) {
      const m = Math.hypot(omegaWorld[0], omegaWorld[1], omegaWorld[2]);
      if (!(m > 1e-9) || !Number.isFinite(m)) {
        speed = 0;
        return;
      }
      ax = omegaWorld[0] / m;
      ay = omegaWorld[1] / m;
      az = omegaWorld[2] / m;
      speed = m;
    },
    step(dt: number, out: [number, number, number, number]): number {
      if (!(speed > 0) || !(dt > 0)) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 1;
        return 0;
      }
      let angle: number;
      let next: number;
      const e = Math.exp(-dt / tau);
      next = (speed + ct) * e - ct;
      if (next > 0) {
        angle = tau * (speed + ct) * (1 - e) - ct * dt;
      } else {
        // It stops inside this step.
        const stop = ct > 0 ? tau * Math.log(1 + speed / ct) : dt;
        angle = tau * (speed + ct) * (1 - Math.exp(-stop / tau)) - ct * stop;
        next = 0;
      }
      speed = next;
      const half = Math.max(0, angle) / 2;
      const s = Math.sin(half);
      out[0] = ax * s;
      out[1] = ay * s;
      out[2] = az * s;
      out[3] = Math.cos(half);
      return speed;
    },
    stop() {
      speed = 0;
    },
  };
}
