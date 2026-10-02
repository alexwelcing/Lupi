/**
 * <LupiCameraRig /> — the viewer's camera controls (replaces drei's
 * OrbitControls; `?controls=orbit` brings those back for this wave).
 *
 * Mounted inside the Canvas. It creates one RigController and:
 * - makes its controls object `state.controls` (drei's makeDefault), so
 *   CameraManager, CameraFocus, AnomalyTracker and the DOF job keep reading
 *   `controls.target` and calling `controls.update()`;
 * - attaches the gesture arbiter to R3F's connected element, with lime
 *   touch marks;
 * - registers the rig API, the canvas input source, a capture guard (settle
 *   before any capture), a recording guard (settle, stand aside, resume from
 *   the store) and the `rig` / `flick` / `catch` dev hooks;
 * - steps the rig in fiber's `update` phase.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import {
  LUPI_JOB,
  emitIntent,
  onIntent,
  registerCanvasInputSource,
  registerCaptureGuard,
  registerRecordingGuard,
} from '@atlas/scene';
import { useStore, type AppState } from '../store';
import { coastEnabled, getComfort, glidesAnimate, subscribeComfort } from '../motion/comfort';
import { playStore } from '../play/playStore';
import { registerPlayDevHook, type PlayRigState } from '../play/devHooks';
import { cue } from '../play/feedback';
import { registerCameraRig, type Vec3 } from './rigApi';
import { RigController, type RigHost } from './rigController';
import { attachGestureArbiter, createGestureMachine, type GestureMachine, type GestureSink } from './gestureArbiter';
import { createTouchMarks } from './touchMarks';
import { GESTURE } from './gestureTokens';

export interface LupiCameraRigProps {
  center: Vec3;
  minDistance: number;
  maxDistance: number;
  /** False while flythrough preview drives the camera. */
  enabled: boolean;
  /** A user gesture started moving the camera (analytics). */
  onFirstInteraction?: () => void;
}

const CAUGHT_FLASH_MS = 700;

function near(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-6 && Math.abs(a[1] - b[1]) <= 1e-6 && Math.abs(a[2] - b[2]) <= 1e-6;
}

export function LupiCameraRig({ center, minDistance, maxDistance, enabled, onFirstInteraction }: LupiCameraRigProps) {
  const camera = useThree((s) => s.camera);
  const renderer = useThree((s) => s.renderer);
  // `false` until R3F connects its events (then its outer Canvas wrapper).
  const connected = useThree((s) => s.events.connected) as unknown;
  const set = useThree((s) => s.set);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const interaction = useRef(onFirstInteraction);
  interaction.current = onFirstInteraction;
  const centerRef = useRef(center);
  const machineRef = useRef<GestureMachine | null>(null);
  const cursorTarget = useRef<HTMLElement | null>(null);
  const cursor = useRef('grab');

  const rig = useMemo(() => {
    const canvas = () => (get().renderer?.domElement as HTMLCanvasElement | undefined) ?? null;
    const host: RigHost = {
      readStore: () => {
        const s = useStore.getState();
        return { position: s.cameraPosition, target: s.cameraTarget, preset: s.cameraPreset };
      },
      writeStore: (patch) => useStore.setState(patch as Partial<AppState>),
      emit: emitIntent,
      coastEnabled: () => coastEnabled(),
      glidesAnimate: () => glidesAnimate(),
      viewport: () => {
        const element = canvas();
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      },
      onCatch: () => {
        playStore.getState().flashText('Caught', 'catch', CAUGHT_FLASH_MS);
        cue('catch');
      },
      onInteraction: () => interaction.current?.(),
    };
    // Start from the store's target when the camera already shows the store
    // pose, else from the structure's centre (what OrbitControls used).
    const store = useStore.getState();
    const target = near(camera.position.toArray(), store.cameraPosition) ? store.cameraTarget : centerRef.current;
    return new RigController(camera, host, { target: [...target] as Vec3 });
  }, [camera, get]);

  useEffect(() => {
    rig.setLimits(minDistance, maxDistance);
  }, [rig, minDistance, maxDistance]);

  useEffect(() => {
    rig.setEnabled(enabled);
  }, [rig, enabled]);

  // state.controls, as drei's makeDefault does.
  useEffect(() => {
    const previous = get().controls;
    set({ controls: rig.controls as unknown as typeof previous });
    return () => {
      if (get().controls === (rig.controls as unknown)) set({ controls: previous });
    };
  }, [rig, get, set]);

  useEffect(() => {
    const cleanups = [
      registerCameraRig(rig),
      registerCanvasInputSource(),
      registerCaptureGuard({ prepare: () => rig.settleNow() }),
      registerRecordingGuard(() => {
        rig.settleNow();
        rig.suspend();
        return () => rig.resumeFromStore();
      }),
      registerPlayDevHook('rig', (): PlayRigState => {
        const pose = rig.pose();
        return { position: pose.position, target: pose.target, moving: rig.isBusy(), restCount: rig.restCount() };
      }),
      registerPlayDevHook('flick', (omega?: Vec3) => {
        rig.fling(Array.isArray(omega) && omega.length === 3 ? omega : [0, 4, 0]);
        return rig.isMoving();
      }),
      registerPlayDevHook('catch', () => {
        rig.catch();
        return rig.isMoving();
      }),
      onIntent('camera.zoomToward', ({ clientX, clientY, factor }) => rig.zoomToward(clientX, clientY, factor)),
      // A calmer Motion level applies to motion already running: Gentle ends a
      // coast, Still cuts every glide and coast to its rest pose.
      subscribeComfort((comfort) => {
        if (comfort === 'still') rig.settleNow();
        else if (comfort === 'gentle') rig.stopCoast();
      }),
    ];
    return () => {
      for (const cleanup of cleanups.reverse()) cleanup();
      rig.dispose();
    };
  }, [rig]);

  // The gesture arbiter on R3F's connected element (the canvas as a fallback).
  useEffect(() => {
    const canvas = (renderer?.domElement as HTMLCanvasElement | undefined) ?? null;
    const element = connected instanceof HTMLElement ? connected : canvas;
    if (!element) return;
    const sink: GestureSink = {
      emit: emitIntent,
      verb: () => playStore.getState().verb,
      canManipulate: () => rig.canManipulate(),
      isMoving: () => rig.isMoving(),
      isIdle: () => !rig.isBusy(),
      catchMotion: () => rig.catch(),
      beginGesture: () => {
        rig.beginGesture();
        invalidate();
      },
      endGesture: () => rig.endGesture(),
      startDrag: () => rig.startDrag(),
      orbitBy: (dx, dy) => {
        rig.orbitBy(dx, dy);
        invalidate();
      },
      panBy: (dx, dy) => {
        rig.panBy(dx, dy);
        invalidate();
      },
      zoomBy: (logFactor, x, y) => {
        rig.zoomBy(logFactor, x, y);
        invalidate();
      },
      dollyBy: (dy) => {
        rig.dollyBy(dy);
        invalidate();
      },
      endDrag: (velocity) => {
        rig.endDrag(velocity);
        invalidate();
      },
    };
    const marks = createTouchMarks(element, { still: () => getComfort() === 'still' });
    const machine = createGestureMachine(GESTURE, sink);
    machineRef.current = machine;
    const arbiter = attachGestureArbiter({
      element,
      canvas,
      machine,
      marks,
      onZoom: (factor, x, y) => {
        rig.wheelZoom(factor, x, y);
        invalidate();
      },
    });
    const previousCursor = element.style.cursor;
    element.style.cursor = 'grab';
    cursor.current = 'grab';
    cursorTarget.current = element;
    return () => {
      arbiter.dispose();
      marks.dispose();
      if (machineRef.current === machine) machineRef.current = null;
      element.style.cursor = previousCursor;
      if (cursorTarget.current === element) cursorTarget.current = null;
    };
  }, [connected, renderer, rig, invalidate]);

  useFrame(
    (_, delta) => {
      rig.frame(delta);
      if (rig.isBusy()) invalidate();
      const element = cursorTarget.current;
      if (!element) return;
      const drag = machineRef.current?.drag();
      const next = drag && drag !== 'stroke'
        ? 'grabbing'
        : !drag && useStore.getState().hoveredAtom != null && !rig.isBusy()
          ? 'pointer'
          : 'grab';
      if (next !== cursor.current) {
        cursor.current = next;
        element.style.cursor = next;
      }
    },
    { phase: 'update', id: LUPI_JOB.cameraRig },
  );

  return null;
}
