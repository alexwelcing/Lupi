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
import { useStore } from './store';
import { getMaxSafeAtomCount, getDefaultQualityTier } from './deviceCapabilities';
import { detectFrameVectorFields } from '@atlas/core';
import type { VectorGlyphStats } from '@atlas/scene';

import { LandingPage } from './LandingPage';
import { SceneLandingPage } from './landing/SceneLandingPage';
import { SeoEducationPage } from './landing/SeoEducationPage';
import { MlipFlywheelPage } from './MlipFlywheelPage';
import { useViewerBackgroundState, useViewerFileState, useViewerPanelState, useViewerPlaybackState } from './storeSelectors';
import {
  SEO_EDUCATION_ROUTES,
  currentHashRoute,
  currentPathRoute,
  isMcpViewerRoute as isMcpViewerRouteMatch,
  normalizedPathRoute,
  savedViewSlugFromRoute,
} from './viewer/viewerRoutes';
import { openMolecule } from './viewer/openMolecule';
import { getBackdropRadiusLimit, useViewerSceneModel } from './viewer/useViewerSceneModel';
import { ViewerCanvas } from './viewer/ViewerCanvas';
import { PresetLegacyBridge } from './viewer/PresetLegacyBridge';
import { xrStore } from './viewer/xrStore';

import { McpViewerBridge, McpViewerHarness } from './mcpViewerBridge';
import { BatchAssetGenerator } from './BatchAssetGenerator';
import { CommandPalette } from './CommandPalette';
import { LupiAuthCallout } from './LupiAuthCallout';
import { MoleculeConfigurator } from './molecules/MoleculeConfigurator';
import { openRandomOmol25Molecule } from './molecules/randomOmol';
import { recognizeLupiUrlPayload } from './lupiUrlRecognition';
import { assertAllowedRemoteMoleculeUrl } from './remoteMoleculeUrlPolicy';
import { decodeFlythrough } from './flythrough';
import { track, ANALYTICS_EVENTS, ensureAnalyticsSession } from './analytics';
import { detectRenderCapability } from './renderCapability';
import { PanelHost } from './PanelHost';
import { StudyLensPanel } from './StudyLensPanel';
import { XREntryButton } from './xr/XREntryButton';

import { useSmoothFramePlayback, type InterpolatedFrameState } from './hooks/useSmoothFramePlayback';
import { useMediaQuery } from './hooks/useMediaQuery';
import { requestStreamingFrame } from './streamingFrameCoordinator';

import { AppHeader } from './app/AppHeader';
import { resolveBackground, type BackgroundAssetAdjustments } from './app/AppBackground';
import { CameraManager } from './app/CameraManager';
import { ToolRail } from './app/ToolRail';
import { CameraPresetRail } from './app/CameraPresetRail';
import { PlaybackStatus } from './app/PlaybackStatus';
import { PlaybackSpeedControl } from './app/PlaybackSpeedControl';
import { MobileShell } from './app/MobileShell';
import { ViewerGestureHint } from './app/ViewerGestureHint';
import { RendererWarningToast } from './app/RendererWarningToast';
import { GlobalShortcuts } from './app/GlobalShortcuts';
import { useSavedViewQuerySync } from './app/useSavedViewQuerySync';
import { SavedViewLoadState } from './app/SavedViewLoadState';
import { RemoteMoleculeLoadError } from './app/RemoteMoleculeLoadError';
import { ViewerScene } from './app/ViewerScene';

import {
  IconFirst,
  IconPrev,
  IconPlay,
  IconPause,
  IconNext,
  IconLast,
} from './icons';
import { TransportButton } from './controls';
import { ThermoMinimap } from './ThermoMinimap';

import { TelemetryHUD } from './TelemetryHUD';
import { StateInspector } from './StateInspector';
import { LabelPerfHUD } from './LabelPerfHUD';
import { PropertyLegendHUD } from './PropertyLegendHUD';
import { DevProbe } from './DevProbe';
import { Perf } from 'r3f-perf';
import { ScaleBar } from '@atlas/scene/ScaleBar';

export function ViewerApp() {
  const [hashRoute, setHashRoute] = useState(currentHashRoute);
  const [pathRoute, setPathRoute] = useState(currentPathRoute);
  const [isExportingQuickLook, setIsExportingQuickLook] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [vectorStats, setVectorStats] = useState<VectorGlyphStats | null>(null);
  const [automaticLoadFailed, setAutomaticLoadFailed] = useState(false);
  const loadedSavedViewSlugRef = useRef<string | null>(null);
  const interactedForFileRef = useRef<string | null>(null);

  const hashPath = hashRoute.split('?')[0] || '/';
  const normalizedPath = normalizedPathRoute(pathRoute);
  const isMlipFlywheelRoute = hashPath === '/system/mlip-flywheel';
  const isMcpViewerRoute = isMcpViewerRouteMatch(hashPath);
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

  const { file, ghostFile, loading, frame, loadedAtomCount } = useViewerFileState();
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
  const showScaleBar = useStore(s => s.showScaleBar);
  const studyLensOpen = useStore(s => s.studyLensOpen);
  const colorMode = useStore(s => s.colorMode);
  const colorProperty = useStore(s => s.colorProperty);
  const colormap = useStore(s => s.colormap);
  const vectorField = useStore(s => s.vectorField);

  const isMobile = useMediaQuery('(max-width: 768px)');
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
      useStore.getState().setRendererWarning('GPU bond acceleration unavailable on this device — using the slower CPU path.');
    } else if (gpuBondsStatus === 'ready') {
      useStore.getState().setRendererWarning(null);
    }
  }, [useGpuBonds, gpuBondsStatus]);

  const playbackFrameRate = file?.playbackFrameRate ?? 30;
  const highFidelityPlayback = Boolean(file?.playbackFrameRate && (file?.trajectory.frames[0]?.natoms ?? 0) <= 5000);
  const totalFrames = file?.trajectory.totalFrames ?? 0;
  const frameIsBuffered = Boolean(file?.trajectory.frames[frame]);
  const bufferedFrameCount = useMemo(() => (
    file?.trajectory.frames.reduce((count, candidate) => count + (candidate ? 1 : 0), 0) ?? 0
  ), [file]);

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

  const { currentState: interpState, setFrame: setSmoothFrame } = useSmoothFramePlayback(playing, {
    frames: file?.trajectory.frames ?? [],
    speed: playbackSpeed,
    targetFPS: highFidelityPlayback ? 120 : 60,
    mdFrameRate: playbackFrameRate,
    stateSyncFPS: highFidelityPlayback ? 120 : 15,
    isFrameReady,
    onFrameNeeded: requestBufferedFrame,
    loopMode,
    onPlaybackEnd: stopAtPlaybackEnd,
    onFrame: (state: InterpolatedFrameState) => {
      if (!isFrameReady(state.frameIndex)) {
        requestBufferedFrame(state.frameIndex);
        return;
      }
      if (useStore.getState().playing && state.frameIndex !== useStore.getState().frame) {
        useStore.getState().setFrame(state.frameIndex);
      }
    }
  });

  // Sync external frame updates back to the hook when NOT playing.
  useEffect(() => {
    if (!playing && frameIsBuffered && interpState.effectiveFrame !== frame) {
      setSmoothFrame(frame);
    } else if (!playing && !frameIsBuffered) {
      requestBufferedFrame(frame);
    }
  }, [frame, frameIsBuffered, playing, requestBufferedFrame, setSmoothFrame, interpState.effectiveFrame]);

  // URL state restore + auto-load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intent = recognizeLupiUrlPayload(window.location.href);
    const state = intent?.state ?? params.get('s');
    if (state) {
      useStore.getState().decodeFromURL(state);
      const unsub = useStore.subscribe(
        (s) => s.file,
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

    // Preserve the raw root-relative ?load= form so preview origins remain
    // portable without widening the global host allowlist.
    const loadUrl = params.get('load') ?? (intent?.kind === 'loadUrl' ? intent.url : null);
    if (loadUrl && !file) {
      (async () => {
        try {
          setAutomaticLoadFailed(false);
          const allowed = assertAllowedRemoteMoleculeUrl(loadUrl, 'human-load', window.location.origin);
          const result = await openMolecule({
            kind: 'url',
            url: allowed.url,
            history: 'none',
            strictRemote: true,
          });
          if (!result.ok) {
            useStore.getState().setError(result.message);
            setAutomaticLoadFailed(true);
          }
        } catch (error) {
          useStore.getState().setError(error instanceof Error ? error.message : 'This molecule link could not be opened.');
          setAutomaticLoadFailed(true);
        }
      })();
    }
  }, []);

  // Hold the last resident frame across streaming gaps.
  const lastResidentRef = useRef<{ trajectory: import('@atlas/core/types').Trajectory | undefined; frame: import('@atlas/core/types').Frame | undefined }>(
    { trajectory: undefined, frame: undefined },
  );
  const rawCurrentFrame = file?.trajectory.frames[frame];
  if (lastResidentRef.current.trajectory !== file?.trajectory) {
    lastResidentRef.current = { trajectory: file?.trajectory, frame: undefined };
  }
  if (rawCurrentFrame) lastResidentRef.current.frame = rawCurrentFrame;
  const currentFrame = file ? (rawCurrentFrame ?? lastResidentRef.current.frame) : undefined;
  const interpolatedFrame = file?.trajectory.frames[interpState.frameIndex] ?? file?.trajectory.frames[displayFrameIndex];
  const interpolatedNextFrame = interpState.isInterpolating
    ? file?.trajectory.frames[interpState.nextFrameIndex]
    : undefined;
  const interpolationFactor = interpolatedNextFrame ? interpState.interpolationFactor : 0;
  const interpolatedFrameKey = interpolatedFrame === file?.trajectory.frames[interpState.frameIndex]
    ? interpState.frameIndex
    : displayFrameIndex;

  const vectorFieldSpecs = useMemo(() => {
    const f0 = file?.trajectory.frames[0];
    return f0 ? detectFrameVectorFields(f0) : [];
  }, [file]);
  const activeVectorField = useMemo(
    () => (vectorField ? vectorFieldSpecs.find((s) => s.id === vectorField) ?? null : null),
    [vectorField, vectorFieldSpecs],
  );

  const {
    cameraDistance,
    cameraMinDistance,
    cameraNear,
    center,
    filterShellBaseRadius,
  } = useViewerSceneModel(file);

  const bg = resolveBackground(backgroundPreset, useStore(s => s.colormap));
  const bgMedia = bg.media;
  const bgAdjustments = useMemo<BackgroundAssetAdjustments>(() => ({
    yawDegrees: backgroundYawDegrees,
    pitchDegrees: backgroundPitchDegrees,
    opacity: backgroundOpacity,
    brightness: backgroundBrightness,
    saturation: backgroundSaturation,
    contrast: backgroundContrast,
    motionPaused: backgroundMotionPaused,
    motionSpeed: backgroundMotionSpeed,
  }), [
    backgroundBrightness, backgroundContrast, backgroundMotionPaused, backgroundMotionSpeed,
    backgroundOpacity, backgroundPitchDegrees, backgroundSaturation, backgroundYawDegrees,
  ]);
  const backgroundBackdropRadiusMax = useMemo(() => getBackdropRadiusLimit(file), [file]);
  const backgroundBackdropEffectiveRadius = Math.max(0.25, Math.min(backgroundBackdropRadius, backgroundBackdropRadiusMax));

  const isBatchExport = new URLSearchParams(window.location.search).get('batchExport') === 'true';
  const mobileTimelineActive = isMobile && !!file && totalFrames > 1;

  const clearLoadedFile = useCallback(() => {
    useStore.getState().clearFile();
    const url = new URL(window.location.href);
    url.searchParams.delete('sim');
    url.searchParams.delete('load');
    if (url.pathname.startsWith('/view/')) url.pathname = '/';
    url.hash = '';
    window.history.pushState({}, '', url);
    setHashRoute(currentHashRoute());
    setPathRoute(currentPathRoute());
  }, []);

  const studioDeck = useStore(s => s.studioDeck);

  return (
    <div
      className="lupine-app-root"
      data-mobile={isMobile}
      data-file={!!file}
      data-timeline={mobileTimelineActive}
      style={{
        height: file ? '100dvh' : 'auto',
        overflow: file ? 'hidden' : 'visible',
        background: file ? `linear-gradient(180deg, ${bg.top}, ${bg.bottom})` : '#020204',
      }}
    >
      <GlobalShortcuts commandPaletteOpen={commandPaletteOpen} setCommandPaletteOpen={setCommandPaletteOpen} />
      <AppHeader isMobile={isMobile} clearLoadedFile={clearLoadedFile} />
      <MoleculeConfigurator />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <McpViewerBridge />
        {isMcpViewerRoute && <McpViewerHarness />}

        <div className="lupine-main-viewport" style={{
          position: file ? 'absolute' : 'fixed',
          top: file ? 0 : 56,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 0,
        }}>
          <style>{`
            .lupine-main-viewport canvas {
              width: 100% !important;
              height: 100% !important;
            }
          `}</style>
          <ViewerCanvas
            capability={renderCapability}
            center={center}
            cameraDistance={cameraDistance}
            cameraNear={cameraNear}
          >
            {import.meta.env.DEV && showDebugHud && <Perf position="top-left" logsPerSecond={4} matrixUpdate />}
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
            <CameraManager fileId={file?.name} center={center} distance={cameraDistance} near={cameraNear} />
            <PresetLegacyBridge />
          </ViewerCanvas>

          {import.meta.env.DEV && showDebugHud && <StateInspector />}
          <RendererWarningToast />

          {file && currentFrame && (
            <ScaleBar
              frame={currentFrame}
              cameraDistance={cameraDistance}
              visible={showScaleBar}
              position="bottom-left"
            />
          )}

          {file && currentFrame && studyLensOpen && !isMobile && (
            <StudyLensPanel compact={false} onClose={() => useStore.getState().setStudyLensOpen(false)} />
          )}

          {file && totalFrames > 1 && (
            <PlaybackStatus frame={frame} totalFrames={totalFrames} showFrame={!isMobile} />
          )}

          {showDebugHud && <TelemetryHUD />}
          <LabelPerfHUD />
          <PropertyLegendHUD
            frame={currentFrame}
            colorMode={colorMode}
            colorProperty={colorProperty}
            colormap={colormap}
            activeVectorField={activeVectorField}
            vectorStats={vectorStats}
            bottomOffset={isMobile ? 96 : 44}
          />

          {file && !isMobile && <CameraPresetRail />}
          {file && !isMobile && <ToolRail isMobile={isMobile} />}
          {file && <ViewerGestureHint isMobile={isMobile} />}
          {file && (
            <div style={{ position: 'absolute', top: isMobile ? 72 : 140, right: 18, zIndex: 149 }}>
              <XREntryButton store={xrStore} />
            </div>
          )}
        </div>

        {isMobile && <MobileShell />}

        {!isMobile && file && (
          <PanelHost
            activePanel={activePanel}
            studioDeck={studioDeck}
            onOpenStudioDeck={(mode) => {
              useStore.getState().setViewMenuOpen(false);
              useStore.getState().setStudioDeck(mode);
              if (activePanel !== 'studio') setActivePanel('studio');
            }}
            onClose={() => setActivePanel(null)}
          />
        )}

        {!file && (
          <div style={{ position: 'relative', width: '100%', zIndex: 10 }}>
            {automaticLoadFailed
              ? <RemoteMoleculeLoadError />
              : isMlipFlywheelRoute
              ? <MlipFlywheelPage />
              : isMcpViewerRoute
                ? null
                : isSavedViewRoute && savedViewSlug
                  ? <SavedViewLoadState slug={savedViewSlug} query={savedViewQuery} />
                : isCopperSceneRoute
                  ? <SceneLandingPage />
                  : seoEducationKind
                    ? <SeoEducationPage kind={seoEducationKind} />
                    : <LandingPage />}
          </div>
        )}
      </div>

      {isBatchExport && <BatchAssetGenerator />}

      {file && totalFrames > 1 && (
        <div style={{
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
        }}>
          <div style={{ display: 'flex', gap: isMobile ? 3 : 4, flexShrink: 0 }}>
            <TransportButton onClick={() => useStore.getState().setFrame(0)} title="First frame" icon={<IconFirst />} />
            <TransportButton onClick={() => useStore.getState().prevFrame()} title="Previous [←]" icon={<IconPrev />} />
            <TransportButton onClick={togglePlay} title="Play/Pause [Space]" icon={playing ? <IconPause /> : <IconPlay />} active={playing} width={40} />
            <TransportButton onClick={nextFrame} title="Next [→]" icon={<IconNext />} />
            <TransportButton onClick={() => useStore.getState().setFrame(totalFrames - 1)} title="Last frame" icon={<IconLast />} />
          </div>
          <ThermoMinimap
            thermo={file?.thermo ?? null}
            totalFrames={totalFrames}
            currentFrame={frame}
            onFrameChange={(f) => { if (playing) togglePlay(); setFrame(f); }}
          />
          <div data-testid="transport-frame-readout" style={{
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: '#64748b',
            minWidth: isMobile ? 58 : 90,
            flexShrink: 0,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}>
            <span style={{ color: '#f8fafc', fontWeight: 500 }}>{Math.floor(frame) + 1}</span>
            <span style={{ color: '#475569' }}> / {totalFrames}</span>
          </div>
          <PlaybackSpeedControl
            isMobile={isMobile}
            playbackSpeed={playbackSpeed}
            onChange={speed => useStore.getState().setPlaybackSpeed(speed)}
          />
        </div>
      )}

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        actions={useMemo(() => {
          const list: import('./CommandPalette').CommandAction[] = [
            {
              id: 'random-molecule',
              label: 'View random OMol25 molecule',
              group: 'Discover',
              shortcut: 'R',
              onSelect: () => void openRandomOmol25Molecule(),
            },
            {
              id: 'gallery',
              label: 'Open gallery',
              group: 'Discover',
              shortcut: 'G',
              onSelect: () => {
                const el = document.getElementById('gallery');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                else window.location.href = '/#/gallery';
              },
            },
            {
              id: 'controls-molecule',
              label: 'Open Molecule controls',
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
              id: 'controls-scene',
              label: 'Open Scene controls',
              group: 'Panels',
              disabled: !file,
              onSelect: () => {
                useStore.getState().setViewMenuOpen(false);
                useStore.getState().setStudioDeck('scene');
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
              label: 'Open telemetry',
              group: 'Panels',
              shortcut: 'T',
              disabled: !file,
              onSelect: () => setActivePanel('telemetry'),
            },
            {
              id: 'flythrough-panel',
              label: 'Open flythrough',
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
        }, [file, activePanel, totalFrames, clearLoadedFile])}
      />
    </div>
  );
}
