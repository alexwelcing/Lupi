import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';
import { getBackgroundFromColormap } from '@atlas/scene';
import type { ColormapName } from '@atlas/core/types';
import { BG_PRESETS, getBgMedia, type BgMedia, type BgPreset } from '../backgroundPresets';
import { useEquirectMediaTexture } from '../hooks/useEquirectMediaTexture';
import type { BackgroundGradientStyle } from '../equirectTexture';
import { ProceduralBackground, ProceduralMathField } from '../ProceduralBackground';
import type { BackgroundBackdropPattern, BackgroundBackdropShape } from '../store';

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

function patternMode(pattern: BackgroundBackdropPattern): number {
  if (pattern === 'plain') return 1;
  if (pattern === 'grid') return 2;
  return 0;
}

const PANORAMA_DOME_RADIUS = 5000;

const PANORAMA_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PANORAMA_FRAGMENT_SHADER = `
  uniform sampler2D map;
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float opacity;
  uniform float brightness;
  uniform float saturation;
  uniform float contrast;
  uniform int patternMode;
  varying vec2 vUv;

  void main() {
    vec4 texel = texture2D(map, vUv);
    vec3 gradient = mix(bottomColor, topColor, smoothstep(0.0, 1.0, vUv.y));
    vec3 color = patternMode == 0 ? texel.rgb : gradient;
    if (patternMode == 2) {
      vec2 cell = fract(vUv * vec2(24.0, 12.0));
      float line = max(
        max(1.0 - step(0.018, cell.x), step(0.982, cell.x)),
        max(1.0 - step(0.024, cell.y), step(0.976, cell.y))
      );
      vec3 gridColor = mix(vec3(0.92, 0.98, 1.0), vec3(0.15, 0.86, 0.90), 0.45);
      color = mix(color, gridColor, line * 0.42);
    }
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, saturation);
    color = (color - 0.5) * contrast + 0.5;
    color *= brightness;
    color = mix(bottomColor, color, opacity);
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

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

  // Hook must be called unconditionally
  const mode = useXR(state => state.mode);
  const xrMode = mode as string | null;
  const isImmersiveAR = xrMode === 'immersive-ar';
  const isImmersiveVR = xrMode === 'immersive-vr';
  const usesBackdropMesh = media.kind !== 'gradient' || backdropShape !== 'dome' || backdropPattern !== 'image';
  const texture = useEquirectMediaTexture({
    media,
    top,
    bottom,
    style,
    enabled: !isImmersiveAR && !procedural,
    projection: usesBackdropMesh ? 'dome' : 'scene-background',
    paused: adjustments.motionPaused,
    playbackRate: adjustments.motionSpeed,
    logPrefix: 'bg',
  });

  useEffect(() => {
    if (isImmersiveAR || procedural) {
      scene.background = null;
      scene.fog = procedural && !isImmersiveAR ? new THREE.FogExp2(bottom, 0.0007) : null;
      return () => {
        scene.background = null;
        scene.fog = null;
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
      };
    }

    scene.background = texture;
    scene.fog = new THREE.FogExp2(bottom, 0.0015);

    return () => {
      if (scene.background === texture) scene.background = null;
      scene.fog = null;
    };
  }, [bottom, isImmersiveAR, media.kind, procedural, scene, texture, usesBackdropMesh]);

  if (procedural) {
    const visible = !isImmersiveAR;
    return (
      <>
        <ProceduralBackground variant={procedural} top={top} bottom={bottom} visible={visible} />
        <ProceduralMathField variant={procedural} center={center} radius={distance * 1.46} visible={visible} />
      </>
    );
  }

  if (usesBackdropMesh && texture && !isImmersiveAR && !isImmersiveVR) {
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
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      topColor: { value: new THREE.Color(top) },
      bottomColor: { value: new THREE.Color(bottom) },
      opacity: { value: adjustments.opacity },
      brightness: { value: adjustments.brightness },
      saturation: { value: adjustments.saturation },
      contrast: { value: adjustments.contrast },
      patternMode: { value: patternMode(pattern) },
    },
    vertexShader: PANORAMA_VERTEX_SHADER,
    fragmentShader: PANORAMA_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    fog: false,
  }), []);

  useEffect(() => {
    material.uniforms.map.value = texture;
    material.uniforms.topColor.value.set(top);
    material.uniforms.bottomColor.value.set(bottom);
    material.uniforms.opacity.value = adjustments.opacity;
    material.uniforms.brightness.value = adjustments.brightness;
    material.uniforms.saturation.value = adjustments.saturation;
    material.uniforms.contrast.value = adjustments.contrast;
    material.uniforms.patternMode.value = patternMode(pattern);
    material.needsUpdate = true;
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
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false} renderOrder={-1000}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}
