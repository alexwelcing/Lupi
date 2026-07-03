import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { useXR } from '@react-three/xr';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type { HandJointSnapshot } from './useXRHands';
import { XRMoleculeInteraction } from './XRMoleculeInteraction';

// setupTests.ts already mocks @react-three/xr's useXR (default mode 'inline');
// individual tests override the mode below. Hand tracking is mocked at the
// hook boundary so tests drive plain snapshot objects instead of WebXR frames.
function makeSnapshot(): HandJointSnapshot {
  return {
    present: false,
    pinching: false,
    pinchPosition: new THREE.Vector3(),
    pinchVelocity: new THREE.Vector3(),
    wristPosition: new THREE.Vector3(),
    gripPosition: new THREE.Vector3(),
    gripOrientation: new THREE.Quaternion(),
  };
}

const mockHands = {
  left: { current: makeSnapshot() },
  right: { current: makeSnapshot() },
};

vi.mock('./useXRHands', () => ({
  useXRHands: () => mockHands,
}));

function setMode(mode: string) {
  vi.mocked(useXR).mockImplementation((selector: any) =>
    selector ? selector({ mode }) : { mode },
  );
}

function resetSnapshot(snap: HandJointSnapshot) {
  snap.present = false;
  snap.pinching = false;
  snap.pinchPosition.set(0, 0, 0);
  snap.pinchVelocity.set(0, 0, 0);
  snap.wristPosition.set(0, 0, 0);
  snap.gripPosition.set(0, 0, 0);
  snap.gripOrientation.identity();
}

async function mount() {
  const renderer = await ReactThreeTestRenderer.create(
    <XRMoleculeInteraction>
      <mesh />
    </XRMoleculeInteraction>,
  );
  const group = renderer.scene.children[0];
  return { renderer, group, three: group.instance as unknown as THREE.Group };
}

const fakeRay = (x: number, y: number) => ({
  intersectPlane: (_plane: THREE.Plane, target: THREE.Vector3) => target.set(x, y, 0),
});

describe('XRMoleculeInteraction', () => {
  beforeEach(() => {
    resetSnapshot(mockHands.left.current);
    resetSnapshot(mockHands.right.current);
    setMode('inline');
  });

  it('non-immersive: pointer drag rotates the molecule', async () => {
    const { renderer, group, three } = await mount();

    await renderer.fireEvent(group, 'pointerDown', {
      stopPropagation: () => {},
      point: new THREE.Vector3(0, 0, 0),
      ray: fakeRay(0, 0),
    });
    await renderer.fireEvent(group, 'pointerMove', {
      stopPropagation: () => {},
      ray: fakeRay(0.1, 0),
    });

    expect(three.rotation.y).toBeGreaterThan(0);
  });

  it('non-immersive: wheel zoom composes with the hover pulse instead of being clobbered', async () => {
    const { renderer, group, three } = await mount();

    await renderer.fireEvent(group, 'wheel', { stopPropagation: () => {}, deltaY: 100 });
    await renderer.fireEvent(group, 'wheel', { stopPropagation: () => {}, deltaY: 100 });
    await renderer.advanceFrames(60, 1 / 60);

    // Two 0.9× wheel steps → interaction scale 0.81; pulse settles at 1.
    expect(three.scale.x).toBeCloseTo(0.81, 2);
  });

  it('non-immersive: hand pinches are ignored', async () => {
    const { renderer, three } = await mount();
    const right = mockHands.right.current;
    right.present = true;
    right.pinching = true;
    right.gripPosition.set(0.1, 0.3, 0);

    await renderer.advanceFrames(30, 1 / 30);

    expect(three.position.length()).toBeCloseTo(0, 6);
  });

  it('immersive: pinch within reach grabs; the molecule follows the hand', async () => {
    setMode('immersive-ar');
    const { renderer, three } = await mount();
    const right = mockHands.right.current;
    right.present = true;
    right.pinching = true;
    right.gripPosition.set(0.1, 0, 0);

    await renderer.advanceFrames(1, 1 / 60); // grab frame
    right.gripPosition.set(0.1, 0.3, 0);
    await renderer.advanceFrames(60, 1 / 30); // converge through smoothing

    expect(three.position.y).toBeGreaterThan(0.29);
    expect(three.position.x).toBeCloseTo(0, 2);
  });

  it('immersive: a pinch outside GRAB_RADIUS does not grab', async () => {
    setMode('immersive-ar');
    const { renderer, three } = await mount();
    const right = mockHands.right.current;
    right.present = true;
    right.pinching = true;
    right.gripPosition.set(2, 0, 0);

    await renderer.advanceFrames(2, 1 / 60);
    right.gripPosition.set(2, 0.5, 0);
    await renderer.advanceFrames(30, 1 / 30);

    expect(three.position.y).toBeCloseTo(0, 6);
  });

  it('immersive: wrist rotation while held rotates the molecule', async () => {
    setMode('immersive-ar');
    const { renderer, three } = await mount();
    const right = mockHands.right.current;
    right.present = true;
    right.pinching = true;
    right.gripPosition.set(0.1, 0, 0);

    await renderer.advanceFrames(1, 1 / 60); // grab
    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    right.gripOrientation.copy(target);
    await renderer.advanceFrames(60, 1 / 30);

    expect(three.quaternion.angleTo(target)).toBeLessThan(0.05);
  });

  it('immersive: second pinch enters two-hand mode and spreading hands scales up', async () => {
    setMode('immersive-ar');
    const { renderer, three } = await mount();
    const left = mockHands.left.current;
    const right = mockHands.right.current;
    left.present = true;
    right.present = true;
    left.gripPosition.set(-0.1, 0, 0);
    right.gripPosition.set(0.1, 0, 0);
    right.pinching = true;

    await renderer.advanceFrames(1, 1 / 60); // right grabs
    left.pinching = true;
    await renderer.advanceFrames(1, 1 / 60); // left joins → two-hand

    // Spread the hands 2% per frame — inside the per-frame clamp band.
    let half = 0.1;
    for (let i = 0; i < 30; i++) {
      half *= 1.02;
      left.gripPosition.set(-half, 0, 0);
      right.gripPosition.set(half, 0, 0);
      await renderer.advanceFrames(1, 1 / 60);
    }
    await renderer.advanceFrames(10, 1 / 60);

    // interaction scale ≈ 1.02^30 ≈ 1.81, times the grabbed pulse (≤1.06)
    expect(three.scale.x).toBeGreaterThan(1.5);
    // Midpoint never moved, so neither should the molecule.
    expect(three.position.length()).toBeLessThan(0.01);
  });

  it('immersive: releasing one hand of two hands back off to a one-hand grab without a jump', async () => {
    setMode('immersive-ar');
    const { renderer, three } = await mount();
    const left = mockHands.left.current;
    const right = mockHands.right.current;
    left.present = true;
    right.present = true;
    left.gripPosition.set(-0.1, 0, 0);
    right.gripPosition.set(0.1, 0, 0);
    right.pinching = true;

    await renderer.advanceFrames(1, 1 / 60);
    left.pinching = true;
    await renderer.advanceFrames(5, 1 / 60);

    left.pinching = false; // secondary lets go
    const before = three.position.clone();
    await renderer.advanceFrames(1, 1 / 60);
    expect(three.position.distanceTo(before)).toBeLessThan(0.005);

    // Still held: the surviving hand keeps driving the molecule.
    right.gripPosition.set(0.1, 0.2, 0);
    await renderer.advanceFrames(60, 1 / 30);
    expect(three.position.y).toBeGreaterThan(0.19);
  });

  it('immersive: primary release while two-handed hands off to the second hand', async () => {
    setMode('immersive-ar');
    const { renderer, three } = await mount();
    const left = mockHands.left.current;
    const right = mockHands.right.current;
    left.present = true;
    right.present = true;
    left.gripPosition.set(-0.1, 0, 0);
    right.gripPosition.set(0.1, 0, 0);
    right.pinching = true; // right becomes primary

    await renderer.advanceFrames(1, 1 / 60);
    left.pinching = true;
    await renderer.advanceFrames(5, 1 / 60);

    right.pinching = false; // primary lets go — left takes over
    await renderer.advanceFrames(1, 1 / 60);
    left.gripPosition.set(-0.1, 0.25, 0);
    await renderer.advanceFrames(60, 1 / 30);

    expect(three.position.y).toBeGreaterThan(0.24);
  });

  it('immersive: release throws with hand velocity and gravity takes over', async () => {
    setMode('immersive-ar');
    const { renderer, three } = await mount();
    const right = mockHands.right.current;
    right.present = true;
    right.pinching = true;
    right.gripPosition.set(0.1, 0, 0);

    await renderer.advanceFrames(2, 1 / 60);
    right.pinchVelocity.set(0, 2, 0);
    right.pinching = false;
    await renderer.advanceFrames(6, 1 / 60); // ~0.1 s of flight

    // v0 = 2 * 1.15 → y ≈ 0.23 - g/2 t² ≈ 0.19
    expect(three.position.y).toBeGreaterThan(0.1);
  });

  it('immersive: released molecule keeps spinning from the wrist motion', async () => {
    setMode('immersive-ar');
    const { renderer, three } = await mount();
    const right = mockHands.right.current;
    right.present = true;
    right.pinching = true;
    right.gripPosition.set(0.1, 0, 0);
    await renderer.advanceFrames(1, 1 / 60);

    // Steady wrist rotation to build angular velocity.
    let angle = 0;
    for (let i = 0; i < 20; i++) {
      angle += 0.05;
      right.gripOrientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      await renderer.advanceFrames(1, 1 / 60);
    }

    right.pinching = false;
    await renderer.advanceFrames(1, 1 / 60);
    const atRelease = three.quaternion.clone();
    await renderer.advanceFrames(10, 1 / 60);

    expect(three.quaternion.angleTo(atRelease)).toBeGreaterThan(0.02);
  });
});
