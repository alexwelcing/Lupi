/**
 * useXRHands — hand-tracking hook backed by the raw WebXR API.
 *
 * Returns a stable ref-shaped state for each hand that updates every frame
 * inside the XR render loop. Reading from raw `XRFrame.getJointPose` keeps us
 * decoupled from any specific @react-three/xr internals so the same code keeps
 * working across minor library upgrades.
 *
 * Controllers publish through the same snapshot shape: when an input source
 * has no articulated hand but exposes a gripSpace (e.g. Touch controllers),
 * its grip pose stands in for the pinch point and the squeeze button stands
 * in for the pinch gesture. Grab code upstream never needs to distinguish
 * hands from controllers. We read the squeeze from `inputSource.gamepad`
 * (xr-standard mapping, buttons[1]) rather than session squeeze events: it
 * is polled in the same frame loop as the poses — no event plumbing, no
 * xrStore changes — and trivially mockable in tests.
 */

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export type HandLabel = 'left' | 'right';

export interface HandJointSnapshot {
  /** True only on frames where the device reports valid poses for this hand/controller. */
  present: boolean;
  /** True when thumb-tip and index-finger-tip are within PINCH_THRESHOLD (or squeeze held on a controller). */
  pinching: boolean;
  /** Pinch point (world space) — midpoint of thumb tip and index tip. */
  pinchPosition: THREE.Vector3;
  /** Smoothed pinch velocity (world space, m/s). Drives throwing. */
  pinchVelocity: THREE.Vector3;
  /** Wrist position (world space) — useful for "near hand" affordances. */
  wristPosition: THREE.Vector3;
  /** Grip point (world space) — pinch midpoint for hands, gripSpace origin for controllers. */
  gripPosition: THREE.Vector3;
  /**
   * Grip orientation (world space) — wrist joint orientation for hands,
   * gripSpace orientation for controllers. The wrist is the most stable
   * oriented joint during a pinch: fingertips wobble as the pinch flexes,
   * the wrist rotates only when the user actually turns their hand. Holds
   * its last value on frames where the runtime reports no orientation so a
   * grab in progress never snaps to identity.
   */
  gripOrientation: THREE.Quaternion;
}

export interface XRHandsState {
  left: React.MutableRefObject<HandJointSnapshot>;
  right: React.MutableRefObject<HandJointSnapshot>;
}

const PINCH_THRESHOLD_M = 0.025; // 2.5 cm — standard threshold across XR runtimes
const VELOCITY_SMOOTHING = 0.6;  // 0 = no smoothing, 1 = frozen

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

/** xr-standard gamepad mapping: buttons[1] is squeeze; fall back to the trigger. */
function isSqueezing(gamepad: { buttons?: ReadonlyArray<{ pressed: boolean }> } | null | undefined): boolean {
  const buttons = gamepad?.buttons;
  if (!buttons || buttons.length === 0) return false;
  const button = buttons[1] ?? buttons[0];
  return !!button?.pressed;
}

export function useXRHands(): XRHandsState {
  const { gl } = useThree();
  const left = useRef<HandJointSnapshot>(makeSnapshot());
  const right = useRef<HandJointSnapshot>(makeSnapshot());

  // Last frame's grip position per hand (world space) for finite-difference velocity.
  const prevPinch = useRef<{ left: THREE.Vector3 | null; right: THREE.Vector3 | null }>({
    left: null,
    right: null,
  });

  // Reusable scratch — avoid allocations every frame
  const tmpMid = useRef(new THREE.Vector3());
  const tmpVel = useRef(new THREE.Vector3());

  useFrame((_state, dt, xrFrame) => {
    const session = (gl as any).xr?.getSession?.();
    const referenceSpace = (gl as any).xr?.getReferenceSpace?.();

    if (!xrFrame || !session || !referenceSpace) {
      left.current.present = false;
      right.current.present = false;
      prevPinch.current.left = null;
      prevPinch.current.right = null;
      return;
    }

    let leftSeen = false;
    let rightSeen = false;

    // Pass 1 — articulated hands.
    for (const inputSource of session.inputSources as Iterable<any>) {
      const xrHand = inputSource.hand;
      if (!xrHand) continue;
      const handedness = inputSource.handedness as HandLabel;
      if (handedness !== 'left' && handedness !== 'right') continue;

      const indexJoint = xrHand.get('index-finger-tip');
      const thumbJoint = xrHand.get('thumb-tip');
      const wristJoint = xrHand.get('wrist');
      if (!indexJoint || !thumbJoint) continue;

      const indexPose = (xrFrame as any).getJointPose?.(indexJoint, referenceSpace);
      const thumbPose = (xrFrame as any).getJointPose?.(thumbJoint, referenceSpace);
      const wristPose = wristJoint
        ? (xrFrame as any).getJointPose?.(wristJoint, referenceSpace)
        : null;
      if (!indexPose || !thumbPose) continue;

      const ip = indexPose.transform.position;
      const tp = thumbPose.transform.position;

      const dx = ip.x - tp.x;
      const dy = ip.y - tp.y;
      const dz = ip.z - tp.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      tmpMid.current.set(
        (ip.x + tp.x) * 0.5,
        (ip.y + tp.y) * 0.5,
        (ip.z + tp.z) * 0.5,
      );

      const snap = handedness === 'left' ? left.current : right.current;
      const prev = handedness === 'left' ? prevPinch.current.left : prevPinch.current.right;

      // Smoothed velocity: blend old velocity with new instantaneous estimate.
      if (prev && dt > 1e-4) {
        tmpVel.current.copy(tmpMid.current).sub(prev).divideScalar(dt);
        snap.pinchVelocity.lerp(tmpVel.current, 1 - VELOCITY_SMOOTHING);
      } else {
        snap.pinchVelocity.set(0, 0, 0);
      }

      snap.present = true;
      snap.pinching = dist < PINCH_THRESHOLD_M;
      snap.pinchPosition.copy(tmpMid.current);
      snap.gripPosition.copy(tmpMid.current);
      if (wristPose) {
        const wp = wristPose.transform.position;
        snap.wristPosition.set(wp.x, wp.y, wp.z);
        const wo = wristPose.transform.orientation;
        if (wo) snap.gripOrientation.set(wo.x, wo.y, wo.z, wo.w);
      }

      if (handedness === 'left') {
        if (!prevPinch.current.left) prevPinch.current.left = new THREE.Vector3();
        prevPinch.current.left.copy(tmpMid.current);
        leftSeen = true;
      } else {
        if (!prevPinch.current.right) prevPinch.current.right = new THREE.Vector3();
        prevPinch.current.right.copy(tmpMid.current);
        rightSeen = true;
      }
    }

    // Pass 2 — controllers, only for sides not already covered by a hand
    // (Quest reports transient hands and controllers as separate sources;
    // an articulated hand always wins).
    for (const inputSource of session.inputSources as Iterable<any>) {
      if (inputSource.hand) continue;
      const handedness = inputSource.handedness as HandLabel;
      if (handedness !== 'left' && handedness !== 'right') continue;
      if (handedness === 'left' ? leftSeen : rightSeen) continue;

      const gripSpace = inputSource.gripSpace;
      if (!gripSpace) continue;
      const pose = (xrFrame as any).getPose?.(gripSpace, referenceSpace);
      if (!pose) continue;

      const gp = pose.transform.position;
      tmpMid.current.set(gp.x, gp.y, gp.z);

      const snap = handedness === 'left' ? left.current : right.current;
      const prev = handedness === 'left' ? prevPinch.current.left : prevPinch.current.right;

      if (prev && dt > 1e-4) {
        tmpVel.current.copy(tmpMid.current).sub(prev).divideScalar(dt);
        snap.pinchVelocity.lerp(tmpVel.current, 1 - VELOCITY_SMOOTHING);
      } else {
        snap.pinchVelocity.set(0, 0, 0);
      }

      snap.present = true;
      snap.pinching = isSqueezing(inputSource.gamepad);
      snap.pinchPosition.copy(tmpMid.current);
      snap.gripPosition.copy(tmpMid.current);
      snap.wristPosition.copy(tmpMid.current);
      const go = pose.transform.orientation;
      if (go) snap.gripOrientation.set(go.x, go.y, go.z, go.w);

      if (handedness === 'left') {
        if (!prevPinch.current.left) prevPinch.current.left = new THREE.Vector3();
        prevPinch.current.left.copy(tmpMid.current);
        leftSeen = true;
      } else {
        if (!prevPinch.current.right) prevPinch.current.right = new THREE.Vector3();
        prevPinch.current.right.copy(tmpMid.current);
        rightSeen = true;
      }
    }

    if (!leftSeen) {
      left.current.present = false;
      left.current.pinching = false;
      prevPinch.current.left = null;
    }
    if (!rightSeen) {
      right.current.present = false;
      right.current.pinching = false;
      prevPinch.current.right = null;
    }
  });

  return { left, right };
}
