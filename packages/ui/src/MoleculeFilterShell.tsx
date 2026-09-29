/**
 * MoleculeFilterShell — the optional "atmosphere" around a molecule: a
 * fresnel sphere (node material, tsl/filterShellMaterial.ts) or a tinted cube
 * with edges and a faint wireframe.
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { FilterShellPreset, FilterShellShape } from './store';
import { createFilterShellMaterial, filterShellUniforms } from './tsl/filterShellMaterial';

const SHELL_PRESETS: Record<FilterShellPreset, {
  fill: string;
  edge: string;
  accent: string;
}> = {
  haze: { fill: '#d9f7ff', edge: '#7de9ff', accent: '#ffffff' },
  cryo: { fill: '#84c9ff', edge: '#d7f7ff', accent: '#5eead4' },
  prism: { fill: '#b9a8ff', edge: '#63f6ff', accent: '#ff7ab6' },
  graphite: { fill: '#8aa0b6', edge: '#d1d5db', accent: '#f59e0b' },
};

interface MoleculeFilterShellProps {
  center: [number, number, number];
  radius: number;
  shape: FilterShellShape;
  preset: FilterShellPreset;
  opacity: number;
  radiusScale: number;
}

export function MoleculeFilterShell({
  center,
  radius,
  shape,
  preset,
  opacity,
  radiusScale,
}: MoleculeFilterShellProps) {
  const style = SHELL_PRESETS[preset] ?? SHELL_PRESETS.haze;
  const shellRadius = Math.max(0.5, radius * radiusScale);
  const diameter = shellRadius * 2;
  const fillOpacity = Math.min(0.34, opacity * 0.58);
  const rimOpacity = Math.min(0.72, opacity * 1.35);
  // Built once; preset and opacity changes are uniform writes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sphereMaterial = useMemo(() => createFilterShellMaterial(style, opacity), []);

  useEffect(() => {
    const bag = filterShellUniforms(sphereMaterial);
    bag.uFill.value.set(style.fill);
    bag.uEdge.value.set(style.edge);
    bag.uAccent.value.set(style.accent);
    bag.uOpacity.value = opacity;
  }, [opacity, sphereMaterial, style]);

  useEffect(() => () => sphereMaterial.dispose(), [sphereMaterial]);

  const cubeEdgesGeometry = useMemo(() => {
    if (shape !== 'cube') return null;
    const box = new THREE.BoxGeometry(diameter, diameter, diameter);
    const edges = new THREE.EdgesGeometry(box, 15);
    box.dispose();
    return edges;
  }, [diameter, shape]);

  useEffect(() => () => {
    cubeEdgesGeometry?.dispose();
  }, [cubeEdgesGeometry]);

  if (shape === 'off' || opacity <= 0) return null;

  return (
    <group position={center} renderOrder={-40}>
      {shape === 'cube' && <mesh frustumCulled={false} renderOrder={-40}>
        <boxGeometry args={[diameter, diameter, diameter, 1, 1, 1]} />
        <meshBasicMaterial
          color={style.fill}
          transparent
          opacity={fillOpacity}
          depthWrite={false}
          depthTest
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>}

      {shape === 'sphere' && (
        // One inexpensive, camera-responsive surface: no refraction buffer,
        // animation loop, or dense wireframe competing with the molecule.
        <mesh frustumCulled={false} renderOrder={-39} material={sphereMaterial}>
          <sphereGeometry args={[shellRadius, 64, 40]} />
        </mesh>
      )}

      {shape === 'cube' && cubeEdgesGeometry && (
        <lineSegments geometry={cubeEdgesGeometry} frustumCulled={false} renderOrder={-39}>
          <lineBasicMaterial
            color={style.edge}
            transparent
            opacity={rimOpacity}
            depthWrite={false}
            depthTest
            toneMapped={false}
          />
        </lineSegments>
      )}

      {shape === 'cube' && (
        <mesh frustumCulled={false} renderOrder={-38}>
          <boxGeometry args={[diameter * 1.006, diameter * 1.006, diameter * 1.006, 1, 1, 1]} />
          <meshBasicMaterial
            color={style.accent}
            transparent
            opacity={Math.min(0.18, opacity * 0.36)}
            wireframe
            depthWrite={false}
            depthTest
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}
