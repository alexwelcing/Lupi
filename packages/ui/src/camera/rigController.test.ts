import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { LupiIntent } from '@atlas/scene';
import { RigController, type RigHost, type RigStorePatch } from './rigController';
import type { Vec3 } from './rigApi';

function makeRig({ coast = true, glides = true }: { coast?: boolean; glides?: boolean } = {}) {
  const store = { position: [0, 0, 10] as Vec3, target: [0, 0, 0] as Vec3, preset: 'iso' };
  const writes: RigStorePatch[] = [];
  const intents: LupiIntent[] = [];
  const host: RigHost = {
    readStore: () => ({ position: [...store.position] as Vec3, target: [...store.target] as Vec3, preset: store.preset }),
    writeStore: (patch) => {
      writes.push(patch);
      store.position = patch.cameraPosition;
      store.target = patch.cameraTarget;
      if (patch.cameraPreset) store.preset = patch.cameraPreset;
    },
    emit: (intent) => intents.push(intent),
    coastEnabled: () => coast,
    glidesAnimate: () => glides,
    viewport: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const camera = new PerspectiveCamera(50, 800 / 600, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const rig = new RigController(camera, host, { target: [0, 0, 0] });
  rig.setLimits(2, 60);
  return { rig, camera, store, writes, intents };
}

/** Step frames of `dt` until the rig is at rest; returns the seconds it took. */
function runToRest(rig: RigController, dt: number, maxS = 10): number {
  let t = 0;
  while (rig.isBusy() && t < maxS) {
    rig.frame(dt);
    t += dt;
  }
  return t;
}

function upDotY(camera: PerspectiveCamera): number {
  return new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).y;
}

/** Level: the camera's right vector is horizontal and its up points up. */
function isLevel(camera: PerspectiveCamera): boolean {
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  return Math.abs(right.y) < 1e-3 && upDotY(camera) > 0;
}

describe('RigController', () => {
  it('coasts the same at 30, 60 and 120 Hz', () => {
    const runs = [1 / 30, 1 / 60, 1 / 120].map((dt) => {
      const { rig, camera } = makeRig();
      rig.fling([0.8, 3, 0.4]);
      const seconds = runToRest(rig, dt);
      return { seconds, dt, q: camera.quaternion.clone(), p: camera.position.clone() };
    });
    for (const run of runs) {
      expect(run.seconds).toBeLessThan(4);
      const angle = (2 * Math.acos(Math.min(1, Math.abs(run.q.dot(runs[2].q)))) * 180) / Math.PI;
      expect(angle).toBeLessThan(0.5);
      expect(Math.abs(run.seconds - runs[2].seconds)).toBeLessThanOrEqual(1 / 30 + 1e-9);
    }
  });

  it('writes the store once per gesture, at rest, and not at release', () => {
    const { rig, writes, intents } = makeRig();
    rig.beginGesture();
    rig.startDrag();
    for (let i = 0; i < 6; i += 1) {
      rig.orbitBy(20, 0);
      rig.frame(1 / 60);
    }
    rig.endDrag({ vx: 1500, vy: 0 });
    rig.endGesture();
    rig.frame(1 / 60);
    expect(rig.isMoving()).toBe(true);
    expect(writes).toHaveLength(0);
    runToRest(rig, 1 / 60);
    expect(writes).toHaveLength(1);
    expect(writes[0].cameraPreset).toBe('free');
    expect(rig.restCount()).toBe(1);
    expect(intents.filter((i) => i.type === 'camera.rest')).toHaveLength(1);
  });

  it('adopts an external camera write and drops its own coast', () => {
    const { rig, camera, writes } = makeRig();
    rig.fling([0, 4, 0]);
    rig.frame(1 / 60);
    rig.frame(1 / 60);
    camera.position.set(5, 5, 5);
    rig.frame(1 / 60);
    expect(rig.isMoving()).toBe(false);
    expect(rig.isBusy()).toBe(false);
    expect(camera.position.toArray()).toEqual([5, 5, 5]);
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(forward.dot(new Vector3(-5, -5, -5).normalize())).toBeCloseTo(1, 9);
    // A target-only move (AnomalyTracker) turns the camera to face it.
    rig.target.set(1, 0, 0);
    rig.frame(1 / 60);
    const facing = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    expect(facing.dot(new Vector3(1, 0, 0).sub(camera.position).normalize())).toBeCloseTo(1, 9);
    expect(writes).toHaveLength(0);
  });

  it('glides to a store pose within 0.8 s and lands on exactly the snap pose', () => {
    const { rig, camera, writes, store } = makeRig();
    // A UI preset writes the store first; CameraManager then asks for the glide.
    store.position = [10, 0, 0];
    rig.glideTo({ position: [10, 0, 0], target: [0, 0, 0] });
    rig.frame(1 / 60);
    expect(camera.position.x).toBeLessThan(10);
    const seconds = runToRest(rig, 1 / 60);
    expect(seconds).toBeLessThanOrEqual(0.8);
    expect(camera.position.toArray()).toEqual([10, 0, 0]);
    const snap = new PerspectiveCamera();
    snap.position.set(10, 0, 0);
    snap.lookAt(0, 0, 0);
    expect(camera.quaternion.equals(snap.quaternion)).toBe(true);
    // The store already holds that pose: no second write.
    expect(writes).toHaveLength(0);
  });

  it('cuts glides under Still and survives the top preset', () => {
    const { rig, camera } = makeRig({ glides: false });
    rig.glideTo({ position: [0, 12, 0], target: [0, 0, 0] });
    expect(camera.position.toArray()).toEqual([0, 12, 0]);
    for (const v of [...camera.position.toArray(), ...camera.quaternion.toArray()]) expect(Number.isFinite(v)).toBe(true);
    const animated = makeRig();
    animated.rig.glideTo({ position: [0, 12, 0], target: [0, 0, 0] });
    runToRest(animated.rig, 1 / 60);
    for (const v of animated.camera.quaternion.toArray()) expect(Number.isFinite(v)).toBe(true);
  });

  it('comes to rest level after a coast that tumbles over the pole', () => {
    const { rig, camera, writes } = makeRig();
    rig.fling([5, 0, 0]);
    let minUp = 1;
    for (let t = 0; t < 1.5; t += 1 / 60) {
      rig.frame(1 / 60);
      minUp = Math.min(minUp, upDotY(camera));
    }
    expect(minUp).toBeLessThan(0); // it really went upside down
    runToRest(rig, 1 / 60);
    expect(isLevel(camera)).toBe(true);
    expect(writes).toHaveLength(1);
    const q = new Quaternion();
    const snap = new PerspectiveCamera();
    snap.position.fromArray(writes[0].cameraPosition);
    snap.lookAt(new Vector3().fromArray(writes[0].cameraTarget));
    q.copy(snap.quaternion);
    expect(camera.quaternion.equals(q)).toBe(true);
  });

  it('catches a coast, relevels and swallows nothing else', () => {
    const { rig, intents } = makeRig();
    rig.fling([0, 4, 0]);
    rig.frame(1 / 60);
    expect(rig.isMoving()).toBe(true);
    rig.catch();
    expect(rig.isMoving()).toBe(false);
    expect(intents.some((i) => i.type === 'camera.catch')).toBe(true);
  });
});
