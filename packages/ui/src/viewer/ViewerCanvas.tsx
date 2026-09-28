import type { ReactNode } from 'react';
import { getDeviceTier, type DeviceTier } from '../deviceCapabilities';
import type { RenderCapability } from '../renderCapability';
import { LupiCanvas } from './LupiCanvas';

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

/** DOM id of the element that wraps the viewer's canvas (`#lupi-viewer-canvas canvas`). */
export const VIEWER_CANVAS_ID = 'lupi-viewer-canvas';

export function viewerDprRange(tier: DeviceTier = getDeviceTier()): [number, number] {
  return [1, MAX_DPR_BY_DEVICE_TIER[tier]];
}

/**
 * The main viewer canvas: LupiCanvas with the viewer's id, DPR table and
 * camera. The renderer (WebGPURenderer, alpha on, antialias off), its look
 * and its disposal all come from LupiCanvas and createLupiRenderer.
 */
export function ViewerCanvas({
  paused = false,
  capability,
  cameraDistance,
  cameraNear,
  center,
  children,
}: ViewerCanvasProps) {
  return (
    <LupiCanvas
      id={VIEWER_CANVAS_ID}
      capability={capability}
      frameloop={paused ? 'never' : 'always'}
      camera={{
        position: [center[0], center[1], center[2] + cameraDistance],
        fov: 50,
        near: cameraNear,
        far: Math.max(10000, cameraDistance * 100),
      }}
      dpr={viewerDprRange()}
    >
      {children}
    </LupiCanvas>
  );
}
