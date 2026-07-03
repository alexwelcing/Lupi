/**
 * MatterPlanet — the rogue planet, made of atoms.
 *
 * The emotional centrepiece of the home page's Melancholia register: a great
 * body of matter hanging in a twilight sky, lit on one limb like a planet in
 * slow approach. It is drawn in Canvas 2D — no WebGL, so it costs almost
 * nothing on first paint and honours the static-first landing — as a sphere of
 * a few thousand atom-points, Lambert-lit toward a warm off-frame light with a
 * cold bright limb.
 *
 * Motion is glacial (a full turn measured in minutes) and freezes entirely
 * under `prefers-reduced-motion`. Deterministic point set, so the body looks
 * the same every visit — a fixed object, not a random field.
 */

import { useEffect, useRef } from 'react';

export interface MatterPlanetProps {
  /** Rendered diameter in CSS pixels. */
  size?: number;
  /** Atom-point count. ~7000 reads as continuous matter without cost. */
  points?: number;
  /** Seconds per full rotation. Glacial by design. */
  secondsPerTurn?: number;
  /** Warm limb/highlight colour (candlelight). */
  warm?: [number, number, number];
  /** Cold body colour (planetary steel). */
  cold?: [number, number, number];
  /** Atmosphere glow colour behind the body. */
  atmosphere?: string;
  className?: string;
  style?: React.CSSProperties;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function matterSphere(n: number): { pos: Float32Array; grain: Float32Array } {
  // A near-uniform Fibonacci set, jittered so it reads as granular matter
  // rather than a spiral lattice. Deterministic — the body is a fixed object.
  const pos = new Float32Array(n * 3);
  const grain = new Float32Array(n); // per-atom brightness noise
  const golden = Math.PI * (3 - Math.sqrt(5));
  const rnd = mulberry32(0x1e0ce);
  for (let i = 0; i < n; i++) {
    const yj = (rnd() - 0.5) * (1.6 / n);
    const y = Math.max(-1, Math.min(1, 1 - (i / (n - 1)) * 2 + yj));
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i + (rnd() - 0.5) * 0.5;
    pos[i * 3] = Math.cos(theta) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(theta) * r;
    grain[i] = 0.82 + rnd() * 0.36;
  }
  return { pos, grain };
}

export function MatterPlanet({
  size = 520,
  points = 7000,
  secondsPerTurn = 240,
  warm = [232, 201, 138],
  cold = [92, 116, 150],
  atmosphere = 'rgba(94, 126, 174, 0.28)',
  className,
  style,
}: MatterPlanetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);

    const { pos: pts, grain } = matterSphere(points);
    const R = size * 0.5 * 0.82;      // leave a rim of atmosphere
    const cx = size * 0.5;
    const cy = size * 0.5;

    // Light from upper-left, slightly toward the viewer — the candle off-frame.
    const L = (() => {
      const v = [-0.62, 0.5, 0.6];
      const m = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / m, v[1] / m, v[2] / m] as const;
    })();
    // Fixed axial tilt so the body sits like a planet, not a spinning top.
    const tilt = -0.42;
    const sinT = Math.sin(tilt);
    const cosT = Math.cos(tilt);

    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const order = new Int32Array(points);
    const depth = new Float32Array(points);
    // Scratch rotated coordinates, reused each frame — no per-frame allocation.
    const rx = new Float32Array(points);
    const ry = new Float32Array(points);
    const rz = new Float32Array(points);
    let raf = 0;
    let startPassed = 0;

    const draw = (angle: number) => {
      ctx.clearRect(0, 0, size, size);

      // Atmosphere: a soft body of light behind the matter.
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.5);
      glow.addColorStop(0, atmosphere);
      glow.addColorStop(0.55, atmosphere.replace(/[\d.]+\)$/, '0.10)'));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2);
      ctx.fill();

      const sinA = Math.sin(angle);
      const cosA = Math.cos(angle);

      // Rotate about Y, then tilt about X; project orthographically. Painter's
      // order back-to-front so front matter overdraws the far hemisphere.
      for (let i = 0; i < points; i++) {
        const x0 = pts[i * 3], y0 = pts[i * 3 + 1], z0 = pts[i * 3 + 2];
        const x1 = x0 * cosA + z0 * sinA;
        const z1 = -x0 * sinA + z0 * cosA;
        const y1 = y0 * cosT - z1 * sinT;
        const z2 = y0 * sinT + z1 * cosT;
        depth[i] = z2;
        order[i] = i;
        rx[i] = x1; ry[i] = y1; rz[i] = z2;
      }
      order.sort((a, b) => depth[a] - depth[b]);

      for (let k = 0; k < points; k++) {
        const i = order[k];
        const nx = rx[i], ny = ry[i], nz = rz[i];
        // Lambert toward the candle + a cold fresnel limb where nz→0.
        const lambert = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const facing = Math.max(0, nz);
        const rim = Math.pow(1 - facing, 3);

        // Base steel, lifted toward candle-gold in the light, cold on the limb.
        // Per-atom grain keeps the surface from reading as a smooth gradient.
        const gr = grain[i];
        const warmth = Math.pow(lambert, 0.85);
        const lit = (0.09 + 1.05 * lambert * lambert) * gr;
        let r = cold[0] * lit + warm[0] * warmth * 0.78;
        let g = cold[1] * lit + warm[1] * warmth * 0.66;
        let b = cold[2] * lit + warm[2] * warmth * 0.4;
        // Cold bright rim (planet limb catching the twilight sky).
        r += rim * 118; g += rim * 148; b += rim * 190;

        const px = cx + nx * R;
        const py = cy - ny * R;
        // Nearer points a touch larger; far hemisphere dims into the body.
        const dsize = 1.0 + facing * 0.75;
        const alpha = 0.32 + 0.68 * facing;
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha.toFixed(3)})`;
        ctx.fillRect(px - dsize * 0.5, py - dsize * 0.5, dsize, dsize);
      }

      // A fine bright meniscus on the lit limb — the last of the light.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const rim = ctx.createRadialGradient(
        cx - R * 0.5, cy - R * 0.42, R * 0.55,
        cx - R * 0.5, cy - R * 0.42, R * 1.15,
      );
      rim.addColorStop(0, 'rgba(0,0,0,0)');
      rim.addColorStop(0.82, 'rgba(0,0,0,0)');
      rim.addColorStop(0.94, `rgba(${warm[0]},${warm[1]},${warm[2]},0.16)`);
      rim.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    if (reduce) {
      draw(-0.6);
      return () => {};
    }

    const loop = (t: number) => {
      if (!startPassed) startPassed = t;
      const angle = -0.6 + ((t - startPassed) / 1000) * ((Math.PI * 2) / secondsPerTurn);
      draw(angle);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size, points, secondsPerTurn, warm, cold, atmosphere]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ width: size, height: size, display: 'block', ...style }}
    />
  );
}

export default MatterPlanet;
