/**
 * captureGuards.ts — keep toys out of every capture.
 *
 * Display-only motion (arrival, ripple, scatter) and an in-flight camera coast
 * must never reach an export, thumbnail, video or MCP artifact. Instead of
 * teaching every capture path about every toy, toys register guards here and
 * the capture paths call in:
 *
 * - `runPrepareCapture()` runs once before a capture reads any camera or
 *   scene state (ExportManager before `applyCanonicalState`, the viewer
 *   capture service before it builds its context). The camera rig settles
 *   and re-levels here.
 * - `beginCaptureRender()` runs inside `renderSceneToPixels`, right before
 *   `renderer.render`; the returned restore runs in its `finally`, LIFO.
 *   Display motion zeroes its master weight here (the uniforms job would
 *   overwrite anything done earlier in the frame).
 * - `beginRecording()` brackets a video recording (the rig suspends, display
 *   motion is suspended); the returned restore runs when recording ends.
 *   An illustrative recording (`{ illustrative: true }`, Instant Replay's
 *   clip, labelled "Illustrative" in its frames) keeps display motion live:
 *   it is a picture of the toys, never an artifact.
 *
 * One throwing guard is logged and never stops the others or the capture.
 * Contract file: additive edits only.
 */

export interface CaptureGuard {
  /** Before a capture reads camera or scene state (may write the camera and store). */
  prepare?(): void;
  /** Right before the capture render; returns the restore. */
  begin?(): () => void;
}

/** What kind of recording is starting. */
export interface RecordingOptions {
  /**
   * An illustrative clip (Instant Replay): display motion keeps playing.
   * Artifact and ordinary video exports leave this unset.
   */
  illustrative?: boolean;
}

export type RecordingGuard = (options: RecordingOptions) => () => void;

const guards: CaptureGuard[] = [];
const recordingGuards: RecordingGuard[] = [];

function report(what: string, error: unknown): void {
  console.error(`[lupi] capture guard ${what} threw`, error);
}

function removeFrom<T>(list: T[], item: T): void {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
}

/** Register a guard; returns the unregister. */
export function registerCaptureGuard(guard: CaptureGuard): () => void {
  guards.push(guard);
  return () => removeFrom(guards, guard);
}

/** Every guard's `prepare`, in registration order. */
export function runPrepareCapture(): void {
  for (const guard of guards.slice()) {
    if (!guard.prepare) continue;
    try {
      guard.prepare();
    } catch (error) {
      report('prepare', error);
    }
  }
}

function runRestores(restores: Array<() => void>, what: string): void {
  for (let i = restores.length - 1; i >= 0; i -= 1) {
    try {
      restores[i]();
    } catch (error) {
      report(what, error);
    }
  }
}

/** Every guard's `begin`, in registration order; the returned restore runs them back LIFO, once. */
export function beginCaptureRender(): () => void {
  const restores: Array<() => void> = [];
  for (const guard of guards.slice()) {
    if (!guard.begin) continue;
    try {
      const restore = guard.begin();
      if (typeof restore === 'function') restores.push(restore);
    } catch (error) {
      report('begin', error);
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    runRestores(restores, 'restore');
  };
}

/** Register a recording guard: `start` runs when a recording begins and returns its stop. */
export function registerRecordingGuard(start: RecordingGuard): () => void {
  recordingGuards.push(start);
  return () => removeFrom(recordingGuards, start);
}

/** Start every recording guard; the returned stop runs them back LIFO, once. */
export function beginRecording(options: RecordingOptions = {}): () => void {
  const stops: Array<() => void> = [];
  const frozen: RecordingOptions = { ...options };
  for (const start of recordingGuards.slice()) {
    try {
      const stop = start(frozen);
      if (typeof stop === 'function') stops.push(stop);
    } catch (error) {
      report('recording start', error);
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    runRestores(stops, 'recording stop');
  };
}

/**
 * Render-target property a capture sets to its supersampling factor (target
 * texels per output pixel on each side; renderTargetReadback). Layers drawn
 * as 1-texel lines read it in `onBeforeRender` so their exported weight does
 * not thin out with the factor.
 */
export const CAPTURE_TEXEL_SCALE_KEY = 'lupiCaptureTexelScale';

/** The capture texel scale of a render target, or null outside a capture. */
export function captureTexelScale(target: unknown): number | null {
  if (!target || typeof target !== 'object') return null;
  const scale = (target as Record<string, unknown>)[CAPTURE_TEXEL_SCALE_KEY];
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : null;
}
