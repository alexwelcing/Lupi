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
 * The live canvas keeps its size and its last picture: while the clip
 * renders, ReplayDirector holds the live view's own render (the sheet covers
 * it), so the device draws one picture per frame, not two. The Play layer
 * and every uniform job still run each frame. The camera rig waits, as for
 * any recording (`beginRecording({ illustrative: true })`, which also holds
 * the hover glow off). Nothing here is an artifact, and MCP cannot ask for
 * it.
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

/**
 * The clip size × this (1 for everyone). `__lupiPlay.replay('clip-scale', k)`
 * sets it for a software renderer's smoke, which draws a 1080×1920 frame in
 * tens of seconds.
 */
let clipScale = 1;

export function setClipScale(scale: number): number {
  clipScale = Number.isFinite(scale) && scale > 0 ? Math.min(1, scale) : 1;
  return clipScale;
}

/** The clip's size: 720×1280 on phones, 1080×1920 elsewhere (× the clip scale, even). */
export function clipSize(phone: boolean): { width: number; height: number } {
  const even = (value: number) => Math.max(2, Math.round((value * clipScale) / 2) * 2);
  return phone ? { width: even(720), height: even(1280) } : { width: even(1080), height: even(1920) };
}

/** A clip rendering now: the frames done, and the time so far (ms). */
export interface ClipProgress {
  frame: number;
  frames: number;
  ms: number;
}

let progress: ClipProgress | null = null;
const holdListeners = new Set<() => void>();

/** The clip in progress, or null. */
export function clipProgress(): ClipProgress | null {
  return progress;
}

/** True while a clip renders (ReplayDirector holds the live view's render). */
export function isClipRendering(): boolean {
  return progress !== null;
}

export function subscribeClipRendering(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => {
    holdListeners.delete(listener);
  };
}

function setProgress(next: ClipProgress | null): void {
  const changed = (progress === null) !== (next === null);
  progress = next;
  if (changed) for (const listener of Array.from(holdListeners)) listener();
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
  /**
   * Where the time went (ms, the offline clip): waiting for the frame to be
   * drawn and read back, burning in the labels, and handing it to the encoder.
   */
  split: { render: number; compose: number; encode: number } | null;
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

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const stopRecording = beginRecording({ illustrative: true });
  const resumeRecorder = pauseRecorder();
  const base = now();
  let clock = base;
  const releaseClock = driveMotionClock(() => clock);
  const resetToys = () => getToyReplaySink()?.play({ kind: 'reset' });
  resetToys();
  player.start();
  const split = { render: 0, compose: 0, encode: 0 };
  let backend: string | null = null;
  setProgress({ frame: 0, frames, ms: 0 });

  try {
    for (let index = 0; index < frames; index += 1) {
      if (signal.aborted) throw new ClipAbortError();
      const seconds = clipFrameTime(index);
      // The toys step by exactly this frame; the camera and the inputs due follow the tape.
      clock = base + seconds * 1000;
      player.seek(Math.min(seconds, tape.duration), camera, null);
      const asked = now();
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
      const drawn = now();
      compositor.compose(pixels, seconds);
      const composed = now();
      await encoder.encode(compositor.canvas, index);
      const encoded = now();
      split.render += drawn - asked;
      split.compose += composed - drawn;
      split.encode += encoded - composed;
      setProgress({ frame: index + 1, frames, ms: Math.round(encoded - base) });
      options.onProgress?.((index + 1) / frames);
    }
    const flushed = now();
    const blob = await encoder.finish();
    split.encode += now() - flushed;
    const ms = now() - base;
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
      split: { render: Math.round(split.render), compose: Math.round(split.compose), encode: Math.round(split.encode) },
      bytes: blob.size,
      backend,
    };
    noteClipReport(report);
    return { blob, report };
  } finally {
    setProgress(null);
    encoder.close();
    player.stop();
    resetToys();
    releaseClock();
    resumeRecorder();
    stopRecording();
    requestLupiFrames();
  }
}
