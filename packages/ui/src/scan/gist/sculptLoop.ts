import { applyMove, decideSculpt, type Gist, type SculptMemory } from '@atlas/core/gist';
import { requestSculpt } from './gistClient';

/**
 * The fast loop. Fire a sculpt judgment every `cadenceMs`, keep up to
 * `inFlight` in the air, apply a chosen move the moment it lands, and stop
 * when Jev says keep twice in a row, when the budget is spent, or when the
 * caller stops it. A judgment made against a shape that has since changed
 * is dropped: it was about the old shape.
 *
 * Every applied move is reported with its confidence and the likeness Jev
 * gave the shape it judged, so the page can show the sculpting as it
 * happens and the dev panel can list it afterwards.
 */
export interface SculptEvent {
  /** Sequence number of the judgment, 1-based. */
  call: number;
  move: string;
  confidence: number;
  likeness: number | null;
  /** Distance between the shape's profile and the photo's at judgment time, when a photo profile was sent. */
  mismatch: number | null;
  applied: boolean;
  ms: number;
  model?: string;
}

export interface SculptLoopOptions {
  subject: string;
  gist: Gist;
  /** The photo's silhouette profile; with it, proportion moves are measured rather than guessed. */
  photoProfile?: number[] | null;
  onGist: (gist: Gist, event: SculptEvent) => void;
  onEvent?: (event: SculptEvent) => void;
  onDone?: (reason: 'satisfied' | 'budget' | 'stopped' | 'unconfigured' | 'failed') => void;
  cadenceMs?: number;
  inFlight?: number;
  maxCalls?: number;
  maxMs?: number;
  /** Apply a move at or above this confidence without waiting for a second vote. */
  minConfidence?: number;
}

export interface SculptLoopHandle {
  stop(): void;
  readonly calls: number;
}

export const SCULPT_DEFAULTS = { cadenceMs: 120, inFlight: 2, maxCalls: 24, maxMs: 6_000, minConfidence: 0.45 } as const;

export function startSculptLoop(options: SculptLoopOptions): SculptLoopHandle {
  const cadenceMs = options.cadenceMs ?? SCULPT_DEFAULTS.cadenceMs;
  const inFlight = options.inFlight ?? SCULPT_DEFAULTS.inFlight;
  const maxCalls = options.maxCalls ?? SCULPT_DEFAULTS.maxCalls;
  const maxMs = options.maxMs ?? SCULPT_DEFAULTS.maxMs;
  const minConfidence = options.minConfidence ?? SCULPT_DEFAULTS.minConfidence;
  const controller = new AbortController();
  const started = performance.now();
  let gist = options.gist;
  let version = 0;
  let pending = 0;
  let calls = 0;
  let memory: SculptMemory = { lastMove: null, keeps: 0 };
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const finish = (reason: Parameters<NonNullable<SculptLoopOptions['onDone']>>[0]) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    options.onDone?.(reason);
  };

  const fire = async () => {
    if (stopped) return;
    if (calls >= maxCalls) {
      if (pending === 0) finish('budget');
      return;
    }
    if (performance.now() - started > maxMs) {
      if (pending === 0) finish('budget');
      return;
    }
    if (pending >= inFlight) return;
    const judgedVersion = version;
    const judged = gist;
    const call = (calls += 1);
    pending += 1;
    const sent = performance.now();
    const reply = await requestSculpt(options.subject, judged, options.photoProfile ?? null, controller.signal);
    pending -= 1;
    if (stopped) return;
    const ms = performance.now() - sent;
    if (reply?.configured === false) {
      finish('unconfigured');
      return;
    }
    if (!reply?.move) {
      failures += 1;
      if (failures >= 3) finish('failed');
      return;
    }
    failures = 0;
    const event: SculptEvent = {
      call,
      move: reply.move.id,
      confidence: reply.move.confidence,
      likeness: typeof reply.likeness === 'number' ? reply.likeness : null,
      mismatch: typeof reply.mismatch === 'number' ? reply.mismatch : null,
      applied: false,
      ms,
      model: reply.model,
    };
    const stale = judgedVersion !== version;
    if (stale) {
      // About a shape that has since changed; worth logging, never acting on.
      options.onEvent?.(event);
      return;
    }
    const verdict = decideSculpt({ move: reply.move, likeness: event.likeness, mismatch: event.mismatch }, memory, minConfidence);
    memory = verdict.memory;
    if (verdict.apply) {
      const next = applyMove(gist, verdict.apply, verdict.strength);
      if (next) {
        gist = next;
        version += 1;
        event.applied = true;
        options.onGist(gist, event);
      }
    }
    options.onEvent?.(event);
    if (verdict.satisfied) finish('satisfied');
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void fire();
      if (calls < maxCalls && performance.now() - started <= maxMs) schedule();
      else if (pending === 0) finish('budget');
      else {
        // Let the last answers land, then close.
        const settle = setInterval(() => {
          if (stopped) return clearInterval(settle);
          if (pending === 0) {
            clearInterval(settle);
            finish('budget');
          }
        }, 100);
      }
    }, cadenceMs);
  };

  void fire();
  schedule();

  return {
    stop: () => finish('stopped'),
    get calls() {
      return calls;
    },
  };
}
