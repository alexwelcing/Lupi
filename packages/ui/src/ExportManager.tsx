/**
 * ExportManager — Unified pipeline for image, MP4/WebM, GLB, and USDZ export.
 *
 * Architecture:
 *   Image:  One render of the scene into a render target at the requested
 *           resolution, read back asynchronously (export/renderTargetReadback),
 *           in the `lupi-capture` frame phase. The canvas is never resized.
 *   Video:  MP4/WebM via the browser-native MediaRecorder recording
 *           `renderer.domElement.captureStream(fps)`. MediaRecorder encodes natively,
 *           off the main thread (no UI freeze), on every browser — mp4 on
 *           Safari/iOS, webm (vp9/vp8) on Chromium/Firefox. The capture loop only
 *           drives the camera/scene by wall-clock time; the canvas is recorded
 *           automatically.
 *           Instant Replay's clip rides the same path: its driver moves the
 *           camera and toys by the clip clock, display motion stays live (an
 *           illustrative recording), and a compositor draws each frame plus
 *           its "Illustrative" labels into a 2D canvas, which is what gets
 *           recorded. The recorder starts on the first composed frame (if the
 *           viewer canvas cannot be drawn there, it records the canvas itself).
 *   GLB:    Reconstructs real sphere/cylinder meshes from atomic data and exports
 *           via GLTFExporter for use in Blender, Unity, or any 3D software.
 *   USDZ:   Same mesh reconstruction → USDZExporter for AR Quick Look.
 *
 * All video modes support 360° orbit around the structure centroid.
 */

import { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber/webgpu';
import { LUPI_JOB, LUPI_PHASE, beginRecording, requestLupiFrames, runPrepareCapture } from '@atlas/scene';
import { useStore, type ExportRequest } from './store';
import {
  canInferCovalentBonds,
  getElementSpec,
  hexToRgb,
  resolveAtomicNumber,
  resolveTypeColor as resolveSemanticTypeColor,
  resolveTypeDisplayRadius,
} from '@atlas/core';
import * as THREE from 'three';
import { sampleFlythrough, getSequenceDuration } from './flythrough';
import { restoreInstancedMeshes } from './export/USDZExportPipeline';
import { bakeInstancedMeshesForExport } from './export/instanceBake';
import {
  buildExportScene,
  computeUsdzFraming,
  disposeExportScene,
  MAX_EXPORT_BONDS,
  ModelExportBudgetError,
  ModelExportLayerIncompleteError,
  ModelExportSourceTopologyError,
  assertCompleteExportBondLayer,
} from './export/exportSceneBuilder';
import {
  assertBrowserImageExportIntent,
  beginImageCaptureTransaction,
  claimFiberFrameCapture,
  claimFiberFrameWarmup,
  completeImageCaptureCallback,
  createFiberFrameCaptureBarrier,
  drawExportAxesOverlayV1,
  markFiberFrameCaptureApplied,
  markFiberFrameCaptureWarmed,
  type PreparedImageCaptureTransaction,
} from './export/renderCaptureState';
import {
  readbackToCanvas,
  renderSceneToPixels,
  resolveViewerPlate,
  ViewerCaptureService,
} from './export/renderTargetReadback';
import {
  createGradientEquirectTexture,
  type BackgroundGradientStyle,
} from './equirectTexture';
import { assertSceneEnvironmentReady, sceneEnvironmentLoadFailed } from './sceneEnvironment';
import { MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import { getPerceivedBonds, resolveFrameRecipe } from './bonds/perceivedBonds';
import { captureLookFromSpec, resolveCaptureLook } from './export/captureLook';
import {
  inspectArtifactAtomSceneReadiness,
  inspectArtifactVectorGlyphSceneReadiness,
} from './export/artifactSceneReadiness';

const SINGLE_TYPE_NORM_VALUE = 0.5;
const MIN_NUMERIC_RANGE = 1e-6;

// ─── Video Capture Loop Component ──────────────────────────────────
// The loop is a conditionally mounted `update`-phase job (LUPI_JOB.videoDrive),
// so it moves the camera before the default render of the same frame and never
// takes rendering over (fiber v10 frame phases, plan-final D12).
//
// MediaRecorder records the canvas in REAL TIME (off the main thread), so this
// loop drives the camera/scene purely by WALL-CLOCK progress — never by frame
// count. It posts no frames anywhere; the canvas is captured automatically.
function VideoCaptureLoop({
  requestRef,
  totalFrames,
  originalCameraPosition,
  file,
  isRecording,
  setIsCapturing,
  recorderRef,
  recorderStoppedRef,
  captureStartRef,
  abortRecording,
}: any) {
  const { invalidate } = useThree();
  const { camera } = useThree();
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3 } | null;

  useFrame(() => {
    if (!isRecording.current) return;

    // Keep the demand frameloop alive: the export must drive continuous rendering
    // even though the app normally renders on demand. Without this, useFrame can
    // stall after the first frame once the frameloop idles.
    invalidate();

    const req = requestRef.current as ExportRequest | null;
    if (!req) return;

    if (req.signal?.aborted) {
      abortRecording();
      return;
    }

    // A composed clip starts its recorder on the first composed frame
    // (ClipCompositeJob): until then it holds the clip's first pose.
    if (captureStartRef.current === null && req.compositor) {
      req.replay?.drive(0, camera, controls?.target ?? null);
      return;
    }

    // On the first tick, anchor the wall-clock start. MediaRecorder started a hair
    // earlier; tying progress to the first rendered frame keeps the motion smooth.
    if (captureStartRef.current === null) {
      captureStartRef.current = performance.now();
    }

    const elapsed = performance.now() - captureStartRef.current;
    const durationMs = (req.replay ? req.replay.duration : req.durationSeconds || 5) * 1000;
    const progress = Math.min(elapsed / durationMs, 1);
    req.onRecordProgress?.(progress);

    // Drive the camera/scene by wall-clock `progress` (0..1).
    // An Instant Replay clip follows its tape; flythrough takes priority over orbit.
    if (req.replay) {
      req.replay.drive(elapsed / 1000, camera, controls?.target ?? null);
    } else if (req.flythrough && req.flythrough.keyframes.length >= 2) {
      const flyDuration = getSequenceDuration(req.flythrough);
      const flyTime = progress * flyDuration;

      // Update store for UI progress bar
      useStore.getState().setFlythroughTime(flyTime);

      const sample = sampleFlythrough(req.flythrough, flyTime);
      if (sample) {
        camera.position.set(...sample.position);
        camera.lookAt(...sample.target);
        if (camera instanceof THREE.PerspectiveCamera && sample.fov) {
          camera.fov = sample.fov;
          camera.updateProjectionMatrix();
        }
      }
    } else if (req.orbit && originalCameraPosition.current && file) {
      const { min, max } = file.trajectory.globalBounds;
      const center = new THREE.Vector3(
        (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2
      );
      const radius = originalCameraPosition.current.distanceTo(center);

      const angle = progress * Math.PI * 2;
      camera.position.x = center.x + Math.sin(angle) * radius;
      camera.position.z = center.z + Math.cos(angle) * radius;
      camera.position.y = originalCameraPosition.current.y;
      camera.lookAt(center);
    }

    if (req.cinematic && file) {
      // Advance trajectory if there is one
      if (file.trajectory.totalFrames > 1) {
        // Run from start to the absolute end frame
        const targetFrame = Math.floor(progress * file.trajectory.totalFrames);
        const safeFrame = Math.min(targetFrame, file.trajectory.totalFrames - 1);
        if (useStore.getState().frame !== safeFrame) {
          useStore.getState().setFrame(safeFrame);
        }
      }

      // Cinematic bond pulse (breathes in to reveal bonds, breathes out).
      // Drives `bondTolerance` now that the tolerance is the user-facing
      // bonding knob — pulse 0 → ~1.0 Å takes per-pair cutoffs from
      // r_cov(A)+r_cov(B) up to a generous reveal, then back down.
      const pulse = Math.sin(progress * Math.PI); // 0 -> 1 -> 0
      useStore.getState().setBondTolerance(Math.max(0, pulse * 1.0));

      // Subtle atom scaling
      useStore.getState().setAtomScale(0.85 + pulse * 0.15);
    }

    // Stop the recorder exactly once when wall-clock duration is reached. The
    // recorder's onstop handler builds the blob, delivers it, and restores the
    // scene. Unmount the loop immediately to hand rendering back to Fiber.
    if (progress >= 1) {
      isRecording.current = false;
      setIsCapturing(false);
      if (
        !recorderStoppedRef.current &&
        recorderRef.current &&
        recorderRef.current.state !== 'inactive'
      ) {
        recorderStoppedRef.current = true;
        recorderRef.current.stop();
      }
    }
  }, { phase: 'update', id: LUPI_JOB.videoDrive });

  return null;
}

/** Blank composed frames tolerated before a clip records the viewer canvas itself. */
const COMPOSITE_BLANK_FRAMES = 2;

/**
 * An illustrative clip's compositor, in `lupi-capture` (right after the
 * default render, while the viewer canvas still holds this frame on both
 * backends): draw the frame and its labels into the compositor's canvas.
 * The first composed frame starts the recorder on that canvas; if the viewer
 * canvas cannot be drawn there, the recorder takes the canvas itself.
 */
function ClipCompositeJob({
  requestRef,
  isRecording,
  captureStartRef,
  startRecorder,
}: {
  requestRef: { current: ExportRequest | null };
  isRecording: { current: boolean };
  captureStartRef: { current: number | null };
  startRecorder: (composed: boolean) => void;
}) {
  const renderer = useThree((state) => state.renderer);
  const blankFrames = useRef(0);

  useFrame(() => {
    if (!isRecording.current) return;
    const req = requestRef.current;
    const compositor = req?.compositor;
    if (!req || !compositor) return;
    const started = captureStartRef.current !== null;
    const seconds = started ? (performance.now() - (captureStartRef.current as number)) / 1000 : 0;
    let drawn = false;
    try {
      drawn = compositor.draw(renderer.domElement as HTMLCanvasElement, seconds);
    } catch (error) {
      console.warn('[ExportManager] clip compositor failed', error);
    }
    if (started) return;
    if (drawn) {
      startRecorder(true);
    } else {
      blankFrames.current += 1;
      if (blankFrames.current >= COMPOSITE_BLANK_FRAMES) startRecorder(false);
    }
  }, { phase: LUPI_PHASE.capture, id: LUPI_JOB.clipComposite });

  return null;
}
// ─── ExportManager component ─────────────────────────────────────
let nextImageCaptureRevision = 1;

function ImageCaptureFrame({
  request,
  frameIndex,
}: {
  request: ExportRequest;
  frameIndex: number;
}) {
  const [frameLifecycleActive, setFrameLifecycleActive] = useState(true);
  return frameLifecycleActive ? (
    <ImageCaptureFrameLifecycle
      request={request}
      frameIndex={frameIndex}
      onFrameCaptured={() => setFrameLifecycleActive(false)}
    />
  ) : null;
}

/**
 * Transient Fiber subscriber for deterministic raster capture, driven by
 * frame phases (no numeric priorities):
 *
 * - `lupi-canonical` (after controls, before uniform jobs) re-syncs the
 *   capture camera from the finalized camera, and asserts the environment.
 * - `lupi-capture` (after the default render) waits until the scene carries
 *   the artifact revision and, one frame later (after the uniform jobs saw
 *   the canonical state), renders into a render target at the requested
 *   size and reads it back (renderTargetReadback). The canvas is never
 *   resized and the live camera never moves, so the on-screen view is
 *   untouched.
 *
 * The capture renders the scene supersampled, with the background the viewer
 * shows (the finalized artifact background, or the live scene background
 * over the viewer plate, or none when transparent), then applies the
 * viewer's look (export/captureLook.ts): the one an artifact spec records,
 * or the configured one for an interactive export.
 */
function ImageCaptureFrameLifecycle({
  request,
  frameIndex,
  onFrameCaptured,
}: {
  request: ExportRequest;
  frameIndex: number;
  onFrameCaptured: () => void;
}) {
  const renderer = useThree((state) => state.renderer);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);
  const revisionRef = useRef(nextImageCaptureRevision++);
  const barrierRef = useRef(createFiberFrameCaptureBarrier(revisionRef.current));
  const transactionRef = useRef<PreparedImageCaptureTransaction | null>(null);
  const targetSizeRef = useRef<{ width: number; height: number } | null>(null);
  const backgroundTextureRef = useRef<THREE.Texture | null>(null);

  const clearActiveRequest = useCallback(() => {
    if (useStore.getState().exportRequest === request) {
      useStore.getState().clearExportRequest();
    }
  }, [request]);

  const restoreCaptureState = useCallback(() => {
    transactionRef.current?.restore();
    transactionRef.current = null;
    backgroundTextureRef.current?.dispose();
    backgroundTextureRef.current = null;
  }, []);

  const failCapture = useCallback((error: unknown) => {
    console.error('[ExportManager] Image export failed:', error);
    restoreCaptureState();
    completeImageCaptureCallback(
      () => request.onComplete?.(false),
      clearActiveRequest,
      (deliveryError) => console.error('[ExportManager] Image export failure callback failed:', deliveryError),
    );
  }, [clearActiveRequest, request, restoreCaptureState]);

  useLayoutEffect(() => {
    try {
      request.onStart?.();
      if (request.artifactSpec && request.artifactSpec.frame !== frameIndex) {
        throw new Error(
          `Artifact frame ${request.artifactSpec.frame} no longer matches active frame ${frameIndex}.`,
        );
      }
      if (
        request.artifactSpec
        && !useStore.getState().file?.trajectory.frames[request.artifactSpec.frame]
      ) {
        throw new Error(`Artifact frame ${request.artifactSpec.frame} is no longer resident.`);
      }
      const format = request.format === 'jpeg' || request.format === 'webp'
        ? request.format
        : 'png';
      assertBrowserImageExportIntent(format, Boolean(request.transparent));

      const canonicalCamera = request.artifactSpec?.view.camera as {
        position?: unknown;
        target?: unknown;
        fov?: unknown;
        near?: unknown;
        far?: unknown;
      } | undefined;
      const appliedCamera = canonicalCamera
        && isFiniteTuple3(canonicalCamera.position)
        && isFiniteTuple3(canonicalCamera.target)
        && typeof canonicalCamera.fov === 'number'
        && Number.isFinite(canonicalCamera.fov)
        && typeof canonicalCamera.near === 'number'
        && Number.isFinite(canonicalCamera.near)
        && canonicalCamera.near > 0
        && typeof canonicalCamera.far === 'number'
        && Number.isFinite(canonicalCamera.far)
        && canonicalCamera.far > canonicalCamera.near
        ? {
          position: canonicalCamera.position,
          target: canonicalCamera.target,
          fov: canonicalCamera.fov,
          near: canonicalCamera.near,
          far: canonicalCamera.far,
        }
        : undefined;

      const canonicalBackground = !request.transparent && request.artifactSpec?.layers.background
        ? readCanonicalGradientBackgroundV1(request.artifactSpec.view.background)
        : undefined;
      if (canonicalBackground) {
        backgroundTextureRef.current = createGradientEquirectTexture(
          canonicalBackground.top,
          canonicalBackground.bottom,
          renderer,
          1024,
          canonicalBackground.style,
        );
      }

      const liveSize = get().size;
      const targetSize = {
        width: captureDimension(request.resolution?.width, liveSize.width),
        height: captureDimension(request.resolution?.height, liveSize.height),
      };
      targetSizeRef.current = targetSize;
      // Toys settle first (a coasting camera re-levels) so the transaction
      // copies a resting camera.
      runPrepareCapture();
      transactionRef.current = beginImageCaptureTransaction({
        scene,
        camera,
        targetWidth: targetSize.width,
        targetHeight: targetSize.height,
        transparent: Boolean(request.transparent),
        appliedCamera,
        ...(backgroundTextureRef.current && canonicalBackground ? {
          appliedBackground: {
            texture: backgroundTextureRef.current,
            fogColor: canonicalBackground.bottom,
            fogDensity: 0.0015,
          },
        } : {}),
      });
      invalidate();
    } catch (error) {
      failCapture(error);
    }

    return restoreCaptureState;
  }, [camera, failCapture, frameIndex, get, renderer, invalidate, request, restoreCaptureState, scene]);

  useFrame(() => {
    const transaction = transactionRef.current;
    if (!transaction) return;
    try {
      if (request.artifactSpec) {
        const lighting = request.artifactSpec.view.lighting as Record<string, unknown> | undefined;
        try {
          assertSceneEnvironmentReady(scene.environment, lighting?.environment);
        } catch (environmentError) {
          // The HDR loads beside the scene. Wait for it (the export timeout
          // is the fail-closed bound) unless its download already failed.
          if (sceneEnvironmentLoadFailed(lighting?.environment)) throw environmentError;
          invalidate();
          return;
        }
      }
      runPrepareCapture();
      transaction.applyCanonicalState();
      markFiberFrameCaptureApplied(barrierRef.current, revisionRef.current);
    } catch (error) {
      onFrameCaptured();
      failCapture(error);
    }
  }, { phase: LUPI_PHASE.canonical, id: LUPI_JOB.exportCanonical });

  useFrame(() => {
    const transaction = transactionRef.current;
    const targetSize = targetSizeRef.current;
    if (!transaction || !targetSize) return;

    try {
      if (request.artifactSpec?.layers.atoms) {
        if (!request.specId) throw new Error('Artifact atom capture is missing its render spec revision.');
        const atomReadiness = inspectArtifactAtomSceneReadiness(scene, request.specId);
        if (!atomReadiness.ready) {
          // React/store intent can precede the Three scene commit. Keep the
          // demand loop alive until every tagged atom mesh carries the exact
          // artifact revision; the export timeout remains the fail-closed
          // bound if the scene can never apply it.
          invalidate();
          return;
        }
      }
      if (request.artifactSpec?.layers.vectorGlyphs) {
        if (!request.specId) throw new Error('Artifact vector-glyph capture is missing its render spec revision.');
        const vectorReadiness = inspectArtifactVectorGlyphSceneReadiness(scene, request.specId);
        if (!vectorReadiness.ready) {
          // Vector glyphs own a separate material, colormap texture, and
          // four instanced buffers. Their exact applied revision must be
          // proven independently of the atom layer before readback.
          invalidate();
          return;
        }
      }

      const { width, height } = targetSize;
      const barrier = barrierRef.current;
      const revision = revisionRef.current;
      if (claimFiberFrameWarmup(barrier, revision)) {
        // The capture follows on a later frame, after every uniform job has
        // seen the canonical state again. No renderer.compileAsync warm-up:
        // three r186 skips any draw whose pipeline is still compiling
        // asynchronously, so a capture behind a slow warm-up lost whole
        // layers (the atoms of a transparent capture on SwiftShader WebGPU).
        // The capture render builds missing pipelines synchronously instead.
        markFiberFrameCaptureWarmed(barrier, revision);
        invalidate();
        return;
      }
      if (!claimFiberFrameCapture(barrier, revision)) {
        invalidate();
        return;
      }

      const transparent = Boolean(request.transparent);
      const captureCamera = transaction.camera;
      // The viewer's look: an artifact applies exactly the look its spec
      // records; an interactive export applies the configured one.
      const look = request.artifactSpec
        ? captureLookFromSpec(request.artifactSpec.view.postprocess, request.artifactSpec.view.ink)
        : resolveCaptureLook(useStore.getState(), { transparent });
      // The render into the target and the scene restore both happen inside
      // this call; only the readback resolves later.
      const readback = transaction.withCaptureScene(() => renderSceneToPixels({
        renderer,
        scene,
        camera: captureCamera,
        width,
        height,
        transparent,
        clearColor: resolveViewerPlate(renderer.domElement),
        look,
      }));
      const contractAxes = request.artifactSpec?.layers.axes;
      const drawAxes = contractAxes ?? useStore.getState().showAxes;

      // The scene is back to its live state; release the capture before the
      // asynchronous readback and the browser's encoder.
      restoreCaptureState();
      invalidate();
      onFrameCaptured();

      const format = request.format === 'jpeg' || request.format === 'webp'
        ? request.format
        : 'png';
      const mime = `image/${format}`;
      const quality = format === 'png' ? undefined : 1.0;
      const ext = format === 'jpeg' ? 'jpg' : format;
      const filename = `${request.baseName || 'LUPI-export'}-frame${frameIndex + 1}.${ext}`;

      readback.then((pixels) => {
        const captureCanvas = readbackToCanvas(pixels);
        const captureContext = captureCanvas.getContext('2d');
        if (!captureContext) throw new Error('Image export could not create a 2D capture context.');
        if (drawAxes) drawExportAxesOverlayV1(captureContext, captureCamera, width, height);
        captureCanvas.toBlob(
          (blob) => {
            completeImageCaptureCallback(
              () => {
                if (blob) {
                  if (request.onComplete) request.onComplete(true, blob, filename);
                  else downloadBlob(blob, filename);
                } else {
                  console.error('[ExportManager] toBlob returned null for the captured image');
                  request.onComplete?.(false);
                }
              },
              clearActiveRequest,
              (error) => console.error('[ExportManager] Image export delivery failed:', error),
            );
          },
          mime,
          quality,
        );
      }).catch(failCapture);
    } catch (error) {
      onFrameCaptured();
      failCapture(error);
    }
  }, { phase: LUPI_PHASE.capture, id: LUPI_JOB.exportCapture });

  return null;
}

/** A requested export dimension, or the live canvas size, as a positive integer. */
function captureDimension(requested: number | undefined, live: number): number {
  const value = requested && Number.isFinite(requested) && requested > 0 ? requested : live;
  return Math.max(1, Math.round(value));
}

export function ExportManager() {
  const { renderer, camera, size, frameloop, setSize, setDpr, setFrameloop, invalidate } = useThree();
  const exportRequest = useStore(s => s.exportRequest);
  const clearExportRequest = useStore(s => s.clearExportRequest);
  const file = useStore(s => s.file);
  const frame = useStore(s => s.frame);

  // Recording state
  const isRecording = useRef(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const onCompleteRef = useRef<ExportRequest['onComplete'] | null>(null);

  // MediaRecorder pipeline state. MediaRecorder records `captureStream()` of the
  // viewer canvas (WebGPU or its WebGL2 fallback) natively, off the main thread — no UI freeze, works on every
  // browser (mp4 on Safari/iOS, webm on Chromium/Firefox).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]); // recorder chunks accumulated via ondataavailable
  const captureStartRef = useRef<number | null>(null); // wall-clock anchor, set on first VideoCaptureLoop tick
  const recorderStoppedRef = useRef(false); // ensures recorder.stop() is called exactly once
  const requestRef = useRef<ExportRequest | null>(null);
  const totalFrames = useRef(0);
  const frameCount = useRef(0);
  const originalPixelRatio = useRef<number>(1);
  const originalCameraPosition = useRef<THREE.Vector3 | null>(null);
  const originalCameraFov = useRef<number | null>(null);
  const originalSize = useRef<{ width: number; height: number; aspect: number } | null>(null);
  const originalStoreState = useRef<{ bondTolerance: number; atomScale: number; frame: number } | null>(null);
  const originalFrameloop = useRef<'always' | 'demand' | 'never' | null>(null);
  // The recording guards' stop (the camera rig resumes, display motion un-suspends).
  const recordingRestoreRef = useRef<(() => void) | null>(null);
  // A composed clip's recorder starts on its first composed frame.
  const startComposedRecorderRef = useRef<((composed: boolean) => void) | null>(null);
  const abortedRef = useRef(false);

  // Shared scene/camera/size/store restore after a video export. Reused for both
  // the success and failure paths of the MediaRecorder capture.
  const restoreAfterVideo = useCallback(() => {
    const replayDriver = requestRef.current?.replay;
    if (replayDriver) {
      try {
        replayDriver.end();
      } catch (error) {
        console.error('[ExportManager] replay clip end threw', error);
      }
    }
    if (originalCameraPosition.current && file) {
      const { min, max } = file.trajectory.globalBounds;
      const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      camera.position.copy(originalCameraPosition.current);
      camera.lookAt(center);
      originalCameraPosition.current = null;
    }
    if (originalCameraFov.current !== null && camera instanceof THREE.PerspectiveCamera) {
      camera.fov = originalCameraFov.current;
      camera.updateProjectionMatrix();
      originalCameraFov.current = null;
    }
    if (originalSize.current) {
      setSize(originalSize.current.width, originalSize.current.height);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = originalSize.current.aspect;
        camera.updateProjectionMatrix();
      }
      originalSize.current = null;
    }
    if (originalPixelRatio.current) setDpr(originalPixelRatio.current);
    if (originalStoreState.current) {
      useStore.getState().setBondTolerance(originalStoreState.current.bondTolerance);
      useStore.getState().setAtomScale(originalStoreState.current.atomScale);
      useStore.getState().setFrame(originalStoreState.current.frame);
      originalStoreState.current = null;
    }
    // Restore the exact mode in effect before export (the viewer runs on
    // demand), and export must not silently change application scheduling
    // for the rest of the session.
    if (originalFrameloop.current) {
      setFrameloop(originalFrameloop.current);
      originalFrameloop.current = null;
    }
    clearExportRequest();
    const stopRecordingGuards = recordingRestoreRef.current;
    recordingRestoreRef.current = null;
    stopRecordingGuards?.();
    // Entering demand grants no frame: draw the restored view.
    requestLupiFrames();
  }, [camera, file, setSize, setDpr, setFrameloop, clearExportRequest]);

  // Stable ref so the VideoCaptureLoop always calls the freshest restore closure.
  const restoreAfterVideoRef = useRef(restoreAfterVideo);
  restoreAfterVideoRef.current = restoreAfterVideo;

  // ─── Image Export ─────────────────────────────────────────────

  // ─── 3D Model Export (GLB / USDZ) ─────────────────────
  // Scene construction (instancing, LOD, chunked bond detection, progress)
  // lives in export/exportSceneBuilder so the exact same code path runs
  // headless from Node (tools/verify-exports.mjs). This handler only wires
  // store state into the builder and drives the format-specific encoders.
  const handle3DExport = useCallback(async () => {
    const req = exportRequest;
    if (!req) return;
    let exportScene: THREE.Scene | null = null;

    try {
      req.onStart?.();
      const { COLORMAPS } = await import('@atlas/scene');

      const state = useStore.getState();
      const currentFile = state.file;
      if (!currentFile) {
        console.error('[3D Export] No file loaded');
        if (req.onComplete) req.onComplete(false);
        clearExportRequest();
        return;
      }

      const currentFrame = currentFile.trajectory.frames[state.frame];
      if (!currentFrame) {
        console.error('[3D Export] No valid frame');
        if (req.onComplete) req.onComplete(false);
        clearExportRequest();
        return;
      }

      const isUsdZ = req.type === 'usdz';
      if (req.artifactSpec && !req.artifactDelivery) {
        throw new ModelExportLayerIncompleteError(
          'Immutable model export is missing its transport policy.',
          { format: isUsdZ ? 'usdz' : 'glb', reason: 'missing-artifact-delivery' },
        );
      }
      if (req.artifactSpec && isUsdZ) {
        throw new ModelExportLayerIncompleteError(
          'USDZ is not available through the immutable artifact-key lane because Three\'s exporter embeds process-global allocation ids.',
          { format: 'usdz', reason: 'process-global-exporter-identifiers' },
        );
      }

      const mapFn = COLORMAPS[state.colormap] ?? COLORMAPS.viridis;
      const typeSet = new Set<number>();
      for (let i = 0; i < currentFrame.natoms; i++) {
        typeSet.add(currentFrame.types[i]);
      }
      const sortedTypes = Array.from(typeSet).sort((a, b) => a - b);
      const typeToNorm = new Map<number, number>();
      for (let i = 0; i < sortedTypes.length; i++) {
        typeToNorm.set(
          sortedTypes[i],
          sortedTypes.length > 1 ? i / (sortedTypes.length - 1) : SINGLE_TYPE_NORM_VALUE,
        );
      }

      const resolvedTypeColors = new Map<number, [number, number, number]>();
      const resolveTypeColor = (typeId: number): [number, number, number] => {
        const cached = resolvedTypeColors.get(typeId);
        if (cached) return cached;
        let resolved: [number, number, number];
        if (state.atomColorSource === 'element') {
          const override = state.elementColorOverrides[typeId];
          resolved = override
            ? hexToRgb(override)
            : hexToRgb(resolveSemanticTypeColor(currentFrame, typeId));
        } else {
          const t = typeToNorm.get(typeId) ?? SINGLE_TYPE_NORM_VALUE;
          resolved = mapFn(t);
        }
        resolvedTypeColors.set(typeId, resolved);
        return resolved;
      };

      const propertyData = state.colorMode === 'property' && state.colorProperty
        ? currentFrame.properties?.get(state.colorProperty)
        : null;
      let propertyMin = state.propRange[0];
      let propertyMax = state.propRange[1];
      if (propertyData && (!Number.isFinite(propertyMin) || !Number.isFinite(propertyMax) || propertyMin >= propertyMax)) {
        propertyMin = Infinity;
        propertyMax = -Infinity;
        for (let i = 0; i < propertyData.length; i++) {
          const v = propertyData[i];
          if (v < propertyMin) propertyMin = v;
          if (v > propertyMax) propertyMax = v;
        }
      }
      const propertyRange = Math.max(propertyMax - propertyMin, MIN_NUMERIC_RANGE);
      const uniformDisplayColor = hexToRgb(state.uniformAtomColor);

      const resolveAtomColor = (atomIndex: number, atomType: number): [number, number, number] => {
        if (state.colorMode === 'property' && propertyData) {
          const t = Math.max(0, Math.min(1, (propertyData[atomIndex] - propertyMin) / propertyRange));
          return mapFn(t);
        }
        if (state.colorMode === 'uniform') {
          return uniformDisplayColor;
        }
        return resolveTypeColor(atomType);
      };

      // Mirror the live viewer's element-aware bond test:
      //   d ≤ r_cov(A) + r_cov(B) + tolerance
      // using the same tolerance the slider controls, so the export matches
      // the on-screen bond set.
      const hasSourceBonds = (currentFrame.bonds?.length ?? 0) > 0;
      const mayInferBonds = state.showBonds
        && !hasSourceBonds
        && canInferCovalentBonds(currentFrame);
      if (state.showBonds && req.artifactSpec && !hasSourceBonds && !mayInferBonds) {
        throw new ModelExportLayerIncompleteError(
          'The requested bond layer has neither authoritative source pairs nor proven element and distance semantics.',
          { format: isUsdZ ? 'usdz' : 'glb', reason: 'unproven-bond-semantics' },
        );
      }
      if (state.showBonds && !req.artifactSpec && !hasSourceBonds && !mayInferBonds) {
        state.setRendererWarning(
          'Bonds were omitted because this frame does not prove element identities and Angstrom distance units.',
        );
      }

      let covalentRadii: Float32Array | undefined;
      let bondTypes: Int32Array | undefined;
      if (mayInferBonds) {
        covalentRadii = new Float32Array(119);
        bondTypes = new Int32Array(currentFrame.natoms);
        for (let i = 0; i < currentFrame.natoms; i++) {
          const atomicNumber = resolveAtomicNumber(currentFrame, currentFrame.types[i])!;
          bondTypes[i] = atomicNumber;
          covalentRadii[atomicNumber] = getElementSpec(atomicNumber).radius;
        }
      }

      // A molecular frame exports the graph the view draws (same cache, same filter).
      const bondRecipe = mayInferBonds
        ? resolveFrameRecipe(currentFrame, {
          profile: state.bondProfile,
          frameCount: currentFile.trajectory.totalFrames ?? currentFile.trajectory.frames.length,
        })
        : null;
      const perceivedBonds = bondRecipe === MOLECULAR_RECIPE_ID
        ? getPerceivedBonds(currentFrame, { recipe: MOLECULAR_RECIPE_ID, tolerance: state.bondTolerance ?? 0.45 })
        : null;

      const framing = isUsdZ
        ? computeUsdzFraming(currentFrame, state.hiddenAtomTypes)
        : { center: [0, 0, 0] as [number, number, number], arScale: 1 };

      const builtExport = await buildExportScene(currentFrame, {
        format: isUsdZ ? 'usdz' : 'glb',
        delivery: req.artifactDelivery?.inline
          ? {
            mode: 'inline-base64',
            maxInlineBytes: req.artifactDelivery.maxInlineBytes,
          }
          : { mode: 'blob' },
        hiddenTypes: state.hiddenAtomTypes,
        displayRadiusForType: (typeId) =>
          resolveTypeDisplayRadius(currentFrame, typeId)
            * (state.atomScale ?? 1.0)
            * (state.atomTypeScales[typeId] ?? 1.0),
        resolveAtomColor,
        materialPreset: state.materialPreset,
        surfacePolish: state.surfacePolish || 0.0,
        surfaceRoughness: state.surfaceRoughness || 0.0,
        showBonds: state.showBonds && (hasSourceBonds || mayInferBonds),
        bondTolerance: state.bondTolerance ?? 0.45,
        perceivedBonds,
        showBondContacts: state.showBondContacts,
        covalentRadii,
        bondTypes,
        center: framing.center,
        arScale: framing.arScale,
        onProgress: req.onProgress,
      });
      exportScene = builtExport.scene;
      const { bondsCapped } = builtExport;
      // Source filenames/URLs are delivery provenance, not semantic render
      // identity. Embedding them in GLB/USDZ bytes would let two identical
      // decoded molecules produce different bytes behind one artifactKey.
      exportScene.name = 'LUPI-render-artifact-v1';

      if (bondsCapped) {
        if (req.artifactSpec) {
          assertCompleteExportBondLayer({ capped: true, topology: builtExport.bondTopology });
        }
        state.setRendererWarning(
          `3D export bond count exceeded ${MAX_EXPORT_BONDS.toLocaleString()} — extra bonds were dropped.`,
        );
      }

      // ── Export via chosen format ──
      let blob: Blob;
      let filename: string;
      const baseName = req.baseName || 'LUPI';

      if (isUsdZ) {
        const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
        const exporter = new USDZExporter();
        // Merged bake (one geometry + palette texture per InstancedMesh).
        // The old expandInstancedMeshes path created one Object3D per atom,
        // which froze the tab around 100k atoms and OOMed near 1M.
        req.onProgress?.('encode', 0, 1);
        const swaps = await bakeInstancedMeshesForExport(exportScene, {
          onProgress: (done, total) => req.onProgress?.('encode', done, total + 1),
        });
        let usdz: ArrayBuffer;
        try {
          usdz = (await (exporter as any).parseAsync(exportScene)) as ArrayBuffer;
        } finally {
          restoreInstancedMeshes(swaps);
        }
        req.onProgress?.('encode', 1, 1);
        blob = new Blob([usdz], { type: 'model/vnd.usdz+zip' });
        filename = `${baseName}-frame${state.frame + 1}.usdz`;
      } else {
        const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
        const exporter = new GLTFExporter();
        req.onProgress?.('encode', 0, 1);
        const glb = (await exporter.parseAsync(exportScene, { binary: true })) as ArrayBuffer;
        req.onProgress?.('encode', 1, 1);
        blob = new Blob([glb], { type: 'model/gltf-binary' });
        filename = `${baseName}-frame${state.frame + 1}.glb`;
      }

      if (req.onComplete) {
        req.onComplete(true, blob, filename);
      } else {
        downloadBlob(blob, filename);
      }

    } catch (err) {
      console.error('[3D Export] Failed:', err);
      if (err instanceof ModelExportBudgetError) {
        useStore.getState().setRendererWarning(err.message);
        req.onComplete?.(false, undefined, undefined, {
          code: err.code,
          message: err.message,
          details: {
            format: err.estimate.format,
            atomCount: err.estimate.atomCount,
            bondCount: err.estimate.bondCount,
            estimatedTriangles: err.estimate.estimatedTriangles,
            estimatedSceneBytes: err.estimate.estimatedSceneBytes,
            estimatedEncoderOutputBytes: err.estimate.estimatedEncoderOutputBytes,
            estimatedDeliveryBytes: err.estimate.estimatedDeliveryBytes,
            estimatedAllocationBytes: err.estimate.estimatedAllocationBytes,
            allocationBudgetBytes: err.estimate.allocationBudgetBytes,
            deliveryMode: err.estimate.deliveryMode,
            ...(err.estimate.maxInlineBytes === undefined
              ? {}
              : { maxInlineBytes: err.estimate.maxInlineBytes }),
          },
        });
      } else if (err instanceof ModelExportSourceTopologyError) {
        useStore.getState().setRendererWarning(err.message);
        req.onComplete?.(false, undefined, undefined, {
          code: err.code,
          message: err.message,
          details: { ...err.details },
        });
      } else if (err instanceof ModelExportLayerIncompleteError) {
        useStore.getState().setRendererWarning(err.message);
        req.onComplete?.(false, undefined, undefined, {
          code: err.code,
          message: err.message,
          details: { ...err.details },
        });
      } else {
        req.onComplete?.(false);
      }
    } finally {
      if (exportScene) disposeExportScene(exportScene);
      clearExportRequest();
    }
  }, [exportRequest, clearExportRequest]);

  // ─── Start Video Recording (MediaRecorder — native, off-thread) ───────
  const startVideoRecording = useCallback(async () => {
    const req = exportRequest;
    if (!req || isRecording.current) return;
    try {
      req.onStart?.();
    } catch (error) {
      console.error('[ExportManager] Video export could not claim its request:', error);
      try {
        req.onComplete?.(false);
      } finally {
        if (useStore.getState().exportRequest === req) clearExportRequest();
      }
      return;
    }

    // Keep even dimensions (some encoders/players dislike odd dims).
    const width = (req.resolution?.width || 1920) & ~1;
    const height = (req.resolution?.height || 1080) & ~1;
    const fps = 30;

    onCompleteRef.current = req.onComplete || null;
    requestRef.current = req;
    abortedRef.current = false;

    // Toys stand down for the whole recording: the rig settles and suspends,
    // display motion stays at rest. restoreAfterVideo stops them on every exit.
    // First, so the pose below is the settled one, not a glide's mid-flight.
    // An illustrative clip (Instant Replay) keeps the toys playing.
    recordingRestoreRef.current?.();
    recordingRestoreRef.current = beginRecording(req.illustrative ? { illustrative: true } : {});

    // Capture the camera pose to restore after capture. The flythrough
    // path drives position AND fov every tick, so both video modes need
    // this — previously only orbit captured, leaving the viewport stuck
    // at the flythrough's final pose after export.
    if (req.orbit || req.replay || (req.flythrough && req.flythrough.keyframes.length >= 2)) {
      originalCameraPosition.current = camera.position.clone();
      originalCameraFov.current =
        camera instanceof THREE.PerspectiveCamera ? camera.fov : null;
    }

    if (req.cinematic) {
      const state = useStore.getState();
      originalStoreState.current = {
        bondTolerance: state.bondTolerance,
        atomScale: state.atomScale,
        frame: state.frame,
      };
    }

    originalSize.current = {
      width: size.width,
      height: size.height,
      aspect: (camera as THREE.PerspectiveCamera).aspect
    };

    // Force DPR to 1 and size the engine THROUGH R3F (setDpr/setSize) rather than
    // a raw renderer.setSize(): R3F's `size` state drives the camera aspect and
    // any render pipeline passes, so routing through it keeps pipeline, camera
    // and renderer on one aspect. The recording is the canvas itself.
    originalPixelRatio.current = renderer.getPixelRatio();
    setDpr(1);
    setSize(width, height);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    // Capture needs a frame every tick. Record the actual Fiber mode first;
    // restoreAfterVideo returns to that exact value on every exit path.
    originalFrameloop.current = frameloop;
    setFrameloop('always');

    // ── MediaRecorder (single durable path) ───────────────────────────
    // Pick the best supported container/codec, preferring MP4 (Safari/iOS) then
    // WebM (Chromium/Firefox). MediaRecorder encodes the captured canvas stream
    // natively and off the main thread, so the UI never freezes.
    const candidateMimes = [
      'video/mp4;codecs=avc1.640028',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const canvas = renderer.domElement as HTMLCanvasElement;
    const supportsRecorder =
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.isTypeSupported === 'function';
    const mimeType = supportsRecorder
      ? candidateMimes.find((m) => MediaRecorder.isTypeSupported(m))
      : undefined;
    const compositor = req.compositor ?? null;

    if (
      !supportsRecorder
      || !mimeType
      || typeof canvas.captureStream !== 'function'
      || (compositor && typeof compositor.canvas.captureStream !== 'function')
    ) {
      useStore.getState().setRendererWarning('Video export isn’t supported in this browser.');
      onCompleteRef.current?.(false);
      restoreAfterVideo();
      return;
    }

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

    const beginRecorder = (stream: MediaStream) => {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: req.replay ? 8_000_000 : 12_000_000,
      });

      // Fresh chunk accumulator for this export.
      recordedChunksRef.current = [];
      const chunks = recordedChunksRef.current;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };

      recorder.onstop = () => {
        void (async () => {
          try {
            if (abortedRef.current) {
              onCompleteRef.current?.(false, undefined, undefined, { code: 'aborted', message: 'The recording was cancelled.' });
              return;
            }
            const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
            const baseName = req.baseName || 'LUPI';
            const filename = `${baseName}.${ext}`;

            if (blob.size === 0) {
              useStore.getState().setRendererWarning('Video export captured no frames.');
              onCompleteRef.current?.(false);
            } else if (req.fileStream) {
              // Stream the final video to the user-picked file handle.
              await req.fileStream.write(blob);
              await req.fileStream.close();
              onCompleteRef.current?.(true);
            } else if (onCompleteRef.current) {
              onCompleteRef.current(true, blob, filename);
            } else {
              downloadBlob(blob, filename);
            }
          } catch (err) {
            console.error('[ExportManager] Video delivery failed:', err);
            useStore.getState().setRendererWarning('Video export failed in this browser.');
            onCompleteRef.current?.(false);
          } finally {
            restoreAfterVideoRef.current();
          }
        })();
      };

      recorderRef.current = recorder;
      recorderStoppedRef.current = false;
      recorder.start();
    };

    captureStartRef.current = null; // anchored on the first VideoCaptureLoop tick (or composed frame)
    recorderRef.current = null;
    recorderStoppedRef.current = false;

    if (compositor) {
      // The first composed frame starts the recorder (ClipCompositeJob).
      startComposedRecorderRef.current = (composed: boolean) => {
        startComposedRecorderRef.current = null;
        if (!isRecording.current) return;
        if (!composed) console.warn('[ExportManager] the viewer canvas could not be composed; recording it without labels');
        beginRecorder((composed ? compositor.canvas : canvas).captureStream(fps));
        captureStartRef.current = performance.now();
      };
    } else {
      startComposedRecorderRef.current = null;
      beginRecorder(canvas.captureStream(fps));
    }

    try {
      req.replay?.begin();
    } catch (error) {
      console.error('[ExportManager] replay clip begin threw', error);
    }

    totalFrames.current = fps * (req.replay ? req.replay.duration : req.durationSeconds || 5); // no longer used for completion; harmless
    frameCount.current = 0;
    isRecording.current = true;
    setIsCapturing(true);
    // Kick the render loop: switching demand→always doesn't restart rAF on its own,
    // so without this the capture loop can stall before its first tick.
    invalidate();
  }, [exportRequest, camera, renderer, size, frameloop, clearExportRequest, setSize, setDpr, setFrameloop, invalidate, restoreAfterVideo]);

  // Stop a recording in flight and discard it (the share sheet closed).
  const abortRecording = useCallback(() => {
    if (!isRecording.current) return;
    abortedRef.current = true;
    isRecording.current = false;
    setIsCapturing(false);
    startComposedRecorderRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive' && !recorderStoppedRef.current) {
      recorderStoppedRef.current = true;
      recorder.stop(); // onstop reports the abort and restores
      return;
    }
    onCompleteRef.current?.(false, undefined, undefined, { code: 'aborted', message: 'The recording was cancelled.' });
    restoreAfterVideoRef.current();
  }, []);

  // ─── Effect: Dispatch export actions ──────────────────────────
  // IMPORTANT: Only depend on exportRequest. We use refs for the handlers
  // to break the React dependency cycle that causes "Maximum update depth exceeded".
  const startVideoRecordingRef = useRef(startVideoRecording);
  startVideoRecordingRef.current = startVideoRecording;
  const handle3DExportRef = useRef(handle3DExport);
  handle3DExportRef.current = handle3DExport;

  useEffect(() => {
    if (!exportRequest || !exportRequest.type) return;

    // Raster export is dispatched by the transient Fiber lifecycle rendered
    // below; it must not run from a React effect or bypass scene useFrame hooks.
    if (exportRequest.type === 'video') {
      startVideoRecordingRef.current();
    }
    if (exportRequest.type === 'glb' || exportRequest.type === 'usdz') {
      handle3DExportRef.current();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportRequest]);

  // Leaving the viewer mid-recording must not leave the toys suspended
  // (display motion's suspend flag is module state and outlives this mount).
  useEffect(() => () => {
    const stopRecordingGuards = recordingRestoreRef.current;
    recordingRestoreRef.current = null;
    stopRecordingGuards?.();
  }, []);

  return (
    <>
      <ViewerCaptureService />
      {exportRequest.type === 'image' && (
        <ImageCaptureFrame request={exportRequest} frameIndex={frame} />
      )}
      {isCapturing && (
        <VideoCaptureLoop
          requestRef={requestRef}
          totalFrames={totalFrames}
          originalCameraPosition={originalCameraPosition}
          file={file}
          isRecording={isRecording}
          setIsCapturing={setIsCapturing}
          recorderRef={recorderRef}
          recorderStoppedRef={recorderStoppedRef}
          captureStartRef={captureStartRef}
          abortRecording={abortRecording}
        />
      )}
      {isCapturing && exportRequest.compositor && (
        <ClipCompositeJob
          requestRef={requestRef}
          isRecording={isRecording}
          captureStartRef={captureStartRef}
          startRecorder={(composed) => startComposedRecorderRef.current?.(composed)}
        />
      )}
    </>
  );
}

// ─── Utility ─────────────────────────────────────────────────────
function readCanonicalGradientBackgroundV1(value: unknown): {
  top: string;
  bottom: string;
  style: BackgroundGradientStyle;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The finalized artifact spec is missing its canonical background state.');
  }
  const background = value as Record<string, unknown>;
  const media = background.media;
  const style = background.style;
  if (
    typeof background.top !== 'string'
    || typeof background.bottom !== 'string'
    || !media
    || typeof media !== 'object'
    || Array.isArray(media)
    || (media as Record<string, unknown>).kind !== 'gradient'
    || (media as Record<string, unknown>).projection !== 'equirectangular'
    || background.projectionMode !== 'scene-background'
    || (style !== 'linear' && style !== 'radial' && style !== 'spotlight')
  ) {
    throw new Error(
      'The V1 browser capture can only apply a canonical equirectangular gradient scene background.',
    );
  }
  return { top: background.top, bottom: background.bottom, style };
}

function isFiniteTuple3(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
