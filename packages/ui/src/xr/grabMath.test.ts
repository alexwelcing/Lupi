// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  type GripPose,
  makeGripPose,
  makeRigidDelta,
  makeTwoHandDelta,
  oneHandDelta,
  twoHandTransform,
  twistAround,
  dampFactor,
  dampScalar,
  dampVector3,
  dampQuaternion,
  angularVelocityFromDelta,
  TWO_HAND_SCALE_STEP_MIN,
  TWO_HAND_SCALE_STEP_MAX,
} from './grabMath';

/** Apply the module's delta convention: pos' = dq * (s * pos) + dp. */
function applyDelta(
  pos: THREE.Vector3,
  delta: { deltaPos: THREE.Vector3; deltaQuat: THREE.Quaternion },
  scale = 1,
): THREE.Vector3 {
  return pos.clone().multiplyScalar(scale).applyQuaternion(delta.deltaQuat).add(delta.deltaPos);
}

function pose(x: number, y: number, z: number, quat = new THREE.Quaternion()): GripPose {
  const p = makeGripPose();
  p.position.set(x, y, z);
  p.quaternion.copy(quat);
  return p;
}

function quatY(deg: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
}

function quatX(deg: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(deg));
}

function expectVec(v: THREE.Vector3, x: number, y: number, z: number, digits = 6) {
  expect(v.x).toBeCloseTo(x, digits);
  expect(v.y).toBeCloseTo(y, digits);
  expect(v.z).toBeCloseTo(z, digits);
}

describe('oneHandDelta', () => {
  it('pure translation carries any point by the hand translation', () => {
    const out = makeRigidDelta();
    const q = new THREE.Quaternion();
    oneHandDelta(new THREE.Vector3(0.1, 1, -0.5), q, new THREE.Vector3(0.3, 1.2, -0.5), q, out);

    expect(out.deltaQuat.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
    const moved = applyDelta(new THREE.Vector3(2, 0, 1), out);
    expectVec(moved, 2.2, 0.2, 1);
  });

  it('rotates the object about the grab point, not the object origin', () => {
    const out = makeRigidDelta();
    const handPos = new THREE.Vector3(0, 1, 0); // hand stays put, wrist turns 90° about y
    oneHandDelta(handPos, new THREE.Quaternion(), handPos, quatY(90), out);

    // The grab point itself must not move.
    expectVec(applyDelta(handPos.clone(), out), 0, 1, 0);
    // A point 1 m along +x from the hand swings onto -z (90° about y).
    expectVec(applyDelta(new THREE.Vector3(1, 1, 0), out), 0, 1, -1);
  });

  it('composed move+rotate maps the previous hand position onto the current one', () => {
    const out = makeRigidDelta();
    const prev = new THREE.Vector3(0.2, 0.9, -0.4);
    const cur = new THREE.Vector3(-0.1, 1.1, -0.6);
    oneHandDelta(prev, quatY(10), cur, quatY(55), out);

    expectVec(applyDelta(prev.clone(), out), cur.x, cur.y, cur.z);
    expect(out.deltaQuat.angleTo(quatY(45))).toBeCloseTo(0, 6);
  });
});

describe('twoHandTransform', () => {
  it('extracts uniform scale within the per-frame clamp and keeps the midpoint fixed', () => {
    const out = makeTwoHandDelta();
    twoHandTransform(
      pose(-0.1, 1, 0), pose(0.1, 1, 0),
      pose(-0.102, 1, 0), pose(0.102, 1, 0),
      out,
    );
    expect(out.scaleFactor).toBeCloseTo(1.02, 6);
    expect(out.deltaQuat.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
    expectVec(applyDelta(new THREE.Vector3(0, 1, 0), out, out.scaleFactor), 0, 1, 0);
    // Hand B maps exactly onto its new position.
    expectVec(applyDelta(new THREE.Vector3(0.1, 1, 0), out, out.scaleFactor), 0.102, 1, 0);
  });

  it('clamps the per-frame scale step to the tracking-glitch band', () => {
    const out = makeTwoHandDelta();
    twoHandTransform(
      pose(-0.1, 0, 0), pose(0.1, 0, 0),
      pose(-1, 0, 0), pose(1, 0, 0),
      out,
    );
    expect(out.scaleFactor).toBe(TWO_HAND_SCALE_STEP_MAX);

    twoHandTransform(
      pose(-1, 0, 0), pose(1, 0, 0),
      pose(-0.1, 0, 0), pose(0.1, 0, 0),
      out,
    );
    expect(out.scaleFactor).toBe(TWO_HAND_SCALE_STEP_MIN);
    // Even with a clamped scale, the midpoint mapping stays exact.
    expectVec(applyDelta(new THREE.Vector3(0, 0, 0), out, out.scaleFactor), 0, 0, 0);
  });

  it('extracts the swing rotating the prev grip axis onto the current one', () => {
    const out = makeTwoHandDelta();
    // A→B axis turns from +x to +z: -90° about y.
    twoHandTransform(
      pose(-1, 0, 0), pose(1, 0, 0),
      pose(0, 0, -1), pose(0, 0, 1),
      out,
    );
    expect(out.scaleFactor).toBeCloseTo(1, 6);
    expect(out.deltaQuat.angleTo(quatY(-90))).toBeCloseTo(0, 6);
    expectVec(applyDelta(new THREE.Vector3(1, 0, 0), out, out.scaleFactor), 0, 0, 1);
  });

  it('recovers roll about the grip axis from the hand orientation deltas', () => {
    const out = makeTwoHandDelta();
    const roll = quatX(30); // both wrists roll 30° about the x grip axis
    twoHandTransform(
      pose(-1, 0, 0), pose(1, 0, 0),
      pose(-1, 0, 0, roll), pose(1, 0, 0, roll),
      out,
    );
    expect(out.deltaQuat.angleTo(roll)).toBeCloseTo(0, 5);
  });

  it('falls back to axis-only rotation when hand orientations do not agree on roll', () => {
    const out = makeTwoHandDelta();
    // Opposite rolls cancel in the average: no roll, identity overall.
    twoHandTransform(
      pose(-1, 0, 0), pose(1, 0, 0),
      pose(-1, 0, 0, quatX(20)), pose(1, 0, 0, quatX(-20)),
      out,
    );
    expect(out.deltaQuat.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 5);
  });

  it('translates by the grip midpoint delta', () => {
    const out = makeTwoHandDelta();
    twoHandTransform(
      pose(-0.1, 1, 0), pose(0.1, 1, 0),
      pose(0.1, 1.3, -0.2), pose(0.3, 1.3, -0.2),
      out,
    );
    expectVec(applyDelta(new THREE.Vector3(0, 1, 0), out, out.scaleFactor), 0.2, 1.3, -0.2);
  });
});

describe('twistAround', () => {
  it('extracts the full rotation when it is purely about the axis', () => {
    const out = new THREE.Quaternion();
    twistAround(quatY(40), new THREE.Vector3(0, 1, 0), out);
    expect(out.angleTo(quatY(40))).toBeCloseTo(0, 6);
  });

  it('returns identity for a rotation perpendicular to the axis', () => {
    const out = new THREE.Quaternion();
    twistAround(quatX(90), new THREE.Vector3(0, 1, 0), out);
    expect(out.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
  });
});

describe('smoothing', () => {
  it('dampFactor is frame-rate independent: two half steps equal one full step', () => {
    const rate = 20;
    const dt = 1 / 30;
    const full = dampScalar(0, 1, rate, dt);
    const half = dampScalar(dampScalar(0, 1, rate, dt / 2), 1, rate, dt / 2);
    expect(half).toBeCloseTo(full, 10);
  });

  it('dampVector3 converges onto the target', () => {
    const cur = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(1, -2, 3);
    for (let i = 0; i < 120; i++) dampVector3(cur, target, 20, 1 / 60);
    expect(cur.distanceTo(target)).toBeLessThan(1e-6);
  });

  it('dampQuaternion converges onto the target', () => {
    const cur = new THREE.Quaternion();
    const target = quatY(120);
    for (let i = 0; i < 120; i++) dampQuaternion(cur, target, 15, 1 / 60);
    expect(cur.angleTo(target)).toBeLessThan(1e-4);
  });

  it('dampFactor stays in [0, 1], saturating for huge steps', () => {
    expect(dampFactor(20, 0)).toBe(0);
    expect(dampFactor(20, 0.5)).toBeLessThan(1);
    expect(dampFactor(20, 0.5)).toBeGreaterThan(0.99);
    expect(dampFactor(20, 10)).toBeLessThanOrEqual(1); // exp underflow → exact 1
  });
});

describe('angularVelocityFromDelta', () => {
  it('converts a per-frame rotation delta into axis * rad/s', () => {
    const out = new THREE.Vector3();
    angularVelocityFromDelta(quatY(90), 0.1, out);
    expectVec(out, 0, Math.PI / 2 / 0.1, 0, 4);
  });

  it('is zero for identity deltas and degenerate dt', () => {
    const out = new THREE.Vector3(9, 9, 9);
    angularVelocityFromDelta(new THREE.Quaternion(), 0.1, out);
    expectVec(out, 0, 0, 0);
    angularVelocityFromDelta(quatY(90), 0, out.set(9, 9, 9));
    expectVec(out, 0, 0, 0);
  });

  it('takes the short arc for negative-w quaternions', () => {
    const q = quatY(90);
    q.set(-q.x, -q.y, -q.z, -q.w); // same rotation, flipped sign
    const out = new THREE.Vector3();
    angularVelocityFromDelta(q, 0.1, out);
    expectVec(out, 0, Math.PI / 2 / 0.1, 0, 4);
  });
});
