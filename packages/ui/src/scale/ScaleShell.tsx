/**
 * /scale: the salt ladder from one ion to a googolplex on the web
 * (scale-spec §11.2, "the web viewer adopts the same data in its own time").
 * Every count is exact (formatMagnitude), every piece a LupiScale node, and
 * the picture is the cut of §9 drawn with the viewer's impostors. Its own
 * route and chunk: nothing here loads on any other page.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LupiCanvas } from '../viewer/LupiCanvas';
import { detectRenderCapability } from '../renderCapability';
import { DEFAULT_ENTRY_ID, entryById, scaleCatalog, type ScaleEntry } from './catalog';
import { phiOfLambda, phiOfSlider, sliderOfPhi } from './axis';
import { rayThrough, ScaleScene, type ScaleFrameInfo } from './ScaleScene';
import { CAMERA, ScaleWorld, webBudgets, type Comfort, type Readout, type Viewport } from './world';
import { readScaleUrl, scaleUrl } from './share';
import './scale.css';

const isPhone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false) && Math.min(window.innerWidth, window.innerHeight) < 820;

const reducedMotion = () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

function initialWorld(): { world: ScaleWorld; error: string | null } {
  const aspect = typeof window === 'undefined' ? 1.6 : window.innerWidth / Math.max(1, window.innerHeight);
  const { entryId, ref } = readScaleUrl(typeof window === 'undefined' ? '' : window.location.search);
  if (ref) {
    try {
      return { world: ScaleWorld.fromRef(ref, aspect), error: null };
    } catch (e) {
      const entry = entryById(entryId) ?? entryById(DEFAULT_ENTRY_ID)!;
      return { world: ScaleWorld.fromEntry(entry, aspect), error: `That link could not be opened (${e instanceof Error ? e.message : String(e)}).` };
    }
  }
  return { world: ScaleWorld.fromEntry(entryById(entryId) ?? entryById(DEFAULT_ENTRY_ID)!, aspect), error: null };
}

interface Hud {
  readout: Readout;
  phi: number;
  canSmash: boolean;
  bodies: number;
  flying: boolean;
  atDesk: boolean;
}

function hudOf(world: ScaleWorld, viewport: Viewport): Hud {
  return {
    readout: world.readout(viewport),
    phi: world.phi(),
    canSmash: world.canSmash(),
    bodies: world.bodies.length,
    flying: world.flight !== null,
    atDesk: world.atDesk(),
  };
}

const SALT_IDS = ['salt-1e3', 'salt-1e6', 'salt-1e9', 'salt-1e30', 'googol', 'googolplex'];

export function ScaleShell() {
  const [capability] = useState(detectRenderCapability);
  const phone = useMemo(isPhone, []);
  const budgets = useMemo(() => webBudgets(phone), [phone]);
  const [{ world, error }, setState] = useState(initialWorld);
  const [comfort, setComfort] = useState<Comfort>(() => (reducedMotion() ? 'still' : 'standard'));
  const [hud, setHud] = useState<Hud | null>(null);
  const [toast, setToast] = useState<string | null>(error);
  const viewportRef = useRef<Viewport>({ heightPx: 800, aspect: 1.6 });
  const stageRef = useRef<HTMLDivElement>(null);
  const lastHud = useRef(0);

  world.comfort = comfort;

  useEffect(() => {
    document.title = `${world.entry?.title ?? world.title} | Lupi scale`;
  }, [world]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onFrame = useCallback(
    (info: ScaleFrameInfo) => {
      viewportRef.current = info.viewport;
      const now = performance.now();
      if (now - lastHud.current < 180) return;
      lastHud.current = now;
      setHud(hudOf(world, info.viewport));
    },
    [world],
  );

  const openEntry = useCallback((entry: ScaleEntry) => {
    const aspect = viewportRef.current.aspect;
    setState({ world: ScaleWorld.fromEntry(entry, aspect), error: null });
    window.history.replaceState(null, '', scaleUrl({ entryId: entry.id }));
  }, []);

  // ─── Gestures ────────────────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; t: number; moved: boolean; pinch: number | null; centroid: [number, number] | null } | null>(null);

  const rayAt = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current!;
    const rect = el.getBoundingClientRect();
    return rayThrough(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
  }, []);

  const metresPerPixel = useCallback(() => {
    const el = stageRef.current!;
    const d = Math.max(0.05, Math.hypot(...(world.focus ?? [0, 0, -CAMERA.distance])));
    return (2 * d * Math.tan(CAMERA.fovY / 2)) / Math.max(1, el.clientHeight);
  }, [world]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    world.stop();
    if (pointers.current.size === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, t: performance.now(), moved: false, pinch: null, centroid: null };
      world.focus = world.focusFor(rayAt(e.clientX, e.clientY));
    } else if (gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.centroid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      gesture.current.moved = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size >= 2 && g.pinch !== null && g.centroid) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const centroid: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const focus = world.focusFor(rayAt(centroid[0], centroid[1]));
      world.zoom(focus, dist / Math.max(1, g.pinch));
      const mpp = metresPerPixel();
      world.pan([(centroid[0] - g.centroid[0]) * mpp, -(centroid[1] - g.centroid[1]) * mpp, 0]);
      g.pinch = dist;
      g.centroid = centroid;
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 6) g.moved = true;
    if (!g.moved) return;
    if (world.atDesk() && !e.shiftKey && e.button !== 2) {
      world.orbit(world.centre(), dx * 0.008, dy * 0.008);
    } else {
      const mpp = metresPerPixel();
      world.pan([dx * mpp, -dy * mpp, 0]);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g || g.moved || performance.now() - g.t > 450) return;
    // A tap dives: into the copy tapped when the bar is smashed, else one landmark closer.
    const hit = world.pick(rayAt(e.clientX, e.clientY));
    if (!hit) return;
    if (world.bodies.length > 1) {
      world.isolate(hit.body);
      world.flyTo(world.range.phiMax, hit.point);
    } else {
      world.flyTo(world.nextLandmark(1), hit.point);
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const ratio = Math.exp(-e.deltaY * scale * 0.0015);
    world.stop();
    world.zoom(world.focusFor(rayAt(e.clientX, e.clientY)), ratio);
  };

  // Wheel events must not scroll the page under the canvas.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const block = (ev: WheelEvent) => ev.preventDefault();
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  const centreFocus = useCallback(() => world.focusFor([0, 0, -1]), [world]);

  const dive = useCallback(() => world.flyTo(world.range.phiMax, centreFocus()), [world, centreFocus]);
  const rise = useCallback(() => world.flyTo(world.range.phiMin, centreFocus()), [world, centreFocus]);

  const share = useCallback(async () => {
    const text = world.shareText(viewportRef.current);
    if (!text) {
      setToast('This piece is too intricate to keep.');
      return;
    }
    const url = `${window.location.origin}${scaleUrl({ ref: text })}`;
    try {
      if (phone && navigator.share) {
        await navigator.share({ title: 'Lupi scale', text: hud?.readout.pieceCount ?? 'A piece of the googolplex', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setToast('Link copied: it opens this piece, exactly, anywhere.');
    } catch {
      setToast('Could not copy the link.');
    }
    window.history.replaceState(null, '', scaleUrl({ ref: text }));
  }, [world, phone, hud]);

  // Keyboard: + and − zoom, arrows turn or slide, D dives, U rises, S smashes, Home resets.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      const f = centreFocus();
      if (e.key === '+' || e.key === '=') world.zoom(f, 10 ** 0.25);
      else if (e.key === '-' || e.key === '_') world.zoom(f, 10 ** -0.25);
      else if (e.key === 'd' || e.key === 'D') dive();
      else if (e.key === 'u' || e.key === 'U') rise();
      else if (e.key === 's' || e.key === 'S') world.smash();
      else if (e.key === 'Home') world.reset();
      else if (e.key.startsWith('Arrow') && !(e.target instanceof HTMLInputElement)) {
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (world.atDesk()) world.orbit(world.centre(), dx * 0.12, dy * 0.12);
        else world.pan([-dx * 0.05, dy * 0.05, 0]);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [world, centreFocus, dive, rise]);

  // ─── The slider ──────────────────────────────────────────────────
  const range = world.range;
  const sliderValue = hud ? Math.round(sliderOfPhi(hud.phi, range) * 1000) : 0;
  const onSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    world.flyTo(phiOfSlider(Number(e.target.value) / 1000, range), centreFocus());
  };
  const ticks = world.landmarks
    .map((l) => ({ ...l, pos: sliderOfPhi(phiOfLambda(l.lambda), range) }))
    .filter((t) => t.pos >= 0 && t.pos <= 1);

  const salt = SALT_IDS.map((id) => entryById(id)!).filter(Boolean);
  const diamondoids = scaleCatalog().filter((e) => e.group === 'diamondoid');
  const current = world.entry?.id ?? null;
  const currentDiamondoid = world.entry?.group === 'diamondoid' ? Number(world.entry.id.split('-')[1]) : null;

  return (
    <div className="scale-page" data-scale-entry={current ?? 'shared'}>
      <header className="scale-top">
        <a className="scale-brand" href="/" aria-label="Lupi home">
          Lupi
        </a>
        <nav className="scale-chips" aria-label="What to look at">
          {salt.map((e) => (
            <button key={e.id} type="button" className="scale-chip" aria-pressed={current === e.id} onClick={() => openEntry(e)}>
              {e.chip}
            </button>
          ))}
          <button type="button" className="scale-chip" aria-pressed={current === 'copper-billion'} onClick={() => openEntry(entryById('copper-billion')!)}>
            Copper
          </button>
          <button
            type="button"
            className="scale-chip"
            aria-pressed={currentDiamondoid !== null}
            onClick={() => openEntry(diamondoids[(currentDiamondoid ?? 0) % diamondoids.length])}
            title="Diamondoids: hydrogen-capped diamond, one size larger each tap"
          >
            {currentDiamondoid ? `Diamondoid ${currentDiamondoid}` : 'Diamondoids'}
          </button>
        </nav>
      </header>

      <div
        ref={stageRef}
        className="scale-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <LupiCanvas
          id="lupi-scale-canvas"
          capability={capability}
          frameloop="demand"
          camera={{ position: [0, 0, 0], rotation: [0, 0, 0], fov: (CAMERA.fovY * 180) / Math.PI, near: 0.004, far: 80 }}
          dpr={phone ? [1, 2] : [1, 2]}
          background="#101817"
        >
          <ScaleScene world={world} budgets={budgets} quality={phone ? 1 : 2} onFrame={onFrame} />
        </LupiCanvas>
      </div>

      <section className="scale-hud" aria-live="polite">
        <div className="scale-readout">
          <p className="scale-title">{hud?.readout.title ?? world.title}</p>
          <p className="scale-count" data-testid="scale-count">
            {hud?.readout.count ?? ''}
          </p>
          <p className="scale-piece">
            In view: <strong>{hud?.readout.pieceCount ?? ''}</strong>
            <span className="scale-formula">{hud?.readout.pieceFormula ?? ''}</span>
          </p>
          <p className="scale-mag">{hud?.readout.magnification ?? ''}</p>
          <p className="scale-drawn">{hud?.readout.drawn ?? ''}</p>
        </div>

        <div className="scale-axis">
          <input
            className="scale-slider"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={sliderValue}
            onChange={onSlider}
            aria-label="Scale"
            aria-valuetext={hud?.readout.magnification ?? undefined}
          />
          <div className="scale-ticks" aria-hidden="true">
            {ticks.map((t) => (
              <button
                key={t.label}
                type="button"
                tabIndex={-1}
                className="scale-tick"
                style={{ '--pos': t.pos } as CSSProperties}
                onClick={() => world.flyTo(phiOfLambda(t.lambda), centreFocus())}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="scale-actions">
          <button type="button" className="scale-button scale-primary" onClick={dive}>
            Dive to the atoms
          </button>
          <button type="button" className="scale-button" onClick={rise}>
            Rise
          </button>
          {hud?.canSmash && (
            <button type="button" className="scale-button" onClick={() => world.smash()}>
              Smash
            </button>
          )}
          {hud && hud.bodies > 1 && <span className="scale-hint">Tap a piece to dive into it</span>}
          <button type="button" className="scale-button" onClick={() => world.reset()}>
            Reset
          </button>
          <button type="button" className="scale-button" onClick={share}>
            Share
          </button>
          <button
            type="button"
            className="scale-button scale-comfort"
            onClick={() => setComfort((c) => (c === 'standard' ? 'gentle' : c === 'gentle' ? 'still' : 'standard'))}
            title="Motion: Standard, Gentle or Still"
          >
            {comfort === 'standard' ? 'Motion: Standard' : comfort === 'gentle' ? 'Motion: Gentle' : 'Motion: Still'}
          </button>
        </div>
        <p className="scale-blurb">{world.entry?.blurb ?? ''}</p>
      </section>
      {toast && (
        <div className="scale-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

export default ScaleShell;
