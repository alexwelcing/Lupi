/**
 * <SimulationCell /> — Wireframe box for periodic boundaries
 *
 * Edge lines of the cell box with a `LineBasicNodeMaterial` (WebGPURenderer
 * draws line lists 1 texel wide on both backends). A 1-texel line thins out
 * as the canvas DPR (or a capture's supersampling) rises, so the line's
 * opacity is scaled to keep its weight (cellLineOpacity):
 * - live: as a 1-px line on the old 1.25x canvas looked, stretched to the
 *   panel (`opacity × DPR / 1.25`, at least `opacity`);
 * - capture: as a 1-px line in the output (`opacity × texel scale`).
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { captureTexelScale } from './captureGuards';

/** The canvas DPR at which a 1-texel cell line has its nominal weight. */
export const CELL_LINE_REFERENCE_DPR = 1.25;

/**
 * The cell line's opacity for one render: scaled by the capture's texel
 * scale inside a capture, else by the canvas DPR over the reference (never
 * below `opacity`); at most 1.
 */
export function cellLineOpacity(opacity: number, pixelRatio: number, texelScale: number | null): number {
  const scale = texelScale ?? Math.max(1, pixelRatio / CELL_LINE_REFERENCE_DPR);
  return Math.min(1, Math.max(0, opacity) * scale);
}

interface SimulationCellProps {
  bounds: Float64Array; // [xlo, xhi, ylo, yhi, zlo, zhi]
  color?: string;
  opacity?: number;
}

export function SimulationCell({ bounds, color = '#1e2840', opacity = 0.4 }: SimulationCellProps) {
  const geometry = useMemo(() => {
    const [xlo, xhi, ylo, yhi, zlo, zhi] = bounds;
    const w = xhi - xlo, h = yhi - ylo, d = zhi - zlo;
    const cx = (xlo + xhi) / 2, cy = (ylo + yhi) / 2, cz = (zlo + zhi) / 2;
    const box = new THREE.BoxGeometry(w, h, d);
    box.translate(cx, cy, cz);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [bounds]);

  const material = useMemo(() => new THREE.LineBasicNodeMaterial({ transparent: true }), []);
  const opacityRef = useRef(opacity);
  // Commit-phase update, so a frame (or a capture) never sees a stale colour.
  useLayoutEffect(() => {
    material.color.set(color);
    opacityRef.current = opacity;
    material.opacity = opacity;
  }, [material, color, opacity]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  const lineRef = useRef<THREE.LineSegments>(null);
  useLayoutEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    line.onBeforeRender = (renderer) => {
      // Typed as WebGLRenderer by @types/three; WebGPURenderer has both too.
      const target = (renderer as unknown as { getRenderTarget(): unknown }).getRenderTarget();
      material.opacity = cellLineOpacity(opacityRef.current, renderer.getPixelRatio(), captureTexelScale(target));
    };
  }, [material]);

  return <lineSegments ref={lineRef} geometry={geometry} material={material} />;
}
