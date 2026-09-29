/**
 * R3FCompat.tsx — keeps drei 11 alpha working on the fiber v10 WebGPU entry.
 *
 * drei 11.0.0-alpha.7 still reads the deprecated `state.gl` (Html,
 * MeshTransmissionMaterial, controls). In fiber 10.0.0-canary.14007b4 WebGPU
 * mode, zustand's first set() snapshots the deprecated `gl` getter as null,
 * so those components throw `null.domElement` / `null.setRenderTarget` and
 * take the whole canvas into the error boundary (lead probe L5). This gate
 * points `gl` at the renderer and renders its children only once it is set.
 */
import { useEffect, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber/webgpu';

export function R3FGlCompat({ children }: { children: ReactNode }) {
  // Typed non-null, but null at runtime until the effect below runs.
  const gl = useThree((state) => state.gl) as unknown;
  const renderer = useThree((state) => state.renderer);
  const set = useThree((state) => state.set);

  useEffect(() => {
    if (!gl && renderer) set({ gl: renderer });
  }, [gl, renderer, set]);

  return gl ? <>{children}</> : null;
}
