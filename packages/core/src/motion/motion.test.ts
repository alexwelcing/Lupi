import { spring } from 'math/time';
import { describe, expect, it } from 'vitest';
import {
  MOTION,
  createSpring1,
  dampAngleWrapped,
  isSettled,
  settleTime,
  springTo,
  stepResponse,
  type MotionToken,
} from './index';

const TOKENS = Object.entries(MOTION) as Array<[string, MotionToken]>;
const EXTRA: Array<[string, MotionToken]> = [['over', { smoothTime: 0.1, dampingRatio: 1.6 }]];

describe('motion kernel', () => {
  it.each([...TOKENS, ...EXTRA])('stepResponse(%s) matches math spring stepped from rest', (_, token) => {
    const h = (4 * token.smoothTime) / 200;
    const s = { value: 0, velocity: 0 };
    for (let i = 1; i <= 200; i += 1) {
      spring.update(s, 1, token.smoothTime, token.dampingRatio, h);
      expect(Math.abs(stepResponse(token, i * h) - s.value)).toBeLessThan(1e-6);
    }
    expect(stepResponse(token, 0)).toBe(0);
    expect(stepResponse(token, -1)).toBe(0);
  });

  it.each(TOKENS)('springTo(%s) settles at the same wall-clock time at 30/60/120 Hz', (_, token) => {
    const eps = 1e-3;
    const settledAt = (hz: number) => {
      const dt = 1 / hz;
      const s = createSpring1(0);
      for (let i = 1; i < hz * 10; i += 1) {
        springTo(s, 1, token, dt);
        if (isSettled(s.value, s.velocity, 1, eps)) return i * dt;
      }
      return Infinity;
    };
    const t30 = settledAt(30);
    const t60 = settledAt(60);
    const t120 = settledAt(120);
    // Each rate detects the same instant, quantised to its own frame.
    expect(Math.abs(t60 - t120)).toBeLessThanOrEqual(1 / 60 + 1e-9);
    expect(Math.abs(t30 - t120)).toBeLessThanOrEqual(1 / 30 + 1e-9);
    // Value-only settle agrees with the analytic settleTime within one 1/120 s step.
    const T = settleTime(token, eps);
    const s = createSpring1(0);
    let valueSettled = Infinity;
    for (let i = 1; i < 1200; i += 1) {
      springTo(s, 1, token, 1 / 120);
      if (Math.abs(1 - s.value) >= eps) valueSettled = Infinity;
      else if (valueSettled === Infinity) valueSettled = i / 120;
    }
    expect(Math.abs(valueSettled - T)).toBeLessThanOrEqual(1 / 120 + 1e-9);
  });

  it('is stable at dt = 5 and cut snaps', () => {
    for (const [, token] of TOKENS) {
      const s = springTo(createSpring1(0), 1, token, 5);
      expect(Math.abs(s.value - 1)).toBeLessThan(1e-6);
      expect(Number.isFinite(s.velocity)).toBe(true);
    }
    const s = springTo({ value: 0, velocity: 3 }, 2, MOTION.glide, 1 / 60, true);
    expect(s).toEqual({ value: 2, velocity: 0 });
  });

  it('dampAngleWrapped(3 → −3) takes the short way and ends at −3', () => {
    const s = createSpring1(3);
    let maxAbs = 0;
    for (let i = 0; i < 240; i += 1) {
      dampAngleWrapped(s, -3, 0.12, 1 / 60);
      maxAbs = Math.max(maxAbs, Math.abs(s.value));
      expect(s.value).toBeGreaterThan(-Math.PI - 1e-12);
      expect(s.value).toBeLessThanOrEqual(Math.PI);
    }
    expect(s.value).toBeCloseTo(-3, 6);
    expect(maxAbs).toBeGreaterThan(3); // crossed ±π rather than unwinding through 0
  });
});
