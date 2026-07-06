import { useMemo, useRef, useState, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { useSmoothFramePlayback, type InterpolatedFrameState } from '../hooks/useSmoothFramePlayback';
import { AtomsOptimized } from '@atlas/scene/AtomsOptimized';
import { AtomClusters } from '@atlas/scene/AtomClusters';
import { buildClusters, type Clusters } from '@atlas/scene/ClusterBuilder';
import { Bonds } from '@atlas/scene/Bonds';
import { SimulationCell } from '@atlas/scene/SimulationCell';
import { TYPE_RADII, VectorGlyphs, type VectorGlyphStats } from '@atlas/scene';
import { ensureVectorMagnitude, getElementSpec, detectFrameVectorFields } from '@atlas/core';
import { AnomalyTracker } from '@atlas/scene/AnomalyTracker';
import { GhostAtoms } from '../GhostAtoms';
import { AtomPicker } from '@atlas/scene/AtomPicker';
import { AnnotationsLayer } from '../AnnotationsLayer';
import { KnowledgeLabelsLayer } from '../KnowledgeLabelsLayer';
import { SelectionMarkers } from '../SelectionMarkers';
import { AtomInfoHUD } from '../AtomInfoHUD';
import { CameraFocus } from '../CameraFocus';
import { AtomTrails } from '../AtomTrails';
import { MoleculeFilterShell } from '../MoleculeFilterShell';
import { MoleculeShadow } from '../MoleculeShadow';
import { SpatialAnchor } from '../SpatialAnchor';
import { SceneLighting } from '../SceneLighting';
import { ScenePostprocessing } from '../postprocess/ScenePostprocessing';
import { ExportManager } from '../ExportManager';
import { USDZExportHelper } from '../export/USDZExportPipeline';
import { XREnvironmentDome } from '../xr/XREnvironmentDome';
import { XRLightEstimation } from '../xr/XRLightEstimation';
import { track, ANALYTICS_EVENTS } from '../analytics';
import { AppBackground, type BackgroundAssetAdjustments } from './AppBackground';

import type { BackgroundBackdropShape, BackgroundBackdropPattern } from '../store';
import type { Frame } from '@atlas/core/types';
import type { MutableRefObject } from 'react';
import type { SpatialHash3D } from '@atlas/scene/SpatialHash';
import type { BgMedia, BgPreset } from '../backgroundPresets';

export function ViewerScene({
  file,
  currentFrame,
  interpolatedFrame,
  interpolatedNextFrame,
  interpolationFactor,
  interpolatedFrameKey,
  ghostFile,
  interpState,
  deviceMaxAtoms,
  deviceQualityTier,
  loadedAtomCount,
  center,
  cameraDistance,
  cameraMinDistance,
  filterShellBaseRadius,
  bgTop,
  bgBottom,
  bgMedia,
  bgProcedural,
  bgAdjustments,
  bgStyle,
  backdropShape,
  backdropPattern,
  backdropRadius,
  isExportingQuickLook,
  setIsExportingQuickLook,
  interactedForFileRef,
  activeVectorField,
  setVectorStats,
}: {
  file: ReturnType<typeof useStore.getState>['file'];
  currentFrame: Frame | undefined;
  interpolatedFrame: Frame | undefined;
  interpolatedNextFrame: Frame | undefined;
  interpolationFactor: number;
  interpolatedFrameKey: number;
  ghostFile: ReturnType<typeof useStore.getState>['ghostFile'];
  interpState: InterpolatedFrameState;
  deviceMaxAtoms: number;
  deviceQualityTier: number;
  loadedAtomCount: number;
  center: [number, number, number];
  cameraDistance: number;
  cameraMinDistance: number;
  filterShellBaseRadius: number;
  bgTop: string;
  bgBottom: string;
  bgMedia: BgMedia;
  bgProcedural: BgPreset['procedural'] | undefined;
  bgAdjustments: BackgroundAssetAdjustments;
  bgStyle: 'linear' | 'radial' | 'spotlight';
  backdropShape: BackgroundBackdropShape;
  backdropPattern: BackgroundBackdropPattern;
  backdropRadius: number;
  isExportingQuickLook: boolean;
  setIsExportingQuickLook: (v: boolean) => void;
  interactedForFileRef: MutableRefObject<string | null>;
  activeVectorField: ReturnType<typeof detectFrameVectorFields>[number] | null;
  setVectorStats: (stats: VectorGlyphStats | null) => void;
}) {
  const colorMode = useStore(s => s.colorMode);
  const colorProperty = useStore(s => s.colorProperty);
  const vectorScale = useStore(s => s.vectorScale);
  const vectorDensity = useStore(s => s.vectorDensity);
  const materialPreset = useStore(s => s.materialPreset);
  const materialIntensity = useStore(s => s.materialIntensity);
  const rimLightIntensity = useStore(s => s.rimLightIntensity);
  const surfaceRoughness = useStore(s => s.surfaceRoughness);
  const surfacePolish = useStore(s => s.surfacePolish);
  const surfaceClearcoat = useStore(s => s.surfaceClearcoat);
  const keyLightAzimuth = useStore(s => s.keyLightAzimuth);
  const keyLightElevation = useStore(s => s.keyLightElevation);
  const fillLightAzimuth = useStore(s => s.fillLightAzimuth);
  const fillLightElevation = useStore(s => s.fillLightElevation);
  const rimLightAzimuth = useStore(s => s.rimLightAzimuth);
  const rimLightElevation = useStore(s => s.rimLightElevation);
  const fillLightColor = useStore(s => s.fillLightColor);
  const rimLightColor = useStore(s => s.rimLightColor);
  const colormap = useStore(s => s.colormap);
  const uniformAtomColor = useStore(s => s.uniformAtomColor);
  const elementColorOverrides = useStore(s => s.elementColorOverrides);
  const atomColorSource = useStore(s => s.atomColorSource);
  const postprocessPreset = useStore(s => s.postprocessPreset);
  const propertyEmissionStrength = useStore(s => s.propertyEmissionStrength);
  const annotations = useStore(s => s.annotations);
  const labelStyle = useStore(s => s.labelStyle);
  const knowledgeLabels = useStore(s => s.knowledgeLabels);
  const knowledgeLabelKinds = useStore(s => s.knowledgeLabelKinds);
  const showKnowledgeLabels = useStore(s => s.showKnowledgeLabels);
  const hoveredAtom = useStore(s => s.hoveredAtom);
  const selectedAtoms = useStore(s => s.selectedAtoms);
  const highlightedNeighbors = useStore(s => s.highlightedNeighbors);
  const dimNonNeighbors = useStore(s => s.showNeighbors);
  const ssao = useStore(s => s.ssao);
  const bloom = useStore(s => s.bloom);
  const dof = useStore(s => s.dof);
  const toneMapping = useStore(s => s.toneMapping);
  const showCell = useStore(s => s.showCell);
  const showAxes = useStore(s => s.showAxes);
  const flythroughPreview = useStore(s => s.flythroughPreview);
  const showBonds = useStore(s => s.showBonds);
  const bondTolerance = useStore(s => s.bondTolerance);
  const useGpuBonds = useStore(s => s.useGpuBonds);
  const bondColorMode = useStore(s => s.bondColorMode);
  const atomScale = useStore(s => s.atomScale);
  const filterShellShape = useStore(s => s.filterShellShape);
  const filterShellPreset = useStore(s => s.filterShellPreset);
  const filterShellOpacity = useStore(s => s.filterShellOpacity);
  const filterShellRadius = useStore(s => s.filterShellRadius);
  const anomalyTracking = useStore(s => s.anomalyTracking);
  const atomTexture = useStore(s => s.atomTexture);
  const hiddenAtomTypes = useStore(s => s.hiddenAtomTypes);
  const atomTypeScales = useStore(s => s.atomTypeScales);

  const trackedAtomIndices = useMemo(() => {
    const set = new Set<number>();
    for (const ann of annotations) set.add(ann.atomIndex);
    return Array.from(set);
  }, [annotations]);

  const { etchTexture, etchAtomId } = useMemo<{
    etchTexture: THREE.CanvasTexture | null;
    etchAtomId: number | null;
  }>(() => {
    if (labelStyle !== 'etched' || annotations.length === 0) {
      return { etchTexture: null, etchAtomId: null };
    }
    const newest = annotations[annotations.length - 1];
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.font = 'bold 48px ui-monospace, "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(newest.text.slice(0, 16), 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return { etchTexture: tex, etchAtomId: newest.atomIndex };
  }, [labelStyle, annotations]);
  useEffect(() => () => { etchTexture?.dispose(); }, [etchTexture]);

  useMemo(() => {
    if (!colorProperty || !file || !activeVectorField) return;
    if (activeVectorField.magnitudeProperty === colorProperty) {
      for (const f of file.trajectory.frames) {
        if (f) ensureVectorMagnitude(f, activeVectorField);
      }
    }
  }, [colorProperty, file, activeVectorField]);

  const effectiveBondCutoff = useMemo(() => {
    if (!currentFrame || !currentFrame.types || currentFrame.natoms === 0) {
      return Math.min(6, 2 * 1.4 + bondTolerance);
    }
    const seen = new Set<number>();
    let maxR = 0;
    for (let i = 0; i < currentFrame.natoms; i++) {
      const t = currentFrame.types[i];
      if (seen.has(t)) continue;
      seen.add(t);
      const r = getElementSpec(t).radius;
      if (r > maxR) maxR = r;
    }
    if (maxR === 0) maxR = 1.4;
    return Math.min(6, 2 * maxR + bondTolerance + 0.5);
  }, [currentFrame, bondTolerance]);

  const [clusters, setClusters] = useState<Clusters | null>(null);
  useEffect(() => {
    setClusters(null);
    if (!currentFrame) return;
    if (currentFrame.natoms < 50_000) return;
    if (loadedAtomCount < currentFrame.natoms) return;
    let cancelled = false;
    const idleCb = (typeof requestIdleCallback !== 'undefined')
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 0);
    const cancelIdle = (typeof cancelIdleCallback !== 'undefined')
      ? cancelIdleCallback
      : clearTimeout;
    const handle = idleCb(() => {
      if (cancelled) return;
      const built = buildClusters(currentFrame, { mobile: deviceQualityTier === 0 });
      if (!cancelled) setClusters(built);
    });
    return () => { cancelled = true; cancelIdle(handle as any); };
  }, [currentFrame, loadedAtomCount, deviceQualityTier]);

  const clusterFadeNear = useMemo(() => {
    if (!file) return 300;
    const { min, max } = file.trajectory.globalBounds;
    const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    return diag * 3;
  }, [file?.name]);
  const clusterFadeFar = useMemo(() => clusterFadeNear * 3.3, [clusterFadeNear]);

  const [spatialHash, setSpatialHash] = useState<SpatialHash3D | null>(null);
  const ghostFrame = ghostFile
    ? ghostFile.trajectory.frames[Math.min(interpState.frameIndex, Math.max(ghostFile.trajectory.totalFrames - 1, 0))]
    : null;

  return (
    <>
      <USDZExportHelper trigger={isExportingQuickLook} onComplete={() => setIsExportingQuickLook(false)} />
      <ExportManager />
      <AppBackground
        top={bgTop}
        bottom={bgBottom}
        style={bgStyle}
        media={bgMedia}
        procedural={bgProcedural}
        adjustments={bgAdjustments}
        center={center}
        distance={cameraDistance}
        backdropShape={backdropShape}
        backdropPattern={backdropPattern}
        backdropRadius={backdropRadius}
      />
      <XREnvironmentDome media={bgMedia} top={bgTop} bottom={bgBottom} style={bgStyle} adjustments={bgAdjustments} disabled={!!bgProcedural} />
      <XRLightEstimation />
      <SceneLighting />

      {currentFrame && (
        <SpatialAnchor cameraDistance={cameraDistance}>
          <MoleculeFilterShell
            center={center}
            radius={filterShellBaseRadius}
            shape={filterShellShape}
            preset={filterShellPreset}
            opacity={filterShellOpacity}
            radiusScale={filterShellRadius}
          />
          {filterShellShape !== 'off' && filterShellOpacity > 0 && (
            <MoleculeShadow
              center={center}
              moleculeRadius={filterShellBaseRadius}
              shellRadius={Math.max(0.5, filterShellBaseRadius * filterShellRadius)}
              azimuthDeg={keyLightAzimuth}
              elevationDeg={keyLightElevation}
              opacity={0.5}
            />
          )}
          <AnomalyTracker frame={currentFrame} colorProperty={colorProperty} active={anomalyTracking} />
          {ghostFrame && <GhostAtoms frame={ghostFrame} scale={atomScale * 0.34} />}
          <AtomsOptimized
            frame={interpolatedFrame ?? currentFrame!}
            nextFrame={interpolatedNextFrame}
            interpolationFactor={interpolationFactor}
            colorMode={colorMode}
            colorProperty={colorProperty ?? undefined}
            colormap={colormap}
            uniformColor={uniformAtomColor}
            elementColorOverrides={elementColorOverrides}
            atomColorSource={atomColorSource}
            scale={atomScale}
            maxAtoms={deviceMaxAtoms}
            loadedAtomCount={loadedAtomCount}
            onSpatialHash={setSpatialHash}
            hiddenAtomTypes={hiddenAtomTypes}
            atomTypeScales={atomTypeScales}
            materialPreset={materialPreset}
            materialIntensity={materialIntensity}
            rimLightIntensity={rimLightIntensity}
            surfaceRoughness={surfaceRoughness}
            surfacePolish={surfacePolish}
            surfaceClearcoat={surfaceClearcoat}
            keyLightAzimuth={keyLightAzimuth}
            keyLightElevation={keyLightElevation}
            fillLightAzimuth={fillLightAzimuth}
            fillLightElevation={fillLightElevation}
            rimLightAzimuth={rimLightAzimuth}
            rimLightElevation={rimLightElevation}
            fillLightColor={fillLightColor}
            rimLightColor={rimLightColor}
            atomTexture={atomTexture}
            propertyEmissionStrength={propertyEmissionStrength}
            etchTexture={etchTexture}
            etchAtomId={etchAtomId}
          />
          {activeVectorField && (
            <VectorGlyphs
              frame={interpolatedFrame ?? currentFrame!}
              nextFrame={interpolatedNextFrame}
              interpolationFactor={interpolationFactor}
              field={activeVectorField}
              scale={vectorScale}
              density={vectorDensity}
              colormap={colormap}
              hiddenAtomTypes={hiddenAtomTypes}
              onStats={setVectorStats}
            />
          )}
          <AtomClusters clusters={clusters} fadeNear={clusterFadeNear} fadeFar={clusterFadeFar} />
          <Bonds
            frame={interpolatedFrame ?? currentFrame}
            nextFrame={interpolatedNextFrame}
            interpolationFactor={interpolationFactor}
            maxBondLength={effectiveBondCutoff}
            tolerance={bondTolerance}
            colormap={colormap}
            colorMode={colorMode}
            colorProperty={colorProperty ?? undefined}
            uniformColor={uniformAtomColor}
            elementColorOverrides={elementColorOverrides}
            radius={0.12}
            opacity={0.85}
            materialPreset={materialPreset}
            materialIntensity={materialIntensity}
            rimLightIntensity={rimLightIntensity}
            surfaceRoughness={surfaceRoughness}
            surfacePolish={surfacePolish}
            surfaceClearcoat={surfaceClearcoat}
            fillLightColor={fillLightColor}
            rimLightColor={rimLightColor}
            fillLightAzimuth={fillLightAzimuth}
            fillLightElevation={fillLightElevation}
            rimLightAzimuth={rimLightAzimuth}
            rimLightElevation={rimLightElevation}
            visible={showBonds && loadedAtomCount >= (interpolatedFrame ?? currentFrame).natoms}
            bondColorMode={bondColorMode}
            useGpu={useGpuBonds}
            atomColorSource={atomColorSource}
            onBondsUpdate={(info) => useStore.getState().reportBondsUpdate(info.source, info.count)}
            onGpuStatusChange={(status) => useStore.getState().setGpuBondsStatus(status)}
          />
          {showCell && <SimulationCell bounds={currentFrame.boxBounds} color="#1e3050" opacity={0.3} />}

          {!(filterShellShape !== 'off' && filterShellOpacity > 0) && currentFrame.boxBounds && postprocessPreset !== 'diagram' && (() => {
            const b = currentFrame.boxBounds;
            const cx = (b[0] + b[1]) / 2;
            const cy = b[2];
            const cz = (b[4] + b[5]) / 2;
            const dx = b[1] - b[0];
            const dz = b[5] - b[4];
            const planeSize = Math.max(dx, dz) * 1.6;
            return (
              <ContactShadows
                position={[cx, cy - 0.05, cz]}
                scale={planeSize}
                blur={2.4}
                far={Math.max(20, dx * 0.6)}
                opacity={postprocessPreset === 'cinematic' ? 0.55 : 0.32}
                resolution={1024}
                color="#04060c"
              />
            );
          })()}

          <AnnotationsLayer
            frame={currentFrame}
            annotations={annotations}
            style={labelStyle}
            onDismiss={(id) => useStore.getState().removeAnnotation(id)}
          />
          <KnowledgeLabelsLayer
            labels={knowledgeLabels}
            visibleKinds={knowledgeLabelKinds}
            visible={showKnowledgeLabels}
          />
          <SelectionMarkers
            frame={currentFrame}
            selectedAtoms={selectedAtoms}
            hoveredAtom={hoveredAtom}
            typeRadii={TYPE_RADII}
            highlightedNeighbors={highlightedNeighbors}
            dimNonNeighbors={dimNonNeighbors}
          />
          <AtomInfoHUD
            frame={currentFrame}
            selectedAtoms={selectedAtoms}
            activeProperty={colorProperty ?? undefined}
            onDismissCard={(atomIndex) => useStore.getState().setSelectedAtoms(
              (prev) => prev.filter(idx => idx !== atomIndex),
            )}
          />
          <CameraFocus frame={currentFrame} enabled={!flythroughPreview} />
          <AtomTrails frame={currentFrame} frameKey={interpolatedFrameKey} atomIndices={trackedAtomIndices} />

          {spatialHash && (
            <AtomPicker
              frame={currentFrame}
              spatialHash={spatialHash}
              enabled
              onClick={(atomIndex) => {
                if (atomIndex == null) return;
                const isAnnotate = (window as any).__atlasShiftHeld === true;
                if (isAnnotate) {
                  const text = window.prompt('Annotation text', `atom #${atomIndex}`);
                  if (text && text.trim()) {
                    useStore.getState().addAnnotation(atomIndex, text.trim());
                  }
                }
              }}
              onHover={(atomIndex) => useStore.getState().setHoveredAtom(atomIndex)}
              onSelect={(indices) => useStore.getState().setSelectedAtoms(indices)}
            />
          )}
        </SpatialAnchor>
      )}

      {showAxes && (
        <GizmoHelper alignment="bottom-left" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ff4060', '#40ff80', '#4080ff']} labelColor="white" />
        </GizmoHelper>
      )}

      <OrbitControls
        makeDefault
        enabled={!flythroughPreview}
        target={center}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        panSpeed={0.4}
        zoomSpeed={0.8}
        minDistance={cameraMinDistance}
        maxDistance={cameraDistance * 6}
        onStart={() => {
          const f = useStore.getState().file;
          if (f && interactedForFileRef.current !== f.name) {
            interactedForFileRef.current = f.name;
            track(ANALYTICS_EVENTS.MOLECULE_INTERACTED, {
              atoms: f.trajectory.frames[0]?.natoms ?? 0,
            });
          }
        }}
        onEnd={(e: any) => {
          if (e?.target?.object && e?.target?.target) {
            useStore.getState().setCameraState(
              e.target.object.position.toArray(),
              e.target.target.toArray(),
            );
          }
        }}
      />

      <ScenePostprocessing />
    </>
  );
}
