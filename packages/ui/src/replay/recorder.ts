/**
 * recorder.ts — the last 20 seconds, always: Instant Replay's ring buffer.
 *
 * While the viewer is open the recorder keeps, in memory only:
 * - the camera pose of every drawn frame in which it changed (orientation,
 *   distance and target, as the rig left them). Quiet Idle draws nothing at
 *   rest, so when motion starts after a pause the recorder first writes the
 *   resting pose again just before the change: the replay then holds still
 *   for exactly as long as the sender did;
 * - the toy inputs (PlayLayer's toy events) and the pill's flashes.
 *
 * Nothing leaves the page until the visitor taps Replay. While a replay plays
 * (a shared link, or a clip being made) the recorder pauses: the replayed
 * moment must not become a new moment.
 */
import type { Vec3 } from '../camera/rigApi';
import type { Quat, TapeEvent, TapeKey } from './tape';

/** How much the ring keeps (s). */
export const RECORDER_SECONDS = 20;
/** A camera change after a gap longer than this re-writes the resting pose first (s). */
const HOLD_GAP_S = 0.05;

export interface RecordedPose extends TapeKey {
  /** Seconds on the recorder clock (performance.now() / 1000). */
  t: number;
}

/** A toy input or flash, on the recorder clock, without the tape's relative time. */
export type RecordedEvent = TapeEvent;

const poses: RecordedPose[] = [];
const events: RecordedEvent[] = [];
let pausedBy = 0;

export function recorderNow(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

function trim(now: number): void {
  const horizon = now - RECORDER_SECONDS;
  let drop = 0;
  // Keep one pose older than the horizon: the pose in force at its start.
  while (drop < poses.length - 1 && poses[drop + 1].t < horizon) drop += 1;
  if (drop > 0) poses.splice(0, drop);
  let dropEvents = 0;
  while (dropEvents < events.length && events[dropEvents].t < horizon) dropEvents += 1;
  if (dropEvents > 0) events.splice(0, dropEvents);
}

function samePose(a: RecordedPose, q: Quat, d: number, target: Vec3): boolean {
  return (
    Math.abs(a.q[0] - q[0]) < 1e-7 &&
    Math.abs(a.q[1] - q[1]) < 1e-7 &&
    Math.abs(a.q[2] - q[2]) < 1e-7 &&
    Math.abs(a.q[3] - q[3]) < 1e-7 &&
    Math.abs(a.d - d) <= 1e-7 * Math.max(1, d) &&
    Math.abs(a.target[0] - target[0]) < 1e-7 &&
    Math.abs(a.target[1] - target[1]) < 1e-7 &&
    Math.abs(a.target[2] - target[2]) < 1e-7
  );
}

/** True while a replay plays (nothing is recorded). */
export function isRecorderPaused(): boolean {
  return pausedBy > 0;
}

/** Pause recording; returns the resume (idempotent). */
export function pauseRecorder(): () => void {
  pausedBy += 1;
  let resumed = false;
  return () => {
    if (resumed) return;
    resumed = true;
    pausedBy = Math.max(0, pausedBy - 1);
    // A replay moved the camera: the next pose starts a fresh hold.
    lastFrameAt = -Infinity;
  };
}

let lastFrameAt = -Infinity;

/**
 * One drawn frame's camera (call after the rig has moved it). `frameDt` is
 * the frame's own delta (s), used to place the resting pose before a change.
 */
export function recordPose(t: number, q: Quat, d: number, target: Vec3, frameDt: number): void {
  if (pausedBy > 0 || !Number.isFinite(d) || !(d > 0)) return;
  const last = poses[poses.length - 1];
  const previousFrame = lastFrameAt;
  lastFrameAt = t;
  if (last && samePose(last, q, d, target)) return;
  if (last) {
    const dt = Math.min(Math.max(Number.isFinite(frameDt) ? frameDt : 1 / 60, 1 / 240), 1 / 20);
    // The camera rested since `last`: frames were drawn without a change (a
    // toy moving, a hover), or Quiet Idle drew nothing at all. Hold the last
    // pose until just before this change.
    let holdUntil = -Infinity;
    if (last.t < previousFrame - 1e-6) holdUntil = previousFrame;
    if (t - previousFrame > Math.max(2.5 * dt, HOLD_GAP_S)) holdUntil = Math.max(holdUntil, t - dt);
    if (holdUntil > last.t + 1e-4 && holdUntil < t) {
      poses.push({ t: holdUntil, q: [...last.q] as Quat, d: last.d, target: [...last.target] as Vec3 });
    }
  }
  poses.push({ t, q: [q[0], q[1], q[2], q[3]], d, target: [target[0], target[1], target[2]] });
  trim(t);
}

export function recordEvent(event: RecordedEvent): void {
  if (pausedBy > 0) return;
  events.push(event);
  trim(event.t);
}

/** Forget everything (a new molecule). */
export function clearRecorder(): void {
  poses.length = 0;
  events.length = 0;
  lastFrameAt = -Infinity;
}

/** The most recent pose, or null. */
export function lastRecordedPose(): RecordedPose | null {
  return poses[poses.length - 1] ?? null;
}

function slerp(a: Quat, b: Quat, s: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let wa: number;
  let wb: number;
  if (dot > 0.9995) {
    wa = 1 - s;
    wb = s * sign;
  } else {
    const theta = Math.acos(Math.min(1, dot));
    const sin = Math.sin(theta);
    wa = Math.sin((1 - s) * theta) / sin;
    wb = (Math.sin(s * theta) / sin) * sign;
  }
  const q: Quat = [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** The recorded pose at time t (between frames, interpolated; before the first, the first). */
export function poseAt(t: number): RecordedPose | null {
  if (poses.length === 0) return null;
  if (t <= poses[0].t) return { ...poses[0], t };
  const last = poses[poses.length - 1];
  if (t >= last.t) return { ...last, t };
  let lo = 0;
  let hi = poses.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (poses[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = poses[lo];
  const b = poses[hi];
  const s = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return {
    t,
    q: slerp(a.q, b.q, s),
    d: Math.exp(Math.log(a.d) + (Math.log(b.d) - Math.log(a.d)) * s),
    target: [
      a.target[0] + (b.target[0] - a.target[0]) * s,
      a.target[1] + (b.target[1] - a.target[1]) * s,
      a.target[2] + (b.target[2] - a.target[2]) * s,
    ],
  };
}

/** Total camera rotation (rad) between two times: how far the view turned. */
export function turnedBetween(t0: number, t1: number): number {
  let total = 0;
  let previous: Quat | null = null;
  for (const pose of poses) {
    if (pose.t < t0) {
      previous = pose.q;
      continue;
    }
    if (pose.t > t1) break;
    if (previous) {
      const dot = Math.abs(previous[0] * pose.q[0] + previous[1] * pose.q[1] + previous[2] * pose.q[2] + previous[3] * pose.q[3]);
      total += 2 * Math.acos(Math.min(1, dot));
    }
    previous = pose.q;
  }
  return total;
}

/** True when the camera changed at all between two times. */
export function cameraMovedBetween(t0: number, t1: number): boolean {
  const first = poseAt(t0);
  for (const pose of poses) {
    if (pose.t <= t0) continue;
    if (pose.t > t1) break;
    if (first && !samePose(first, pose.q, pose.d, pose.target)) return true;
  }
  return false;
}

export interface RecordedWindow {
  /** Poses relative to t0 (the first at 0, the last at t1 − t0). */
  poses: TapeKey[];
  /** Events relative to t0. */
  events: TapeEvent[];
  duration: number;
}

/** The poses and events of [t0, t1], times relative to t0. */
export function recordedWindow(t0: number, t1: number): RecordedWindow | null {
  const start = poseAt(t0);
  if (!start || !(t1 > t0)) return null;
  const out: TapeKey[] = [{ t: 0, q: start.q, d: start.d, target: start.target }];
  for (const pose of poses) {
    if (pose.t <= t0) continue;
    if (pose.t >= t1) break;
    out.push({ t: pose.t - t0, q: [...pose.q] as Quat, d: pose.d, target: [...pose.target] as Vec3 });
  }
  const end = poseAt(t1);
  if (end) out.push({ t: t1 - t0, q: end.q, d: end.d, target: end.target });
  const inWindow: TapeEvent[] = [];
  for (const event of events) {
    if (event.t < t0 || event.t > t1) continue;
    inWindow.push({ ...event, t: event.t - t0 } as TapeEvent);
  }
  return { poses: out, events: inWindow, duration: t1 - t0 };
}

/** Events since a time (the moment detector's view of what just happened). */
export function eventsSince(t0: number): readonly RecordedEvent[] {
  return events.filter((event) => event.t >= t0);
}
