import { useEffect, useRef, useState } from 'react';
import type { Gist } from '@atlas/core/gist';
import type { GistParticles } from './gistParticles';
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
  /** True while a scan is in flight: the swirl runs and the photo dims. */
  active: boolean;
  /** The shape to settle onto; null keeps whirling. */
  gist: Gist | null;
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

export function GistStage({ photoUrl, photoWidth, photoHeight, active, gist, settled, status, label, onRenderer }: GistStageProps) {
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
  const latest = useRef({ active, gist, settled });
  latest.current = { active, gist, settled };

  const apply = () => {
    const { active: isActive, gist: shape, settled: isSettled } = latest.current;
    const engine = particles.current;
    if (engine) {
      engine.setFade(isActive || shape ? 1 : 0);
      engine.setGist(shape);
      engine.setAttract(shape ? 1 : 0);
      engine.setEnergy(shape ? (isSettled ? 0.08 : 0.2) : isActive ? 1 : 0);
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
    pending.current = import('./gistParticles')
      .then(({ createGistParticles }) => createGistParticles(node, () => {
        particles.current = null;
        setRenderer('css');
      }))
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
    if (active || gist) ensure();
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `apply` reads the latest props through a ref.
  }, [active, gist, settled]);

  useEffect(
    () => () => {
      particles.current?.dispose();
      particles.current = null;
      swirl.current?.dispose();
      swirl.current = null;
    },
    [],
  );

  const dimmed = active || gist !== null;
  return (
    <div
      className={`scan-stage gist-stage${active ? ' is-scanning' : ''}${gist ? ' has-gist' : ''}${settled ? ' is-done' : ''}`}
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
