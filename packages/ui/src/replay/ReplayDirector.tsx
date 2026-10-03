/**
 * <ReplayDirector /> — Instant Replay inside the canvas.
 *
 * Sending side:
 * - records every drawn frame's camera into the ring buffer (`lupi-capture`,
 *   after the render, so the pose is the one on screen);
 * - runs the moment detector (moments.ts), which offers "Replay ↗";
 * - tells DOM code the view context (FOV, aspect, frame, the molecule's
 *   centre and radius, name and page id) for tapes and clips.
 *
 * Receiving side (a `?replay=` link):
 * - the molecule opens at the moment's first pose (or, under Motion: Still or
 *   for a still tape, at its last pose, and nothing plays);
 * - Standard plays it on its own a moment after the molecule lands; Gentle
 *   waits for "▶ Watch" on the pill;
 * - it plays in this view's own 3D: the camera along the keys, the toys
 *   through this Play layer at this view's comfort, the pill's flashes;
 * - any touch, wheel or key takes over at once; at the end (or the takeover)
 *   the pill says "Your turn" with the gesture the sender used, and a toy
 *   moment latches that toy's verb, so the next touch tries it.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import { LUPI_JOB, LUPI_PHASE, keepLupiAwake, requestLupiFrames } from '@atlas/scene';
import { useStore } from '../store';
import { getCameraRig, type Vec3 } from '../camera/rigApi';
import { getComfort } from '../motion/comfort';
import { playStore, type PlayVerb } from '../play/playStore';
import { registerPlayDevHook } from '../play/devHooks';
import { getToyReplaySink } from '../play/toyTape';
import { hasFirstFrame, onFirstFrame } from '../relay/firstFrame';
import { moleculePageIdFor } from '../moleculePage/pages';
import { consumeIntakeFailure } from './intake';
import { installMomentDetector, offerMoment } from './moments';
import { cameraFov, ReplayPlayer } from './player';
import { clearRecorder, pauseRecorder, recordPose, recorderNow } from './recorder';
import { replayStore, type IncomingReplay } from './replayStore';
import { buildTape, registerReplayViewContext, replayLink } from './session';
import type { MomentGesture, Tape } from './tape';

export interface ReplayDirectorProps {
  frame: Frame;
  center: Vec3;
}

/** Standard autoplay waits this long after the molecule lands (and its arrival ends) (ms). */
const AUTOPLAY_DELAY_MS = 700;
/** "Your turn" stays this long on the pill (ms). */
const TURN_FLASH_MS = 3600;

const TURN_COACH: Readonly<Record<MomentGesture, string>> = {
  flick: 'Your turn · flick it',
  drag: 'Your turn · drag to spin',
  keys: 'Your turn · ← → hop faces',
  spin: 'Your turn · Play › Spin',
  poke: 'Your turn · tap an atom',
  tug: 'Your turn · drag an atom',
  burst: 'Your turn · tap to pop',
  heat: 'Your turn · hold to warm it',
  scatter: 'Your turn · Play › Scatter',
};

const TURN_VERB: Partial<Record<MomentGesture, PlayVerb>> = { tug: 'tug', burst: 'burst', heat: 'heat' };

function coarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;
  } catch {
    return false;
  }
}

function turnText(tape: Tape): string {
  if (tape.still) return 'Shared view · your turn';
  // Arrow keys mean nothing on a phone: flicks find the same faces.
  if (tape.moment === 'chain' && (tape.gesture !== 'keys' || coarsePointer())) return 'Your turn · flick it into a face';
  if (tape.gesture === 'keys' && coarsePointer()) return TURN_COACH.flick;
  return tape.gesture ? TURN_COACH[tape.gesture] : 'Your turn';
}

/**
 * Hand the view over: the coach line, and (when the replay ran to its end)
 * the sender's toy latched, so the next touch tries it. A takeover keeps the
 * visitor's own verb: their touch is already doing something.
 */
function yourTurn(tape: Tape, latch: boolean): void {
  const verb = tape.gesture ? TURN_VERB[tape.gesture] : undefined;
  const play = playStore.getState();
  if (latch && verb && getComfort() !== 'still' && !tape.still) play.setVerb(verb);
  // The verb's own hint flashes as it latches; the coach line goes after it.
  play.flashText(turnText(tape), 'turn', TURN_FLASH_MS);
  play.markTeachSeen();
}

/** The farthest atom from `center` (world). */
function boundingRadius(frame: Frame, center: Vec3): number {
  const p = frame.positions;
  let max2 = 0;
  for (let i = 0; i < frame.natoms; i += 1) {
    const dx = p[i * 3] - center[0];
    const dy = p[i * 3 + 1] - center[1];
    const dz = p[i * 3 + 2] - center[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > max2) max2 = d2;
  }
  return Math.max(0.5, Math.sqrt(max2));
}

function arrivalRunning(): boolean {
  return playStore.getState().displacedSources.includes('arrival');
}

export function ReplayDirector({ frame, center }: ReplayDirectorProps): null {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3 } | null;
  const trajectory = useStore((state) => state.file?.trajectory ?? null);
  const live = useRef({ frame, center, camera, size, controls });
  live.current = { frame, center, camera, size, controls };
  const radiusRef = useRef<{ frame: Frame | null; center: Vec3 | null; radius: number }>({ frame: null, center: null, radius: 1 });
  const playerRef = useRef<ReplayPlayer | null>(null);
  const resumeRecorderRef = useRef<(() => void) | null>(null);
  const scratch = useRef({ q: [0, 0, 0, 1] as [number, number, number, number], target: [0, 0, 0] as Vec3 });

  const radiusNow = (): number => {
    const cache = radiusRef.current;
    const { frame: f, center: c } = live.current;
    if (cache.frame !== f || cache.center !== c) {
      cache.frame = f;
      cache.center = c;
      cache.radius = boundingRadius(f, c);
    }
    return cache.radius;
  };

  // The moment detector, for as long as the viewer is open.
  useEffect(() => installMomentDetector(), []);

  // The view context DOM code builds tapes and clips from.
  useEffect(
    () =>
      registerReplayViewContext(() => {
        const { camera: cam, size: s, center: c } = live.current;
        const state = useStore.getState();
        const file = state.file;
        return {
          fov: cameraFov(cam),
          aspect: s.width > 0 && s.height > 0 ? s.width / s.height : 1,
          frame: state.frame,
          totalFrames: file?.trajectory.totalFrames ?? 1,
          center: [c[0], c[1], c[2]],
          radius: radiusNow(),
          name: file?.name?.replace(/\.(xyz|extxyz|pdb|sdf|mol|cif)$/i, '') ?? 'Molecule',
          pageId: moleculePageIdFor(state.activeCardId, file?.sourceUrl ?? null),
        };
      }),
    [],
  );

  // A new molecule: the old moments are gone. A replay link this build could
  // not read says so once the molecule is on screen.
  useEffect(() => {
    clearRecorder();
    const store = replayStore.getState();
    store.setOffer(null);
    store.setLastMoment(null);
    if (!trajectory) return undefined;
    const sayIfUnreadable = () => {
      if (consumeIntakeFailure()) playStore.getState().flashText('That replay link couldn’t be read', 'info', 2600);
    };
    if (hasFirstFrame(trajectory)) {
      sayIfUnreadable();
      return undefined;
    }
    return onFirstFrame((key) => {
      if (key === trajectory) sayIfUnreadable();
    });
  }, [trajectory]);

  // ─── Receiving: open at the moment, then play it (or hand it over) ────
  /**
   * End playback: at its end, by Skip (straight to the last pose) or by a
   * takeover (the camera stays where the touch caught it).
   */
  const stopPlayback = (reason: 'end' | 'skip' | 'takeover') => {
    const player = playerRef.current;
    const incoming = replayStore.getState().incoming;
    playerRef.current = null;
    resumeRecorderRef.current?.();
    resumeRecorderRef.current = null;
    if (!player || !incoming) return;
    if (reason !== 'end') player.stop();
    const { camera: cam, controls: ctl } = live.current;
    if (reason !== 'takeover') {
      player.applyCamera(player.duration, cam, ctl?.target ?? null);
    }
    // Settle the store on the pose on screen: level, so the rig adopts it
    // without a jump (a takeover mid-tumble rights itself with a short glide).
    const position: Vec3 = [cam.position.x, cam.position.y, cam.position.z];
    const target: Vec3 = ctl?.target ? [ctl.target.x, ctl.target.y, ctl.target.z] : player.endPose().target;
    // Same position, same target: the two orientations differ only by roll.
    const level = new THREE.PerspectiveCamera();
    level.position.set(position[0], position[1], position[2]);
    level.lookAt(target[0], target[1], target[2]);
    const roll = level.quaternion.angleTo(cam.quaternion);
    const rig = getCameraRig();
    if (roll > 0.02 && rig) {
      rig.glideTo({ position, target }, { userMoved: true });
    } else {
      useStore.setState({ cameraPosition: position, cameraTarget: target, cameraPreset: 'free' });
    }
    replayStore.getState().setIncomingPhase('done');
    yourTurn(incoming.tape, reason !== 'takeover');
    requestLupiFrames();
  };

  /** Ask for playback (autoplay, ▶ Watch): the phase change starts the player. */
  const startPlayback = () => {
    const store = replayStore.getState();
    if (store.incoming?.phase === 'waiting') store.setIncomingPhase('playing');
  };

  /** The phase turned to playing: build the player for this view and go. */
  const createPlayer = () => {
    const incoming = replayStore.getState().incoming;
    if (!incoming || playerRef.current) return;
    const { camera: cam, size: s, center: c } = live.current;
    const player = new ReplayPlayer(incoming.tape, {
      framing: { center: c, radius: radiusNow(), fov: cameraFov(cam), aspect: s.width > 0 && s.height > 0 ? s.width / s.height : 1 },
      flashes: true,
      toys: true,
    });
    resumeRecorderRef.current?.();
    resumeRecorderRef.current = pauseRecorder();
    // Toys from before start from rest (the arrival lands).
    getToyReplaySink()?.play({ kind: 'reset' });
    player.start();
    playerRef.current = player;
    requestLupiFrames();
  };

  // Open at the moment's first pose as soon as the molecule is in.
  useEffect(() => {
    if (!trajectory) return undefined;
    const store = replayStore.getState();
    const incoming = store.incoming;
    if (!incoming) return undefined;
    if (incoming.phase !== 'pending') {
      // Another molecule opened: that replay belonged to the last one.
      if (incoming.phase !== 'done') {
        if (playerRef.current) stopPlayback('takeover');
        store.setIncoming(null);
      }
      return undefined;
    }
    const tape = incoming.tape;
    const placeAt = (which: 'start' | 'end') => {
      const { camera: cam, size: s, center: c } = live.current;
      const player = new ReplayPlayer(tape, {
        framing: { center: c, radius: radiusNow(), fov: cameraFov(cam), aspect: s.width > 0 && s.height > 0 ? s.width / s.height : 1 },
        flashes: false,
        toys: false,
      });
      const pose = which === 'start' ? player.startPose() : player.endPose();
      useStore.setState({ cameraPosition: pose.position, cameraTarget: pose.target, cameraPreset: 'free' });
    };
    const still = tape.still || getComfort() === 'still';
    if (tape.frame > 0 && tape.frame < trajectory.totalFrames) useStore.getState().setFrame(tape.frame);
    placeAt(still ? 'end' : 'start');

    let autoplay: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let interacted = false;
    const onInput = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-lupi-pill], [data-lupi-replay-sheet]')) return;
      interacted = true;
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', onInput, opts);
    window.addEventListener('wheel', onInput, opts);
    window.addEventListener('keydown', onInput, opts);

    const begin = () => {
      // The first frame may have been drawn at the gallery's fit: open where the moment does.
      if (!interacted) placeAt(still ? 'end' : 'start');
      if (still) {
        replayStore.getState().setIncomingPhase('done');
        yourTurn(tape, true);
        return;
      }
      replayStore.getState().setIncomingPhase('waiting');
      if (getComfort() !== 'standard') return; // Gentle: the pill's ▶ Watch starts it.
      const tryAutoplay = () => {
        poll = null;
        const state = replayStore.getState();
        if (state.incoming?.phase !== 'waiting' || interacted) return;
        if (arrivalRunning()) {
          poll = setTimeout(tryAutoplay, 120);
          return;
        }
        autoplay = setTimeout(() => {
          autoplay = null;
          if (!interacted && replayStore.getState().incoming?.phase === 'waiting') startPlayback();
        }, AUTOPLAY_DELAY_MS);
      };
      tryAutoplay();
    };
    const offFirst = onFirstFrame((key) => {
      if (key === trajectory) begin();
    });
    if (hasFirstFrame(trajectory)) begin();
    return () => {
      offFirst();
      if (autoplay !== null) clearTimeout(autoplay);
      if (poll !== null) clearTimeout(poll);
      window.removeEventListener('pointerdown', onInput, opts);
      window.removeEventListener('wheel', onInput, opts);
      window.removeEventListener('keydown', onInput, opts);
    };
  }, [trajectory]);

  // ▶ Watch (the pill) and Skip.
  useEffect(
    () =>
      replayStore.subscribe((state, previous) => {
        const phase = state.incoming?.phase;
        const before = previous.incoming?.phase;
        // ▶ Watch, or "Again" after the end.
        if (phase === 'playing' && before !== 'playing' && !playerRef.current) createPlayer();
        if (phase === 'done' && before === 'playing' && playerRef.current) stopPlayback('skip');
      }),
    // createPlayer and stopPlayback read refs only: one subscription for the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // While it plays: any touch, wheel or key takes over at once.
  useEffect(() => {
    const takeOver = (event: Event) => {
      if (!playerRef.current) return;
      const target = event.target as Element | null;
      if (target?.closest?.('[data-lupi-pill], [data-lupi-replay-sheet]')) return;
      if (event instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      stopPlayback('takeover');
    };
    const opts = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', takeOver, opts);
    window.addEventListener('wheel', takeOver, opts);
    window.addEventListener('keydown', takeOver, opts);
    const offAwake = keepLupiAwake('replay', () => playerRef.current !== null);
    return () => {
      window.removeEventListener('pointerdown', takeOver, opts);
      window.removeEventListener('wheel', takeOver, opts);
      window.removeEventListener('keydown', takeOver, opts);
      offAwake();
      if (playerRef.current) {
        playerRef.current.stop();
        playerRef.current = null;
      }
      resumeRecorderRef.current?.();
      resumeRecorderRef.current = null;
    };
  }, []);

  // Dev hook: __lupiPlay.replay() → the offer or last moment as a tape and link;
  // __lupiPlay.replay('watch') starts a waiting shared replay.
  useEffect(
    () =>
      registerPlayDevHook('replay', (command?: string) => {
        const store = replayStore.getState();
        if (command === 'watch') {
          if (store.incoming?.phase === 'waiting') store.setIncomingPhase('playing');
          return store.incoming?.phase ?? null;
        }
        if (command === 'moment') {
          const t = recorderNow();
          return offerMoment('flick', 'flick', t - 4, t);
        }
        const moment = store.offer ?? store.lastMoment;
        if (!moment) return { incoming: store.incoming?.phase ?? null, moment: null };
        const built = buildTape(moment);
        return {
          incoming: store.incoming?.phase ?? null,
          moment: moment.moment,
          keys: built?.tape.keys.length ?? 0,
          events: built?.tape.events.length ?? 0,
          bytes: built ? Math.ceil((built.token.length * 3) / 4) : 0,
          link: built ? replayLink(built.token) : null,
        };
      }),
    [],
  );

  // The shared replay plays in `update` (before the render; the rig adopts the pose).
  useFrame(
    (_, delta) => {
      const player = playerRef.current;
      if (!player) return;
      const { camera: cam, controls: ctl } = live.current;
      const running = player.step(delta, cam, ctl?.target ?? null);
      if (!running) stopPlayback('end');
    },
    { phase: 'update', id: LUPI_JOB.replayPlay },
  );

  // The recorder: the pose on screen this frame.
  useFrame(
    (_, delta) => {
      if (playerRef.current) return;
      const { camera: cam, controls: ctl } = live.current;
      const target = ctl?.target;
      if (!target) return;
      const s = scratch.current;
      s.q[0] = cam.quaternion.x;
      s.q[1] = cam.quaternion.y;
      s.q[2] = cam.quaternion.z;
      s.q[3] = cam.quaternion.w;
      s.target[0] = target.x;
      s.target[1] = target.y;
      s.target[2] = target.z;
      recordPose(recorderNow(), s.q, cam.position.distanceTo(target), s.target, delta);
    },
    { phase: LUPI_PHASE.capture, id: LUPI_JOB.replayRecord },
  );

  return null;
}

export type { IncomingReplay };
