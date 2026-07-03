/**
 * XRMoleculeInteraction
 * ---------------------
 *
 * Wraps the molecule mesh and provides three layers of interaction:
 *
 *  1. **Pointer / mouse drag** (legacy) — used in 2D viewport and as a fallback
 *     when the XR runtime forwards controller rays as pointer events. Drag
 *     rotates, wheel zooms.
 *
 *  2. **Grab manipulation** — in an immersive session either hand can pinch
 *     (thumb tip + index tip < 2.5 cm), or a controller can squeeze, within
 *     reach of the model to grab it. One hand moves AND rotates the model
 *     rigidly about the grab point, so turning the wrist turns the molecule
 *     like a held object. A second pinch while held enters two-hand mode:
 *     translate with the grip midpoint, rotate with the grip axis (plus roll
 *     from the wrists), scale with grip separation. Releasing either hand
 *     re-anchors cleanly back to a one-hand grab without a jump.
 *
 *  3. **Throw physics** — once released, the molecule retains the hand's
 *     linear velocity plus its recent spin, falls under gravity, and bounces
 *     off a virtual floor at y=0 (with damping) so it settles instead of
 *     clipping through the ground.
 *
 * Grab targets are smoothed with frame-rate-independent exponential damping
 * (see grabMath) so tracked-joint jitter never reaches the model. The
 * grabbed "squish" pulse is a separate multiplier composed with the
 * interaction (two-hand zoom / wheel) scale each frame — neither ever
 * overwrites the other.
 *
 * The visual scaling and the AR entry animation live in `SpatialAnchor` —
 * this component only mutates a single inner group's transform. The parent
 * anchor is translation-only, so world-space rotation deltas apply to the
 * local quaternion directly; only positions need world↔local conversion.
 */

import React, { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useXR } from '@react-three/xr';
import { useXRHands, type HandLabel, type HandJointSnapshot } from './useXRHands';
import {
  type GripPose,
  makeGripPose,
  makeRigidDelta,
  makeTwoHandDelta,
  oneHandDelta,
  twoHandTransform,
  dampScalar,
  dampVector3,
  dampQuaternion,
  angularVelocityFromDelta,
} from './grabMath';

// Tunables — feel free to tweak. These were chosen to feel "Quest-grade":
// reachable without lunging, throw weight similar to a tennis ball, soft
// floor bounce that always comes to rest.
const GRAB_RADIUS_M = 0.5;     // a hand within 50 cm of model center can grab
const GRAVITY_M_S2  = 6.5;     // softened gravity — a real-feeling 9.8 makes it crash
const RESTITUTION   = 0.45;    // floor bounce energy retained per hit
const AIR_DAMPING   = 0.995;   // ~0.5% velocity bleed per frame in flight
const FLOOR_FRICTION = 0.78;   // horizontal friction on contact
const FLOOR_Y_M     = 0.0;     // world-y of the virtual floor
const MIN_REST_VEL  = 0.06;    // below this, freeze to silence jitter
const THROW_SCALE   = 1.15;    // small momentum boost so a flick feels alive
const HOVER_SCALE   = 1.06;    // visual squish when grabbed/hovered
const PULSE_RATE    = 12;      // 1/s — squish pulse damping rate
const POS_SMOOTH_RATE = 20;    // 1/s — held-position damping toward the grab target
const ROT_SMOOTH_RATE = 15;    // 1/s — held-rotation slerp rate toward the grab target
const SPIN_DAMPING  = 1.5;     // 1/s — angular velocity bleed after release
const SPIN_SAMPLE_BLEND = 0.4; // smoothing of per-frame spin estimates (matches hand velocity)
const SCALE_TOTAL_MIN = 0.25;  // two-hand / wheel zoom bounds relative to base scale
const SCALE_TOTAL_MAX = 4;

export function XRMoleculeInteraction({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);

  // Mode comes from @react-three/xr; we only enable hand grab + throw in immersive sessions.
  const mode = useXR(state => state.mode);
  const isImmersive = mode === 'immersive-ar' || mode === 'immersive-vr';

  const hands = useXRHands();

  // Live grip views — the snapshot vectors are stable objects, so these
  // GripPose wrappers stay valid for the component's lifetime.
  const leftGrip = useRef<GripPose>({
    position: hands.left.current.gripPosition,
    quaternion: hands.left.current.gripOrientation,
  });
  const rightGrip = useRef<GripPose>({
    position: hands.right.current.gripPosition,
    quaternion: hands.right.current.gripOrientation,
  });

  // Grab state
  const grabbedBy = useRef<HandLabel | null>(null);   // primary hand
  const secondHand = useRef<HandLabel | null>(null);  // non-null → two-hand mode
  const prevPrimary = useRef<GripPose>(makeGripPose());
  const prevSecondary = useRef<GripPose>(makeGripPose());
  const targetPos = useRef(new THREE.Vector3());      // grab target, world space
  const targetQuat = useRef(new THREE.Quaternion());  // grab target, world == local (translation-only parent)
  const interactionScale = useRef(1);                 // accumulated two-hand / wheel zoom
  const pulseScale = useRef(1);                       // grabbed squish multiplier

  // Physics state
  const velocity = useRef(new THREE.Vector3());
  const angularVelocity = useRef(new THREE.Vector3()); // axis * rad/s

  // Reusable scratch
  const worldPos = useRef(new THREE.Vector3());
  const localTarget = useRef(new THREE.Vector3());
  const spinSample = useRef(new THREE.Vector3());
  const spinStep = useRef(new THREE.Quaternion());
  const oneDelta = useRef(makeRigidDelta());
  const twoDelta = useRef(makeTwoHandDelta());

  // Pointer-drag fallback state (mouse + controller-ray pointer events)
  const [isDragging, setIsDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const dragPlane = useRef(new THREE.Plane());
  const lastPoint = useRef(new THREE.Vector3());
  const { camera } = useThree();

  // ─── Pointer fallback handlers (unchanged behavior from prior version) ──
  const handlePointerDown = (e: any) => {
    if (isImmersive) return; // hand tracking owns interaction in XR
    e.stopPropagation();
    setIsDragging(true);
    const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
    dragPlane.current.setFromNormalAndCoplanarPoint(normal, e.point);
    const ray = e.ray as THREE.Ray;
    const intersection = new THREE.Vector3();
    const hit = ray.intersectPlane(dragPlane.current, intersection);
    if (hit) lastPoint.current.copy(hit);
    else lastPoint.current.copy(e.point);
    if (e.target?.setPointerCapture) {
      try { e.target.setPointerCapture(e.pointerId); } catch {}
    }
  };

  const handlePointerUp = (e: any) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (e.target?.releasePointerCapture) {
      try { e.target.releasePointerCapture(e.pointerId); } catch {}
    }
  };

  const handlePointerMove = (e: any) => {
    if (isImmersive) return;
    if (!isDragging || !group.current) return;
    e.stopPropagation();
    const ray = e.ray as THREE.Ray;
    const intersection = new THREE.Vector3();
    const hit = ray.intersectPlane(dragPlane.current, intersection);
    if (hit) {
      const dx = intersection.x - lastPoint.current.x;
      const dy = intersection.y - lastPoint.current.y;
      group.current.rotation.y += dx * 5;
      group.current.rotation.x -= dy * 5;
      lastPoint.current.copy(intersection);
    }
  };

  const handleWheel = (e: any) => {
    if (isImmersive) return;
    e.stopPropagation();
    const scaleDelta = e.deltaY > 0 ? 0.9 : 1.1;
    interactionScale.current = THREE.MathUtils.clamp(
      interactionScale.current * scaleDelta,
      SCALE_TOTAL_MIN,
      SCALE_TOTAL_MAX,
    );
  };

  const reAnchor = (pose: GripPose, snap: HandJointSnapshot) => {
    pose.position.copy(snap.gripPosition);
    pose.quaternion.copy(snap.gripOrientation);
  };

  // ─── Per-frame: grab manipulation + throw physics in immersive mode ─────
  useFrame((_state, dt) => {
    const g = group.current;
    if (!g) return;

    if (!isImmersive) {
      // 2D fallback: gentle hover/active feedback composed with wheel zoom.
      pulseScale.current = dampScalar(pulseScale.current, isDragging ? HOVER_SCALE : 1.0, PULSE_RATE, dt);
      g.scale.setScalar(interactionScale.current * pulseScale.current);
      return;
    }

    const left = hands.left.current;
    const right = hands.right.current;

    // 1) GRAB LIFECYCLE
    if (grabbedBy.current === null) {
      // Look for a hand pinching within reach
      const candidates: Array<[HandLabel, HandJointSnapshot]> = [];
      if (left.present && left.pinching) candidates.push(['left', left]);
      if (right.present && right.pinching) candidates.push(['right', right]);
      if (candidates.length > 0) {
        g.getWorldPosition(worldPos.current);
        // Pick the closest pinching hand within GRAB_RADIUS_M
        let bestLabel: HandLabel | null = null;
        let bestDist = GRAB_RADIUS_M;
        let bestSnap: HandJointSnapshot | null = null;
        for (const [label, snap] of candidates) {
          const d = snap.gripPosition.distanceTo(worldPos.current);
          if (d < bestDist) {
            bestDist = d;
            bestLabel = label;
            bestSnap = snap;
          }
        }
        if (bestLabel && bestSnap) {
          grabbedBy.current = bestLabel;
          reAnchor(prevPrimary.current, bestSnap);
          targetPos.current.copy(worldPos.current);
          targetQuat.current.copy(g.quaternion);
          velocity.current.set(0, 0, 0);
          angularVelocity.current.set(0, 0, 0);
        }
      }
    } else {
      const primary = grabbedBy.current === 'left' ? left : right;
      const other = grabbedBy.current === 'left' ? right : left;
      const otherLabel: HandLabel = grabbedBy.current === 'left' ? 'right' : 'left';
      const primaryHeld = primary.present && primary.pinching;
      const otherHeld = other.present && other.pinching;

      if (!primaryHeld && secondHand.current !== null) {
        // HAND-OFF — the surviving hand becomes primary. Re-anchoring means
        // the incremental delta restarts from its current pose: no jump.
        grabbedBy.current = secondHand.current;
        secondHand.current = null;
        reAnchor(prevPrimary.current, grabbedBy.current === 'left' ? left : right);
      } else if (!primaryHeld) {
        // RELEASE — hand velocity becomes throw velocity; angularVelocity
        // already tracks the recent spin and carries over as-is.
        velocity.current.copy(primary.pinchVelocity).multiplyScalar(THROW_SCALE);
        grabbedBy.current = null;
      } else {
        // Second hand joining / leaving two-hand mode. Both transitions
        // re-anchor so no stale delta gets applied across the switch.
        if (secondHand.current === null && otherHeld) {
          g.getWorldPosition(worldPos.current);
          if (other.gripPosition.distanceTo(worldPos.current) < GRAB_RADIUS_M) {
            secondHand.current = otherLabel;
            reAnchor(prevSecondary.current, other);
            reAnchor(prevPrimary.current, primary);
          }
        } else if (secondHand.current !== null && !otherHeld) {
          secondHand.current = null;
          reAnchor(prevPrimary.current, primary);
        }

        const curPrimary = grabbedBy.current === 'left' ? leftGrip.current : rightGrip.current;
        const curSecondary = grabbedBy.current === 'left' ? rightGrip.current : leftGrip.current;

        if (secondHand.current !== null) {
          twoHandTransform(prevPrimary.current, prevSecondary.current, curPrimary, curSecondary, twoDelta.current);
          const total = THREE.MathUtils.clamp(
            interactionScale.current * twoDelta.current.scaleFactor,
            SCALE_TOTAL_MIN,
            SCALE_TOTAL_MAX,
          );
          const applied = total / interactionScale.current;
          if (applied !== twoDelta.current.scaleFactor) {
            // Total-scale clamp changed the step — recompute the translation
            // so the grip midpoint still maps exactly.
            localTarget.current
              .copy(twoDelta.current.prevMid)
              .multiplyScalar(applied)
              .applyQuaternion(twoDelta.current.deltaQuat);
            twoDelta.current.deltaPos.copy(twoDelta.current.curMid).sub(localTarget.current);
          }
          interactionScale.current = total;
          targetPos.current
            .multiplyScalar(applied)
            .applyQuaternion(twoDelta.current.deltaQuat)
            .add(twoDelta.current.deltaPos);
          targetQuat.current.premultiply(twoDelta.current.deltaQuat).normalize();
          angularVelocityFromDelta(twoDelta.current.deltaQuat, dt, spinSample.current);
          angularVelocity.current.lerp(spinSample.current, SPIN_SAMPLE_BLEND);
          reAnchor(prevPrimary.current, primary);
          reAnchor(prevSecondary.current, other);
        } else {
          oneHandDelta(
            prevPrimary.current.position,
            prevPrimary.current.quaternion,
            primary.gripPosition,
            primary.gripOrientation,
            oneDelta.current,
          );
          targetPos.current.applyQuaternion(oneDelta.current.deltaQuat).add(oneDelta.current.deltaPos);
          targetQuat.current.premultiply(oneDelta.current.deltaQuat).normalize();
          angularVelocityFromDelta(oneDelta.current.deltaQuat, dt, spinSample.current);
          angularVelocity.current.lerp(spinSample.current, SPIN_SAMPLE_BLEND);
          reAnchor(prevPrimary.current, primary);
        }
        velocity.current.set(0, 0, 0);
      }
    }

    // 2) FOLLOW (held) or PHYSICS (free)
    if (grabbedBy.current !== null) {
      // Smooth toward the grab target — damped, frame-rate independent, so
      // joint jitter is filtered but the molecule still feels rigidly held.
      const parent = g.parent;
      localTarget.current.copy(targetPos.current);
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parent.worldToLocal(localTarget.current);
      }
      dampVector3(g.position, localTarget.current, POS_SMOOTH_RATE, dt);
      dampQuaternion(g.quaternion, targetQuat.current, ROT_SMOOTH_RATE, dt);
    } else {
      // Apply gravity
      velocity.current.y -= GRAVITY_M_S2 * dt;

      // Integrate. Parent is translation-only (SpatialAnchor) so adding
      // world-space velocity to local position is a valid simplification.
      g.position.x += velocity.current.x * dt;
      g.position.y += velocity.current.y * dt;
      g.position.z += velocity.current.z * dt;

      // Air drag
      velocity.current.multiplyScalar(AIR_DAMPING);

      // Spin carry-over — integrate the released angular velocity, bleeding
      // it off exponentially so a flicked molecule twirls then settles.
      const spin = angularVelocity.current.length();
      if (spin > 1e-4) {
        spinSample.current.copy(angularVelocity.current).divideScalar(spin);
        spinStep.current.setFromAxisAngle(spinSample.current, spin * dt);
        g.quaternion.premultiply(spinStep.current);
        angularVelocity.current.multiplyScalar(Math.exp(-SPIN_DAMPING * dt));
      }

      // Floor collision in WORLD space
      g.getWorldPosition(worldPos.current);
      if (worldPos.current.y < FLOOR_Y_M) {
        const correction = FLOOR_Y_M - worldPos.current.y;
        g.position.y += correction;
        if (velocity.current.y < 0) {
          velocity.current.y = -velocity.current.y * RESTITUTION;
        }
        velocity.current.x *= FLOOR_FRICTION;
        velocity.current.z *= FLOOR_FRICTION;
        if (velocity.current.length() < MIN_REST_VEL) {
          velocity.current.set(0, 0, 0);
        }
      }
    }

    // 3) Visual feedback — squish pulse composed with the interaction zoom
    pulseScale.current = dampScalar(
      pulseScale.current,
      grabbedBy.current !== null ? HOVER_SCALE : 1.0,
      PULSE_RATE,
      dt,
    );
    g.scale.setScalar(interactionScale.current * pulseScale.current);
  });

  return (
    <group
      ref={group}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerOut={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerOver={(e: any) => { e.stopPropagation(); setHovered(true); }}
      onPointerLeave={(e: any) => { e.stopPropagation(); setHovered(false); }}
      onWheel={handleWheel}
    >
      {children}
    </group>
  );
}
