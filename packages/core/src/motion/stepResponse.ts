// NO imports: scene (and the TSL mirror of this formula) imports this file
// directly as '@atlas/core/motion/stepResponse', without pulling in `math`.

/** The two dials of a spring; structurally the same as `MotionToken`. */
export interface StepResponseToken {
  readonly smoothTime: number;
  readonly dampingRatio: number;
}

/**
 * Closed-form unit step response of math's spring (`math/time` spring-core):
 * the value at time `t` of a spring released at rest from 0 toward 1.
 *
 * ω = 2 / max(1e-4, smoothTime). Critical (|ζ−1| < 1e-4): 1 − (1 + ωt)e^{−ωt}.
 * Under-damped: 1 − e^{−ζωt}(cos ω_d t + (ζω/ω_d) sin ω_d t), ω_d = ω√(1−ζ²).
 * Over-damped: the two-exponential form. `t <= 0` returns 0.
 */
export function stepResponse(token: StepResponseToken, t: number): number {
  if (!(t > 0)) return 0;
  const omega = 2 / Math.max(0.0001, token.smoothTime);
  const zeta = token.dampingRatio;
  if (Math.abs(zeta - 1) < 1e-4) {
    return 1 - (1 + omega * t) * Math.exp(-omega * t);
  }
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-zeta * omega * t);
    return 1 - e * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
  }
  const za = -omega * zeta;
  const zb = omega * Math.sqrt(zeta * zeta - 1);
  const r1 = za - zb;
  const r2 = za + zb;
  return 1 - (r1 * Math.exp(r2 * t) - r2 * Math.exp(r1 * t)) / (r1 - r2);
}
