/**
 * MatterField — an interactive molecular fluid behind the overture.
 *
 * A drifting cloud of element-tinted atoms with faint bonds that form and
 * break as they move — the viewer's own bond detection, alive in the sky.
 * The pointer becomes a cursor-atom: bonds snap between it and its nearest
 * neighbours as you move through the field, an allusion to ball-and-stick
 * and to holding a structure in your hand.
 *
 * Canvas 2D, no WebGL — cheap on first paint, honouring the static-first
 * landing. Neighbour search runs on a uniform spatial grid (the same idea
 * the real bond engine uses), so it stays O(n·k) rather than O(n²). Density
 * thins toward the left where the copy sits, so the text stays legible.
 * Freezes to a single static frame under prefers-reduced-motion.
 */

import { useEffect, useRef } from 'react';

// Melancholia element palette — steel and silver dominant, candlelight gold
// and a rare rose/teal as accents.
const TINTS: Array<[number, number, number]> = [
  [109, 134, 168], // steel
  [190, 202, 222], // silver
  [216, 184, 120], // candle gold
  [232, 201, 138], // bright gold
  [185, 140, 174], // rose
  [127, 169, 184], // teal
];
const TINT_WEIGHTS = [0.40, 0.28, 0.10, 0.06, 0.09, 0.07];

function pickTint(r: number): number {
  let acc = 0;
  for (let i = 0; i < TINT_WEIGHTS.length; i++) {
    acc += TINT_WEIGHTS[i];
    if (r < acc) return i;
  }
  return 0;
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

export function MatterField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const mobile = window.matchMedia?.('(max-width: 760px)').matches;

    let W = 0, H = 0;
    let n = 0;
    let px!: Float32Array, py!: Float32Array, vx!: Float32Array, vy!: Float32Array;
    let phase!: Float32Array, tint!: Uint8Array, rad!: Float32Array;

    const bondDist = mobile ? 84 : 96;         // atom↔atom bond length (px)
    const bondDist2 = bondDist * bondDist;
    const pointerDist = mobile ? 120 : 150;     // cursor bonds reach further
    const pointerDist2 = pointerDist * pointerDist;
    const cell = bondDist;                       // spatial-grid cell = bond length

    const rnd = mulberry32(0x5eed);

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      W = Math.max(1, rect.width);
      H = Math.max(1, rect.height);
      canvas!.width = Math.round(W * dpr);
      canvas!.height = Math.round(H * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Density scales with area; a denser cloud on the right (planet side),
      // thinner on the left (copy). Capped for cost.
      const target = Math.min(mobile ? 90 : 230, Math.round((W * H) / (mobile ? 12000 : 8600)));
      n = target;
      px = new Float32Array(n); py = new Float32Array(n);
      vx = new Float32Array(n); vy = new Float32Array(n);
      phase = new Float32Array(n); tint = new Uint8Array(n); rad = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        // Bias spawn toward the right so the copy side stays calm.
        const bias = rnd();
        px[i] = (0.14 + 0.86 * (bias * bias)) * W;
        py[i] = rnd() * H;
        const sp = (mobile ? 5 : 7) + rnd() * (mobile ? 6 : 9);
        const ang = rnd() * Math.PI * 2;
        vx[i] = Math.cos(ang) * sp * 0.5;
        vy[i] = -Math.abs(Math.sin(ang)) * sp - 3; // gentle upward drift (approach)
        phase[i] = rnd() * Math.PI * 2;
        tint[i] = pickTint(rnd());
        rad[i] = 1.1 + rnd() * (mobile ? 1.2 : 1.7);
      }
    }
    resize();

    // Pointer, in canvas-local coordinates. influence eases 0↔1.
    const ptr = { x: -9999, y: -9999, influence: 0, want: 0 };
    const onMove = (cx: number, cy: number) => {
      const rect = canvas!.getBoundingClientRect();
      const lx = cx - rect.left, ly = cy - rect.top;
      if (lx >= 0 && ly >= 0 && lx <= rect.width && ly <= rect.height) {
        ptr.x = lx; ptr.y = ly; ptr.want = 1;
      } else {
        ptr.want = 0;
      }
    };
    const onPointer = (e: PointerEvent) => onMove(e.clientX, e.clientY);
    const onLeave = () => { ptr.want = 0; };
    if (!reduce) {
      window.addEventListener('pointermove', onPointer, { passive: true });
      window.addEventListener('pointerdown', onPointer, { passive: true });
      window.addEventListener('blur', onLeave);
    }

    // Grid buckets, rebuilt each frame (n is small). head[cell] → first atom
    // index, next[i] → next atom in same cell (linked list, zero alloc churn).
    let cols = 1, rows = 1;
    let head = new Int32Array(1);
    let next = new Int32Array(n);
    function rebuildGrid() {
      cols = Math.max(1, Math.ceil(W / cell));
      rows = Math.max(1, Math.ceil(H / cell));
      const cellsN = cols * rows;
      if (head.length !== cellsN) head = new Int32Array(cellsN);
      head.fill(-1);
      if (next.length !== n) next = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const c = cellIndex(px[i], py[i]);
        next[i] = head[c];
        head[c] = i;
      }
    }
    const cellIndex = (x: number, y: number) => {
      let cxi = (x / cell) | 0; if (cxi < 0) cxi = 0; else if (cxi >= cols) cxi = cols - 1;
      let cyi = (y / cell) | 0; if (cyi < 0) cyi = 0; else if (cyi >= rows) cyi = rows - 1;
      return cyi * cols + cxi;
    };

    // Left-edge legibility ramp: fade the whole field where the copy sits.
    const legibility = (x: number) => {
      const t = x / W;
      // 0.18 at far left → 1 by ~48% width.
      return Math.max(0.18, Math.min(1, (t - 0.04) / 0.44));
    };

    function step(dt: number) {
      // Ease pointer influence.
      ptr.influence += (ptr.want - ptr.influence) * Math.min(1, dt * 4);

      for (let i = 0; i < n; i++) {
        // Slow sinusoidal sway for a tumbling-fluid feel.
        phase[i] += dt * 0.5;
        const swayx = Math.cos(phase[i]) * 1.4;
        // Faint pointer attraction so the field feels magnetic (bonds lead).
        if (ptr.influence > 0.02) {
          const dx = ptr.x - px[i], dy = ptr.y - py[i];
          const d2 = dx * dx + dy * dy;
          if (d2 < pointerDist2 && d2 > 1) {
            const d = Math.sqrt(d2);
            const pull = (1 - d / pointerDist) * 26 * ptr.influence;
            vx[i] += (dx / d) * pull * dt;
            vy[i] += (dy / d) * pull * dt;
          }
        }
        vx[i] *= 0.985; vy[i] *= 0.985; // drag, so pulls never collapse the field
        px[i] += (vx[i] + swayx) * dt;
        py[i] += vy[i] * dt;
        // Toroidal wrap — the fluid is endless.
        if (px[i] < -8) px[i] += W + 16; else if (px[i] > W + 8) px[i] -= W + 16;
        if (py[i] < -8) py[i] += H + 16; else if (py[i] > H + 8) py[i] -= H + 16;
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H);
      rebuildGrid();

      // ── Bonds (atom↔atom) via grid neighbours ──
      ctx!.lineWidth = 1;
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          for (let i = head[cy * cols + cx]; i !== -1; i = next[i]) {
            // Check this cell + the 4 forward-adjacent cells (avoid dup pairs).
            for (let o = 0; o < 5; o++) {
              const ncx = cx + FWD[o * 2], ncy = cy + FWD[o * 2 + 1];
              if (ncx < 0 || ncy < 0 || ncx >= cols || ncy >= rows) continue;
              let j = head[ncy * cols + ncx];
              // Same cell: only j after i in the list to avoid double-draw.
              if (o === 0) j = next[i];
              for (; j !== -1; j = next[j]) {
                const dx = px[j] - px[i], dy = py[j] - py[i];
                const d2 = dx * dx + dy * dy;
                if (d2 >= bondDist2) continue;
                const t = 1 - Math.sqrt(d2) / bondDist;
                const leg = Math.min(legibility(px[i]), legibility(px[j]));
                const a = t * t * 0.34 * leg;
                if (a < 0.012) continue;
                ctx!.strokeStyle = `rgba(150,170,200,${a.toFixed(3)})`;
                ctx!.beginPath();
                ctx!.moveTo(px[i], py[i]);
                ctx!.lineTo(px[j], py[j]);
                ctx!.stroke();
              }
            }
          }
        }
      }

      // ── Cursor bonds — gold, brighter, reach further ──
      if (ptr.influence > 0.02) {
        const cxi = (ptr.x / cell) | 0, cyi = (ptr.y / cell) | 0;
        const reach = Math.ceil(pointerDist / cell);
        ctx!.lineWidth = 1.1;
        for (let oy = -reach; oy <= reach; oy++) {
          for (let ox = -reach; ox <= reach; ox++) {
            const gx = cxi + ox, gy = cyi + oy;
            if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
            for (let j = head[gy * cols + gx]; j !== -1; j = next[j]) {
              const dx = px[j] - ptr.x, dy = py[j] - ptr.y;
              const d2 = dx * dx + dy * dy;
              if (d2 >= pointerDist2) continue;
              const t = 1 - Math.sqrt(d2) / pointerDist;
              const a = t * t * 0.6 * ptr.influence;
              ctx!.strokeStyle = `rgba(224,196,136,${a.toFixed(3)})`;
              ctx!.beginPath();
              ctx!.moveTo(ptr.x, ptr.y);
              ctx!.lineTo(px[j], py[j]);
              ctx!.stroke();
            }
          }
        }
      }

      // ── Atoms ──
      for (let i = 0; i < n; i++) {
        const leg = legibility(px[i]);
        const [r, g, b] = TINTS[tint[i]];
        const glow = tint[i] === 2 || tint[i] === 3; // gold atoms carry a soft halo
        const a = (glow ? 0.9 : 0.72) * leg;
        if (glow) {
          ctx!.fillStyle = `rgba(${r},${g},${b},${(0.14 * leg).toFixed(3)})`;
          ctx!.beginPath();
          ctx!.arc(px[i], py[i], rad[i] * 3.2, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
        ctx!.beginPath();
        ctx!.arc(px[i], py[i], rad[i], 0, Math.PI * 2);
        ctx!.fill();
      }

      // ── Cursor atom ──
      if (ptr.influence > 0.05) {
        const a = ptr.influence;
        ctx!.fillStyle = `rgba(232,201,138,${(0.16 * a).toFixed(3)})`;
        ctx!.beginPath(); ctx!.arc(ptr.x, ptr.y, 10, 0, Math.PI * 2); ctx!.fill();
        ctx!.fillStyle = `rgba(244,232,214,${(0.9 * a).toFixed(3)})`;
        ctx!.beginPath(); ctx!.arc(ptr.x, ptr.y, 2.4, 0, Math.PI * 2); ctx!.fill();
      }
    }

    let raf = 0, last = 0, running = false;
    const loop = (t: number) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
      last = t;
      step(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); } };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    let ro: ResizeObserver | null = null;
    let vis: IntersectionObserver | null = null;
    if (reduce) {
      draw(); // single static frame
    } else {
      // Only animate while the hero is on screen — scrolling past the overture
      // costs no CPU. Also pause when the tab is hidden.
      vis = new IntersectionObserver(
        ([e]) => { if (e.isIntersecting && !document.hidden) start(); else stop(); },
        { threshold: 0 },
      );
      vis.observe(canvas);
      ro = new ResizeObserver(() => resize());
      ro.observe(canvas);
      start();
    }
    const onVisChange = () => {
      if (document.hidden) stop();
      else if (canvas.getBoundingClientRect().bottom > 0 && canvas.getBoundingClientRect().top < window.innerHeight) start();
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      stop();
      ro?.disconnect();
      vis?.disconnect();
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

// Forward-adjacent cell offsets (self + right, down-left, down, down-right)
// so each atom pair is visited exactly once.
const FWD = [0, 0, 1, 0, -1, 1, 0, 1, 1, 1];

export default MatterField;
