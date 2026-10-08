/**
 * offlineClip.ts — Instant Replay's 9:16 clip, rendered frame by frame.
 *
 * The clip is not a recording of the screen. For each of its frames, at a
 * fixed 30 fps on the clip's own clock (clipSchedule.ts):
 *
 * 1. the replay player puts a camera of the clip's own at that time on the
 *    tape (the live camera never moves) and fires the toy inputs that are
 *    due, which the Play layer plays as usual;
 * 2. the display-motion clock is driven by the clip (play/motionClock.ts):
 *    exactly 1/30 s per clip frame, nothing in between, so the toys are where
 *    they would be at that time whatever the device's frame rate;
 * 3. the next drawn frame renders the scene with that camera into render
 *    targets at the clip's size, supersampled 2×, with the viewer's look,
 *    and reads it back (export/renderTargetReadback.ts). It is an
 *    illustrative frame: display motion, the overlays riding it and a Foil
 *    finish stay on, which no export, thumbnail or MCP artifact ever shows;
 * 4. the compositor burns in the labels and the flash on the tape at that
 *    time, and WebCodecs encodes the frame into the MP4 (clipEncoder.ts).
 *
 * The live canvas keeps its size and keeps drawing; the camera rig waits,
 * as for any recording (`beginRecording({ illustrative: true })`, which also
 * holds the hover glow off). Nothing here is an artifact, and MCP cannot ask
 * for it.
 */
import * as THREE from 'three';
import { beginRecording, requestLupiFrames } from '@atlas/scene';
import { useStore } from '../store';
import { resolveCaptureLook } from '../export/captureLook';
import { renderSceneToPixels, runViewerCapture } from '../export/renderTargetReadback';
import { driveMotionClock } from '../play/motionClock';
import { getToyReplaySink } from '../play/toyTape';
import type { ClipCompositor } from './clipCompositor';
import { createClipEncoder, type ClipCodecChoice } from './clipEncoder';
import { CLIP_FPS, clipFrameCount, clipFrameTime } from './clipSchedule';
import { ReplayPlayer, type ReplayFraming } from './player';
import { pauseRecorder } from './recorder';
import type { Tape } from './tape';

/**
 * Supersampling for clip frames: 2×2 samples per pixel. The video codec
 * softens edges anyway, and 3× at 720×1280 would draw 8 million texels a
 * frame on a phone.
 */
export const CLIP_SUPERSAMPLE = 2;

export interface OfflineClipOptions {
  tape: Tape;
  width: number;
  height: number;
  /** Clip length (s), the end card included. */
  duration: number;
  /** The view's framing (the molecule and the FOV), for the 9:16 aspect. */
  framing: ReplayFraming | null;
  compositor: ClipCompositor;
  choice: ClipCodecChoice;
  signal: AbortSignal;
  /** 0..1 after each encoded frame. */
  onProgress?: (fraction: number) => void;
}

/** What made the last clip (for the sheet and `__lupiPlay.replay('clip')`). */
export interface ClipReport {
  encoder: 'webcodecs' | 'mediarecorder';
  /** The codec string ('avc1.640028', or MediaRecorder's MIME type). */
  codec: string;
  container: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
  /** Frames encoded (the offline clip), or null (recorded in real time). */
  frames: number | null;
  /** Clip length (s). */
  duration: number;
  /** Wall time from the first frame to the file (ms), and per frame. */
  ms: number;
  msPerFrame: number | null;
  bytes: number;
  backend: string | null;
}

let lastReport: ClipReport | null = null;

/** The last clip's report, or null. */
export function lastClipReport(): ClipReport | null {
  return lastReport;
}

export function noteClipReport(report: ClipReport | null): void {
  lastReport = report;
}

export class ClipAbortError extends Error {
  constructor() {
    super('The clip was cancelled.');
    this.name = 'ClipAbortError';
  }
}

/** A camera for the clip: the view's lens at the clip's aspect, with no view offset. */
function createClipCamera(fov: number, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 10_000);
  camera.updateProjectionMatrix();
  return camera;
}

/** Near, far and layers as the live camera has them (the clip keeps its own FOV and aspect). */
function syncLens(clip: THREE.PerspectiveCamera, live: THREE.Camera): void {
  const lens = live as Partial<THREE.PerspectiveCamera>;
  if (typeof lens.near === 'number' && typeof lens.far === 'number' && lens.far > lens.near && lens.near > 0) {
    if (clip.near !== lens.near || clip.far !== lens.far) {
      clip.near = lens.near;
      clip.far = lens.far;
      clip.updateProjectionMatrix();
    }
  }
  clip.layers.mask = live.layers.mask;
}

/** Render, compose and encode the clip; resolves with the MP4. Throws ClipAbortError when `signal` aborts. */
export async function renderOfflineClip(options: OfflineClipOptions): Promise<{ blob: Blob; report: ClipReport }> {
  const { tape, width, height, duration, compositor, choice, signal } = options;
  const frames = clipFrameCount(duration);
  const camera = createClipCamera(options.framing?.fov ?? tape.fov, width / height);
  const player = new ReplayPlayer(tape, { framing: options.framing, flashes: false, toys: true });
  const encoder = createClipEncoder(choice, width, height);
  // The view as configured (never the phone budget), like an export.
  const look = resolveCaptureLook(useStore.getState(), { transparent: false });

  const stopRecording = beginRecording({ illustrative: true });
  const resumeRecorder = pauseRecorder();
  const base = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let clock = base;
  const releaseClock = driveMotionClock(() => clock);
  const resetToys = () => getToyReplaySink()?.play({ kind: 'reset' });
  resetToys();
  player.start();
  const started = base;
  let backend: string | null = null;

  try {
    for (let index = 0; index < frames; index += 1) {
      if (signal.aborted) throw new ClipAbortError();
      const seconds = clipFrameTime(index);
      // The toys step by exactly this frame; the camera and the inputs due follow the tape.
      clock = base + seconds * 1000;
      player.seek(Math.min(seconds, tape.duration), camera, null);
      const pending = runViewerCapture(({ renderer, scene, camera: live, plate }) => {
        syncLens(camera, live);
        return renderSceneToPixels({
          renderer,
          scene,
          camera,
          width,
          height,
          transparent: false,
          clearColor: plate,
          look,
          illustrative: true,
          maxSupersample: CLIP_SUPERSAMPLE,
        });
      });
      if (!pending) throw new Error('The viewer closed before the clip was made.');
      const pixels = await pending;
      backend = pixels.backend;
      if (signal.aborted) throw new ClipAbortError();
      compositor.compose(pixels, seconds);
      await encoder.encode(compositor.canvas, index);
      options.onProgress?.((index + 1) / frames);
    }
    const blob = await encoder.finish();
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    const report: ClipReport = {
      encoder: 'webcodecs',
      codec: choice.codec,
      container: 'mp4',
      width,
      height,
      fps: CLIP_FPS,
      frames,
      duration,
      ms: Math.round(ms),
      msPerFrame: Math.round((ms / frames) * 10) / 10,
      bytes: blob.size,
      backend,
    };
    noteClipReport(report);
    return { blob, report };
  } finally {
    encoder.close();
    player.stop();
    resetToys();
    releaseClock();
    resumeRecorder();
    stopRecording();
    requestLupiFrames();
  }
}
