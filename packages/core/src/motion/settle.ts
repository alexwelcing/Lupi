import { stepResponse } from './stepResponse';
import type { MotionToken } from './tokens';

/** True when the spring is within `eps` of `target` and slower than `velEps` (default eps·10). */
export function isSettled(
  value: number,
  velocity: number,
  target: number,
  eps: number,
  velEps: number = eps * 10,
): boolean {
  return Math.abs(value - target) < eps && Math.abs(velocity) < velEps;
}

/**
 * Seconds until a unit step on `token` stays within `eps` of its target for
 * good (from `stepResponse`, so it is exact and frame-rate free).
 */
export function settleTime(token: MotionToken, eps = 1e-3): number {
  const zeta = token.dampingRatio;
  const omega = 2 / Math.max(0.0001, token.smoothTime);
  // An upper bound on the settle time: every branch's error is below
  // C·e^{-σt} with σ the slowest decay rate.
  const sigma =
    Math.abs(zeta - 1) < 1e-4
      ? omega
      : zeta < 1
        ? zeta * omega
        : omega * (zeta - Math.sqrt(zeta * zeta - 1));
  const horizon = (Math.log(1 / eps) + 8) / Math.max(sigma, 1e-9) + 1 / omega;
  const steps = 4096;
  const h = horizon / steps;
  let last = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = i * h;
    if (Math.abs(1 - stepResponse(token, t)) >= eps) last = t;
  }
  // Refine the final crossing in (last, last + h].
  let lo = last;
  let hi = last + h;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (Math.abs(1 - stepResponse(token, mid)) >= eps) lo = mid;
    else hi = mid;
  }
  return hi;
}
