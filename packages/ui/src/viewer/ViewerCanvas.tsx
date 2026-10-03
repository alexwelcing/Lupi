import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { getDeviceTier, type DeviceTier } from '../deviceCapabilities';
import type { RenderCapability } from '../renderCapability';
import { LupiCanvas } from './LupiCanvas';
import type { LupiBackend, LupiRendererRuntime } from './createLupiRenderer';
import { FirstFrameSignal } from '../relay/FirstFrameSignal';
import { FrameDemandDriver, viewerFrameloop } from './FrameDemandDriver';

interface ViewerCanvasProps {
  capability: RenderCapability;
  cameraDistance: number;
  cameraNear: number;
  center: [number, number, number];
  /**
   * Atoms in the open structure, held for the whole file (see
   * `budgetAtomCount`), so playback never resizes the canvas; large
   * structures get a smaller pixel budget.
   */
  atomCount?: number;
  children: ReactNode;
}

/**
 * Highest canvas DPR by device tier, for small, large and very large
 * structures. Ray-cast impostors pay per covered pixel, so the budget shrinks
 * as the structure grows; small ones render at (or near) the panel's native
 * density, so phones no longer upscale a 1.25x canvas to 3x. Phones and
 * low-power devices keep large and very large structures at about their old
 * 1.25x budget (the 1M-atom test froze phones: deviceCapabilities.ts). The
 * post pipeline's FXAA smooths what is left of the silhouettes.
 */
const MAX_DPR_BY_DEVICE_TIER: Record<DeviceTier, readonly [small: number, large: number, huge: number]> = {
  mobile: [3, 1.5, 1.25],
  low: [2, 1.25, 1.25],
  desktop: [2, 2, 1.5],
  high: [2, 2, 1.5],
};

/**
 * A phone on the WebGL2 backend has no WebGPU: an older browser or a weaker
 * GPU (iOS Safari 26 and current Android Chrome run WebGPU). Its canvas stays
 * at most 2x; FXAA still smooths the silhouettes.
 */
export const WEBGL2_PHONE_MAX_DPR = 2;

/** From this many atoms a structure is large (ViewerScene's large-scene threshold). */
export const DPR_SMALL_STRUCTURE_ATOMS = 50_000;
/** Above this many atoms a structure is very large (the atoms' full-quality limit). */
export const DPR_LARGE_STRUCTURE_ATOMS = 400_000;

/**
 * The atom count the DPR budget uses for a file: the largest frame resident
 * when the file first has one (every frame of a fully loaded trajectory, the
 * first streamed frame otherwise), then held for the file. A trajectory whose
 * atom count changes from frame to frame therefore never resizes the canvas
 * mid-playback or mid-recording. 0 until a frame is resident.
 */
export function budgetAtomCount(frames: ReadonlyArray<{ natoms: number } | undefined>, current?: { natoms: number }): number {
  let count = current?.natoms ?? 0;
  for (const frame of frames) {
    if (frame && frame.natoms > count) count = frame.natoms;
  }
  return Number.isFinite(count) ? count : 0;
}

/** DOM id of the element that wraps the viewer's canvas (`#lupi-viewer-canvas canvas`). */
export const VIEWER_CANVAS_ID = 'lupi-viewer-canvas';

/**
 * The viewer's DPR range: [1, the tier's cap for this structure size], and at
 * most WEBGL2_PHONE_MAX_DPR for a phone on the WebGL2 backend. `backend` is
 * null until the renderer has started.
 */
export function viewerDprRange(
  tier: DeviceTier = getDeviceTier(),
  atomCount = 0,
  backend: LupiBackend | null = null,
): [number, number] {
  const [small, large, huge] = MAX_DPR_BY_DEVICE_TIER[tier];
  const count = Number.isFinite(atomCount) ? atomCount : 0;
  const max = count < DPR_SMALL_STRUCTURE_ATOMS ? small : count <= DPR_LARGE_STRUCTURE_ATOMS ? large : huge;
  return [1, backend === 'webgl2' && tier === 'mobile' ? Math.min(max, WEBGL2_PHONE_MAX_DPR) : max];
}

/**
 * The main viewer canvas: LupiCanvas with the viewer's id, DPR table and
 * camera. The renderer (WebGPURenderer, alpha on, antialias off), its look
 * and its disposal all come from LupiCanvas and createLupiRenderer.
 *
 * Quiet Idle: the canvas renders on demand and FrameDemandDriver keeps it
 * drawing only while something changes or moves, so a still view costs no
 * GPU work. `?frameloop=always` restores continuous rendering. The prop is
 * read once and never changes, so ExportManager's `setFrameloop('always')`
 * for a video recording is never overridden mid-recording.
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
  const frameloop = useMemo(() => viewerFrameloop(), []);
  const [backend, setBackend] = useState<LupiBackend | null>(null);
  const dpr = useMemo(() => viewerDprRange(tier, atomCount, backend), [tier, atomCount, backend]);
  const atomCountRef = useRef(atomCount);
  atomCountRef.current = atomCount;
  // The backend is known once the renderer has started, before the first
  // frame: apply its cap to the canvas at once, then keep the prop in step.
  const onRuntime = useCallback(
    (runtime: LupiRendererRuntime, root: { setDpr(dpr: [number, number] | number): void }) => {
      root.setDpr(viewerDprRange(tier, atomCountRef.current, runtime.backend));
      setBackend(runtime.backend);
    },
    [tier],
  );
  return (
    <LupiCanvas
      id={VIEWER_CANVAS_ID}
      capability={capability}
      frameloop={frameloop}
      camera={{
        position: [center[0], center[1], center[2] + cameraDistance],
        fov: 50,
        near: cameraNear,
        far: Math.max(10000, cameraDistance * 100),
      }}
      dpr={dpr}
      onRuntime={onRuntime}
    >
      <FrameDemandDriver />
      {children}
      <FirstFrameSignal />
    </LupiCanvas>
  );
}
