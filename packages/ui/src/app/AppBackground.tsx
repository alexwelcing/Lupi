import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import { getBackgroundFromColormap, requestLupiFrames } from '@atlas/scene';
import type { ColormapName } from '@atlas/core/types';
import { BG_PRESETS, getBgMedia, type BgMedia, type BgPreset } from '../backgroundPresets';
import { useEquirectMediaTexture } from '../hooks/useEquirectMediaTexture';
import type { BackgroundGradientStyle } from '../equirectTexture';
import { ProceduralBackground, ProceduralMathField } from '../ProceduralBackground';
import { createDomeMaterial, updateDomeMaterial, type DomePatternMode } from '../tsl/domeMaterial';
import type { BackgroundBackdropPattern, BackgroundBackdropShape } from '../store';
import {
  LUPI_EXPORT_BACKGROUND_LAYER,
  LUPI_EXPORT_LAYER_KEY,
} from '../export/renderCaptureState';

export type BackgroundAssetAdjustments = {
  yawDegrees: number;
  pitchDegrees: number;
  opacity: number;
  brightness: number;
  saturation: number;
  contrast: number;
  motionPaused: boolean;
  motionSpeed: number;
};

export const DEFAULT_BACKGROUND_ADJUSTMENTS: BackgroundAssetAdjustments = {
  yawDegrees: 0,
  pitchDegrees: 0,
  opacity: 1,
  brightness: 1,
  saturation: 1,
  contrast: 1,
  motionPaused: false,
  motionSpeed: 1,
};

export function resolveBackground(backgroundPreset: string, colormap: ColormapName) {
  if (backgroundPreset.startsWith('palette:')) {
    const [, palette] = backgroundPreset.split(':');
    const colors = getBackgroundFromColormap((palette as ColormapName) ?? colormap);
    return { ...colors, media: { kind: 'gradient', projection: 'equirectangular' } as BgMedia };
  }
  const preset = BG_PRESETS[backgroundPreset] ?? BG_PRESETS.void;
  return { top: preset.top, bottom: preset.bottom, media: getBgMedia(preset), procedural: preset.procedural };
}

function patternMode(pattern: BackgroundBackdropPattern): DomePatternMode {
  if (pattern === 'plain') return 1;
  if (pattern === 'grid') return 2;
  return 0;
}

const PANORAMA_DOME_RADIUS = 5000;

export function AppBackground({
  top,
  bottom,
  style = 'linear',
  media,
  procedural,
  adjustments = DEFAULT_BACKGROUND_ADJUSTMENTS,
  center = [0, 0, 0],
  distance = 1,
  backdropShape = 'dome',
  backdropPattern = 'image',
  backdropRadius = 5,
}: {
  top: string; bottom: string;
  style?: BackgroundGradientStyle;
  media: BgMedia;
  procedural?: BgPreset['procedural'];
  adjustments?: BackgroundAssetAdjustments;
  center?: [number, number, number];
  distance?: number;
  backdropShape?: BackgroundBackdropShape;
  backdropPattern?: BackgroundBackdropPattern;
  backdropRadius?: number;
}) {
  const { scene } = useThree();

  // A plain gradient can use scene.background, but its fine adjustments need
  // the same live shader as image backdrops. Never show inert adjustment UI.
  const adjusted = adjustments.opacity !== 1 || adjustments.brightness !== 1
    || adjustments.saturation !== 1 || adjustments.contrast !== 1
    || adjustments.yawDegrees !== 0 || adjustments.pitchDegrees !== 0;
  const usesBackdropMesh = adjusted || media.kind !== 'gradient' || backdropShape !== 'dome' || backdropPattern !== 'image';
  const texture = useEquirectMediaTexture({
    media,
    top,
    bottom,
    style,
    enabled: !procedural,
    projection: usesBackdropMesh ? 'dome' : 'scene-background',
    paused: adjustments.motionPaused,
    playbackRate: adjustments.motionSpeed,
    logPrefix: 'bg',
  });

  useEffect(() => {
    // scene.background and fog are set outside React's props: draw the change
    // (Quiet Idle), here and in every cleanup below.
    requestLupiFrames();
    if (procedural) {
      scene.background = null;
      scene.fog = new THREE.FogExp2(bottom, 0.0007);
      return () => {
        scene.background = null;
        scene.fog = null;
        requestLupiFrames();
      };
    }

    if (!texture) {
      scene.background = null;
      scene.fog = null;
      return;
    }

    if (usesBackdropMesh || media.kind !== 'gradient') {
      scene.background = null;
      scene.fog = null;
      return () => {
        scene.background = null;
        scene.fog = null;
        requestLupiFrames();
      };
    }

    scene.background = texture;
    scene.fog = new THREE.FogExp2(bottom, 0.0015);

    return () => {
      if (scene.background === texture) scene.background = null;
      scene.fog = null;
      requestLupiFrames();
    };
  }, [bottom, media.kind, procedural, scene, texture, usesBackdropMesh]);

  if (procedural) {
    const visible = true;
    return (
      <group userData={{ [LUPI_EXPORT_LAYER_KEY]: LUPI_EXPORT_BACKGROUND_LAYER }}>
        <ProceduralBackground variant={procedural} top={top} bottom={bottom} visible={visible} paused={adjustments.motionPaused} speed={adjustments.motionSpeed} />
        <ProceduralMathField variant={procedural} center={center} radius={distance * 1.46} visible={visible} paused={adjustments.motionPaused} speed={adjustments.motionSpeed} />
      </group>
    );
  }

  if (usesBackdropMesh && texture) {
    return (
      <BackdropVolume
        texture={texture}
        top={top}
        bottom={bottom}
        adjustments={adjustments}
        shape={backdropShape}
        pattern={backdropPattern}
        center={center}
        radius={backdropShape === 'dome' ? PANORAMA_DOME_RADIUS : backdropRadius}
      />
    );
  }

  return null;
}

function BackdropVolume({
  texture,
  top,
  bottom,
  adjustments,
  shape,
  pattern,
  center,
  radius,
}: {
  texture: THREE.Texture;
  top: string;
  bottom: string;
  adjustments: BackgroundAssetAdjustments;
  shape: BackgroundBackdropShape;
  pattern: BackgroundBackdropPattern;
  center: [number, number, number];
  radius: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const geometry = useMemo(() => {
    const safeRadius = Math.max(0.25, radius);
    if (shape === 'cube') {
      const diameter = safeRadius * 2;
      return new THREE.BoxGeometry(diameter, diameter, diameter, 1, 1, 1);
    }

    const geo = new THREE.SphereGeometry(safeRadius, 128, 64);
    if (shape === 'dome') geo.scale(-1, 1, 1);
    return geo;
  }, [radius, shape]);
  const domeValues = {
    map: texture,
    top,
    bottom,
    opacity: adjustments.opacity,
    brightness: adjustments.brightness,
    saturation: adjustments.saturation,
    contrast: adjustments.contrast,
    patternMode: patternMode(pattern),
  };
  // Built once; every change after that is a uniform or texture swap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useMemo(() => createDomeMaterial(domeValues), []);

  useEffect(() => {
    updateDomeMaterial(material, domeValues);
    requestLupiFrames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustments.brightness, adjustments.contrast, adjustments.opacity, adjustments.saturation, bottom, material, pattern, texture, top]);

  useEffect(() => () => {
    geometry.dispose();
  }, [geometry]);

  useEffect(() => () => {
    material.dispose();
  }, [material]);

  useFrame(() => {
    if (!meshRef.current) return;
    if (shape === 'dome') {
      meshRef.current.position.copy(camera.position);
    } else {
      meshRef.current.position.set(center[0], center[1], center[2]);
    }
    meshRef.current.rotation.set(
      THREE.MathUtils.degToRad(adjustments.pitchDegrees),
      THREE.MathUtils.degToRad(adjustments.yawDegrees),
      0,
    );
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-1000}
      userData={{ [LUPI_EXPORT_LAYER_KEY]: LUPI_EXPORT_BACKGROUND_LAYER }}
    />
  );
}
