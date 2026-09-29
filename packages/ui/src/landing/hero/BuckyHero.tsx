import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LandingIntentContext } from '../landingIntent';
import { openLocalMolecule } from '../MoleculeFinder';
import { setBaton } from '../../relay/baton';
import { createBuckyStage, type BuckyStage } from './buckyStage';
import './hero.css';

const GALLERY_ID = 'c60_buckyball';
/** The first spin this far (or a hover dwell) is intent: warm the viewer chunks, once. */
const PREFETCH_SPIN_DEG = 30;
const HOVER_DWELL_MS = 150;
const FLASH_MS = 1400;
const LABEL = 'Buckyball, C60. Drag or use the arrow keys to turn; press Enter to open it in 3D.';

type Face = 'Hexagon' | 'Pentagon';

/** A small outline of the face the ball clicked onto. */
function FaceMark({ face }: { face: Face }) {
  const sides = face === 'Hexagon' ? 6 : 5;
  const points = Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    return `${(7 + 5.6 * Math.cos(a)).toFixed(2)},${(7 + 5.6 * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  return (
    <svg className="bucky-hero__face" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">
      <polygon points={points} />
    </svg>
  );
}

/**
 * The home page's ink buckyball: still until touched. A drag spins it, a
 * release clicks it onto a hexagon or pentagon and names the face, and a tap
 * (or Enter/Space) opens C60 in the 3D viewer, handing over the pose and spin
 * the visitor left on it. Pure DOM/SVG: the landing page keeps zero canvases.
 */
export function BuckyHero() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<BuckyStage | null>(null);
  const intent = useContext(LandingIntentContext);
  const intentRef = useRef(intent);
  intentRef.current = intent;
  const prefetched = useRef(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashCount = useRef(0);
  const openingRef = useRef(false);
  const [flash, setFlash] = useState<{ face: Face; n: number } | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const flashOnRef = useRef(false);
  const [opening, setOpening] = useState(false);

  const prefetch = useCallback(() => {
    if (prefetched.current) return;
    prefetched.current = true;
    intentRef.current.prefetchViewer();
  }, []);

  const open = useCallback(() => {
    const host = hostRef.current;
    const stage = stageRef.current;
    if (!host || !stage || openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setBaton({
      galleryId: GALLERY_ID,
      source: 'hero',
      viewDir: stage.viewDir(),
      bodyOmegaY: stage.getBodyOmegaY(),
      t: performance.now(),
    });
    openLocalMolecule(GALLERY_ID, { source: 'hero', fromRect: host.getBoundingClientRect() })
      .catch(() => undefined) // the store carries the readable error
      .finally(() => {
        openingRef.current = false;
        setOpening(false);
      });
  }, []);

  const showFace = useCallback((label: string) => {
    if (label !== 'Hexagon' && label !== 'Pentagon') return;
    flashCount.current += 1;
    setFlash({ face: label, n: flashCount.current });
    flashOnRef.current = true;
    setFlashOn(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      flashOnRef.current = false;
      setFlashOn(false);
    }, FLASH_MS);
  }, []);

  /** A new turn by hand retires the last face name, so the next one reads fresh. */
  const onSpin = useCallback(
    (total: number) => {
      if (flashOnRef.current) {
        flashOnRef.current = false;
        if (flashTimer.current) clearTimeout(flashTimer.current);
        setFlashOn(false);
      }
      if (total >= PREFETCH_SPIN_DEG) prefetch();
    },
    [prefetch],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = createBuckyStage(host, {
      size: 300,
      interactive: true,
      onTap: open,
      onDetent: showFace,
      onSpinDegrees: onSpin,
    });
    stageRef.current = stage;
    return () => {
      stage.destroy();
      stageRef.current = null;
    };
  }, [open, onSpin, showFace]);

  useEffect(
    () => () => {
      if (dwellTimer.current) clearTimeout(dwellTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const onPointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse' || prefetched.current) return;
    dwellTimer.current = setTimeout(prefetch, HOVER_DWELL_MS);
  };
  const onPointerLeave = () => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
  };

  return (
    <figure className="bucky-hero" data-opening={opening || undefined}>
      <div
        ref={hostRef}
        className="bucky-hero__stage"
        role="button"
        tabIndex={0}
        aria-label={LABEL}
        aria-busy={opening || undefined}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      />
      <figcaption className="bucky-hero__caption">
        <span className="bucky-hero__slot">
          <span className="bucky-hero__name" data-hidden={flashOn || opening || undefined}>
            C<sub>60</sub>
          </span>
          <span className="bucky-hero__flash" data-on={(flashOn && !opening) || undefined} aria-hidden="true">
            {flash && (
              <>
                <FaceMark face={flash.face} />
                {flash.face}
              </>
            )}
          </span>
          <span className="bucky-hero__flash" data-on={opening || undefined} aria-hidden="true">
            Opening…
          </span>
        </span>
        <span className="bucky-hero__spin" aria-hidden="true">
          ↻
        </span>
      </figcaption>
      <span className="bucky-hero__live" role="status" aria-live="polite">
        {flash ? `${flash.face}${flash.n % 2 ? '' : ' '}` : ''}
      </span>
    </figure>
  );
}
