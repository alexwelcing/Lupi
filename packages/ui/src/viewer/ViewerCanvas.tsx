import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR } from '@react-three/xr';
import * as THREE from 'three';
import { CanvasErrorBoundary } from '../CanvasErrorBoundary';
import { getDeviceTier, type DeviceTier } from '../deviceCapabilities';
import type { RenderCapability } from '../renderCapability';
import { xrStore } from './xrStore';

interface ViewerCanvasProps {
  paused?: boolean;
  capability: RenderCapability;
  cameraDistance: number;
  cameraNear: number;
  center: [number, number, number];
  children: ReactNode;
}

const MAX_DPR_BY_DEVICE_TIER: Record<DeviceTier, number> = {
  mobile: 1.25,
  low: 1.25,
  desktop: 1.75,
  high: 1.75,
};

export const VIEWER_GL_OPTIONS = {
  alpha: true,
  antialias: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
} as const;

export function viewerDprRange(tier: DeviceTier = getDeviceTier()): [number, number] {
  return [1, MAX_DPR_BY_DEVICE_TIER[tier]];
}

interface ViewerRendererConfigurationTarget {
  outputColorSpace: string;
  shadowMap: { type: THREE.ShadowMapType };
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
}

export function configureViewerRenderer(gl: ViewerRendererConfigurationTarget): void {
  gl.outputColorSpace = THREE.SRGBColorSpace;
  // The postprocess pipeline is the sole tone-map owner. Applying a renderer
  // tone map here would process the scene twice and make exports drift.
  gl.toneMapping = THREE.NoToneMapping;
  gl.toneMappingExposure = 1;
  // r182 deprecates PCFSoftShadowMap; PCFShadowMap is now soft.
  gl.shadowMap.type = THREE.PCFShadowMap;
}

export function ViewerCanvas({
  paused = false,
  capability,
  cameraDistance,
  cameraNear,
  center,
  children,
}: ViewerCanvasProps) {
  const dpr = viewerDprRange();

  return (
    <CanvasErrorBoundary capability={capability}>
      <Canvas
        frameloop={paused ? 'never' : 'always'}
        id="lupi-viewer-canvas"
        camera={{
          position: [center[0], center[1], center[2] + cameraDistance],
          fov: 50,
          near: cameraNear,
          far: Math.max(10000, cameraDistance * 100),
        }}
        gl={VIEWER_GL_OPTIONS}
        dpr={dpr}
        onCreated={({ gl }) => configureViewerRenderer(gl)}
        style={{
          background: 'transparent',
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      >
        <XR store={xrStore}>{children}</XR>
      </Canvas>
    </CanvasErrorBoundary>
  );
}
