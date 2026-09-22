import { useEffect, useRef, useState } from 'react';
import type { ColouredPoints, Gist, Volume } from '@atlas/core/gist';
import type { GistParticles } from './gistParticles';
import type { PhotoPixels } from './gistEngine';
import type { ScanSwirl } from '../swirl';

/**
 * The stage over the photo. Particles whirl while the edge looks, flow onto
 * the gist the moment it lands, and keep shimmering on it while Jev sculpts.
 * The photo dims behind them so the shape reads on its own, and a label
 * sits on top with everything the intelligence claims, marked as inference.
 *
 * Renderer chain: vgpu particles → the fragment-only swirl → CSS ring.
 */
export type StageRenderer = 'pending' | 'particles' | 'swirl' | 'css';

export interface StageLabel {
  text: string;
  confidence: number;
  /** Jev's latest likeness for the shape, 0..1, or null before the first judgment. */
  likeness: number | null;
  judgments: number;
  lastMove: string | null;
  sculpting: boolean;
  model?: string;
}

export interface GistStageProps {
  photoUrl: string | null;
  photoWidth?: number;
  photoHeight?: number;
  /** The photo's pixels; when given, the particles are born as the photo and carry its colours. */
  photoPixels?: PhotoPixels | null;
  /** A reconstructed object's coloured points: every particle flies to one, bottom up. */
  points?: ColouredPoints | null;
  /** Camera orbit rate, radians per second; 0 holds the photo's own view. */
  spin?: number;
  /** True while a scan is in flight: the swirl runs and the photo dims. */
  active: boolean;
  /** The shape to settle onto; null keeps whirling. */
  gist: Gist | null;
  /** The photo's own silhouette inflated; when given, this is the shape and `gist` only supplies the label. */
  volume?: Volume | null;
  /** Colours for the particles that wear the palette; with a volume, the object's own. */
  palette?: [string, string] | null;
  /** True once the result is on screen; the photo fades further so the shape owns the stage. */
  settled: boolean;
  status: { line: string; elapsedMs: number } | null;
  label: StageLabel | null;
  onRenderer?: (renderer: StageRenderer) => void;
}

const MOVE_WORDS: Record<string, string> = {
  flatten: 'flattened it',
  stretch: 'stretched it',
  widen: 'widened it',
  slim: 'slimmed it',
  soften: 'softened the joins',
  sharpen: 'sharpened the joins',
  'add-stem': 'added a stem',
  'add-handle': 'added a handle',
  'add-base': 'added a base',
  dimple: 'pressed a dimple in',
  hollow: 'hollowed it out',
  keep: 'kept it',
};

export function moveWords(move: string | null): string {
  if (!move) return '';
  if (MOVE_WORDS[move]) return MOVE_WORDS[move];
  if (move.startsWith('remove-')) return `removed the ${move.slice('remove-'.length)}`;
  return move;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function GistStage({ photoUrl, photoWidth, photoHeight, photoPixels = null, points = null, spin = 0, active, gist, volume = null, palette = null, settled, status, label, onRenderer }: GistStageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const particles = useRef<GistParticles | null>(null);
  const swirl = useRef<ScanSwirl | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const [renderer, setRendererState] = useState<StageRenderer>('pending');
  const rendererRef = useRef<StageRenderer>('pending');
  const setRenderer = (next: StageRenderer) => {
    rendererRef.current = next;
    setRendererState(next);
    onRenderer?.(next);
  };
  const latest = useRef({ active, gist, volume, palette, settled, points, spin });
  latest.current = { active, gist, volume, palette, settled, points, spin };
  const seededPhoto = useRef<PhotoPixels | null>(null);
  const homedPoints = useRef<ColouredPoints | null>(null);

  const apply = () => {
    const { active: isActive, gist: shape, volume: field, palette: colours, settled: isSettled, points: cloud, spin: rate } = latest.current;
    const engine = particles.current;
    if (engine) {
      const hasShape = Boolean(field || shape || cloud);
      engine.setFade(isActive || hasShape ? 1 : 0);
      // With a volume the photo's silhouette is the shape; the gist's primitives only stand in without one.
      engine.setVolume(field);
      engine.setGist(field ? null : shape);
      if (colours) engine.setPalette(colours[0], colours[1]);
      // The reconstruction's points, once, when they arrive or go.
      if (homedPoints.current !== cloud) {
        homedPoints.current = cloud;
        engine.setHomes(cloud);
      }
      engine.setSpin(rate);
      engine.setAttract(hasShape ? 1 : 0);
      engine.setEnergy(hasShape ? (isSettled ? 0.08 : 0.2) : isActive ? 1 : 0);
      return;
    }
    const ring = swirl.current;
    if (ring) {
      if (isActive && !isSettled) ring.setEnergy(1);
      else ring.reveal();
    }
  };

  const ensure = () => {
    if (particles.current || swirl.current || pending.current) return;
    const node = canvas.current;
    if (!node) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('gpu' in navigator)) {
      setRenderer('css');
      return;
    }
    const fallbackToSwirl = () =>
      import('../swirl')
        .then(({ createScanSwirl }) => createScanSwirl(node, () => {
          swirl.current = null;
          setRenderer('css');
        }))
        .then((instance) => {
          swirl.current = instance;
          setRenderer('swirl');
          apply();
        })
        .catch(() => setRenderer('css'));
    seededPhoto.current = photoPixels;
    pending.current = import('./gistParticles')
      .then(({ createGistParticles }) => createGistParticles(node, () => {
        particles.current = null;
        setRenderer('css');
      }, photoPixels))
      .then((instance) => {
        particles.current = instance;
        setRenderer('particles');
        apply();
      })
      .catch(fallbackToSwirl)
      .finally(() => {
        pending.current = null;
      });
  };

  useEffect(() => {
    if (active || gist || volume) ensure();
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply` reads the latest props through a ref.
  }, [active, gist, volume, palette, settled, points, spin]);

  // A new photo (a rescan, a different picture) reseeds the particles as that photo.
  useEffect(() => {
    if (!particles.current || seededPhoto.current === photoPixels) return;
    seededPhoto.current = photoPixels;
    particles.current.setPhoto(photoPixels);
  }, [photoPixels]);

  useEffect(
    () => () => {
      particles.current?.dispose();
      particles.current = null;
      swirl.current?.dispose();
      swirl.current = null;
    },
    [],
  );

  const dimmed = active || gist !== null || volume !== null;
  return (
    <div
      className={`scan-stage gist-stage${active ? ' is-scanning' : ''}${gist || volume ? ' has-gist' : ''}${settled ? ' is-done' : ''}`}
      data-renderer={renderer}
    >
      {photoUrl ? (
        <img className={`scan-photo${dimmed ? ' is-dimmed' : ''}`} src={photoUrl} alt="" width={photoWidth} height={photoHeight} />
      ) : (
        <div className="scan-photo scan-photo--empty" aria-hidden="true" />
      )}
      <canvas ref={canvas} className="scan-swirl" aria-hidden="true" />
      {status && (
        <div className="scan-status" role="status">
          <strong>{status.line}</strong>
          <span>{formatMs(status.elapsedMs)}</span>
        </div>
      )}
      {label && (
        <div className="gist-label" aria-live="polite">
          <p className="student-eyebrow">
            Looks like <span className="scan-inference">inferred · {Math.round(label.confidence * 100)}%</span>
          </p>
          <strong className="gist-label-text">{label.text}</strong>
          <div className="gist-likeness" aria-label={label.likeness === null ? 'Jev has not rated the shape yet' : `Jev rates the likeness ${Math.round(label.likeness * 100)}%`}>
            <span className="gist-likeness-bar" style={{ ['--share' as string]: label.likeness ?? 0 }} aria-hidden="true" />
            <span>
              {label.likeness === null
                ? label.sculpting
                  ? 'Jev is looking…'
                  : 'Jev did not rate it'
                : `reads as ${label.text} · ${Math.round(label.likeness * 100)}% · inferred`}
            </span>
          </div>
          <small>
            {label.judgments > 0 ? `Jev · ${label.judgments} judgment${label.judgments === 1 ? '' : 's'}` : label.sculpting ? 'Jev · sculpting' : 'Jev · off'}
            {label.lastMove ? ` · ${moveWords(label.lastMove)}` : ''}
            {label.sculpting ? ' …' : ''}
          </small>
        </div>
      )}
    </div>
  );
}
