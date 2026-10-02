import { useMemo, type ReactNode } from 'react';
import { getDeviceTier, type DeviceTier } from '../deviceCapabilities';
import type { RenderCapability } from '../renderCapability';
import { LupiCanvas } from './LupiCanvas';
import { FirstFrameSignal } from '../relay/FirstFrameSignal';

interface ViewerCanvasProps {
  capability: RenderCapability;
  cameraDistance: number;
  cameraNear: number;
  center: [number, number, number];
  /** Atoms in the open structure; large structures get a smaller pixel budget. */
  atomCount?: number;
  children: ReactNode;
}

/**
 * Highest canvas DPR by device tier, for small, large and very large
 * structures. Ray-cast impostors pay per covered pixel, so the budget shrinks
 * as the structure grows; small ones render at (or near) the panel's native
 * density, so phones no longer upscale a 1.25x canvas to 3x. The post
 * pipeline's FXAA smooths what is left of the silhouettes.
 */
const MAX_DPR_BY_DEVICE_TIER: Record<DeviceTier, readonly [small: number, large: number, huge: number]> = {
  mobile: [3, 2, 1.5],
  low: [2, 1.5, 1.25],
  desktop: [2, 2, 1.5],
  high: [2, 2, 1.5],
};

/** Up to this many atoms a structure is small (ViewerScene's large-scene threshold). */
export const DPR_SMALL_STRUCTURE_ATOMS = 50_000;
/** Above this many atoms a structure is very large (the atoms' full-quality limit). */
export const DPR_LARGE_STRUCTURE_ATOMS = 400_000;

/** DOM id of the element that wraps the viewer's canvas (`#lupi-viewer-canvas canvas`). */
export const VIEWER_CANVAS_ID = 'lupi-viewer-canvas';

/** The viewer's DPR range: [1, the tier's cap for this structure size]. */
export function viewerDprRange(tier: DeviceTier = getDeviceTier(), atomCount = 0): [number, number] {
  const [small, large, huge] = MAX_DPR_BY_DEVICE_TIER[tier];
  const count = Number.isFinite(atomCount) ? atomCount : 0;
  const max = count <= DPR_SMALL_STRUCTURE_ATOMS ? small : count <= DPR_LARGE_STRUCTURE_ATOMS ? large : huge;
  return [1, max];
}

/**
 * The main viewer canvas: LupiCanvas with the viewer's id, DPR table and
 * camera. The renderer (WebGPURenderer, alpha on, antialias off), its look
 * and its disposal all come from LupiCanvas and createLupiRenderer.
 */
export function ViewerCanvas({
  capability,
  cameraDistance,
  cameraNear,
  center,
  atomCount = 0,
  children,
}: ViewerCanvasProps) {
  const tier = useMemo(getDeviceTier, []);
  const dpr = useMemo(() => viewerDprRange(tier, atomCount), [tier, atomCount]);
  return (
    <LupiCanvas
      id={VIEWER_CANVAS_ID}
      capability={capability}
      frameloop="always"
      camera={{
        position: [center[0], center[1], center[2] + cameraDistance],
        fov: 50,
        near: cameraNear,
        far: Math.max(10000, cameraDistance * 100),
      }}
      dpr={dpr}
    >
      {children}
      <FirstFrameSignal />
    </LupiCanvas>
  );
}
