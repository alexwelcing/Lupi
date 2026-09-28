/**
 * LupiCanvas.tsx — the only <Canvas> in Lupi (plan-final D2).
 *
 * Every scene (the viewer, the billion-atom page, the testbed) mounts through
 * it, so each one gets the same renderer stack:
 *
 * - the fiber v10 WebGPU entry with createLupiRenderer (WebGPU, or the WebGL2
 *   backend of WebGPURenderer);
 * - configureViewerRenderer in onCreated (sRGB, no renderer tone mapping,
 *   exposure 1, PCF shadows), because R3F sets ACES after the factory;
 * - the renderer runtime record (`window.__lupiRenderer`, onRuntime) and a
 *   `data-renderer-backend` attribute on the wrapper;
 * - R3FGlCompat, so drei 11 components that read `state.gl` work;
 * - RendererFallback when the capability probe finds neither WebGPU nor
 *   WebGL2, CanvasErrorBoundary when the renderer throws at mount;
 * - renderer disposal on unmount (R3F v10 does not dispose a WebGPURenderer).
 *
 * `id` lands on the wrapper element, so `#<id> canvas` selects the canvas as
 * it did with the v9 Canvas.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, type CameraProps } from '@react-three/fiber/webgpu';
import type * as THREE from 'three/webgpu';
import { installLupiPhases } from '@atlas/scene';
import { CanvasErrorBoundary } from '../CanvasErrorBoundary';
import { RendererFallback } from '../RendererFallback';
import { fallbackCopyFor, type RenderCapability } from '../renderCapability';
import { R3FGlCompat } from './R3FCompat';
import {
  configureViewerRenderer,
  createLupiRenderer,
  disposeLupiRenderer,
  recordLupiRendererRuntime,
  type LupiBackend,
  type LupiRendererRuntime,
} from './createLupiRenderer';

// Frame phases are added once, before any canvas mounts (plan-final D12).
installLupiPhases();

export interface LupiCanvasProps {
  /** DOM id of the wrapper element around the canvas. */
  id: string;
  capability: RenderCapability;
  frameloop: 'always' | 'demand' | 'never';
  camera: CameraProps;
  dpr: [number, number] | number;
  /** Scene background colour (the Canvas `background` prop). */
  background?: THREE.ColorRepresentation;
  children: ReactNode;
  /** Called once the renderer is initialized and configured. */
  onRuntime?: (runtime: LupiRendererRuntime) => void;
}

const FILL_STYLE = { width: '100%', height: '100%' } as const;

export function LupiCanvas({
  id,
  capability,
  frameloop,
  camera,
  dpr,
  background,
  children,
  onRuntime,
}: LupiCanvasProps) {
  const [backend, setBackend] = useState<LupiBackend | null>(null);
  // Every canvas this component created a renderer for (a retry after an
  // error remounts a new canvas element).
  const canvasesRef = useRef(new Set<HTMLCanvasElement>());

  useEffect(() => {
    const canvases = canvasesRef.current;
    return () => {
      for (const canvas of canvases) disposeLupiRenderer(canvas);
      canvases.clear();
    };
  }, []);

  if (!capability.canRender) {
    return <RendererFallback copy={fallbackCopyFor(capability)} />;
  }

  return (
    <CanvasErrorBoundary capability={capability}>
      <div id={id} data-renderer-backend={backend ?? undefined} style={FILL_STYLE}>
        <Canvas
          renderer={createLupiRenderer}
          frameloop={frameloop}
          camera={camera}
          dpr={dpr}
          background={background}
          onCreated={(state) => {
            const renderer = state.renderer;
            configureViewerRenderer(renderer);
            if (renderer.domElement instanceof HTMLCanvasElement) canvasesRef.current.add(renderer.domElement);
            const runtime = recordLupiRendererRuntime(renderer);
            setBackend(runtime.backend);
            onRuntime?.(runtime);
          }}
          style={{
            background: 'transparent',
            display: 'block',
            width: '100%',
            height: '100%',
          }}
        >
          <R3FGlCompat>{children}</R3FGlCompat>
        </Canvas>
      </div>
    </CanvasErrorBoundary>
  );
}
