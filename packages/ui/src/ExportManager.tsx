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

import { useEffect, useRef, useCallback, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useStore } from './store';
import { getElementSpec } from '@atlas/core';
import * as THREE from 'three';
import { sampleFlythrough, getSequenceDuration } from './flythrough';
import { restoreInstancedMeshes } from './export/USDZExportPipeline';
import { bakeInstancedMeshesForExport } from './export/instanceBake';
import {
  buildExportScene,
  computeUsdzFraming,
  disposeExportScene,
  MAX_EXPORT_BONDS,
} from './export/exportSceneBuilder';

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
export function ExportManager() {
  const { gl, scene, camera, size, setSize, setDpr, setFrameloop, invalidate } = useThree();
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
    // Hand rendering back to the perf-friendly demand loop now that export is done.
    setFrameloop('demand');
    clearExportRequest();
  }, [camera, file, setSize, setDpr, setFrameloop, clearExportRequest]);

  // Stable ref so the VideoCaptureLoop always calls the freshest restore closure.
  const restoreAfterVideoRef = useRef(restoreAfterVideo);
  restoreAfterVideoRef.current = restoreAfterVideo;

  // ─── Image Export ─────────────────────────────────────────────
  const handleImageExport = useCallback(() => {
    const req = exportRequest;
    if (!req) return;

    const oldWidth = size.width;
    const oldHeight = size.height;
    const targetWidth = req.resolution?.width || oldWidth;
    const targetHeight = req.resolution?.height || oldHeight;
    const format = req.format || 'png';

    const originalAspect = (camera as THREE.PerspectiveCamera).aspect;
    const originalPixelRatio = gl.getPixelRatio();
    const originalClearColor = new THREE.Color();
    gl.getClearColor(originalClearColor);
    const originalClearAlpha = gl.getClearAlpha();

    gl.setPixelRatio(1);
    gl.setSize(targetWidth, targetHeight, false);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = targetWidth / targetHeight;
      camera.updateProjectionMatrix();
    }

    if (!req.transparent) {
      gl.setClearColor(new THREE.Color('#10131a'), 1);
    } else {
      gl.setClearColor(0x000000, 0);
    }

    const originalRenderTarget = gl.getRenderTarget();
    gl.setRenderTarget(null);
    gl.render(scene, camera);

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = targetWidth;
    captureCanvas.height = targetHeight;
    const captureContext = captureCanvas.getContext('2d')!;
    captureContext.drawImage(gl.domElement, 0, 0, targetWidth, targetHeight);

    const mime = `image/${format}`;
    const quality = format === 'png' ? undefined : 1.0;
    const ext = format === 'jpeg' ? 'jpg' : format;
    const filename = `${req.baseName || 'LUPI-export'}-frame${frame + 1}.${ext}`;

    // Use toBlob for reliable downloads with correct file extensions.
    // toDataURL + link.click() fails in modern Chrome when the <a> isn't in the DOM,
    // causing missing/wrong file extensions.
    // Note: toBlob captures pixels synchronously per spec — the callback is just for
    // delivering the encoded blob. Safe to restore renderer state immediately after.
    captureCanvas.toBlob(
      (blob) => {
        if (blob) {
          if (req.onComplete) {
            req.onComplete(true, blob, filename);
          } else {
            downloadBlob(blob, filename);
          }
        } else {
          console.error('[ExportManager] toBlob returned null — canvas may be tainted or context lost');
          if (req.onComplete) req.onComplete(false);
        }
        clearExportRequest();
      },
      mime,
      quality,
    );

    // Restore renderer state immediately — pixels already captured above
    gl.setRenderTarget(originalRenderTarget);
    gl.setPixelRatio(originalPixelRatio);
    gl.setSize(oldWidth, oldHeight, false);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = originalAspect;
      camera.updateProjectionMatrix();
    }
    gl.setClearColor(originalClearColor, originalClearAlpha);
  }, [exportRequest, gl, scene, camera, size, clearExportRequest, frame]);

  // ─── 3D Model Export (GLB / USDZ) ─────────────────────
  // Scene construction (instancing, LOD, chunked bond detection, progress)
  // lives in export/exportSceneBuilder so the exact same code path runs
  // headless from Node (tools/verify-exports.mjs). This handler only wires
  // store state into the builder and drives the format-specific encoders.
  const handle3DExport = useCallback(async () => {
    const req = exportRequest;
    if (!req) return;

    try {
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

      const resolveTypeColor = (typeId: number): [number, number, number] => {
        if (state.atomColorSource === 'element') {
          const override = state.elementColorOverrides[typeId];
          if (override) return new THREE.Color(override).toArray() as [number, number, number];
          return TYPE_COLORS[typeId] ?? DEFAULT_TYPE_COLOR;
        }
        const t = typeToNorm.get(typeId) ?? SINGLE_TYPE_NORM_VALUE;
        return mapFn(t);
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

      const resolveAtomColor = (atomIndex: number, atomType: number): [number, number, number] => {
        if (state.colorMode === 'property' && propertyData) {
          const t = Math.max(0, Math.min(1, (propertyData[atomIndex] - propertyMin) / propertyRange));
          return mapFn(t);
        }
        if (state.colorMode === 'uniform') {
          return new THREE.Color(state.uniformAtomColor).toArray() as [number, number, number];
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

      const { scene: exportScene, bondsCapped } = await buildExportScene(currentFrame, {
        format: isUsdZ ? 'usdz' : 'glb',
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
      exportScene.name = currentFile.name || 'LUPI-export';

      if (bondsCapped) {
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

      disposeExportScene(exportScene);

    } catch (err) {
      console.error('[3D Export] Failed:', err);
      if (req.onComplete) req.onComplete(false);
    }

    clearExportRequest();
  }, [exportRequest, clearExportRequest]);

  // ─── Start Video Recording (MediaRecorder — native, off-thread) ───────
  const startVideoRecording = useCallback(async () => {
    const req = exportRequest;
    if (!req || isRecording.current) return;

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

    // The app runs a demand frameloop (renders only on interaction) for perf, but
    // the capture loop needs a frame EVERY tick. Force 'always' for the duration of
    // the export; restoreAfterVideo() hands it back to 'demand'. This is the real
    // fix for exports stalling when the canvas is otherwise idle.
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
  }, [exportRequest, camera, gl, size, clearExportRequest, setSize, setDpr, setFrameloop, invalidate, restoreAfterVideo]);

  // ─── Effect: Dispatch export actions ──────────────────────────
  // IMPORTANT: Only depend on exportRequest. We use refs for the handlers
  // to break the React dependency cycle that causes "Maximum update depth exceeded".
  const handleImageExportRef = useRef(handleImageExport);
  handleImageExportRef.current = handleImageExport;
  const startVideoRecordingRef = useRef(startVideoRecording);
  startVideoRecordingRef.current = startVideoRecording;
  const handle3DExportRef = useRef(handle3DExport);
  handle3DExportRef.current = handle3DExport;

  useEffect(() => {
    if (!exportRequest || !exportRequest.type) return;

    if (exportRequest.type === 'image') {
      handleImageExportRef.current();
    }
    if (exportRequest.type === 'video') {
      startVideoRecordingRef.current();
    }
    if (exportRequest.type === 'glb' || exportRequest.type === 'usdz') {
      handle3DExportRef.current();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportRequest]);

  return isCapturing ? (
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
  ) : null;
}

// ─── Utility ─────────────────────────────────────────────────────
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
