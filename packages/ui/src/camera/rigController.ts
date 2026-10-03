/**
 * rigController.ts — the Lupi camera rig's brain (no DOM, no React, no store).
 *
 * The camera orbits a target; the molecule never moves. The rig owns the
 * camera's orientation as a quaternion (so a coast can tumble with roll) and
 * a distance, and writes `position = target + orientation·(0, 0, distance)`.
 *
 * Modes: `idle`, `drag` (the pointer owns the pose, 1:1), `coast` (a flick
 * keeps turning on a CoastModel), and the three eased moves `glide` (a UI
 * camera change), `detent` (a coast clicking into a DetentProvider's view)
 * and `relevel` (rolling back to y-up). Zoom is a separate channel that runs
 * alongside any of them.
 *
 * Rules (plan-final WP3):
 * - Adopt external writes. Anything else may move the camera or
 *   `controls.target` (CameraManager's snaps, MCP, flythrough, video,
 *   AnomalyTracker, the legacy focus glide). The rig notices at its next
 *   frame (or at once through `controls.update()`), cancels its own motion,
 *   looks at the target if the camera no longer does, and carries on from
 *   there. So none of those writers needs to know the rig exists.
 * - The store is written once, when motion comes to rest, never per frame.
 * - The rest pose is level (y-up) and bit-identical to what CameraManager's
 *   snap would produce from the same store pose, so saved views, URLs and
 *   artifacts hold exactly what the screen shows.
 */
import { EventDispatcher, PerspectiveCamera, Quaternion, Vector3, type Camera } from 'three';
import { MOTION, springTo, type MotionToken } from '@atlas/core/motion';
import type { LupiIntent } from '@atlas/scene';
import type { CameraPose, CoastModel, DetentProvider, LupiCameraRigApi, Vec3 } from './rigApi';
import { createIsotropicCoast } from './isotropicCoast';
import { GESTURE, type GestureTokens } from './gestureTokens';
import {
  copyGlidePose,
  createCameraGlide,
  createGlidePose,
  glideDuration,
  glideMagnitude,
  quaternionAngle,
  sampleGlide,
  scaleToken,
  slerpUnclamped,
  stepGlide,
  type GlideKind,
  type GlidePose,
} from './cameraGlide';

export type RigMode = 'idle' | 'drag' | 'coast' | GlideKind;

export interface RigViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RigStoreCamera {
  position: Vec3;
  target: Vec3;
  preset: string;
}

export interface RigStorePatch {
  cameraPosition: Vec3;
  cameraTarget: Vec3;
  cameraPreset?: 'free';
}

/** Everything the rig needs from the app, injected so tests need no DOM or store. */
export interface RigHost {
  readStore(): RigStoreCamera;
  /** The one atomic store write at rest. */
  writeStore(patch: RigStorePatch): void;
  emit(intent: LupiIntent): void;
  coastEnabled(): boolean;
  glidesAnimate(): boolean;
  /** The canvas rectangle in client px (pointer → ray); null without a DOM. */
  viewport(): RigViewport | null;
  /** A catch stopped visible motion (the pill flashes "Caught", a cue plays). */
  onCatch?(): void;
  /** A user gesture started moving the camera (analytics). */
  onInteraction?(): void;
  /**
   * The rig started or changed motion outside a frame (Quiet Idle): the host
   * asks the demand frameloop for frames. While the rig is busy, the host's
   * frame job keeps the loop going.
   */
  wake?(): void;
}

const DEG = Math.PI / 180;

export const RIG = {
  /** Fixed coast step (s): the coast is identical at 30, 60 or 120 Hz. */
  step: 1 / 240,
  /**
   * Longest frame the rig integrates (a background tab resumes calmly). Up to
   * this, motion keeps wall-clock time, even on a software renderer at 1 fps.
   */
  maxFrameDt: 1,
  /** External-write tolerance (world units). */
  epsilon: 1e-6,
  /** Polar clamp while dragging (a coast may tumble past it). */
  minPolar: 1 * DEG,
  maxPolar: 179 * DEG,
  /**
   * |ω| below which a DetentProvider may capture (rad/s): early enough that
   * the rest of the coast can be steered into the detent at its own pace
   * (the provider picks the detent near where the coast would stop).
   */
  captureOmega: 1.5,
  /** A detent landing takes the natural stopping time 2θ/v, within these bounds (s). */
  landMinS: 0.25,
  landMaxS: 0.9,
  /** How far (rad) a fast landing may overshoot beyond a monotone ease: the click. */
  landSlack: 0.035,
  /** Landings with an end this close to a pole (|y|) slerp instead of following the view curve. */
  landPoleDot: 0.98,
  /**
   * A landing may not start slower than the coast by more than this (rad/s):
   * a detent that would need a sharper brake (just behind the aim, or off to
   * the side) is passed over, and the coast looks again next frame.
   */
  landMaxJolt: 0.3,
  /** A coast faster than this is "moving": a tap catches it instead of picking. */
  movingOmega: 0.3,
  /** Below this the rig ends any coast model itself with a short constant deceleration. */
  tailOmega: 0.3,
  tailDecel: 1.0,
  tailMaxS: 0.3,
  /** As a coast slows below this, it rights itself toward y-up (rad/s). */
  rightingOmega: 1.5,
  /** Righting rate at rest speed (1/s). */
  rightingRate: 5,
  /** Roll correction time constant while dragging after a catch (s). */
  dragRightingS: 0.08,
  /** Do not relevel closer than this to the poles (|viewDir·Ŷ|): y-up is undefined there. */
  poleDot: 0.999,
  rightingPoleDot: 0.95,
  /** Roll (rad) below which the rest pose is simply cut level. */
  rollEpsilon: 1e-3,
  /** Zoom may stretch this far past its limits, then springs back. */
  softZoom: 0.08,
  boingDelayS: 0.12,
  /** The store is written this long after the last wheel tick. */
  wheelQuietS: 0.15,
  wheelToken: { smoothTime: 0.06, dampingRatio: 1 } as MotionToken,
  /** Middle-button dolly: log distance per viewport height. */
  dollyPerViewport: 2,
} as const;

const Y_AXIS = new Vector3(0, 1, 0);
const IDENTITY = new Quaternion();
const EPS2 = RIG.epsilon * RIG.epsilon;

type RigEvents = { start: object; change: object; end: object };

/**
 * `state.controls` while the rig is mounted: what CameraManager, CameraFocus,
 * AnomalyTracker and the DOF job read (`target`, `object`, `enabled`,
 * `update()`), plus the familiar start/change/end events.
 */
export class RigControls extends EventDispatcher<RigEvents> {
  readonly target: Vector3;
  readonly object: Camera;
  private readonly rig: RigController;

  constructor(rig: RigController) {
    super();
    this.rig = rig;
    this.target = rig.target;
    this.object = rig.camera;
  }

  get enabled(): boolean {
    return this.rig.isEnabled();
  }

  set enabled(value: boolean) {
    this.rig.setEnabled(value);
  }

  /** Adopt whatever was just written to the camera or target (OrbitControls semantics). */
  update(): boolean {
    return this.rig.update();
  }

  dispose(): void {}
}

function vecClose(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(a[i] - b[i]) > 1e-9 * Math.max(1, Math.abs(a[i]))) return false;
  }
  return true;
}

function quatClose(a: Quaternion, b: Quaternion): boolean {
  return (
    Math.abs(a.x - b.x) <= 1e-9 &&
    Math.abs(a.y - b.y) <= 1e-9 &&
    Math.abs(a.z - b.z) <= 1e-9 &&
    Math.abs(a.w - b.w) <= 1e-9
  );
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export class RigController implements LupiCameraRigApi {
  readonly camera: Camera;
  readonly target = new Vector3();
  readonly controls: RigControls;
  mode: RigMode = 'idle';

  private readonly host: RigHost;
  private readonly tokens: GestureTokens;
  private readonly orientation = new Quaternion();
  private distance = 1;
  private enabled = true;
  private suspended = false;
  private holding = 0;
  private dragActive = false;
  private dirty = false;
  private userMoved = false;
  private restLabel: string | null = null;
  private restCounter = 0;
  private clock = 0;
  private minDistance = 0;
  private maxDistance = Number.POSITIVE_INFINITY;

  // Coast.
  private readonly defaultCoast = createIsotropicCoast();
  private coast: CoastModel = this.defaultCoast;
  private detents: DetentProvider | null = null;
  private coastAcc = 0;
  private omega = 0;
  private readonly omegaAxis = new Vector3(0, 1, 0);
  private tail = false;
  private tailDecel: number = RIG.tailDecel;
  private readonly dq: [number, number, number, number] = [0, 0, 0, 1];

  // Glides.
  private readonly glide = createCameraGlide();
  private readonly sample = createGlidePose();
  /**
   * A detent landing: the view follows a cubic Hermite curve on the sphere
   * from where the coast was (with its velocity) to the detent (at rest), so
   * the coast flows into the face instead of being yanked there.
   */
  private readonly land = {
    active: false,
    curve: true,
    from: new Vector3(),
    to: new Vector3(),
    vel: new Vector3(),
    /** orientation = level(view)·roll at capture; blended out over the landing. */
    roll: new Quaternion(),
    /** Slerp fallback: the scalar Hermite's start slope. */
    m: 0,
    duration: 1,
    time: 0,
  };

  // Drag input, applied once per frame.
  private pendingYaw = 0;
  private pendingPitch = 0;
  private pendingPanX = 0;
  private pendingPanY = 0;
  private pendingZoomLog = 0;
  private pinchAnchor: { x: number; y: number } | null = null;
  private pinchRawLog: number | null = null;
  private lastPitchClamp = Number.NEGATIVE_INFINITY;
  private dragRighting = false;

  // Zoom channel: a spring on the log-distance still to apply.
  private readonly zoom = { value: 0, velocity: 0 };
  private zoomGoal = 0;
  private zoomToken: MotionToken = RIG.wheelToken;
  private zoomAnchor: { x: number; y: number } | null = null;
  private lastZoomInput = Number.NEGATIVE_INFINITY;
  private boing = false;
  /** Only a user zoom springs back into the limits (an MCP or saved pose outside them stays exact). */
  private zoomedByUser = false;

  // What the rig itself last wrote.
  private readonly lastPos = new Vector3();
  private readonly lastTarget = new Vector3();
  private readonly lastQuat = new Quaternion();

  // Scratch.
  private readonly levelCamera = new PerspectiveCamera();
  private readonly qLevel = new Quaternion();
  private readonly qTmp = new Quaternion();
  private readonly vTmp = new Vector3();
  private readonly vTmp2 = new Vector3();
  private readonly vTmp3 = new Vector3();
  private readonly vTmp4 = new Vector3();
  private readonly vRest = new Vector3();
  private readonly vRestRight = new Vector3();
  private readonly vRestPosition = new Vector3();
  private readonly anchor = new Vector3();

  constructor(camera: Camera, host: RigHost, { tokens = GESTURE, target }: { tokens?: GestureTokens; target?: Vec3 } = {}) {
    this.camera = camera;
    this.host = host;
    this.tokens = tokens;
    this.controls = new RigControls(this);
    if (target) this.target.fromArray(target);
    this.adoptCamera();
  }

  // ─── Configuration ────────────────────────────────────────────────

  setLimits(minDistance: number, maxDistance: number): void {
    this.minDistance = Number.isFinite(minDistance) && minDistance > 0 ? minDistance : 0;
    this.maxDistance = Number.isFinite(maxDistance) && maxDistance > this.minDistance ? maxDistance : Number.POSITIVE_INFINITY;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.host.wake?.();
    if (this.enabled === value) return;
    this.enabled = value;
    if (!value) {
      this.clearPending();
      this.stopAutonomous();
      if (this.mode === 'drag') this.mode = 'idle';
      this.dragActive = false;
    }
  }

  /** Accepts pointer and wheel manipulation right now. */
  canManipulate(): boolean {
    return this.enabled && !this.suspended;
  }

  setCoastModel(model: CoastModel | null): void {
    this.host.wake?.();
    const next = model ?? this.defaultCoast;
    if (next === this.coast) return;
    if (this.mode === 'coast' && !this.tail && this.coast === this.defaultCoast && next !== this.defaultCoast) {
      // A molecule's model arriving mid-coast (the hero's spin carried into
      // 3D before its Object Facts are ready) takes the spin over rather
      // than stopping it dead. The isotropic coast's ω axis is fixed in
      // world, so the handed-over ω is exact.
      this.coast.stop();
      this.coast = next;
      next.begin([this.omegaAxis.x * this.omega, this.omegaAxis.y * this.omega, this.omegaAxis.z * this.omega]);
      return;
    }
    if (this.mode === 'coast' && !this.tail) {
      this.coast.stop();
      this.omega = 0;
      this.mode = 'idle';
      this.settleOrientation();
    }
    this.coast = next;
  }

  setDetentProvider(provider: DetentProvider | null): void {
    this.detents = provider;
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /** Visibly moving on its own: a tap now catches instead of picking. */
  isMoving(): boolean {
    if (this.mode === 'coast') return !this.tail && this.omega > RIG.movingOmega;
    return this.mode === 'glide' || this.mode === 'detent' || this.mode === 'relevel';
  }

  /** Anything in flight (including a held pointer, zoom easing or a pending store write). */
  isBusy(): boolean {
    return (
      this.mode !== 'idle' ||
      this.holding > 0 ||
      this.dragActive ||
      this.zoomActive() ||
      this.boing ||
      this.dirty
    );
  }

  pose(): CameraPose {
    const cam = this.camera as PerspectiveCamera;
    return {
      position: [cam.position.x, cam.position.y, cam.position.z],
      target: [this.target.x, this.target.y, this.target.z],
      fov: typeof cam.fov === 'number' ? cam.fov : 50,
    };
  }

  restCount(): number {
    return this.restCounter;
  }

  /** The unit view direction, normalize(position − target). */
  viewDir(out: Vector3 = new Vector3()): Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.orientation);
  }

  // ─── Frame ────────────────────────────────────────────────────────

  /** The external-write check (`controls.update()`). */
  update(): boolean {
    if (this.suspended) return false;
    return this.adoptExternal();
  }

  frame(dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, RIG.maxFrameDt) : 0;
    this.clock += step;
    if (this.suspended) return;
    const adopted = this.adoptExternal();
    if (adopted && this.mode !== 'drag') return;
    if (!this.enabled) {
      this.clearPending();
      return;
    }
    let moved = false;
    if (this.dragActive && this.hasPending() && this.mode !== 'drag') this.enterDrag();
    if (this.mode === 'drag') moved = this.applyDrag(step) || moved;
    else if (this.mode === 'coast') moved = this.stepCoast(step) || moved;
    else if (this.mode !== 'idle') moved = this.stepGlideMode(step) || moved;
    moved = this.stepZoom(step, moved) || moved;
    if (moved) this.writePose();
    this.maybeRest();
  }

  // ─── Gesture input (from the gesture arbiter) ─────────────────────

  /** A pointer went down on the canvas: hold whatever is drifting slowly. */
  beginGesture(): void {
    this.host.wake?.();
    this.holding += 1;
    if (this.holding !== 1 || !this.canManipulate()) return;
    if (this.mode === 'coast') {
      this.coast.stop();
      this.tail = false;
      this.omega = 0;
      this.mode = 'idle';
      this.userMoved = true;
      this.settleOrientation(MOTION.snap, 0.25);
    }
  }

  /** The last pointer lifted. */
  endGesture(): void {
    this.holding = Math.max(0, this.holding - 1);
  }

  /** A press became a drag (orbit, pan, dolly or two fingers). */
  startDrag(): void {
    if (!this.canManipulate()) return;
    this.dragActive = true;
    this.pinchRawLog = null;
    this.enterDrag();
    this.controls.dispatchEvent({ type: 'start' });
    this.host.onInteraction?.();
  }

  orbitBy(dxPx: number, dyPx: number): void {
    if (!this.dragActive) return;
    this.pendingYaw += dxPx;
    this.pendingPitch += dyPx;
  }

  panBy(dxPx: number, dyPx: number): void {
    if (!this.dragActive) return;
    this.pendingPanX += dxPx;
    this.pendingPanY += dyPx;
  }

  /** Pinch or dolly: multiply the distance by e^logFactor about the client point (the target when null). */
  zoomBy(logFactor: number, clientX: number | null = null, clientY: number | null = null): void {
    if (!this.dragActive || !Number.isFinite(logFactor)) return;
    this.pendingZoomLog += logFactor;
    this.pinchAnchor = clientX === null || clientY === null ? null : { x: clientX, y: clientY };
  }

  /** Middle-button dolly by a vertical drag (down = farther). */
  dollyBy(dyPx: number): void {
    this.zoomBy((RIG.dollyPerViewport * dyPx) / this.viewportHeight());
  }

  /** The drag ended; `velocity` (px/s) is the orbit release speed, or null for no coast. */
  endDrag(velocity: { vx: number; vy: number } | null): void {
    this.host.wake?.();
    const wasDrag = this.mode === 'drag';
    this.dragActive = false;
    this.pinchRawLog = null;
    if (!wasDrag) return;
    // Apply the last moves before deciding anything.
    if (this.hasPending()) {
      this.applyDrag(0);
      this.writePose();
    }
    this.mode = 'idle';
    this.dragRighting = false;
    if (velocity && this.canManipulate()) {
      const omega = this.releaseOmega(velocity.vx, velocity.vy, this.vTmp3);
      const speed = omega.length();
      if (speed > this.tokens.flickMinRadPerSec && this.host.coastEnabled()) {
        this.fling([omega.x, omega.y, omega.z]);
        return;
      }
    }
    this.settleOrientation();
  }

  /** Wheel zoom by `factor` (distance multiplier) toward the client point, eased. */
  wheelZoom(factor: number, clientX: number, clientY: number): void {
    this.host.wake?.();
    if (!this.canManipulate() || !(factor > 0) || !Number.isFinite(factor)) return;
    if (!this.zoomActive()) {
      this.controls.dispatchEvent({ type: 'start' });
      this.host.onInteraction?.();
    }
    this.queueZoom(factor, clientX, clientY, RIG.wheelToken, true);
  }

  // ─── LupiCameraRigApi ─────────────────────────────────────────────

  fling(omegaWorld: Vec3): void {
    this.host.wake?.();
    if (!this.canManipulate() || !this.host.coastEnabled()) return;
    const speed = Math.hypot(omegaWorld[0], omegaWorld[1], omegaWorld[2]);
    if (!(speed > 1e-6) || !Number.isFinite(speed)) return;
    const scale = speed > this.tokens.maxOmega ? this.tokens.maxOmega / speed : 1;
    const w: Vec3 = [omegaWorld[0] * scale, omegaWorld[1] * scale, omegaWorld[2] * scale];
    if (this.mode === 'coast') this.coast.stop();
    this.endGlideState();
    this.coast.begin(w);
    this.mode = 'coast';
    this.tail = false;
    this.coastAcc = 0;
    this.omega = speed * scale;
    this.omegaAxis.set(w[0], w[1], w[2]).normalize();
    this.userMoved = true;
    this.dirty = true;
    this.controls.dispatchEvent({ type: 'start' });
  }

  /** End a coast without a catch (no flash, no cue): the visitor chose a calmer Motion level. */
  stopCoast(): void {
    this.host.wake?.();
    if (this.mode !== 'coast') return;
    this.coast.stop();
    this.tail = false;
    this.omega = 0;
    this.mode = 'idle';
    this.dirty = true;
    this.settleOrientation(MOTION.snap, 0.25);
  }

  catch(): void {
    this.host.wake?.();
    const wasMoving = this.isMoving();
    if (this.mode === 'coast') {
      this.coast.stop();
      this.tail = false;
      this.omega = 0;
      this.mode = 'idle';
    } else if (this.mode === 'glide' || this.mode === 'detent' || this.mode === 'relevel') {
      this.endGlideState();
      this.mode = 'idle';
    }
    this.stopZoom();
    if (wasMoving) {
      this.userMoved = true;
      this.dirty = true;
    }
    this.settleOrientation(MOTION.snap, 0.25);
    if (wasMoving) {
      this.host.emit({ type: 'camera.catch' });
      this.host.onCatch?.();
    }
  }

  glideTo(
    pose: { position: Vec3; target: Vec3 },
    opts: { token?: MotionToken; userMoved?: boolean; onDone?(): void } = {},
  ): void {
    this.host.wake?.();
    const toPosition = new Vector3().fromArray(pose.position);
    const toTarget = new Vector3().fromArray(pose.target);
    if (!Number.isFinite(toPosition.lengthSq()) || !Number.isFinite(toTarget.lengthSq())) return;
    if (this.mode === 'coast') {
      this.coast.stop();
      this.tail = false;
      this.omega = 0;
    }
    this.stopZoom();
    const g = this.glide;
    g.kind = 'glide';
    this.currentPose(g.from);
    this.levelQuaternion(toPosition, toTarget, g.to.orientation);
    g.to.logDistance = Math.log(Math.max(RIG.epsilon, toPosition.distanceTo(toTarget)));
    g.to.target.copy(toTarget);
    g.toPosition = toPosition;
    g.label = null;
    g.userMoved = opts.userMoved ?? false;
    g.onDone = opts.onDone ?? null;
    g.p.value = 0;
    g.p.velocity = 0;
    g.token = scaleToken(opts.token ?? MOTION.glide, glideDuration(glideMagnitude(g.from, g.to)));
    this.mode = 'glide';
    this.dirty = true;
    if (!this.canManipulate() || !this.host.glidesAnimate()) this.finishGlide();
  }

  zoomToward(clientX: number, clientY: number, factor: number): void {
    this.host.wake?.();
    if (!this.canManipulate() || !(factor > 0) || !Number.isFinite(factor)) return;
    const token = scaleToken(MOTION.glide, glideDuration(Math.abs(Math.log(factor))));
    this.queueZoom(factor, clientX, clientY, token, false);
  }

  /** Stop, re-level, and write the camera and store synchronously (before any capture). */
  settleNow(): void {
    this.host.wake?.();
    if (this.suspended) return;
    this.adoptExternal();
    const active = this.mode !== 'idle' || this.zoomActive() || this.boing || this.dirty || this.outsideLimits();
    if (!active) return;
    if (this.mode === 'glide' || this.mode === 'detent' || this.mode === 'relevel') {
      this.finishGlide();
    } else if (this.mode === 'coast') {
      this.coast.stop();
      this.tail = false;
      this.omega = 0;
      this.mode = 'idle';
      this.dirty = true;
    }
    if (this.zoomActive()) {
      const remaining = this.zoomGoal - this.zoom.value;
      this.stopZoom();
      if (remaining !== 0) {
        this.syncCameraObject();
        this.applySimilarity(this.anchorPoint(this.zoomAnchor, this.anchor), Math.exp(remaining));
        this.dirty = true;
      }
    }
    if (this.outsideLimits()) {
      this.distance = clamp(this.distance, this.minDistance, this.maxDistance);
      this.dirty = true;
    }
    this.boing = false;
    this.zoomedByUser = false;
    if (!this.dirty) return;
    if (this.mode === 'drag') this.writePose();
    else this.cutLevel();
    this.rest();
  }

  // ─── Recording ────────────────────────────────────────────────────

  suspend(): void {
    this.suspended = true;
    this.clearPending();
    this.dragActive = false;
    if (this.mode === 'drag') this.mode = 'idle';
  }

  /** Snap to the store pose (as CameraManager would) and adopt it. */
  resumeFromStore(): void {
    this.host.wake?.();
    this.suspended = false;
    const store = this.host.readStore();
    this.camera.position.fromArray(store.position);
    this.target.fromArray(store.target);
    if (this.camera.position.distanceToSquared(this.target) > EPS2) this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.stopAutonomous();
    this.mode = 'idle';
    this.adoptCamera();
    this.dirty = false;
    this.zoomedByUser = false;
  }

  dispose(): void {
    this.stopAutonomous();
    this.clearPending();
  }

  // ─── Internals: adopt and write ───────────────────────────────────

  private adoptExternal(): boolean {
    const cam = this.camera;
    if (
      cam.position.distanceToSquared(this.lastPos) <= EPS2 &&
      this.target.distanceToSquared(this.lastTarget) <= EPS2 &&
      quatClose(cam.quaternion, this.lastQuat)
    ) {
      return false;
    }
    this.stopAutonomous();
    this.adoptCamera();
    this.dirty = false;
    this.userMoved = false;
    this.restLabel = null;
    this.zoomedByUser = false;
    return true;
  }

  /** Take the camera as it is; look at the target first if it no longer does. */
  private adoptCamera(): void {
    const cam = this.camera;
    const toTarget = this.vTmp.copy(this.target).sub(cam.position);
    const length = toTarget.length();
    if (length > RIG.epsilon) {
      const forward = this.vTmp2.set(0, 0, -1).applyQuaternion(cam.quaternion);
      if (forward.dot(toTarget) / length < 1 - 1e-9) {
        cam.lookAt(this.target);
      }
    }
    cam.updateMatrixWorld();
    this.orientation.copy(cam.quaternion).normalize();
    this.distance = Math.max(RIG.epsilon, length);
    this.recordWritten();
  }

  private recordWritten(): void {
    this.lastPos.copy(this.camera.position);
    this.lastTarget.copy(this.target);
    this.lastQuat.copy(this.camera.quaternion);
  }

  private syncCameraObject(): void {
    const cam = this.camera;
    this.orientation.normalize();
    cam.quaternion.copy(this.orientation);
    cam.position.set(0, 0, this.distance).applyQuaternion(this.orientation).add(this.target);
    cam.updateMatrixWorld();
  }

  private writePose(): void {
    this.syncCameraObject();
    this.recordWritten();
    this.dirty = true;
    this.controls.dispatchEvent({ type: 'change' });
  }

  /** Write an exact pose: `position` as given, orientation from the state. */
  private writePoseExact(position: Vector3): void {
    const cam = this.camera;
    cam.position.copy(position);
    cam.quaternion.copy(this.orientation);
    cam.updateMatrixWorld();
    this.distance = Math.max(RIG.epsilon, position.distanceTo(this.target));
    this.recordWritten();
    this.dirty = true;
    this.controls.dispatchEvent({ type: 'change' });
  }

  private currentPose(out: GlidePose): GlidePose {
    out.orientation.copy(this.orientation);
    out.logDistance = Math.log(Math.max(RIG.epsilon, this.distance));
    out.target.copy(this.target);
    return out;
  }

  // ─── Internals: rest ──────────────────────────────────────────────

  private maybeRest(): void {
    if (!this.dirty || this.holding > 0 || this.dragActive || this.mode !== 'idle') return;
    if (this.zoomActive() || this.boing) return;
    if (this.clock - this.lastZoomInput < RIG.wheelQuietS) return;
    if (this.outsideLimits()) return; // the boing starts first
    this.rest();
  }

  private rest(): void {
    this.dirty = false;
    const cam = this.camera;
    const position: Vec3 = [cam.position.x, cam.position.y, cam.position.z];
    const target: Vec3 = [this.target.x, this.target.y, this.target.z];
    const userMoved = this.userMoved;
    const label = this.restLabel;
    this.userMoved = false;
    this.restLabel = null;
    const store = this.host.readStore();
    const differs = !vecClose(position, store.position) || !vecClose(target, store.target);
    if (differs || (userMoved && store.preset !== 'free')) {
      this.host.writeStore({
        cameraPosition: position,
        cameraTarget: target,
        ...(userMoved ? { cameraPreset: 'free' as const } : {}),
      });
    }
    this.restCounter += 1;
    const view = this.viewDir(this.vTmp);
    this.host.emit({ type: 'camera.rest', viewDir: [view.x, view.y, view.z], detentLabel: label, userMoved });
    this.controls.dispatchEvent({ type: 'end' });
  }

  // ─── Internals: level ─────────────────────────────────────────────

  /** The quaternion Object3D.lookAt gives a camera at `position` facing `target` with up +Y. */
  private levelQuaternion(position: Vector3, target: Vector3, out: Quaternion): Quaternion {
    const cam = this.levelCamera;
    cam.position.copy(position);
    cam.quaternion.identity();
    cam.lookAt(target);
    return out.copy(cam.quaternion);
  }

  /** The level orientation for the current view direction, unless it is too close to a pole. */
  private levelForCurrent(out: Quaternion, poleDot: number): boolean {
    const view = this.viewDir(this.vTmp);
    if (Math.abs(view.y) > poleDot) return false;
    const position = this.vTmp2.copy(view).multiplyScalar(this.distance).add(this.target);
    this.levelQuaternion(position, this.target, out);
    return true;
  }

  private rollAngle(): number {
    return this.levelForCurrent(this.qLevel, RIG.poleDot) ? quaternionAngle(this.orientation, this.qLevel) : 0;
  }

  /**
   * The rest pose for the current view: a position, and the orientation
   * Object3D.lookAt gives there (what a store snap of it shows). Within the
   * pole cap y-up no longer says which way the picture turns, so rather than
   * spin it there, a rolled camera moves to the cap's edge on the side where
   * lookAt keeps its right axis (a tilt of a few degrees at most).
   */
  private restPose(position: Vector3, out: Quaternion): Vector3 {
    const view = this.viewDir(this.vRest);
    position.copy(view).multiplyScalar(this.distance).add(this.target);
    const level = this.levelQuaternion(position, this.target, this.qTmp);
    if (Math.abs(view.y) > RIG.poleDot && quaternionAngle(this.orientation, level) > RIG.rollEpsilon) {
      const right = this.vRestRight.set(1, 0, 0).applyQuaternion(this.orientation).setY(0);
      if (right.lengthSq() > EPS2) {
        right.normalize();
        // lookAt's right axis is Ŷ × view, and Ŷ × (right × Ŷ) = right.
        const pole = Math.sign(view.y) * RIG.poleDot;
        view
          .set(-right.z, 0, right.x)
          .multiplyScalar(Math.sqrt(1 - RIG.poleDot * RIG.poleDot))
          .addScaledVector(Y_AXIS, pole);
        position.copy(view).multiplyScalar(this.distance).add(this.target);
        this.levelQuaternion(position, this.target, level);
      }
    }
    out.copy(level);
    return position;
  }

  /** Cut to the exact level pose (what a store snap of this pose would show). */
  private cutLevel(): void {
    this.writePoseExact(this.restPose(this.vRestPosition, this.orientation));
  }

  /** At the end of motion: relevel with a glide if rolled, else cut exactly level. */
  private settleOrientation(token: MotionToken = MOTION.glide, minS = 0.3): void {
    // The level pose for the current view direction (the camera object may
    // not carry this frame's orientation yet).
    const toPosition = this.restPose(new Vector3(), this.qLevel);
    const roll = quaternionAngle(this.orientation, this.qLevel);
    if (roll <= RIG.rollEpsilon) {
      if (this.mode === 'idle' && this.dirty) this.cutLevel();
      return;
    }
    const g = this.glide;
    g.kind = 'relevel';
    this.currentPose(g.from);
    copyGlidePose(g.to, g.from);
    g.toPosition = toPosition;
    g.to.orientation.copy(this.qLevel);
    g.label = null;
    g.userMoved = true;
    g.onDone = null;
    g.p.value = 0;
    g.p.velocity = 0;
    g.token = scaleToken(token, glideDuration(roll, minS));
    this.mode = 'relevel';
    this.dirty = true;
    if (!this.host.glidesAnimate()) this.finishGlide();
  }

  // ─── Internals: drag ──────────────────────────────────────────────

  private enterDrag(): void {
    if (this.mode === 'coast') {
      this.coast.stop();
      this.tail = false;
      this.omega = 0;
    }
    if (this.mode === 'glide' || this.mode === 'detent' || this.mode === 'relevel') {
      this.endGlideState();
    }
    this.mode = 'drag';
    this.userMoved = true;
    this.dragRighting = this.rollAngle() > RIG.rollEpsilon;
  }

  private hasPending(): boolean {
    return this.pendingYaw !== 0 || this.pendingPitch !== 0 || this.pendingPanX !== 0 || this.pendingPanY !== 0 || this.pendingZoomLog !== 0;
  }

  private clearPending(): void {
    this.pendingYaw = 0;
    this.pendingPitch = 0;
    this.pendingPanX = 0;
    this.pendingPanY = 0;
    this.pendingZoomLog = 0;
  }

  private viewportHeight(): number {
    const h = this.host.viewport()?.height;
    return h && h > 1 ? h : 800;
  }

  private applyDrag(dt: number): boolean {
    let moved = false;
    const h = this.viewportHeight();
    if (this.pendingYaw !== 0 || this.pendingPitch !== 0) {
      const yaw = (Math.PI * this.pendingYaw) / h;
      const pitch = (Math.PI * this.pendingPitch) / h;
      // Content follows the pointer: the molecule turns +yaw about world Y,
      // so the camera orbits by the inverse.
      this.orientation.premultiply(this.qTmp.setFromAxisAngle(Y_AXIS, -yaw));
      const view = this.viewDir(this.vTmp);
      const polar = Math.acos(clamp(view.y, -1, 1));
      const lo = Math.min(0, polar - RIG.maxPolar);
      const hi = Math.max(0, polar - RIG.minPolar);
      const applied = clamp(pitch, lo, hi);
      if (applied !== pitch) this.lastPitchClamp = this.clock;
      const right = this.vTmp2.set(1, 0, 0).applyQuaternion(this.orientation);
      this.orientation.premultiply(this.qTmp.setFromAxisAngle(right, -applied)).normalize();
      moved = true;
    }
    if (this.pendingPanX !== 0 || this.pendingPanY !== 0) {
      const units = (2 * this.distance * Math.tan((this.fovDegrees() * DEG) / 2)) / h;
      const right = this.vTmp.set(1, 0, 0).applyQuaternion(this.orientation);
      const up = this.vTmp2.set(0, 1, 0).applyQuaternion(this.orientation);
      const delta = right.multiplyScalar(-this.pendingPanX * units).addScaledVector(up, this.pendingPanY * units);
      this.target.add(delta);
      moved = true;
    }
    if (this.pendingZoomLog !== 0) {
      if (this.pinchRawLog === null) this.pinchRawLog = Math.log(Math.max(RIG.epsilon, this.distance));
      this.pinchRawLog += this.pendingZoomLog;
      const next = this.rubber(Math.exp(this.pinchRawLog));
      const factor = next / this.distance;
      if (Number.isFinite(factor) && factor > 0 && factor !== 1) {
        this.zoomedByUser = true;
        this.syncCameraObject();
        this.applySimilarity(this.anchorPoint(this.pinchAnchor, this.anchor), factor);
        this.lastZoomInput = this.clock;
        moved = true;
      }
    }
    if (this.dragRighting && dt > 0) {
      if (this.levelForCurrent(this.qLevel, RIG.poleDot)) {
        this.orientation.slerp(this.qLevel, 1 - Math.exp(-dt / RIG.dragRightingS));
        if (quaternionAngle(this.orientation, this.qLevel) < 1e-4) this.dragRighting = false;
        moved = true;
      } else {
        this.dragRighting = false;
      }
    }
    this.clearPending();
    if (moved) this.userMoved = true;
    return moved;
  }

  /** The release speed as the molecule's apparent ω in world space (rad/s). */
  private releaseOmega(vx: number, vy: number, out: Vector3): Vector3 {
    const h = this.viewportHeight();
    const yawRate = (Math.PI * vx) / h;
    // A drag pinned at the polar clamp must not fling past it on release.
    const pitchRate = this.clock - this.lastPitchClamp < this.tokens.polarClampMemoryMs / 1000 ? 0 : (Math.PI * vy) / h;
    const right = this.vTmp.set(1, 0, 0).applyQuaternion(this.orientation);
    out.copy(Y_AXIS).multiplyScalar(yawRate).addScaledVector(right, pitchRate);
    const speed = out.length();
    if (speed > this.tokens.maxOmega) out.multiplyScalar(this.tokens.maxOmega / speed);
    return out;
  }

  private fovDegrees(): number {
    const fov = (this.camera as PerspectiveCamera).fov;
    return typeof fov === 'number' && fov > 0 ? fov : 50;
  }

  // ─── Internals: coast ─────────────────────────────────────────────

  private stepCoast(dt: number): boolean {
    this.coastAcc = Math.min(this.coastAcc + dt, RIG.maxFrameDt);
    let moved = false;
    const h = RIG.step;
    while (this.coastAcc >= h - 1e-12 && this.mode === 'coast') {
      this.coastAcc -= h;
      if (!this.tail) {
        const speed = this.coast.step(h, this.dq);
        this.applyMoleculeDelta(this.dq, h);
        this.omega = Number.isFinite(speed) ? Math.max(0, speed) : 0;
        if (this.omega < RIG.tailOmega) {
          // The rig lands every coast model itself: a short constant
          // deceleration instead of an exponential creep.
          this.coast.stop();
          this.tail = true;
          this.tailDecel = Math.max(RIG.tailDecel, this.omega / RIG.tailMaxS);
        }
      } else {
        const w0 = this.omega;
        const w1 = Math.max(0, w0 - this.tailDecel * h);
        const angle = w1 > 0 ? ((w0 + w1) / 2) * h : (w0 * w0) / (2 * this.tailDecel);
        this.qTmp.setFromAxisAngle(this.omegaAxis, angle);
        this.orientation.premultiply(this.qTmp.invert());
        this.omega = w1;
      }
      this.rightingStep(h);
      moved = true;
      if (this.tail && this.omega <= 0) break;
    }
    if (this.detents && this.mode === 'coast' && this.omega < RIG.captureOmega && this.tryCapture()) return true;
    if (this.tail && this.omega <= 0 && this.mode === 'coast') {
      this.mode = 'idle';
      this.tail = false;
      // The unused part of this frame goes to the relevel, so the rest
      // time does not depend on where the frame boundaries fell.
      const leftover = this.coastAcc;
      this.coastAcc = 0;
      this.settleOrientation();
      const next = this.mode as RigMode; // settleOrientation may start a relevel
      if (next === 'relevel' && leftover > 0) return this.stepGlideMode(leftover) || moved;
      // Idle: settleOrientation already cut the exact level pose.
      return moved && next !== 'idle';
    }
    return moved;
  }

  /** orientation ← conj(dq)·orientation, and remember the world ω axis. */
  private applyMoleculeDelta(dq: [number, number, number, number], h: number): void {
    const [x, y, z, w] = dq;
    const s = Math.hypot(x, y, z);
    if (s > 1e-12) this.omegaAxis.set(x / s, y / s, z / s);
    void h;
    this.orientation.premultiply(this.qTmp.set(-x, -y, -z, w)).normalize();
  }

  /** As a coast slows, roll back toward y-up so it lands upright. */
  private rightingStep(h: number): void {
    if (this.omega >= RIG.rightingOmega) return;
    const k = RIG.rightingRate * (1 - this.omega / RIG.rightingOmega);
    if (!(k > 0)) return;
    if (!this.levelForCurrent(this.qLevel, RIG.rightingPoleDot)) return;
    this.orientation.slerp(this.qLevel, 1 - Math.exp(-k * h));
  }

  private tryCapture(): boolean {
    const provider = this.detents;
    if (!provider) return false;
    const view = this.viewDir(this.vTmp);
    // The camera turns by −ω: d(viewDir)/dt = (−ω) × viewDir.
    const velocity = this.vTmp2.copy(this.omegaAxis).multiplyScalar(-this.omega).cross(view);
    let hit;
    try {
      hit = provider.capture([view.x, view.y, view.z], [velocity.x, velocity.y, velocity.z]);
    } catch (error) {
      console.error('[lupi] detent provider threw', error);
      return false;
    }
    if (!hit) return false;
    const dir = this.vTmp3.fromArray(hit.dir);
    if (!(dir.lengthSq() > 0.5)) return false;
    dir.normalize();
    if (this.beginLanding(view, velocity, dir) > RIG.landMaxJolt) {
      this.land.active = false;
      return false;
    }
    const g = this.glide;
    g.kind = 'detent';
    this.currentPose(g.from);
    const toPosition = this.land.to.clone().multiplyScalar(this.distance).add(this.target);
    this.levelQuaternion(toPosition, this.target, g.to.orientation);
    g.to.logDistance = g.from.logDistance;
    g.to.target.copy(this.target);
    g.toPosition = toPosition;
    g.label = hit.label;
    g.userMoved = true;
    g.onDone = null;
    g.p.value = 0;
    g.p.velocity = 0;
    this.coast.stop();
    this.tail = false;
    this.omega = 0;
    this.mode = 'detent';
    if (!this.host.glidesAnimate()) this.finishGlide();
    return true;
  }

  /**
   * Plan the landing from `view` moving at `velocity` (rad/s, tangent) to
   * `dir`: it takes the time a constant deceleration from the speed toward the
   * detent would (2θ/v, clamped), so a coast that was going to stop near the
   * face eases straight in, a slow one is carried gently, and a fast one close
   * to the face overshoots a hair and clicks back. Returns the speed (rad/s)
   * the landing sheds at its start to keep that overshoot small.
   */
  private beginLanding(view: Vector3, velocity: Vector3, dir: Vector3): number {
    const land = this.land;
    land.from.copy(view);
    land.to.copy(dir);
    land.vel.copy(velocity);
    const cos = clamp(view.dot(dir), -1, 1);
    const theta = Math.acos(cos);
    const tangent = this.anchor.copy(dir).addScaledVector(view, -cos);
    const along = tangent.lengthSq() > 1e-12 ? velocity.dot(tangent.normalize()) : 0;
    const duration = clamp(along > 1e-3 ? (2 * theta) / along : RIG.landMaxS, RIG.landMinS, RIG.landMaxS);
    const speed = land.vel.length();
    const reach = duration * speed;
    const limit = 3 * theta + RIG.landSlack;
    let shed = 0;
    if (reach > limit) {
      land.vel.multiplyScalar(limit / reach);
      shed = speed * (1 - limit / reach);
    }
    land.duration = duration;
    land.time = 0;
    land.m = theta > 1e-6 ? clamp((Math.max(0, along) * duration) / theta, 0, 3 + RIG.landSlack / theta) : 0;
    // Follow the view curve unless it passes near a pole (level is undefined there).
    land.curve = true;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      if (Math.abs(this.landingView(t, this.vTmp4).y) > RIG.landPoleDot) land.curve = false;
    }
    if (land.curve) {
      this.levelQuaternion(this.vTmp4.copy(view).multiplyScalar(this.distance).add(this.target), this.target, this.qLevel);
      land.roll.copy(this.qLevel).invert().multiply(this.orientation).normalize();
    }
    land.active = true;
    return shed;
  }

  /** The landing's view direction at s ∈ [0, 1] (cubic Hermite in R³, normalised). */
  private landingView(s: number, out: Vector3): Vector3 {
    const land = this.land;
    const s2 = s * s;
    const s3 = s2 * s;
    out
      .copy(land.from)
      .multiplyScalar(2 * s3 - 3 * s2 + 1)
      .addScaledVector(land.vel, (s3 - 2 * s2 + s) * land.duration)
      .addScaledVector(land.to, 3 * s2 - 2 * s3);
    return out.lengthSq() > 1e-12 ? out.normalize() : out.copy(land.to);
  }

  private stepLanding(dt: number): boolean {
    const land = this.land;
    const g = this.glide;
    land.time += dt;
    const s = land.time / land.duration;
    if (s >= 1) {
      this.finishGlide();
      return false;
    }
    const ease = s * s * (3 - 2 * s);
    this.distance = Math.exp(g.from.logDistance + (g.to.logDistance - g.from.logDistance) * ease);
    this.target.copy(g.from.target).lerp(g.to.target, ease);
    if (land.curve) {
      const view = this.landingView(s, this.vTmp);
      this.levelQuaternion(this.vTmp2.copy(view).multiplyScalar(this.distance).add(this.target), this.target, this.orientation);
      this.orientation.multiply(this.qTmp.copy(land.roll).slerp(IDENTITY, ease)).normalize();
    } else {
      const p = (s * s * s - 2 * s * s + s) * land.m + ease;
      slerpUnclamped(g.from.orientation, g.to.orientation, p, this.orientation);
    }
    return true;
  }

  // ─── Internals: glides ────────────────────────────────────────────

  private stepGlideMode(dt: number): boolean {
    if (this.mode === 'detent' && this.land.active) return this.stepLanding(dt);
    const g = this.glide;
    const done = stepGlide(g, dt);
    if (done) {
      this.finishGlide();
      return false;
    }
    sampleGlide(g, this.sample);
    this.orientation.copy(this.sample.orientation);
    this.distance = Math.exp(this.sample.logDistance);
    this.target.copy(this.sample.target);
    return true;
  }

  private finishGlide(): void {
    const g = this.glide;
    const kind = g.kind;
    this.orientation.copy(g.to.orientation);
    this.target.copy(g.to.target);
    this.distance = Math.exp(g.to.logDistance);
    if (g.userMoved) this.userMoved = true;
    if (kind === 'detent') this.restLabel = g.label;
    this.mode = 'idle';
    const position = g.toPosition ?? this.vTmp3.set(0, 0, this.distance).applyQuaternion(this.orientation).add(this.target);
    this.writePoseExact(position);
    const done = g.onDone;
    this.endGlideState();
    if (done) {
      try {
        done();
      } catch (error) {
        console.error('[lupi] camera glide onDone threw', error);
      }
    }
  }

  private endGlideState(): void {
    this.land.active = false;
    const g = this.glide;
    g.onDone = null;
    g.toPosition = null;
    g.label = null;
    g.p.value = 0;
    g.p.velocity = 0;
  }

  private stopAutonomous(): void {
    if (this.mode === 'coast') this.coast.stop();
    this.tail = false;
    this.omega = 0;
    this.coastAcc = 0;
    if (this.mode !== 'drag') this.mode = 'idle';
    this.endGlideState();
    this.stopZoom();
    this.boing = false;
  }

  // ─── Internals: zoom ──────────────────────────────────────────────

  private zoomActive(): boolean {
    return this.zoom.value !== this.zoomGoal || this.zoom.velocity !== 0;
  }

  private stopZoom(): void {
    this.zoom.value = 0;
    this.zoom.velocity = 0;
    this.zoomGoal = 0;
    this.boing = false;
  }

  /** A user zoom left the distance outside [min, max]: it springs back. */
  private outsideLimits(): boolean {
    return (
      this.zoomedByUser &&
      (this.distance < this.minDistance * (1 - 1e-6) || this.distance > this.maxDistance * (1 + 1e-6))
    );
  }

  private queueZoom(factor: number, clientX: number, clientY: number, token: MotionToken, soft: boolean): void {
    const pending = this.zoomGoal - this.zoom.value;
    const goalDistance = this.distance * Math.exp(pending);
    const lo = this.minDistance * (soft ? 1 - RIG.softZoom : 1);
    const hi = this.maxDistance * (soft ? 1 + RIG.softZoom : 1);
    // Never further out of range, but always free to come back into it.
    let next = goalDistance * factor;
    if (factor < 1) next = Math.max(next, Math.min(goalDistance, lo));
    else next = Math.min(next, Math.max(goalDistance, hi));
    if (!(next > 0) || !(goalDistance > 0)) return;
    this.zoomedByUser = true;
    this.zoomGoal += Math.log(next / goalDistance);
    this.zoomToken = token;
    this.zoomAnchor = { x: clientX, y: clientY };
    this.lastZoomInput = this.clock;
    this.boing = false;
    this.userMoved = true;
    this.dirty = true;
    if (!this.host.glidesAnimate()) {
      // Still: no easing, the zoom lands at once.
      const remaining = this.zoomGoal - this.zoom.value;
      this.stopZoom();
      this.syncCameraObject();
      this.applySimilarity(this.anchorPoint(this.zoomAnchor, this.anchor), Math.exp(remaining));
      this.writePose();
    }
  }

  private stepZoom(dt: number, poseMoved: boolean): boolean {
    if (!this.zoomActive() && !this.boing && this.holding === 0 && !this.dragActive && this.outsideLimits()) {
      if (this.clock - this.lastZoomInput >= RIG.boingDelayS) {
        const inside = clamp(this.distance, this.minDistance, this.maxDistance);
        this.zoomGoal = Math.log(inside / this.distance);
        this.zoom.value = 0;
        this.zoom.velocity = 0;
        this.zoomToken = MOTION.boing;
        this.zoomAnchor = null;
        this.boing = true;
      }
    }
    if (!this.zoomActive()) {
      if (this.boing) this.boing = false;
      return false;
    }
    const before = this.zoom.value;
    if (this.host.glidesAnimate()) springTo(this.zoom, this.zoomGoal, this.zoomToken, dt);
    else {
      this.zoom.value = this.zoomGoal;
      this.zoom.velocity = 0;
    }
    const settled = Math.abs(this.zoomGoal - this.zoom.value) < 1e-5 && Math.abs(this.zoom.velocity) < 1e-3;
    if (settled) {
      this.zoom.value = this.zoomGoal;
      this.zoom.velocity = 0;
    }
    const delta = this.zoom.value - before;
    if (settled) {
      if (this.boing) this.zoomedByUser = false;
      this.zoom.value = 0;
      this.zoomGoal = 0;
      this.boing = false;
      if (this.clock - this.lastZoomInput < RIG.boingDelayS) this.lastZoomInput = this.clock;
    }
    if (delta === 0) return false;
    if (poseMoved || this.mode !== 'idle') this.syncCameraObject();
    this.applySimilarity(this.anchorPoint(this.zoomAnchor, this.anchor), Math.exp(delta));
    return true;
  }

  /** Soft limits: past [min, max] the distance stretches at most `softZoom` further. */
  private rubber(distance: number): number {
    const min = this.minDistance;
    const max = this.maxDistance;
    if (min > 0 && distance < min) {
      const span = -Math.log(1 - RIG.softZoom);
      const over = Math.log(min / distance);
      return min * Math.exp(-span * (1 - Math.exp(-over / span)));
    }
    if (Number.isFinite(max) && distance > max) {
      const span = Math.log(1 + RIG.softZoom);
      const over = Math.log(distance / max);
      return max * Math.exp(span * (1 - Math.exp(-over / span)));
    }
    return distance;
  }

  /**
   * The world point under a client pointer on the plane through the target
   * facing the camera (the target itself without a pointer). Zooming about it
   * keeps that point under the pointer.
   */
  private anchorPoint(client: { x: number; y: number } | null, out: Vector3): Vector3 {
    out.copy(this.target);
    const rect = client ? this.host.viewport() : null;
    if (!client || !rect || !(rect.width > 0) || !(rect.height > 0)) return out;
    const cam = this.camera;
    const ndcX = ((client.x - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((client.y - rect.top) / rect.height) * 2 - 1);
    if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return out;
    const ray = this.vTmp.set(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
    const forward = this.vTmp2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const denom = ray.dot(forward);
    if (!(denom > 1e-6)) return out;
    const along = this.vTmp3.copy(this.target).sub(cam.position).dot(forward) / denom;
    if (!(along > 0) || !Number.isFinite(along)) return out;
    return out.copy(cam.position).addScaledVector(ray, along);
  }

  /** Scale the whole rig (current pose and any glide's ends) about P by f. */
  private applySimilarity(p: Vector3, f: number): void {
    const scaleAbout = (v: Vector3) => v.sub(p).multiplyScalar(f).add(p);
    scaleAbout(this.target);
    this.distance *= f;
    if (this.mode === 'glide' || this.mode === 'detent' || this.mode === 'relevel') {
      const g = this.glide;
      const log = Math.log(f);
      scaleAbout(g.from.target);
      scaleAbout(g.to.target);
      g.from.logDistance += log;
      g.to.logDistance += log;
      if (g.toPosition) scaleAbout(g.toPosition);
      g.userMoved = true;
    }
  }
}
