/**
 * <SimulationCell /> — Wireframe box for periodic boundaries
 *
 * Edge lines of the cell box with a `LineBasicNodeMaterial` (WebGPURenderer
 * draws line lists 1 device pixel wide on both backends).
 */

import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three/webgpu';

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
  // Commit-phase update, so a frame (or a capture) never sees a stale colour.
  useLayoutEffect(() => {
    material.color.set(color);
    material.opacity = opacity;
  }, [material, color, opacity]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return <lineSegments geometry={geometry} material={material} />;
}
