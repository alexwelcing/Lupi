/**
 * trueSpinCoast.ts — a flick that coasts on the molecule's real inertia.
 *
 * The camera rig's coast model for one file (from its Object Facts). The
 * molecule tumbles as a free rigid body: the body-frame angular velocity ω
 * follows the torque-free Euler equations (RK4), so C60 glides like a marble,
 * a plate-like molecule settles toward its face axis, and an asymmetric top
 * spun about its middle axis flips end over end by itself (the
 * tennis-racket, or Dzhanibekov, effect).
 *
 * Frames (see rigApi `CoastModel`): at `begin` the molecule sits in its rest
 * principal frame P (Object Facts `principalQuat`, body → world), so the
 * release ω maps into the body with P⁻¹ and no camera state is needed. Each
 * step integrates body increments δq and returns dq = P·δq·P⁻¹; the rig turns
 * the camera by conj(dq), so what the viewer sees is a free body tumbling in
 * front of a fixed camera (its angular momentum is conserved in the camera's
 * frame).
 *
 * Dynamics use I = max(I_i, 0.02·I_max) (a linear molecule has I_a ≈ 0), and
 * a spherical top uses its mean moment exactly (its axes are arbitrary; tiny
 * moment noise must not precess C60).
 *
 * Dissipation, the major-axis rule (physically motivated: a real body losing
 * energy at fixed angular momentum ends up turning about its largest-moment
 * axis): ω components off the largest-moment axis decay with τ = 0.35 s, the
 * on-axis component with τ = 1.2 s. A spherical top decays uniformly with
 * τ = 1.2 s. On top of that the same constant friction as the rig's
 * isotropic coast (1.5 rad/s²) brings every flick to rest in finite time, so
 * a spherical top coasts exactly like the default coast. Degenerate major
 * axes (a prolate or linear rotor's b = c) are both "on-axis".
 *
 * Spin (`armSpin`, the tray's Spin): 3 rad/s about the middle axis b plus a
 * seeded 5 % on a, with no decay for 4 s and then a uniform τ = 1.5 s. On a
 * spherical or linear rotor it spins about the principal axis most
 * perpendicular to the view (never a linear molecule's own axis).
 *
 * A flip is a sign change of the body-frame angular momentum's b component,
 * counted between two moments when L lies within ~37° of ±b (|L_b| ≥ 0.8·|L|):
 * the plain sign change also fires on every wobble of a coast that precesses
 * about a or c, which is not a flip anyone sees. Only an asymmetric top has a
 * middle axis to flip about (a symmetric top's b is any axis of a degenerate
 * pair, so its L_b sign means nothing).
 *
 * Pure math: no three.js, no DOM, no store.
 */
import type { ObjectFactsV1 } from '@atlas/core/objectFacts';
import type { CoastModel, Vec3 } from './rigApi';

export const TRUE_SPIN = {
  /** Integration substep (s): step(dt) splits dt into steps no longer than this. */
  substep: 1 / 240,
  /** Dynamic moments are floored at this fraction of the largest. */
  inertiaFloor: 0.02,
  /** Major-axis rule time constants (s). */
  offAxisTau: 0.35,
  onAxisTau: 1.2,
  /** Constant friction (rad/s²), as the isotropic coast. */
  friction: 1.5,
  /** Spin: speed about b (rad/s), the seeded share on a, the undamped hold (s), then τ (s). */
  spinOmega: 3,
  spinWobble: 0.05,
  spinHoldS: 4,
  spinTau: 1.5,
  /** |L_b| / |L| that counts as "turning about ±b" for flip detection. */
  flipShare: 0.8,
} as const;

type Quat = [number, number, number, number];

export interface TrueSpinOptions {
  /** A flip happened (the coast calls it synchronously from `step`). */
  onFlip?: () => void;
  /** false: no decay at all (energy-conserving; tests). Default true. */
  dissipation?: boolean;
  /** Seed for the spin's 5 % wobble (default 1). */
  seed?: number;
}

/** Rotate `v` by the unit quaternion `q` (x, y, z, w). */
function rotate(q: Quat, v: Vec3, out: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** out = a·b (Hamilton product; `out` may alias `a`). */
function multiply(a: Quat, b: Quat, out: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** mulberry32: a tiny seeded PRNG in [0, 1). */
function random(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class TrueSpinCoast implements CoastModel {
  /** The moments the dynamics use (floored; a spherical top's mean), body a, b, c. */
  readonly inertia: Readonly<Vec3>;
  readonly rotor: ObjectFactsV1['rotor'];

  private readonly P: Quat;
  private readonly Pinv: Quat;
  private readonly axes: [Vec3, Vec3, Vec3];
  /** Euler coefficients k_i: ω̇_a = k_a ω_b ω_c, and cyclic. */
  private readonly k: Vec3;
  /** Per-component time constants for a flick (the major-axis rule). */
  private readonly tau: Vec3;
  private readonly dissipation: boolean;
  private readonly detectFlips: boolean;
  private readonly onFlip: (() => void) | undefined;

  private readonly w: Vec3 = [0, 0, 0];
  private running = false;
  private spinning = false;
  private spinArm: Vec3 | null = null;
  private seed: number;
  private t = 0;
  private flipSign = 0;
  private flipCount = 0;

  // Scratch.
  private readonly k1: Vec3 = [0, 0, 0];
  private readonly k2: Vec3 = [0, 0, 0];
  private readonly k3: Vec3 = [0, 0, 0];
  private readonly k4: Vec3 = [0, 0, 0];
  private readonly tmp: Vec3 = [0, 0, 0];
  private readonly w0: Vec3 = [0, 0, 0];
  private readonly delta: Quat = [0, 0, 0, 1];
  private readonly total: Quat = [0, 0, 0, 1];
  private readonly vec: Vec3 = [0, 0, 0];

  constructor(facts: Pick<ObjectFactsV1, 'moments' | 'principalQuat' | 'rotor' | 'axes'>, options: TrueSpinOptions = {}) {
    this.rotor = facts.rotor;
    const q = facts.principalQuat;
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    this.P = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
    this.Pinv = [-this.P[0], -this.P[1], -this.P[2], this.P[3]];
    this.axes = facts.axes;
    const raw = facts.moments.map((m) => (Number.isFinite(m) && m > 0 ? m : 0)) as Vec3;
    const max = Math.max(raw[0], raw[1], raw[2]);
    let inertia: Vec3;
    if (!(max > 0) || facts.rotor === 'atom' || facts.rotor === 'spherical') {
      const mean = max > 0 ? (raw[0] + raw[1] + raw[2]) / 3 : 1;
      inertia = [mean, mean, mean];
    } else {
      const floor = TRUE_SPIN.inertiaFloor * max;
      inertia = [Math.max(raw[0], floor), Math.max(raw[1], floor), Math.max(raw[2], floor)];
    }
    this.inertia = inertia;
    const [ia, ib, ic] = inertia;
    this.k = [(ib - ic) / ia, (ic - ia) / ib, (ia - ib) / ic];
    const on = TRUE_SPIN.onAxisTau;
    const off = TRUE_SPIN.offAxisTau;
    // Moments ascend, so c is the largest; a prolate or linear rotor's b = c.
    this.tau =
      facts.rotor === 'spherical' || facts.rotor === 'atom'
        ? [on, on, on]
        : facts.rotor === 'prolate' || facts.rotor === 'linear'
          ? [off, on, on]
          : [off, off, on];
    this.dissipation = options.dissipation !== false;
    this.detectFlips = facts.rotor === 'asymmetric';
    this.onFlip = options.onFlip;
    this.seed = Number.isFinite(options.seed) ? (options.seed as number) : 1;
  }

  // ─── CoastModel ───────────────────────────────────────────────────

  begin(omegaWorld: Vec3): void {
    rotate(this.Pinv, omegaWorld, this.w);
    this.spinning = this.spinArm !== null;
    this.spinArm = null;
    this.t = 0;
    this.running = Number.isFinite(this.w[0] + this.w[1] + this.w[2]) && this.speed() > 1e-9;
    if (!this.running) this.w.fill(0);
    this.flipSign = this.bSign();
  }

  step(dt: number, out: [number, number, number, number]): number {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    if (!this.running || !(dt > 0) || !Number.isFinite(dt)) return this.running ? this.speed() : 0;
    const n = Math.max(1, Math.ceil(dt / TRUE_SPIN.substep - 1e-9));
    const h = dt / n;
    const total = this.total;
    total[0] = 0;
    total[1] = 0;
    total[2] = 0;
    total[3] = 1;
    for (let i = 0; i < n && this.running; i += 1) {
      this.substep(h);
      multiply(total, this.delta, total);
    }
    // dq = P·δq·P⁻¹: the same rotation angle about P·(axis).
    const m = Math.hypot(total[0], total[1], total[2], total[3]) || 1;
    this.vec[0] = total[0] / m;
    this.vec[1] = total[1] / m;
    this.vec[2] = total[2] / m;
    rotate(this.P, this.vec, this.vec);
    out[0] = this.vec[0];
    out[1] = this.vec[1];
    out[2] = this.vec[2];
    out[3] = total[3] / m;
    return this.running ? this.speed() : 0;
  }

  stop(): void {
    this.running = false;
    this.spinning = false;
  }

  // ─── Spin ─────────────────────────────────────────────────────────

  /**
   * Arm the next `begin` as a Spin and return the world ω to fling with
   * (`viewDir` = normalize(camera − target) picks the axis of a spherical or
   * linear rotor). The rig's `fling` calls `begin`; call `disarmSpin()` right
   * after it in case the fling was refused.
   */
  armSpin(viewDir: Vec3 | null): Vec3 {
    const s = TRUE_SPIN.spinOmega;
    const body: Vec3 = [0, 0, 0];
    if (this.rotor === 'asymmetric' || this.rotor === 'oblate' || this.rotor === 'prolate') {
      body[1] = s;
      body[0] = s * TRUE_SPIN.spinWobble * (random(this.seed) < 0.5 ? -1 : 1);
      this.seed += 1;
    } else {
      // Spherical, linear, atom: the principal axis most perpendicular to the view.
      const candidates = this.rotor === 'linear' ? [1, 2] : [0, 1, 2];
      let best = candidates[0];
      let bestDot = Number.POSITIVE_INFINITY;
      for (const i of candidates) {
        const axis = this.axes[i];
        const d = viewDir ? Math.abs(axis[0] * viewDir[0] + axis[1] * viewDir[1] + axis[2] * viewDir[2]) : 0;
        if (d < bestDot - 1e-9) {
          bestDot = d;
          best = i;
        }
      }
      body[best] = s;
    }
    this.spinArm = body;
    return rotate(this.P, body, [0, 0, 0]);
  }

  disarmSpin(): void {
    this.spinArm = null;
  }

  // ─── Introspection (tests, dev hooks) ─────────────────────────────

  /** Body-frame ω (rad/s), a copy. */
  bodyOmega(): Vec3 {
    return [this.w[0], this.w[1], this.w[2]];
  }

  /** Rotational kinetic energy ½·Σ I_i ω_i² (amu·Å²/s²). */
  energy(): number {
    const [ia, ib, ic] = this.inertia;
    const [a, b, c] = this.w;
    return 0.5 * (ia * a * a + ib * b * b + ic * c * c);
  }

  flips(): number {
    return this.flipCount;
  }

  isRunning(): boolean {
    return this.running;
  }

  isSpinning(): boolean {
    return this.running && this.spinning;
  }

  // ─── Internals ────────────────────────────────────────────────────

  private speed(): number {
    return Math.hypot(this.w[0], this.w[1], this.w[2]);
  }

  private euler(w: Vec3, out: Vec3): Vec3 {
    const k = this.k;
    out[0] = k[0] * w[1] * w[2];
    out[1] = k[1] * w[2] * w[0];
    out[2] = k[2] * w[0] * w[1];
    return out;
  }

  private substep(h: number): void {
    const w = this.w;
    const w0 = this.w0;
    const tmp = this.tmp;
    w0[0] = w[0];
    w0[1] = w[1];
    w0[2] = w[2];
    // RK4 on the torque-free Euler equations.
    this.euler(w0, this.k1);
    for (let i = 0; i < 3; i += 1) tmp[i] = w0[i] + 0.5 * h * this.k1[i];
    this.euler(tmp, this.k2);
    for (let i = 0; i < 3; i += 1) tmp[i] = w0[i] + 0.5 * h * this.k2[i];
    this.euler(tmp, this.k3);
    for (let i = 0; i < 3; i += 1) tmp[i] = w0[i] + h * this.k3[i];
    this.euler(tmp, this.k4);
    for (let i = 0; i < 3; i += 1) w[i] = w0[i] + (h / 6) * (this.k1[i] + 2 * this.k2[i] + 2 * this.k3[i] + this.k4[i]);
    this.dissipate(h);
    this.t += h;

    // The body turns by the step's mean ω: δq = exp(ω̄·h/2).
    const mx = 0.5 * (w0[0] + w[0]);
    const my = 0.5 * (w0[1] + w[1]);
    const mz = 0.5 * (w0[2] + w[2]);
    const mean = Math.hypot(mx, my, mz);
    const delta = this.delta;
    if (mean > 1e-12) {
      const half = 0.5 * mean * h;
      const s = Math.sin(half) / mean;
      delta[0] = mx * s;
      delta[1] = my * s;
      delta[2] = mz * s;
      delta[3] = Math.cos(half);
    } else {
      delta[0] = 0;
      delta[1] = 0;
      delta[2] = 0;
      delta[3] = 1;
    }

    const speed = this.speed();
    if (!(speed > 1e-9) || !Number.isFinite(speed)) {
      this.running = false;
      this.spinning = false;
      w.fill(0);
      return;
    }
    const sign = this.bSign();
    if (sign !== 0) {
      if (this.flipSign !== 0 && sign !== this.flipSign) {
        this.flipCount += 1;
        try {
          this.onFlip?.();
        } catch (error) {
          console.error('[lupi] spin flip listener threw', error);
        }
      }
      this.flipSign = sign;
    }
  }

  private dissipate(h: number): void {
    if (!this.dissipation) return;
    const w = this.w;
    if (this.spinning) {
      // Spin: undamped for the hold, then a uniform τ (the part of h past it).
      const past = this.t + h - TRUE_SPIN.spinHoldS;
      if (past <= 0) return;
      const e = Math.exp(-Math.min(h, past) / TRUE_SPIN.spinTau);
      w[0] *= e;
      w[1] *= e;
      w[2] *= e;
      return;
    }
    const tau = this.tau;
    w[0] *= Math.exp(-h / tau[0]);
    w[1] *= Math.exp(-h / tau[1]);
    w[2] *= Math.exp(-h / tau[2]);
    // Constant friction, integrated as the isotropic coast does:
    // |ω| ← (|ω| + cτ)e^{−h/τ} − cτ with the viscous part applied above.
    const m = this.speed();
    if (!(m > 0)) return;
    const ct = TRUE_SPIN.friction * TRUE_SPIN.onAxisTau;
    const next = m - ct * (1 - Math.exp(-h / TRUE_SPIN.onAxisTau));
    const scale = next > 0 ? next / m : 0;
    w[0] *= scale;
    w[1] *= scale;
    w[2] *= scale;
  }

  /** ±1 while L lies within the flip cone about ±b, else 0. */
  private bSign(): number {
    if (!this.detectFlips) return 0;
    const [ia, ib, ic] = this.inertia;
    const la = ia * this.w[0];
    const lb = ib * this.w[1];
    const lc = ic * this.w[2];
    const l = Math.hypot(la, lb, lc);
    if (!(l > 0)) return 0;
    if (Math.abs(lb) < TRUE_SPIN.flipShare * l) return 0;
    return lb > 0 ? 1 : -1;
  }
}
