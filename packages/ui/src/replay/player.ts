/**
 * player.ts — plays a tape: the camera along its keys, the toys and the
 * pill's flashes at their times.
 *
 * The same player runs a shared replay live in the receiver's view and
 * drives the sender's 9:16 clip. It writes the camera object directly (the
 * camera rig adopts the pose each frame, as it adopts any external write)
 * and the rig's target; it never writes the viewer store while it plays.
 *
 * Framing: a tape plays at the sender's angles and distances, scaled by one
 * constant so the molecule fits a narrower screen than the sender's (a
 * desktop moment on a phone, or the 9:16 clip) and so a different field of
 * view shows the molecule at the same size.
 */
import { PerspectiveCamera, Quaternion, Vector3, type Camera } from 'three';
import type { Vec3 } from '../camera/rigApi';
import { cue } from '../play/feedback';
import { playStore } from '../play/playStore';
import { getToyReplaySink, type ToyEvent } from '../play/toyTape';
import { CLIP_FLASH_MS } from './clipSchedule';
import { buildCurve, createPoseSample, samplePose, type KeyCurve, type PoseSample } from './keyframes';
import type { Tape, TapeEvent } from './tape';

/** How long a replayed flash shows (ms), as the live ones do (the offline clip draws them for as long). */
const FLASH_MS = CLIP_FLASH_MS;
/** The molecule's bounding sphere fills at most this much of the narrow side. */
const FIT_MARGIN = 1.08;
/** A replay never zooms out more than this to fit a narrower screen… */
const MAX_REFRAME = 2.4;
/** …nor in more than this on a wider one. */
const MIN_REFRAME = 0.45;

export interface ReplayFraming {
  /** Molecule centre and bounding radius (world). */
  center: Vec3;
  radius: number;
  /** The playing view's vertical FOV (degrees) and aspect (width / height). */
  fov: number;
  aspect: number;
}

/**
 * The one distance scale for a tape on another screen. The sender framed the
 * molecule against the narrower of their width and height; the replay keeps
 * that framing against this screen's narrower side: a phone moment on a
 * desktop moves in (the molecule fills the height as it filled the phone's
 * width), a desktop moment on a phone or in the 9:16 clip moves out, but only
 * as far as the molecule needs to fit. A different FOV keeps the same
 * apparent size.
 */
export function reframeScale(tape: Tape, framing: ReplayFraming): number {
  const deg = Math.PI / 180;
  const tanSender = Math.tan((Math.max(1, tape.fov) * deg) / 2);
  const tanHere = Math.tan((Math.max(1, framing.fov) * deg) / 2);
  // The same apparent size under a different vertical FOV.
  const fovScale = tanHere > 1e-6 ? tanSender / tanHere : 1;
  const aspect = Math.max(0.2, framing.aspect);
  const senderAspect = Math.max(0.2, tape.aspect);
  const ratio = Math.min(1, senderAspect) / Math.min(1, aspect);
  if (Math.abs(ratio - 1) < 1e-3 || !(framing.radius > 0)) return fovScale;
  // The bounding sphere must fit the narrower half-angle here.
  const halfNarrow = Math.atan(tanHere * Math.min(1, aspect));
  const needDistance = (framing.radius * FIT_MARGIN) / Math.sin(halfNarrow);
  let need = -Infinity;
  for (const key of tape.keys) {
    const toCenter = Math.hypot(
      key.target[0] - framing.center[0],
      key.target[1] - framing.center[1],
      key.target[2] - framing.center[2],
    );
    // A view aimed well off the molecule (a close-up of one end) keeps its framing.
    if (toCenter > framing.radius * 0.5) continue;
    const d = key.d * fovScale;
    if (d > 1e-6) need = Math.max(need, needDistance / d);
  }
  if (!Number.isFinite(need)) need = ratio;
  const k = ratio > 1
    ? Math.min(Math.max(need, 1), Math.min(ratio, MAX_REFRAME))
    : Math.min(1, Math.max(ratio, need, MIN_REFRAME));
  return fovScale * k;
}

export interface ReplayPlayerOptions {
  framing: ReplayFraming | null;
  /** Replay the pill's flashes (and their cues). */
  flashes: boolean;
  /** Replay the toys. */
  toys: boolean;
}

const OFFSET = new Vector3();
const Q = new Quaternion();

export class ReplayPlayer {
  readonly tape: Tape;
  readonly curve: KeyCurve;
  readonly duration: number;
  readonly scale: number;
  private readonly options: ReplayPlayerOptions;
  private readonly pose: PoseSample = createPoseSample();
  private time = 0;
  private nextEvent = 0;
  private started = false;
  private tugHeld = false;
  private heatHeld = false;

  constructor(tape: Tape, options: ReplayPlayerOptions) {
    this.tape = tape;
    this.options = options;
    this.curve = buildCurve(tape.keys);
    this.duration = Math.max(tape.duration, tape.keys[tape.keys.length - 1]?.t ?? 0);
    this.scale = options.framing ? reframeScale(tape, options.framing) : 1;
  }

  get elapsed(): number {
    return this.time;
  }

  get done(): boolean {
    return this.started && this.time >= this.duration;
  }

  /** The camera pose at time t (s), framed for this view. */
  poseAt(t: number): { position: Vec3; target: Vec3; quaternion: [number, number, number, number] } {
    const pose = samplePose(this.curve, t, this.pose);
    const d = pose.d * this.scale;
    Q.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    OFFSET.set(0, 0, d).applyQuaternion(Q);
    return {
      position: [pose.target[0] + OFFSET.x, pose.target[1] + OFFSET.y, pose.target[2] + OFFSET.z],
      target: [pose.target[0], pose.target[1], pose.target[2]],
      quaternion: [pose.q[0], pose.q[1], pose.q[2], pose.q[3]],
    };
  }

  /** The first pose (where a shared replay opens). */
  startPose(): { position: Vec3; target: Vec3 } {
    const { position, target } = this.poseAt(0);
    return { position, target };
  }

  /** The last pose (where it rests; a Still view opens here). */
  endPose(): { position: Vec3; target: Vec3 } {
    const { position, target } = this.poseAt(this.duration);
    return { position, target };
  }

  /** Put the camera (and the rig's target) at time t. */
  applyCamera(t: number, camera: Camera, rigTarget: Vector3 | null): void {
    const pose = this.poseAt(t);
    camera.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.updateMatrixWorld();
    if (rigTarget) rigTarget.set(pose.target[0], pose.target[1], pose.target[2]);
  }

  /** Start from the top (events fire from t = 0). */
  start(): void {
    this.started = true;
    this.time = 0;
    this.nextEvent = 0;
    this.tugHeld = false;
    this.heatHeld = false;
  }

  /** Advance to `t` (s from the start): camera and every event due. Returns true while running. */
  seek(t: number, camera: Camera, rigTarget: Vector3 | null): boolean {
    if (!this.started) this.start();
    this.time = Math.max(this.time, Math.min(t, this.duration));
    this.applyCamera(this.time, camera, rigTarget);
    const events = this.tape.events;
    while (this.nextEvent < events.length && events[this.nextEvent].t <= this.time + 1e-6) {
      this.fire(events[this.nextEvent]);
      this.nextEvent += 1;
    }
    return this.time < this.duration;
  }

  /** Advance by dt seconds. */
  step(dt: number, camera: Camera, rigTarget: Vector3 | null): boolean {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    return this.seek(this.time + step, camera, rigTarget);
  }

  /** Stop early: let go of anything a toy still holds. */
  stop(): void {
    const sink = getToyReplaySink();
    if (sink && this.options.toys) {
      if (this.tugHeld) sink.play({ kind: 'tugRelease' });
      if (this.heatHeld) sink.play({ kind: 'heatOff' });
    }
    this.tugHeld = false;
    this.heatHeld = false;
    this.started = true;
    this.time = this.duration;
    this.nextEvent = this.tape.events.length;
  }

  private fire(event: TapeEvent): void {
    if (event.kind === 'label') {
      if (!this.options.flashes) return;
      const kind = event.flash;
      playStore.getState().flashText(event.text, kind, FLASH_MS[kind] ?? 1200);
      if (kind === 'detent' || kind === 'flip' || kind === 'catch') cue(kind);
      return;
    }
    if (!this.options.toys) return;
    const sink = getToyReplaySink();
    if (!sink) return;
    if (event.kind === 'tugGrab') this.tugHeld = true;
    if (event.kind === 'tugRelease') this.tugHeld = false;
    if (event.kind === 'heatOn') this.heatHeld = true;
    if (event.kind === 'heatOff') this.heatHeld = false;
    const { t: _t, ...rest } = event;
    void _t;
    sink.play(rest as ToyEvent);
  }
}

/** True when the camera of `camera` is a perspective camera with a usable FOV. */
export function cameraFov(camera: Camera): number {
  return camera instanceof PerspectiveCamera && camera.fov > 0 ? camera.fov : 50;
}
