import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { FilterShellPreset, FilterShellShape } from './store';

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
  const sphereUniforms = useMemo(() => ({
    uFill: { value: new THREE.Color(style.fill) },
    uEdge: { value: new THREE.Color(style.edge) },
    uAccent: { value: new THREE.Color(style.accent) },
    uOpacity: { value: opacity },
  }), [style, opacity]);

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
        <mesh frustumCulled={false} renderOrder={-39}>
          <sphereGeometry args={[shellRadius, 64, 40]} />
          {/* One inexpensive, camera-responsive surface: no refraction buffer,
              animation loop, or dense wireframe competing with the molecule. */}
          <shaderMaterial
            uniforms={sphereUniforms}
            vertexShader={SPHERE_VERTEX}
            fragmentShader={SPHERE_FRAGMENT}
            transparent
            side={THREE.BackSide}
            depthWrite={false}
            depthTest
            toneMapped={false}
          />
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

const SPHERE_VERTEX = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vView = -view.xyz;
    vNormal = normalize(normalMatrix * normal);
    vLocal = normalize(position);
    gl_Position = projectionMatrix * view;
  }
`;

const SPHERE_FRAGMENT = /* glsl */`
  uniform vec3 uFill;
  uniform vec3 uEdge;
  uniform vec3 uAccent;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float fresnel = pow(1.0 - facing, 2.6);
    float pearl = 0.5 + 0.5 * sin(vLocal.y * 4.0 + vLocal.x * 3.0 + facing * 6.0);
    vec3 rim = mix(uEdge, uAccent, pearl);
    vec3 color = mix(uFill, rim, 0.25 + 0.75 * fresnel);
    float sheen = pow(max(0.0, dot(normalize(vLocal), normalize(vec3(-0.5, 0.8, 0.4)))), 20.0);
    color = mix(color, vec3(1.0), sheen * 0.5);
    gl_FragColor = vec4(color, uOpacity * (0.035 + fresnel * 0.9 + sheen * 0.15));
    #include <colorspace_fragment>
  }
`;
