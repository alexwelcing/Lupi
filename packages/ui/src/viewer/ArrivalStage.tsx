/**
 * A molecule arrives: sixty thousand particles whirl over the viewer, then
 * fly to the atoms, bottom up, each taking its element's colour, and the
 * real atoms grow in underneath as the particles fade. When one molecule
 * replaces another, the particles are already sitting on the old atoms and
 * simply fly to the new ones.
 *
 * The stage is a second canvas over the viewer's, driven by the same
 * compute engine as the scanner's stage, with its camera taken from the
 * viewer every frame (`cameraFeed`), so the particles land exactly where
 * the atoms are drawn. While it runs, the store's `arrival` holds the real
 * atoms at zero size; anything that stops the stage (no WebGPU, reduced
 * motion, a failure, a watchdog) sets it straight to one, so the viewer is
 * never left empty.
 */
import { useEffect, useRef } from 'react';
import { atomDiscSize, atomsToPoints, normalizePoints } from '@atlas/core/gist';
import type { Frame } from '@atlas/core/types';
import { useStore } from '../store';
import { cameraInto } from './cameraFeed';
import type { GistParticles } from '../scan/gist/gistParticles';

/** The swirl before the first molecule's particles are called to it. */
const SWIRL_MS = 700;
/** From the call to the last particles landing (the wave runs bottom to top). */
const LAND_MS = 2_200;
/** The real atoms grow in over this long while the particles fade. */
const GROW_MS = 1_000;
/** If nothing has finished by then, the atoms are shown regardless. */
const WATCHDOG_MS = 8_000;
const EXTENT = 1.8;

function firstFrame(file: { trajectory?: { frames?: Array<Frame | undefined> } } | null): Frame | null {
  const frame = file?.trajectory?.frames?.[0];
  return frame && frame.natoms > 0 ? frame : null;
}

/** The mean of the points' colours and the same in shadow, as hex. */
function paletteOf(points: { count: number; colors: Uint8Array }): [string, string] {
  if (points.count === 0) return ['#d5ef9c', '#84d7ff'];
  let r = 0;
  let g = 0;
  let b = 0;
  const step = Math.max(1, Math.floor(points.count / 4096));
  let n = 0;
  for (let index = 0; index < points.count; index += step) {
    r += points.colors[index * 3];
    g += points.colors[index * 3 + 1];
    b += points.colors[index * 3 + 2];
    n += 1;
  }
  const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return [`#${hex(r / n)}${hex(g / n)}${hex(b / n)}`, `#${hex((r / n) * 0.62)}${hex((g / n) * 0.62)}${hex((b / n) * 0.66)}`];
}

export function ArrivalStage() {
  const file = useStore((state) => state.file);
  const enabled = useStore((state) => state.arrivalEnabled);
  const setArrival = useStore((state) => state.setArrival);
  const canvas = useRef<HTMLCanvasElement>(null);
  const particles = useRef<GistParticles | null>(null);
  const pending = useRef<Promise<GistParticles | null> | null>(null);
  const failed = useRef(false);
  const settledOnce = useRef(false);

  const ensureEngine = async (): Promise<GistParticles | null> => {
    if (particles.current) return particles.current;
    if (failed.current || !canvas.current) return null;
    if (!pending.current) {
      const node = canvas.current;
      pending.current = import('../scan/gist/gistParticles')
        .then(({ createGistParticles }) =>
          createGistParticles(node, () => {
            failed.current = true;
            particles.current = null;
            useStore.getState().setArrival(1);
          }),
        )
        .then((engine) => {
          particles.current = engine;
          return engine;
        })
        .catch(() => {
          failed.current = true;
          return null;
        });
    }
    return pending.current;
  };

  useEffect(() => {
    return () => {
      particles.current?.dispose();
      particles.current = null;
      useStore.getState().setArrival(1);
    };
  }, []);

  useEffect(() => {
    const frame = firstFrame(file);
    if (!enabled || !frame) {
      setArrival(1);
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    let raf = 0;
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => !cancelled && fn(), ms));
    const finish = () => {
      if (!cancelled) setArrival(1);
    };
    later(WATCHDOG_MS, finish);

    void (async () => {
      const engine = await ensureEngine();
      if (cancelled) return;
      if (!engine) {
        finish();
        return;
      }
      const { pickParticleCount } = await import('../scan/gist/gistParticles');
      if (cancelled) return;
      const raw = atomsToPoints(frame, pickParticleCount());
      const normalized = normalizePoints(raw, EXTENT);
      const cameraOut = new Float32Array(16);
      engine.setCameraSource(() => cameraInto(normalized.centre, normalized.scale, cameraOut));
      engine.setDiscSize(atomDiscSize(raw, frame.natoms, normalized.scale));
      // The whirl already wears the molecule's colours: its mean, and that mean in shadow.
      const [main, accent] = paletteOf(raw);
      engine.setPalette(main, accent);
      engine.setSpin(0);
      engine.setFade(1);
      const call = () => {
        engine.setHomes(normalized.points);
        engine.setAttract(1);
        engine.setEnergy(0.1);
      };
      const morph = settledOnce.current;
      if (morph) {
        // The particles sit on the last molecule's atoms: fly straight to the new ones.
        call();
      } else {
        engine.setAttract(0);
        engine.setEnergy(1);
        later(SWIRL_MS, call);
      }
      settledOnce.current = true;
      later((morph ? 0 : SWIRL_MS) + LAND_MS, () => {
        // The atoms grow in under the landing particles while the particles fade.
        engine.setFade(0);
        const started = performance.now();
        const grow = (now: number) => {
          if (cancelled) return;
          const t = Math.min(1, (now - started) / GROW_MS);
          const eased = t * t * (3 - 2 * t);
          setArrival(eased);
          if (t < 1) raf = requestAnimationFrame(grow);
        };
        raf = requestAnimationFrame(grow);
      });
    })();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      cancelAnimationFrame(raf);
    };
  }, [file, enabled, setArrival]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-testid="lupi-arrival-stage"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}
    />
  );
}
