/**
 * A molecule arrives: sixty thousand particles whirl over the viewer, then
 * fly to the atoms, bottom up, each taking its element's colour, and the
 * real atoms grow in underneath as the particles fade. When one molecule
 * replaces another, the particles are already sitting on the old atoms and
 * simply fly to the new ones; while the next one is still loading they
 * lift off and whirl, so a wait reads as anticipation, not a stall.
 *
 * The room is made for it. While the particles whirl and fly, the chrome
 * clears (`data-arriving` on the app root), a veil deepens the background
 * so the particles read on any preset, and a caption names what is
 * arriving: the name first, then its formula and atom count as the atoms
 * land, then three things to see next, offered before anyone asks. Any
 * touch, wheel or key during the flight skips to the end; any touch after
 * it lets the caption go. Nothing here is pre-made: every molecule that
 * loads gets the same treatment.
 *
 * The stage is a second canvas over the viewer's, driven by the same
 * compute engine as the scanner's stage, with its camera taken from the
 * viewer every frame (`cameraFeed`), so the particles land exactly where
 * the atoms are drawn. While it runs, the store's `arrival` holds the real
 * atoms at zero size; anything that stops the stage (no WebGPU, reduced
 * motion, a failure, a watchdog) sets it straight to one, so the viewer is
 * never left empty.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { atomDiscSize, atomsToPoints, elementSymbolsOf, formulaOf, normalizePoints, type ColouredPoints } from '@atlas/core/gist';
import type { Frame } from '@atlas/core/types';
import { useStore } from '../store';
import { LOCAL_MOLECULES } from '../landing/moleculeIndex';
import type { SwitchCandidate } from '../switcher/switchIndex';
import { cameraInto } from './cameraFeed';
import { relatedMolecules } from './related';
import type { GistParticles } from '../scan/gist/gistParticles';
import './arrival.css';

/** The swirl before the first molecule's particles are called to it. */
const SWIRL_MS = 700;
/** From the call to the last particles landing (the wave runs bottom to top). */
const LAND_MS = 2_200;
/** The real atoms grow in over this long while the particles fade. */
const GROW_MS = 1_000;
/** A skip grows the atoms in this fast. */
const SKIP_GROW_MS = 260;
/** The suggestions appear this long after landing, and the caption lets go this long after that. */
const NEXT_AFTER_MS = 500;
const CAPTION_LINGER_MS = 7_000;
/** If nothing has finished by then, the atoms are shown regardless. */
const WATCHDOG_MS = 8_000;
const EXTENT = 1.8;

type Phase = 'whirl' | 'calling' | 'landed' | null;

interface Caption {
  title: string;
  line: string;
  next: SwitchCandidate[];
}

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

/** A file name as a title: no extension, no underscores, no leading digits-and-dashes. */
function prettyName(name: string): string {
  return name
    .replace(/\.[a-z0-9]{1,6}(\.gz)?$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/^\d+\s+/, '')
    .trim();
}

function captionFor(file: { name: string }, frame: Frame, galleryId: string | null): Caption {
  const gallery = galleryId ? LOCAL_MOLECULES.find((molecule) => molecule.id === galleryId) : undefined;
  const formula = gallery?.formula ?? formulaOf(frame);
  const atoms = `${frame.natoms.toLocaleString()} atom${frame.natoms === 1 ? '' : 's'}`;
  const parts = [formula, atoms, gallery?.subtitle].filter((part): part is string => Boolean(part && part.trim()));
  const elements = elementSymbolsOf(frame).map((entry) => entry.symbol);
  return {
    title: gallery?.title ?? prettyName(file.name) ?? 'Molecule',
    line: parts.join('  ·  '),
    next: relatedMolecules({ currentId: galleryId, elements, atoms: frame.natoms }),
  };
}

export function ArrivalStage() {
  const file = useStore((state) => state.file);
  const loading = useStore((state) => state.loading);
  const galleryId = useStore((state) => state.activeCardId);
  const enabled = useStore((state) => state.arrivalEnabled);
  const setArrival = useStore((state) => state.setArrival);
  const setArrivalPhase = useStore((state) => state.setArrivalPhase);
  const canvas = useRef<HTMLCanvasElement>(null);
  const particles = useRef<GistParticles | null>(null);
  const pending = useRef<Promise<GistParticles | null> | null>(null);
  const failed = useRef(false);
  const settledOnce = useRef(false);
  /** The last molecule's points, to settle back on when a load fails. */
  const lastPoints = useRef<ColouredPoints | null>(null);
  const lastFile = useRef(file);
  const [phase, setPhaseState] = useState<Phase>(null);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [captionOn, setCaptionOn] = useState(false);
  const [detailOn, setDetailOn] = useState(false);
  const [nextOn, setNextOn] = useState(false);
  const skipRef = useRef<(() => void) | null>(null);

  const setPhase = useCallback(
    (next: Phase) => {
      setPhaseState(next);
      setArrivalPhase(next);
    },
    [setArrivalPhase],
  );

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
            useStore.getState().setArrivalPhase(null);
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
    // A browser can carry `navigator.gpu` and still have no adapter (headless
    // Chromium, some VMs). Ask once, up front, so a molecule never waits on
    // an engine that cannot start.
    let disposed = false;
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
    if (gpu?.requestAdapter) {
      gpu
        .requestAdapter()
        .then((adapter) => {
          if (!disposed && !adapter) useStore.getState().setArrivalEnabled(false);
        })
        .catch(() => {
          if (!disposed) useStore.getState().setArrivalEnabled(false);
        });
    } else useStore.getState().setArrivalEnabled(false);
    return () => {
      disposed = true;
      particles.current?.dispose();
      particles.current = null;
      useStore.getState().setArrival(1);
      useStore.getState().setArrivalPhase(null);
    };
  }, []);

  /* ─── The arrival itself ─── */
  useEffect(() => {
    lastFile.current = file;
    const frame = firstFrame(file);
    if (!enabled || !frame || !file) {
      setArrival(1);
      setPhase(null);
      setCaptionOn(false);
      return;
    }
    let cancelled = false;
    const timers: number[] = [];
    let raf = 0;
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(() => !cancelled && fn(), ms));
    const grow = (ms: number, then?: () => void) => {
      const started = performance.now();
      const step = (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - started) / ms);
        setArrival(t * t * (3 - 2 * t));
        if (t < 1) raf = requestAnimationFrame(step);
        else then?.();
      };
      raf = requestAnimationFrame(step);
    };
    const land = () => {
      setPhase('landed');
      setDetailOn(true);
      later(NEXT_AFTER_MS, () => setNextOn(true));
      later(NEXT_AFTER_MS + CAPTION_LINGER_MS, () => {
        setCaptionOn(false);
        setPhase(null);
      });
    };
    const finishNow = () => {
      if (!cancelled) {
        setArrival(1);
        land();
      }
    };
    later(WATCHDOG_MS, finishNow);

    setCaption(captionFor(file, frame, galleryId));
    setDetailOn(false);
    setNextOn(false);
    setCaptionOn(true);

    void (async () => {
      const engine = await ensureEngine();
      if (cancelled) return;
      if (!engine) {
        finishNow();
        return;
      }
      const { pickParticleCount } = await import('../scan/gist/gistParticles');
      if (cancelled) return;
      const raw = atomsToPoints(frame, pickParticleCount());
      const normalized = normalizePoints(raw, EXTENT);
      lastPoints.current = normalized.points;
      const cameraOut = new Float32Array(16);
      engine.setCameraSource(() => cameraInto(normalized.centre, normalized.scale, cameraOut));
      engine.setDiscSize(atomDiscSize(raw, frame.natoms, normalized.scale));
      const [main, accent] = paletteOf(raw);
      engine.setPalette(main, accent);
      engine.setSpin(0);
      engine.setFade(1);
      const call = () => {
        engine.setHomes(normalized.points);
        engine.setAttract(1);
        engine.setEnergy(0.1);
        setPhase('calling');
      };
      // Already whirling (a switch, or a load the particles lifted off for): fly straight there.
      const morph = settledOnce.current;
      if (morph) {
        call();
      } else {
        setPhase('whirl');
        engine.setAttract(0);
        engine.setEnergy(1);
        later(SWIRL_MS, call);
      }
      settledOnce.current = true;
      // Any touch, wheel or key during the flight: land now.
      skipRef.current = () => {
        timers.forEach((timer) => window.clearTimeout(timer));
        timers.length = 0;
        engine.setFade(0);
        grow(SKIP_GROW_MS, land);
      };
      later((morph ? 0 : SWIRL_MS) + LAND_MS, () => {
        // The atoms grow in under the landing particles while the particles fade.
        skipRef.current = null;
        engine.setFade(0);
        grow(GROW_MS, land);
      });
    })();

    return () => {
      cancelled = true;
      skipRef.current = null;
      timers.forEach((timer) => window.clearTimeout(timer));
      cancelAnimationFrame(raf);
    };
  }, [file, enabled, galleryId, setArrival, setPhase]);

  /* ─── A load in progress: the particles lift off and whirl until it lands ─── */
  useEffect(() => {
    if (!enabled) return;
    const engine = particles.current;
    if (!engine || !settledOnce.current) return;
    if (loading) {
      engine.setFade(1);
      engine.setAttract(0);
      engine.setEnergy(1);
      setPhase('whirl');
      setCaptionOn(false);
      return;
    }
    // Loading ended. If no new file followed, the load failed: settle back.
    const fileAtEnd = lastFile.current;
    const timer = window.setTimeout(() => {
      if (lastFile.current !== fileAtEnd || !lastPoints.current) return;
      if (useStore.getState().arrival >= 1 && useStore.getState().arrivalPhase === 'whirl') {
        engine.setHomes(lastPoints.current);
        engine.setAttract(1);
        engine.setEnergy(0.1);
        window.setTimeout(() => engine.setFade(0), 1_200);
        setPhase(null);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [loading, enabled, setPhase]);

  /* ─── Ins and outs: skip during the flight, let the caption go after ─── */
  useEffect(() => {
    if (phase !== 'whirl' && phase !== 'calling' && phase !== 'landed') return;
    const insideCaption = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.lupi-arrival-caption'));
    const onPointer = (event: PointerEvent) => {
      if (insideCaption(event.target)) return;
      if (phase === 'landed') {
        setCaptionOn(false);
        setPhase(null);
      } else skipRef.current?.();
    };
    const onWheel = () => {
      if (phase === 'landed') {
        setCaptionOn(false);
        setPhase(null);
      } else skipRef.current?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (phase === 'landed') return;
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') skipRef.current?.();
    };
    window.addEventListener('pointerdown', onPointer, { capture: true });
    window.addEventListener('wheel', onWheel, { passive: true, capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, { capture: true });
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
  }, [phase, setPhase]);

  if (!enabled) return null;
  const veilOn = phase === 'whirl' || phase === 'calling';
  return (
    <div className="lupi-arrival" aria-hidden={!captionOn}>
      <div className="lupi-arrival-veil" data-on={veilOn} aria-hidden />
      <canvas ref={canvas} className="lupi-arrival-canvas" aria-hidden data-testid="lupi-arrival-stage" />
      {caption && (
        <div className="lupi-arrival-caption" data-on={captionOn} data-detail={detailOn} data-next={nextOn && caption.next.length > 0} role="status" aria-live="polite">
          <h2 className="lupi-arrival-caption__name">{caption.title}</h2>
          <p className="lupi-arrival-caption__line">{caption.line}</p>
          {caption.next.length > 0 && (
            <div className="lupi-arrival-caption__next">
              <span className="lupi-arrival-caption__label">Next</span>
              {caption.next.map((candidate) => (
                <button
                  key={candidate.key}
                  type="button"
                  className="lupi-arrival-chip"
                  onClick={() => {
                    setCaptionOn(false);
                    void candidate.open();
                  }}
                >
                  {candidate.title}
                  {candidate.formula && <span className="lupi-arrival-chip__formula">{candidate.formula}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
