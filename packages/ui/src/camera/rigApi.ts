/**
 * rigApi.ts — the camera-rig contract.
 *
 * The Lupi camera rig (drag, coast, glide, detents) registers itself here
 * while mounted; toys, the relay and UI call it through `getCameraRig()` and
 * never import the rig. Conventions: ω is the molecule's apparent angular
 * velocity in world space (rad/s); `camera.up` is never mutated; the store's
 * camera is written only when motion settles.
 *
 * Programmatic camera writes (MCP, saved views, URL decode, gallery loads)
 * stay instant; only UI writes wrapped in `withCameraGlide()` animate.
 *
 * Contract file: additive edits only.
 */
import type { MotionToken } from '@atlas/core/motion';

export type Vec3 = [number, number, number];

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

export interface CoastModel {
  begin(omegaWorld: Vec3): void;
  /** Advance by a fixed step; write the apparent body rotation increment (world) as [x,y,z,w]; return |ω| (rad/s). */
  step(dt: number, outDeltaQuat: [number, number, number, number]): number;
  stop(): void;
}

export interface Detent {
  dir: Vec3;
  label: string;
  kind: 'ring-face' | 'plane-face' | 'plane-edge' | 'principal';
  order?: number;
}

export interface DetentProvider {
  readonly captureRadiusDeg: number;
  capture(viewDir: Vec3, viewDirVelocity: Vec3 | null): Detent | null;
  step(viewDir: Vec3, screenRight: Vec3, screenUp: Vec3, dx: number, dy: number): Detent | null;
}

export interface LupiCameraRigApi {
  /** Start a coast; a no-op unless coastEnabled(). */
  fling(omegaWorld: Vec3): void;
  catch(): void;
  glideTo(
    pose: { position: Vec3; target: Vec3 },
    opts?: { token?: MotionToken; userMoved?: boolean; onDone?(): void },
  ): void;
  zoomToward(clientX: number, clientY: number, factor: number): void;
  /** null → the isotropic default. */
  setCoastModel(model: CoastModel | null): void;
  setDetentProvider(provider: DetentProvider | null): void;
  isMoving(): boolean;
  /** Stop, re-level, and write the camera and store synchronously. */
  settleNow(): void;
  pose(): CameraPose;
  restCount(): number;
}

let rig: LupiCameraRigApi | null = null;

/** Register the mounted rig; returns the unregister. */
export function registerCameraRig(api: LupiCameraRigApi): () => void {
  rig = api;
  return () => {
    if (rig === api) rig = null;
  };
}

export function getCameraRig(): LupiCameraRigApi | null {
  return rig;
}

let glideDepth = 0;

/**
 * Run `fn` (a UI camera write such as a preset or Recenter) as a glide:
 * store writes made inside it animate when a rig is mounted and comfort
 * allows. Everything outside stays an instant snap.
 */
export function withCameraGlide<T>(fn: () => T): T {
  glideDepth += 1;
  try {
    return fn();
  } finally {
    glideDepth -= 1;
  }
}

/**
 * True while inside `withCameraGlide` (the camera manager asks this from its
 * synchronous store subscription). It stays true for every store write within
 * the wrapped call, and false everywhere else.
 */
export function consumeCameraGlideRequest(): boolean {
  return glideDepth > 0;
}
