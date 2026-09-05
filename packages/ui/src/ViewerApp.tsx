/**
 * ViewerApp - the hook-bearing Lupi molecular viewer shell.
 *
 * Professional molecular dynamics visualization with
 * glassmorphic UI, side panels, and publication-quality rendering.
 *
 * Refactored into an orchestration layer: layout, route/URL effects,
 * playback state, and command palette live here; visual pieces are
 * composed from packages/ui/src/app/* and primitives/AppShell.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useStore, initSettingsPersistence } from './store';
import {
  getMaxSafeAtomCount,
  getDefaultQualityTier,
  MAX_INTERACTIVE_PICKING_ATOMS,
} from './deviceCapabilities';
import { detectFrameVectorFields } from '@atlas/core';
import type { VectorGlyphStats } from '@atlas/scene';

import { LandingPage } from './LandingPage';
import { SceneLandingPage } from './landing/SceneLandingPage';
import { SeoEducationPage } from './landing/SeoEducationPage';
import {
  useViewerBackgroundState,
  useViewerFileState,
  useViewerPanelState,
  useViewerPlaybackState,
} from './storeSelectors';
import {
  SEO_EDUCATION_ROUTES,
  currentHashRoute,
  currentPathRoute,
  isEmbeddedMobileViewerRoute,
  isMcpViewerRoute as isMcpViewerRouteMatch,
  isSciencePanelRoute,
  normalizedPathRoute,
  savedViewSlugFromRoute,
  sciencePathIndexFromRoute,
} from './viewer/viewerRoutes';
import { openMolecule } from './viewer/openMolecule';
import {
  DEFAULT_Z1_SCIENCE_PATH_INDEX,
  scienceGalleryIdForPathIndex,
} from './science/scienceBundle';
import { getBackdropRadiusLimit, useViewerSceneModel } from './viewer/useViewerSceneModel';
import { ViewerCanvas } from './viewer/ViewerCanvas';
import { selectViewerFrames } from './viewer/artifactFrameSelection';
import { PresetLegacyBridge } from './viewer/PresetLegacyBridge';
import { xrStore } from './viewer/xrStore';

import { McpViewerBridge, McpViewerHarness } from './mcpViewerBridge';
import { BatchAssetGenerator } from './BatchAssetGenerator';
import { DeferredCommandPalette } from './CommandPalette';
import { recognizeLupiUrlPayload } from './lupiUrlRecognition';
import { assertAllowedRemoteMoleculeUrl } from './remoteMoleculeUrlPolicy';
import { decodeFlythrough } from './flythrough';
import { track, ANALYTICS_EVENTS, ensureAnalyticsSession } from './analytics';
import { detectRenderCapability } from './renderCapability';
import { PanelHost } from './PanelHost';
import { StudyLensPanel } from './StudyLensPanel';
import { XREntryButton } from './xr/XREntryButton';

import {
  useSmoothFramePlayback,
  type InterpolatedFrameState,
} from './hooks/useSmoothFramePlayback';
import { useMediaQuery } from './hooks/useMediaQuery';
import { clearStreamingFrameCoordinator, requestStreamingFrame } from './streamingFrameCoordinator';

import { AppHeader } from './app/AppHeader';
import { resolveBackground, type BackgroundAssetAdjustments } from './app/AppBackground';
import { CameraManager } from './app/CameraManager';
import { ViewerCommandDeck } from './app/ViewerCommandDeck';
import { PlaybackStatus } from './app/PlaybackStatus';
import { PlaybackScrubber } from './app/PlaybackScrubber';
import { PlaybackSpeedControl } from './app/PlaybackSpeedControl';
import { ViewerGestureHint } from './app/ViewerGestureHint';
import { RendererWarningToast } from './app/RendererWarningToast';
import { GlobalShortcuts } from './app/GlobalShortcuts';
import { useSavedViewQuerySync } from './app/useSavedViewQuerySync';
import { SavedViewLoadState } from './app/SavedViewLoadState';
import { RemoteMoleculeLoadError } from './app/RemoteMoleculeLoadError';
import { ViewerScene } from './app/ViewerScene';
import { cancelViewerLoad } from './viewer/loadGuard';

import { IconFirst, IconPrev, IconPlay, IconPause, IconNext, IconLast } from './icons';
import { TransportButton } from './controls';

import { TelemetryHUD } from './TelemetryHUD';
import { StateInspector } from './StateInspector';
import { LabelPerfHUD } from './LabelPerfHUD';
import { PropertyLegendHUD } from './PropertyLegendHUD';
import { DevProbe } from './DevProbe';
import { Perf } from 'r3f-perf';
import { ScaleBar } from '@atlas/scene/ScaleBar';

const EMPTY_TRAJECTORY_FRAMES: Array<import('@atlas/core/types').Frame | undefined> = [];

// Boot settings persistence (rehydrate + subscribe) as the viewer chunk
// evaluates — before the component effect decodes `?s=`, so an explicit share
// URL always wins over stored device settings. Idempotent and SSR/test-safe.
initSettingsPersistence();

export function ViewerApp() {
  const [hashRoute, setHashRoute] = useState(currentHashRoute);
  const [pathRoute, setPathRoute] = useState(currentPathRoute);
  const [isExportingQuickLook, setIsExportingQuickLook] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [gpuStudioOpen, setGpuStudioOpen] = useState(false);
  const [vectorStats, setVectorStats] = useState<VectorGlyphStats | null>(null);
  const [automaticLoadFailed, setAutomaticLoadFailed] = useState(false);
  const loadedSavedViewSlugRef = useRef<string | null>(null);
  const interactedForFileRef = useRef<string | null>(null);

  const hashPath = hashRoute.split('?')[0] || '/';
  const normalizedPath = normalizedPathRoute(pathRoute);
  const isEmbeddedMobileViewer = isEmbeddedMobileViewerRoute(hashPath);
  const isMcpViewerRoute = !isEmbeddedMobileViewer && isMcpViewerRouteMatch(hashPath);
  const savedViewSlug = savedViewSlugFromRoute(hashPath) ?? savedViewSlugFromRoute(normalizedPath);
  const isSavedViewRoute = Boolean(savedViewSlug);
  const isCopperSceneRoute = normalizedPath === '/scenes/1m-copper-lattice';
  const seoEducationKind = SEO_EDUCATION_ROUTES[normalizedPath] ?? null;

  // Route sync
  useEffect(() => {
    const syncRoute = () => {
      setHashRoute(currentHashRoute());
      setPathRoute(currentPathRoute());
    };
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  // Analytics: top-of-funnel landing.
  useEffect(() => {
    ensureAnalyticsSession();
    track(ANALYTICS_EVENTS.APP_LANDED);
  }, []);

  // Saved view query (mirrors loading/error/title state into the store).
  const savedViewQuery = useSavedViewQuerySync(savedViewSlug);
  if (savedViewSlug && loadedSavedViewSlugRef.current !== savedViewSlug) {
    loadedSavedViewSlugRef.current = savedViewSlug;
  }

  const { file, ghostFile, frame, loadedAtomCount } = useViewerFileState();
  const { playing, playbackSpeed, setFrame, nextFrame, togglePlay } = useViewerPlaybackState();
  const loopMode = useStore(s => s.loopMode);
  const { activePanel, setActivePanel } = useViewerPanelState();
  const {
    backgroundPreset,
    backgroundStyle,
    backgroundMotionPaused,
    backgroundMotionSpeed,
    backgroundOpacity,
    backgroundBrightness,
    backgroundSaturation,
    backgroundContrast,
    backgroundYawDegrees,
    backgroundPitchDegrees,
    backgroundBackdropShape,
    backgroundBackdropPattern,
    backgroundBackdropRadius,
  } = useViewerBackgroundState();

  const useGpuBonds = useStore(s => s.useGpuBonds);
  const gpuBondsStatus = useStore(s => s.gpuBondsStatus);
  const showBonds = useStore(s => s.showBonds);
  const showScaleBar = useStore(s => s.showScaleBar);
  const studyLensOpen = useStore(s => s.studyLensOpen);
  const colorMode = useStore(s => s.colorMode);
  const colorProperty = useStore(s => s.colorProperty);
  const colormap = useStore(s => s.colormap);
  const vectorField = useStore(s => s.vectorField);
  const exportRequest = useStore(s => s.exportRequest);

  // Treat narrow phones and short landscape viewports as compact. Tablet-size
  // Codex/browser previews keep the full command-deck layout instead of a
  // canvas-covering mobile sheet.
  const isMobile = useMediaQuery('(max-width: 640px), (max-height: 500px) and (max-width: 900px)');
  const showDebugHud = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.has('debug') || params.has('devhud') || params.has('dev');
  }, []);

  const deviceMaxAtoms = useMemo(() => getMaxSafeAtomCount(), []);
  const deviceQualityTier = useMemo(() => getDefaultQualityTier(), []);
  const renderCapability = useMemo(() => detectRenderCapability(), []);

  // Renderer warning is derived from gpu bond state.
  useEffect(() => {
    if (useGpuBonds && gpuBondsStatus === 'unsupported') {
      useStore
        .getState()
        .setRendererWarning(
          'GPU bond acceleration unavailable on this device — using the slower CPU path.',
        );
    } else if (gpuBondsStatus === 'ready') {
      useStore.getState().setRendererWarning(null);
    }
  }, [useGpuBonds, gpuBondsStatus]);

  const playbackFrameRate = file?.playbackFrameRate ?? 30;
  const highFidelityPlayback = Boolean(
    file?.playbackFrameRate && (file?.trajectory.frames[0]?.natoms ?? 0) <= 5000,
  );
  const totalFrames = file?.trajectory.totalFrames ?? 0;
  const hasScience = Boolean(file?.science);
  const scienceDiscretePlayback = useStore(s => s.scienceDiscretePlayback);

  // A non-science file replacing a science one closes the science panel
  // (loading a molecule after a Z1 entry must not leave the panel forced open).
  useEffect(() => {
    if (file && !file.science && useStore.getState().activePanel === 'science') {
      useStore.getState().setActivePanel(null);
    }
  }, [file]);
  const frameIsBuffered = Boolean(file?.trajectory.frames[frame]);
  const displayFrameIndex = useMemo(() => {
    if (!file || totalFrames <= 0) return 0;
    const frames = file.trajectory.frames;
    const requested = Math.max(0, Math.min(frame, totalFrames - 1));
    if (frames[requested]) return requested;
    for (let i = requested - 1; i >= 0; i -= 1) if (frames[i]) return i;
    for (let i = requested + 1; i < totalFrames; i += 1) if (frames[i]) return i;
    return 0;
  }, [file, frame, totalFrames]);

  const isFrameReady = useCallback((frameIndex: number) => {
    const frames = useStore.getState().file?.trajectory.frames;
    return Boolean(frames?.[frameIndex]);
  }, []);
  const requestBufferedFrame = useCallback((frameIndex: number) => {
    const current = useStore.getState().frame;
    const direction = frameIndex >= current ? 1 : -1;
    requestStreamingFrame(frameIndex, direction, 12);
  }, []);
  const stopAtPlaybackEnd = useCallback(() => {
    const state = useStore.getState();
    if (state.playing) state.togglePlay();
  }, []);
  const handlePlaybackFrame = useCallback(
    (state: InterpolatedFrameState) => {
      if (!isFrameReady(state.frameIndex)) {
        requestBufferedFrame(state.frameIndex);
        return;
      }
      if (useStore.getState().playing && state.frameIndex !== useStore.getState().frame) {
        useStore.getState().setFrame(state.frameIndex);
      }
    },
    [isFrameReady, requestBufferedFrame],
  );

  const {
    currentState: interpState,
    setFrame: setSmoothFrame,
    liveStateRef,
  } = useSmoothFramePlayback(playing, {
    frames: file?.trajectory.frames ?? EMPTY_TRAJECTORY_FRAMES,
    speed: playbackSpeed,
    targetFPS: highFidelityPlayback ? 120 : 60,
    mdFrameRate: playbackFrameRate,
    // NEB images are discrete reaction-path states — never interpolate between them.
    snapToIntegers: hasScience && scienceDiscretePlayback,
    // Atom and vector shaders read the live RAF ref directly. React now only
    // synchronizes source-frame uploads (and bond interpolation when enabled).
    stateSyncFPS: highFidelityPlayback ? (showBonds ? 60 : 30) : 15,
    isFrameReady,
    onFrameNeeded: requestBufferedFrame,
    loopMode,
    onPlaybackEnd: stopAtPlaybackEnd,
    onFrame: handlePlaybackFrame,
  });

  // Sync external frame updates back to the hook when NOT playing.
  useEffect(() => {
    if (!playing && frameIsBuffered && interpState.effectiveFrame !== frame) {
      setSmoothFrame(frame);
    } else if (!playing && !frameIsBuffered) {
      requestBufferedFrame(frame);
    }
  }, [
    frame,
    frameIsBuffered,
    playing,
    requestBufferedFrame,
    setSmoothFrame,
    interpState.effectiveFrame,
  ]);

  // URL state restore + auto-load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intent = recognizeLupiUrlPayload(window.location.href);
    const state = intent?.state ?? params.get('s');
    if (state) {
      useStore.getState().decodeFromURL(state);
      const unsub = useStore.subscribe(
        s => s.file,
        (loadedFile, prevFile) => {
          if (loadedFile && loadedFile !== prevFile) {
            unsub();
            useStore.getState().decodeFromURL(state);
          }
        },
      );
    }

    const flyParam = intent?.fly ?? params.get('fly');
    if (flyParam) {
      const seq = decodeFlythrough(flyParam);
      if (seq) {
        useStore.getState().setFlythrough(seq);
        useStore.getState().setActivePanel('flythrough');
      }
    }
  }, []);

  // Own molecule URL history in the shell that remains mounted while a scene
  // is open. Gallery used to own popstate, but Gallery unmounts as soon as a
  // file loads; browser Back then changed the URL while leaving the old scene,
  // renderer, and streaming source alive.
  useEffect(() => {
    let navigationGeneration = 0;
    const reconcileMoleculeUrl = async () => {
      const generation = ++navigationGeneration;
      const params = new URLSearchParams(window.location.search);
      const intent = recognizeLupiUrlPayload(window.location.href);
      const sim = params.get('sim');
      const loadUrl = params.get('load') ?? (intent?.kind === 'loadUrl' ? intent.url : null);
      const state = useStore.getState();

      // `#/science/<index>` owns its loads (see the science-route effect
      // below): without this guard the generic path would strip a stale
      // ?sim= param the science flow already replaced, or clear the scene.
      if (isSciencePanelRoute(currentHashRoute())) return;

      if (sim) {
        if (state.activeCardId === sim && (state.file || state.loading)) return;
        setAutomaticLoadFailed(false);
        const result = await openMolecule({
          kind: 'gallery',
          id: sim,
          history: 'none',
        });
        if (generation !== navigationGeneration) return;
        if (!result.ok) {
          useStore.getState().setError(result.message);
          setAutomaticLoadFailed(true);
        }
        return;
      }

      if (loadUrl) {
        if (state.file?.sourceUrl === loadUrl && !state.loading) return;
        try {
          setAutomaticLoadFailed(false);
          // Preserve root-relative local dataset routes while applying the
          // strict remote policy to absolute network URLs.
          const allowed = assertAllowedRemoteMoleculeUrl(
            loadUrl,
            'human-load',
            window.location.origin,
          );
          const result = await openMolecule({
            kind: 'url',
            url: allowed.url,
            history: 'none',
            strictRemote: true,
          });
          if (generation !== navigationGeneration) return;
          if (!result.ok) {
            useStore.getState().setError(result.message);
            setAutomaticLoadFailed(true);
          }
        } catch (error) {
          if (generation !== navigationGeneration) return;
          useStore
            .getState()
            .setError(
              error instanceof Error ? error.message : 'This molecule link could not be opened.',
            );
          setAutomaticLoadFailed(true);
        }
        return;
      }

      const routeSavedViewSlug =
        savedViewSlugFromRoute(currentHashRoute()) ??
        savedViewSlugFromRoute(normalizedPathRoute(currentPathRoute()));
      if (routeSavedViewSlug) return;

      cancelViewerLoad();
      if (state.file || state.loading) {
        clearStreamingFrameCoordinator();
        useStore.getState().clearFile();
      }
    };

    const onPopState = () => {
      void reconcileMoleculeUrl();
    };
    void reconcileMoleculeUrl();
    window.addEventListener('popstate', onPopState);
    return () => {
      navigationGeneration += 1;
      cancelViewerLoad();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Science routes: `#/science/<index>` is a first-class viewer route. It
  // loads the bound Z1 gallery trajectory through the normal gallery pipeline
  // (which attaches the validated science bundle and opens the SCIENCE deck
  // section) — never a separate page. Legacy demo aliases redirect here.
  useEffect(() => {
    const reconcileScienceRoute = () => {
      const params = new URLSearchParams(window.location.search);
      const hashPath = currentHashRoute().split('?')[0] || '/';
      // Legacy aliases: `?demo=science-panel[&path=<i>]`, `#/demo/science-panel`.
      if (params.get('demo') === 'science-panel' || hashPath === '/demo/science-panel') {
        const wanted = Number(params.get('path'));
        const target =
          scienceGalleryIdForPathIndex(wanted) != null ? wanted : DEFAULT_Z1_SCIENCE_PATH_INDEX;
        const url = new URL(window.location.href);
        url.searchParams.delete('demo');
        url.searchParams.delete('path');
        url.hash = `#/science/${target}`;
        window.history.replaceState({}, '', url);
      }

      const index = sciencePathIndexFromRoute(currentHashRoute());
      if (index == null) return;
      const id = scienceGalleryIdForPathIndex(index);
      if (!id) {
        // Unknown golden path: normalize to the default instead of stranding the URL.
        window.history.replaceState({}, '', `#/science/${DEFAULT_Z1_SCIENCE_PATH_INDEX}`);
        return;
      }

      // The hash is canonical for science loads — strip stale ?sim/?load so
      // the generic molecule reconciler never fights this effect.
      const url = new URL(window.location.href);
      if (url.searchParams.has('sim') || url.searchParams.has('load')) {
        url.searchParams.delete('sim');
        url.searchParams.delete('load');
        window.history.replaceState({}, '', url);
      }

      const state = useStore.getState();
      if (state.activeCardId === id && (state.file || state.loading)) {
        // Already loaded (e.g. arrived via the landing card's ?sim= flow):
        // make sure the SCIENCE section is open.
        if (state.file?.science) useStore.setState({ activePanel: 'science' });
        return;
      }
      void openMolecule({ kind: 'gallery', id, history: 'none' });
    };

    reconcileScienceRoute();
    window.addEventListener('hashchange', reconcileScienceRoute);
    window.addEventListener('popstate', reconcileScienceRoute);
    return () => {
      window.removeEventListener('hashchange', reconcileScienceRoute);
      window.removeEventListener('popstate', reconcileScienceRoute);
    };
  }, []);

  // Hold the last resident frame across streaming gaps.
  const lastResidentRef = useRef<{
    trajectory: import('@atlas/core/types').Trajectory | undefined;
    frame: import('@atlas/core/types').Frame | undefined;
  }>({ trajectory: undefined, frame: undefined });
  const rawCurrentFrame = file?.trajectory.frames[frame];
  if (lastResidentRef.current.trajectory !== file?.trajectory) {
    lastResidentRef.current = {
      trajectory: file?.trajectory,
      frame: undefined,
    };
  }
  if (rawCurrentFrame) lastResidentRef.current.frame = rawCurrentFrame;
  const currentFrame = file ? (rawCurrentFrame ?? lastResidentRef.current.frame) : undefined;
  // An immutable raster artifact always draws its addressed integer source
  // frame. This render-time override closes the pause->export race where the
  // playback hook's RAF ref/passive synchronization can still describe a
  // fractional frame even though the store is already paused.
  const artifactCaptureFrameIndex =
    exportRequest.type === 'image' && exportRequest.artifactSpec
      ? exportRequest.artifactSpec.frame
      : null;
  const renderedFrames = selectViewerFrames(
    file?.trajectory.frames ?? [],
    displayFrameIndex,
    interpState,
    artifactCaptureFrameIndex,
  );
  const interpolatedFrame = renderedFrames.frame;
  const interpolatedNextFrame = renderedFrames.nextFrame;
  const interpolationFactor = renderedFrames.interpolationFactor;
  const interpolatedFrameKey = renderedFrames.frameKey;

  const vectorFieldSpecs = useMemo(() => {
    const f0 = file?.trajectory.frames[0];
    return f0 ? detectFrameVectorFields(f0) : [];
  }, [file]);
  const activeVectorField = useMemo(
    () => (vectorField ? (vectorFieldSpecs.find(s => s.id === vectorField) ?? null) : null),
    [vectorField, vectorFieldSpecs],
  );

  const { cameraDistance, cameraMinDistance, cameraNear, center, filterShellBaseRadius } =
    useViewerSceneModel(file);

  const bg = resolveBackground(
    backgroundPreset,
    useStore(s => s.colormap),
  );
  const bgMedia = bg.media;
  const bgAdjustments = useMemo<BackgroundAssetAdjustments>(
    () => ({
      yawDegrees: backgroundYawDegrees,
      pitchDegrees: backgroundPitchDegrees,
      opacity: backgroundOpacity,
      brightness: backgroundBrightness,
      saturation: backgroundSaturation,
      contrast: backgroundContrast,
      motionPaused: backgroundMotionPaused,
      motionSpeed: backgroundMotionSpeed,
    }),
    [
      backgroundBrightness,
      backgroundContrast,
      backgroundMotionPaused,
      backgroundMotionSpeed,
      backgroundOpacity,
      backgroundPitchDegrees,
      backgroundSaturation,
      backgroundYawDegrees,
    ],
  );
  const backgroundBackdropRadiusMax = useMemo(() => getBackdropRadiusLimit(file), [file]);
  const backgroundBackdropEffectiveRadius = Math.max(
    0.25,
    Math.min(backgroundBackdropRadius, backgroundBackdropRadiusMax),
  );

  const isBatchExport = new URLSearchParams(window.location.search).get('batchExport') === 'true';
  const mobileTimelineActive = isMobile && !!file && totalFrames > 1;
  const [uiStowed, setUiStowed] = useState(false);

  const clearLoadedFile = useCallback(() => {
    // A streamed trajectory owns abort controllers, subscriptions, loader
    // caches, and resident typed arrays outside Zustand. Dispose that source
    // before dropping the store reference so returning to the library really
    // releases the scene instead of retaining it behind the landing page.
    clearStreamingFrameCoordinator();
    cancelViewerLoad();
    useStore.getState().clearFile();
    // Return through the lightweight entry point, releasing the renderer graph.
    window.location.assign('/');
  }, []);

  return (
    <div
      className="lupine-app-root"
      data-embedded-mobile-viewer={isEmbeddedMobileViewer}
      data-mobile={isMobile}
      data-file={!!file}
      data-timeline={mobileTimelineActive}
      data-ui-stowed={uiStowed}
      style={{
        height: file || isEmbeddedMobileViewer ? '100dvh' : 'auto',
        overflow: file || isEmbeddedMobileViewer ? 'hidden' : 'visible',
        background: file ? `linear-gradient(180deg, ${bg.top}, ${bg.bottom})` : '#020204',
      }}
    >
      {!isEmbeddedMobileViewer && !gpuStudioOpen && (
        <GlobalShortcuts
          commandPaletteOpen={commandPaletteOpen}
          setCommandPaletteOpen={setCommandPaletteOpen}
        />
      )}
      {!isEmbeddedMobileViewer && (
        <div className="lupine-viewer-chrome lupine-viewer-chrome--header">
          <AppHeader
            isMobile={isMobile}
            clearLoadedFile={clearLoadedFile}
            onStudioOpenChange={setGpuStudioOpen}
          />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <McpViewerBridge />
        {isMcpViewerRoute && <McpViewerHarness />}

        {file && (
          <div
            className="lupine-main-viewport"
            style={{
              position: file ? 'absolute' : 'fixed',
              top: file ? 0 : 56,
              right: 0,
              bottom: 0,
              left: 0,
              zIndex: 0,
            }}
          >
            <style>{`
            .lupine-main-viewport canvas {
              width: 100% !important;
              height: 100% !important;
            }
          `}</style>
            <ViewerCanvas
              paused={gpuStudioOpen}
              capability={renderCapability}
              center={center}
              cameraDistance={cameraDistance}
              cameraNear={cameraNear}
            >
              {import.meta.env.DEV && showDebugHud && (
                <Perf position="top-left" logsPerSecond={4} matrixUpdate />
              )}
              {(import.meta.env.DEV || showDebugHud) && <DevProbe enabled={showDebugHud} />}
              <ViewerScene
                file={file}
                currentFrame={currentFrame}
                interpolatedFrame={interpolatedFrame}
                interpolatedNextFrame={interpolatedNextFrame}
                interpolationFactor={interpolationFactor}
                interpolatedFrameKey={interpolatedFrameKey}
                ghostFile={ghostFile}
                interpState={interpState}
                liveStateRef={liveStateRef}
                deviceMaxAtoms={deviceMaxAtoms}
                deviceQualityTier={deviceQualityTier}
                loadedAtomCount={loadedAtomCount}
                center={center}
                cameraDistance={cameraDistance}
                cameraMinDistance={cameraMinDistance}
                filterShellBaseRadius={filterShellBaseRadius}
                bgTop={bg.top}
                bgBottom={bg.bottom}
                bgMedia={bgMedia}
                bgProcedural={bg.procedural}
                bgAdjustments={bgAdjustments}
                bgStyle={backgroundStyle}
                backdropShape={backgroundBackdropShape}
                backdropPattern={backgroundBackdropPattern}
                backdropRadius={backgroundBackdropEffectiveRadius}
                isExportingQuickLook={isExportingQuickLook}
                setIsExportingQuickLook={setIsExportingQuickLook}
                interactedForFileRef={interactedForFileRef}
                activeVectorField={activeVectorField}
                setVectorStats={setVectorStats}
              />
              <CameraManager
                fileId={file?.name}
                center={center}
                distance={cameraDistance}
                near={cameraNear}
              />
              <PresetLegacyBridge />
            </ViewerCanvas>

            {!isEmbeddedMobileViewer && import.meta.env.DEV && showDebugHud && <StateInspector />}
            {!isEmbeddedMobileViewer && <RendererWarningToast />}

            {file && currentFrame && !isEmbeddedMobileViewer && (
              <ScaleBar
                frame={currentFrame}
                cameraDistance={cameraDistance}
                visible={showScaleBar}
                position="bottom-left"
              />
            )}

            {file && currentFrame && studyLensOpen && !isEmbeddedMobileViewer && (
              <div>
                <StudyLensPanel
                  compact={isMobile}
                  onClose={() => useStore.getState().setStudyLensOpen(false)}
                />
              </div>
            )}

            {file && totalFrames > 1 && !isEmbeddedMobileViewer && (
              <PlaybackStatus frame={frame} totalFrames={totalFrames} showFrame={!isMobile} />
            )}

            {!isEmbeddedMobileViewer && showDebugHud && <TelemetryHUD />}
            {!isEmbeddedMobileViewer && <LabelPerfHUD />}
            {!isEmbeddedMobileViewer && (
              <PropertyLegendHUD
                frame={currentFrame}
                colorMode={colorMode}
                colorProperty={colorProperty}
                colormap={colormap}
                activeVectorField={activeVectorField}
                vectorStats={vectorStats}
                bottomOffset={isMobile ? 96 : 44}
              />
            )}

            {file && !isEmbeddedMobileViewer && (
              <ViewerGestureHint
                isMobile={isMobile}
                canSelectAtoms={(rawCurrentFrame?.natoms ?? 0) <= MAX_INTERACTIVE_PICKING_ATOMS}
              />
            )}
            {file && !isEmbeddedMobileViewer && (
              <div
                style={{
                  position: 'absolute',
                  top: isMobile ? 72 : 84,
                  left: 18,
                  zIndex: 149,
                }}
              >
                <XREntryButton store={xrStore} />
              </div>
            )}
          </div>
        )}

        {file && !isEmbeddedMobileViewer && <ViewerCommandDeck compact={isMobile} />}
        {file && !isEmbeddedMobileViewer && <PanelHost />}

        {file && !isEmbeddedMobileViewer && (
          <button
            type="button"
            className="lupine-ui-bucket"
            data-stowed={uiStowed}
            aria-label={uiStowed ? 'Restore viewer controls' : 'Stow viewer controls'}
            aria-pressed={uiStowed}
            title={uiStowed ? 'Restore controls' : 'Stow all controls'}
            onClick={() => setUiStowed(value => !value)}
          >
            <span className="lupine-ui-bucket__orb" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="lupine-ui-bucket__label">{uiStowed ? 'Restore' : 'Clear view'}</span>
            <span className="lupine-ui-bucket__count" aria-hidden="true">
              {uiStowed ? 'UI' : '↓'}
            </span>
          </button>
        )}

        {!file && !isEmbeddedMobileViewer && (
          <div style={{ position: 'relative', width: '100%', zIndex: 10 }}>
            {automaticLoadFailed ? (
              <RemoteMoleculeLoadError />
            ) : isMcpViewerRoute ? null : isSavedViewRoute && savedViewSlug ? (
              <SavedViewLoadState slug={savedViewSlug} query={savedViewQuery} />
            ) : isCopperSceneRoute ? (
              <SceneLandingPage />
            ) : seoEducationKind ? (
              <SeoEducationPage kind={seoEducationKind} />
            ) : (
              <LandingPage />
            )}
          </div>
        )}
      </div>

      {isBatchExport && !isEmbeddedMobileViewer && <BatchAssetGenerator />}

      {file && totalFrames > 1 && !isEmbeddedMobileViewer && (
        <div
          className="lupine-viewer-chrome lupine-viewer-chrome--timeline"
          style={{
            height: isMobile ? 'calc(64px + env(safe-area-inset-bottom))' : 60,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 8 : 16,
            padding: isMobile ? '8px 12px calc(env(safe-area-inset-bottom) + 8px)' : '0 20px',
            borderTop: '1px solid #1f2937',
            background: 'rgba(10,10,12,0.96)',
            overflowX: 'auto',
            position: 'relative',
            zIndex: 120,
            scrollbarWidth: 'none',
          }}
        >
          <div style={{ display: 'flex', gap: isMobile ? 3 : 4, flexShrink: 0 }}>
            <TransportButton
              onClick={() => useStore.getState().setFrame(0)}
              title="First frame"
              icon={<IconFirst />}
            />
            <TransportButton
              onClick={() => useStore.getState().prevFrame()}
              title="Previous [←]"
              icon={<IconPrev />}
            />
            <TransportButton
              onClick={togglePlay}
              title="Play/Pause [Space]"
              icon={playing ? <IconPause /> : <IconPlay />}
              active={playing}
              width={40}
            />
            <TransportButton onClick={nextFrame} title="Next [→]" icon={<IconNext />} />
            <TransportButton
              onClick={() => useStore.getState().setFrame(totalFrames - 1)}
              title="Last frame"
              icon={<IconLast />}
            />
          </div>
          <PlaybackScrubber
            hasScience={hasScience}
            thermo={file?.thermo ?? null}
            totalFrames={totalFrames}
            currentFrame={frame}
            onFrameChange={f => {
              if (playing) togglePlay();
              setFrame(f);
            }}
          />
          <div
            data-testid="transport-frame-readout"
            style={{
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              color: '#64748b',
              minWidth: isMobile ? 58 : 90,
              flexShrink: 0,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {hasScience ? (
              <span style={{ color: '#f8fafc', fontWeight: 500 }}>
                NEB image {Math.floor(frame)}
                <span style={{ color: '#475569' }}> of {totalFrames - 1}</span>
              </span>
            ) : (
              <>
                <span style={{ color: '#f8fafc', fontWeight: 500 }}>{Math.floor(frame) + 1}</span>
                <span style={{ color: '#475569' }}> / {totalFrames}</span>
              </>
            )}
          </div>
          <PlaybackSpeedControl
            isMobile={isMobile}
            playbackSpeed={playbackSpeed}
            onChange={speed => useStore.getState().setPlaybackSpeed(speed)}
          />
        </div>
      )}

      <DeferredCommandPalette
        open={!isEmbeddedMobileViewer && commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        actions={useMemo(() => {
          const list: import('./CommandPalette').CommandAction[] = [
            {
              id: 'gallery',
              label: 'Open gallery',
              group: 'Discover',
              shortcut: 'G',
              onSelect: () => {
                const el = document.getElementById('gallery');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                else window.location.href = '/#gallery';
              },
            },
            {
              id: 'controls-molecule',
              label: 'Open Style',
              group: 'Panels',
              shortcut: 'V',
              disabled: !file,
              onSelect: () => {
                useStore.getState().setViewMenuOpen(false);
                useStore.getState().setStudioDeck('molecule');
                useStore.getState().setActivePanel('studio');
              },
            },
            {
              id: 'export-panel',
              label: 'Open figure export',
              group: 'Panels',
              shortcut: 'X',
              disabled: !file,
              onSelect: () => setActivePanel('export'),
            },
            {
              id: 'study-lens',
              label: 'Toggle Study Guide',
              group: 'Panels',
              disabled: !file,
              onSelect: () => useStore.getState().toggleStudyLens(),
            },
            {
              id: 'telemetry-panel',
              label: 'Open Data and measurements',
              group: 'Panels',
              shortcut: 'T',
              disabled: !file,
              onSelect: () => setActivePanel('telemetry'),
            },
            {
              id: 'flythrough-panel',
              label: 'Open Camera',
              group: 'Panels',
              disabled: !file,
              onSelect: () => setActivePanel('flythrough'),
            },
            {
              id: 'camera-top',
              label: 'Camera top view',
              group: 'Camera',
              disabled: !file,
              onSelect: () => useStore.getState().setCameraPreset('top'),
            },
            {
              id: 'camera-side',
              label: 'Camera side view',
              group: 'Camera',
              disabled: !file,
              onSelect: () => useStore.getState().setCameraPreset('side'),
            },
            {
              id: 'camera-front',
              label: 'Camera front view',
              group: 'Camera',
              disabled: !file,
              onSelect: () => useStore.getState().setCameraPreset('front'),
            },
            {
              id: 'camera-iso',
              label: 'Camera isometric view',
              group: 'Camera',
              disabled: !file,
              onSelect: () => useStore.getState().setCameraPreset('iso'),
            },
            {
              id: 'toggle-bonds',
              label: 'Toggle bond guides',
              group: 'Scene',
              disabled: !file,
              onSelect: () => useStore.getState().toggleBonds(),
            },
            {
              id: 'toggle-playback',
              label: 'Play / pause trajectory',
              group: 'Scene',
              disabled: !file || totalFrames <= 1,
              onSelect: () => togglePlay(),
            },
            {
              id: 'close-file',
              label: 'Close current molecule',
              group: 'Scene',
              disabled: !file,
              onSelect: clearLoadedFile,
            },
            {
              id: 'close-panel',
              label: 'Close tool panel',
              group: 'Scene',
              disabled: !activePanel,
              onSelect: () => setActivePanel(null),
            },
          ];
          return list;
        }, [file, activePanel, totalFrames, clearLoadedFile, setActivePanel, togglePlay])}
      />
    </div>
  );
}
