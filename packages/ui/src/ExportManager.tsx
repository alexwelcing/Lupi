/**
 * ExportManager — Unified pipeline for image, MP4/WebM, GLB, and USDZ export.
 *
 * Architecture:
 *   Image:  Single-frame WebGL readback at arbitrary resolution.
 *   Video:  MP4/WebM via the browser-native MediaRecorder recording
 *           `gl.domElement.captureStream(fps)`. MediaRecorder encodes natively,
 *           off the main thread (no UI freeze), on every browser — mp4 on
 *           Safari/iOS, webm (vp9/vp8) on Chromium/Firefox. The capture loop only
 *           drives the camera/scene by wall-clock time; the canvas is recorded
 *           automatically.
 *   GLB:    Reconstructs real sphere/cylinder meshes from atomic data and exports
 *           via GLTFExporter for use in Blender, Unity, or any 3D software.
 *   USDZ:   Same mesh reconstruction → USDZExporter for AR Quick Look.
 *
 * All video modes support 360° orbit around the structure centroid.
 */

import { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useStore, type ExportRequest } from './store';
import { getElementSpec, hexToRgb } from '@atlas/core';
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
  type PreparedImageCaptureTransaction,
} from './export/renderCaptureState';
import {
  createGradientEquirectTexture,
  type BackgroundGradientStyle,
} from './equirectTexture';
import { assertSceneEnvironmentReady } from './sceneEnvironment';
import {
  inspectArtifactAtomSceneReadiness,
  inspectArtifactVectorGlyphSceneReadiness,
} from './export/artifactSceneReadiness';

const SINGLE_TYPE_NORM_VALUE = 0.5;
const MIN_NUMERIC_RANGE = 1e-6;

// ─── Video Capture Loop Component ──────────────────────────────────
// By isolating the priority=2 useFrame into a conditionally mounted component,
// we prevent React Three Fiber from permanently disabling its native Priority 0
// gl.render loop (which happens if any hooked component has priority > 0).
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
}: any) {
  const { invalidate } = useThree();
  const { camera } = useThree();

  useFrame(() => {
    if (!isRecording.current) return;

    // Keep the demand frameloop alive: the export must drive continuous rendering
    // even though the app normally renders on demand. Without this, useFrame can
    // stall after the first frame once the frameloop idles.
    invalidate();

    const req = requestRef.current;
    if (!req) return;

    // On the first tick, anchor the wall-clock start. MediaRecorder started a hair
    // earlier; tying progress to the first rendered frame keeps the motion smooth.
    if (captureStartRef.current === null) {
      captureStartRef.current = performance.now();
    }

    const elapsed = performance.now() - captureStartRef.current;
    const durationMs = (req.durationSeconds || 5) * 1000;
    const progress = Math.min(elapsed / durationMs, 1);

    // Drive the camera/scene by wall-clock `progress` (0..1).
    // Flythrough path takes priority over orbit
    if (req.flythrough && req.flythrough.keyframes.length >= 2) {
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
  }, 2); // Priority 2 execution!

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
 * Transient two-phase Fiber subscriber for deterministic raster capture.
 * Priority -0.5 runs after drei OrbitControls (-1) and before ordinary scene
 * hooks (0), re-applying the finalized camera. Priority 100 reads pixels after
 * atom/environment/interpolation uniforms have observed that camera.
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
  const { gl, scene, camera, size, invalidate } = useThree();
  const revisionRef = useRef(nextImageCaptureRevision++);
  const barrierRef = useRef(createFiberFrameCaptureBarrier(revisionRef.current));
  const transactionRef = useRef<PreparedImageCaptureTransaction | null>(null);
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
          gl,
          1024,
          canonicalBackground.style,
        );
      }

      const targetWidth = request.resolution?.width || size.width;
      const targetHeight = request.resolution?.height || size.height;
      transactionRef.current = beginImageCaptureTransaction({
        renderer: gl,
        scene,
        camera,
        viewportWidth: size.width,
        viewportHeight: size.height,
        targetWidth,
        targetHeight,
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
  }, [camera, failCapture, frameIndex, gl, invalidate, request, restoreCaptureState, scene, size.height, size.width]);

  useFrame(() => {
    const transaction = transactionRef.current;
    if (!transaction) return;
    try {
      if (request.artifactSpec) {
        const lighting = request.artifactSpec.view.lighting as Record<string, unknown> | undefined;
        assertSceneEnvironmentReady(scene.environment, lighting?.environment);
      }
      transaction.applyCanonicalState();
      markFiberFrameCaptureApplied(barrierRef.current, revisionRef.current);
    } catch (error) {
      onFrameCaptured();
      failCapture(error);
    }
  }, -0.5);

  useFrame(() => {
    const transaction = transactionRef.current;
    if (!transaction) return;

    try {
      if (request.artifactSpec?.layers.atoms) {
        if (!request.specId) throw new Error('Artifact atom capture is missing its render spec revision.');
        const atomReadiness = inspectArtifactAtomSceneReadiness(scene, request.specId);
        if (!atomReadiness.ready) {
          // React/store intent can precede the Three scene commit. Keep the
          // owned demand loop alive until every tagged atom mesh carries the
          // exact artifact revision; the export timeout remains the fail-closed
          // bound if the scene can never apply it.
          invalidate();
          return;
        }
      }
      if (request.artifactSpec?.layers.vectorGlyphs) {
        if (!request.specId) throw new Error('Artifact vector-glyph capture is missing its render spec revision.');
        const vectorReadiness = inspectArtifactVectorGlyphSceneReadiness(scene, request.specId);
        if (!vectorReadiness.ready) {
          // Vector glyphs own a separate ShaderMaterial, colormap texture, and
          // four instanced buffers. Their exact applied revision must be proven
          // independently of the atom layer before immutable readback.
          invalidate();
          return;
        }
      }

      if (claimFiberFrameWarmup(barrierRef.current, revisionRef.current)) {
        // R3F state and Three resources committed in the same update as the
        // export request need one owned draw before readback. This is an
        // explicit GPU-application barrier: the warm-up uploads new palette
        // DataTextures and compiles the active ShaderMaterial program, then the
        // next Fiber frame re-applies camera-space uniforms before capture.
        transaction.clear();
        gl.render(scene, camera);
        invalidate();
        return;
      }
      if (!claimFiberFrameCapture(barrierRef.current, revisionRef.current)) return;

      transaction.clear();
      gl.render(scene, camera);

      const targetWidth = request.resolution?.width || size.width;
      const targetHeight = request.resolution?.height || size.height;
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = targetWidth;
      captureCanvas.height = targetHeight;
      const captureContext = captureCanvas.getContext('2d');
      if (!captureContext) throw new Error('Image export could not create a 2D capture context.');
      captureContext.drawImage(gl.domElement, 0, 0, targetWidth, targetHeight);
      const contractAxes = request.artifactSpec?.layers.axes;
      if (contractAxes ?? useStore.getState().showAxes) {
        drawExportAxesOverlayV1(captureContext, camera, targetWidth, targetHeight);
      }

      // Readback is complete; release renderer/Fiber ownership before the
      // browser's asynchronous canvas encoder starts.
      restoreCaptureState();
      // Present the restored live scene immediately when Plan 028 moves the
      // Canvas to demand mode; otherwise the export-sized frame can remain on
      // screen until an unrelated interaction invalidates Fiber.
      invalidate();
      onFrameCaptured();

      const format = request.format === 'jpeg' || request.format === 'webp'
        ? request.format
        : 'png';
      const mime = `image/${format}`;
      const quality = format === 'png' ? undefined : 1.0;
      const ext = format === 'jpeg' ? 'jpg' : format;
      const filename = `${request.baseName || 'LUPI-export'}-frame${frameIndex + 1}.${ext}`;

      captureCanvas.toBlob(
        (blob) => {
          completeImageCaptureCallback(
            () => {
              if (blob) {
                if (request.onComplete) request.onComplete(true, blob, filename);
                else downloadBlob(blob, filename);
              } else {
                console.error('[ExportManager] toBlob returned null — canvas may be tainted or context lost');
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
    } catch (error) {
      onFrameCaptured();
      failCapture(error);
    }
  }, 100);

  return null;
}

export function ExportManager() {
  const { gl, camera, size, frameloop, setSize, setDpr, setFrameloop, invalidate } = useThree();
  const exportRequest = useStore(s => s.exportRequest);
  const clearExportRequest = useStore(s => s.clearExportRequest);
  const file = useStore(s => s.file);
  const frame = useStore(s => s.frame);

  // Recording state
  const isRecording = useRef(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const onCompleteRef = useRef<((success: boolean, blob?: Blob, filename?: string) => void) | null>(null);

  // MediaRecorder pipeline state. MediaRecorder records `captureStream()` of the
  // WebGL canvas natively, off the main thread — no UI freeze, works on every
  // browser (mp4 on Safari/iOS, webm on Chromium/Firefox).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]); // recorder chunks accumulated via ondataavailable
  const captureStartRef = useRef<number | null>(null); // wall-clock anchor, set on first VideoCaptureLoop tick
  const recorderStoppedRef = useRef(false); // ensures recorder.stop() is called exactly once
  const requestRef = useRef<any>(null);
  const totalFrames = useRef(0);
  const frameCount = useRef(0);
  const originalPixelRatio = useRef<number>(1);
  const originalCameraPosition = useRef<THREE.Vector3 | null>(null);
  const originalCameraFov = useRef<number | null>(null);
  const originalSize = useRef<{ width: number; height: number; aspect: number } | null>(null);
  const originalStoreState = useRef<{ bondTolerance: number; atomScale: number; frame: number } | null>(null);
  const originalFrameloop = useRef<'always' | 'demand' | 'never' | null>(null);

  // Shared scene/camera/size/store restore after a video export. Reused for both
  // the success and failure paths of the MediaRecorder capture.
  const restoreAfterVideo = useCallback(() => {
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
    // Restore the exact mode in effect before export. Canvas defaults to
    // "always" unless configured otherwise, and export must not silently
    // change application scheduling for the rest of the session.
    if (originalFrameloop.current) {
      setFrameloop(originalFrameloop.current);
      originalFrameloop.current = null;
    }
    clearExportRequest();
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
      const { TYPE_COLORS, TYPE_RADII, DEFAULT_TYPE_COLOR, COLORMAPS } = await import('@atlas/scene');

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
          resolved = override ? hexToRgb(override) : (TYPE_COLORS[typeId] ?? DEFAULT_TYPE_COLOR);
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
      let maxTypeId = 0;
      for (const t of typeSet) if (t > maxTypeId) maxTypeId = t;
      const covalentRadii = new Float32Array(maxTypeId + 1);
      for (const t of typeSet) covalentRadii[t] = getElementSpec(t).radius;

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
          (TYPE_RADII[typeId] ?? 1.0) * (state.atomScale ?? 1.0) * (state.atomTypeScales[typeId] ?? 1.0),
        resolveAtomColor,
        materialPreset: state.materialPreset,
        surfacePolish: state.surfacePolish || 0.0,
        surfaceRoughness: state.surfaceRoughness || 0.0,
        showBonds: state.showBonds,
        bondTolerance: state.bondTolerance ?? 0.45,
        covalentRadii,
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

    // Capture the camera pose to restore after capture. The flythrough
    // path drives position AND fov every tick, so both video modes need
    // this — previously only orbit captured, leaving the viewport stuck
    // at the flythrough's final pose after export.
    if (req.orbit || (req.flythrough && req.flythrough.keyframes.length >= 2)) {
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
    // a raw gl.setSize(). The postprocessing EffectComposer only resizes its
    // render targets when R3F's `size` state changes; a raw gl.setSize() leaves
    // the composer at the old viewport aspect, and its final fullscreen pass then
    // stretches that across the new export buffer — the squished-molecule bug.
    // Routing through R3F keeps composer + camera + renderer on one aspect.
    originalPixelRatio.current = gl.getPixelRatio();
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
    const canvas = gl.domElement as HTMLCanvasElement;
    const supportsRecorder =
      typeof MediaRecorder !== 'undefined' &&
      typeof MediaRecorder.isTypeSupported === 'function';
    const mimeType = supportsRecorder
      ? candidateMimes.find((m) => MediaRecorder.isTypeSupported(m))
      : undefined;

    if (!supportsRecorder || !mimeType || typeof canvas.captureStream !== 'function') {
      useStore.getState().setRendererWarning('Video export isn’t supported in this browser.');
      onCompleteRef.current?.(false);
      restoreAfterVideo();
      return;
    }

    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
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
    captureStartRef.current = null; // anchored on the first VideoCaptureLoop tick
    recorderStoppedRef.current = false;

    recorder.start();

    totalFrames.current = fps * (req.durationSeconds || 5); // no longer used for completion; harmless
    frameCount.current = 0;
    isRecording.current = true;
    setIsCapturing(true);
    // Kick the render loop: switching demand→always doesn't restart rAF on its own,
    // so without this the capture loop can stall before its first tick.
    invalidate();
  }, [exportRequest, camera, gl, size, frameloop, clearExportRequest, setSize, setDpr, setFrameloop, invalidate, restoreAfterVideo]);

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

  return (
    <>
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
