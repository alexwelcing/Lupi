/**
 * ProceduralBackground — the procedural mathematical backgrounds: a sky
 * sphere that follows the camera (node material, tsl/skyMaterial.ts) and a
 * sparse line/point field around the molecule.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import * as THREE from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import { float, instancedBufferAttribute } from 'three/tsl';
import type { ProceduralBackgroundVariant } from './backgroundPresets';
import { SKY_VARIANT_INDEX as VARIANT_INDEX, createSkyMaterial, skyUniforms } from './tsl/skyMaterial';
import { LUPI_BACKGROUND_MATERIAL_KEY, markBackgroundMaterial } from './postprocess/backgroundMask';

/** The field's line materials are background too (postprocess/backgroundMask.ts). */
const BACKGROUND_MATERIAL_USER_DATA = { [LUPI_BACKGROUND_MATERIAL_KEY]: true };

const TWO_PI = Math.PI * 2;

type FieldGeometry = {
  lines: THREE.BufferGeometry;
  /** Point positions (xyz), drawn as instanced sprites: WebGPU has no point size. */
  points: Float32Array;
  primary: string;
  secondary: string;
  point: string;
  lineOpacity: number;
  pointOpacity: number;
};

function fract(value: number) {
  return value - Math.floor(value);
}

function seeded(index: number) {
  return fract(Math.sin(index * 127.1 + 311.7) * 43758.5453123);
}

function spherical(theta: number, phi: number, radius: number) {
  const sinTheta = Math.sin(theta);
  return new THREE.Vector3(
    radius * sinTheta * Math.cos(phi),
    radius * Math.cos(theta),
    radius * sinTheta * Math.sin(phi),
  );
}

function frameFromNormal(normal: THREE.Vector3) {
  const n = normal.clone().normalize();
  const helper = Math.abs(n.y) > 0.86 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(helper, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { u, v, n };
}

function pushSegment(points: number[], a: THREE.Vector3, b: THREE.Vector3) {
  const radius = Math.max(a.length(), b.length(), 1);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const aperture = Math.max(8, radius * 0.34);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const projection = lenSq > 0 ? Math.max(0, Math.min(1, -(a.x * abx + a.y * aby) / lenSq)) : 0;
  const closestX = a.x + abx * projection;
  const closestY = a.y + aby * projection;
  const screenRadius = Math.min(Math.hypot(mid.x, mid.y), Math.hypot(closestX, closestY));
  if (screenRadius < aperture && Math.abs(mid.z) < radius * 1.05) return;
  points.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

function pushPolyline(points: number[], polyline: THREE.Vector3[]) {
  for (let i = 1; i < polyline.length; i++) {
    pushSegment(points, polyline[i - 1], polyline[i]);
  }
}

function makeGeometry(linePositions: number[], pointPositions: number[], variant: ProceduralBackgroundVariant): FieldGeometry {
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

  const filteredPoints: number[] = [];
  for (let i = 0; i < pointPositions.length; i += 3) {
    const p = new THREE.Vector3(pointPositions[i], pointPositions[i + 1], pointPositions[i + 2]);
    const radius = Math.max(p.length(), 1);
    if (Math.hypot(p.x, p.y) < Math.max(8, radius * 0.34) && Math.abs(p.z) < radius * 1.05) continue;
    filteredPoints.push(p.x, p.y, p.z);
  }

  const points = new Float32Array(filteredPoints);

  const palette: Record<ProceduralBackgroundVariant, Omit<FieldGeometry, 'lines' | 'points'>> = {
    'manifold-field': { primary: '#84fbff', secondary: '#f0a85b', point: '#8662ff', lineOpacity: 0.18, pointOpacity: 0.18 },
    'hopf-current': { primary: '#7af8ff', secondary: '#ffd66f', point: '#9b7cff', lineOpacity: 0.22, pointOpacity: 0.15 },
    'harmonic-bloom': { primary: '#74ecff', secondary: '#ffd16a', point: '#b184ff', lineOpacity: 0.17, pointOpacity: 0.20 },
    'reaction-lattice': { primary: '#55f5df', secondary: '#a5ff7a', point: '#48b7ff', lineOpacity: 0.15, pointOpacity: 0.14 },
    'moire-crystal': { primary: '#8af7ff', secondary: '#f3cf66', point: '#9b7cff', lineOpacity: 0.20, pointOpacity: 0.18 },
  };

  return { lines, points, ...palette[variant] };
}

function buildFieldGeometry(variant: ProceduralBackgroundVariant, radius: number): FieldGeometry {
  const linePositions: number[] = [];
  const pointPositions: number[] = [];
  const outer = radius;
  const inner = radius * 0.52;

  if (variant === 'hopf-current') {
    for (let strand = 0; strand < 10; strand++) {
      const polyline: THREE.Vector3[] = [];
      const phase = strand * TWO_PI / 10;
      const rot = new THREE.Euler(0.3 + strand * 0.11, strand * 0.42, strand * 0.19);
      for (let i = 0; i <= 180; i++) {
        const t = i / 180 * TWO_PI;
        const major = outer * (0.66 + 0.035 * Math.sin(3 * t + phase));
        const minor = outer * (0.18 + 0.025 * Math.sin(5 * t - phase));
        polyline.push(new THREE.Vector3(
          (major + minor * Math.cos(3 * t + phase)) * Math.cos(2 * t + phase * 0.35),
          minor * Math.sin(3 * t + phase),
          (major + minor * Math.cos(3 * t + phase)) * Math.sin(2 * t + phase * 0.35),
        ).applyEuler(rot));
      }
      pushPolyline(linePositions, polyline);
      for (let i = 0; i < polyline.length; i += 24) pointPositions.push(polyline[i].x, polyline[i].y, polyline[i].z);
    }
  } else if (variant === 'reaction-lattice') {
    for (let cell = 0; cell < 34; cell++) {
      const normal = spherical(Math.acos(1 - 2 * (cell + 0.5) / 34), cell * Math.PI * (3 - Math.sqrt(5)), 1);
      const { u, v, n } = frameFromNormal(normal);
      const center = n.multiplyScalar(outer * (0.62 + seeded(cell) * 0.24));
      const cellRadius = outer * (0.055 + seeded(cell + 7) * 0.065);
      const polyline: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const a = i / 64 * TWO_PI;
        const wobble = 1 + 0.24 * Math.sin(3 * a + cell) + 0.13 * Math.sin(7 * a + cell * 1.7);
        polyline.push(center.clone().addScaledVector(u, Math.cos(a) * cellRadius * wobble).addScaledVector(v, Math.sin(a) * cellRadius * wobble));
      }
      pushPolyline(linePositions, polyline);
      pointPositions.push(center.x, center.y, center.z);
    }
  } else if (variant === 'moire-crystal') {
    const axes = [
      new THREE.Vector3(1, 0.18, 0.28).normalize(),
      new THREE.Vector3(-0.44, 0.86, 0.26).normalize(),
      new THREE.Vector3(0.30, 0.48, -0.82).normalize(),
    ];
    for (const axis of axes) {
      const { u, v } = frameFromNormal(axis);
      for (let band = -4; band <= 4; band++) {
        const offset = band * outer * 0.135;
        const half = Math.sqrt(Math.max(0, outer * outer * 0.78 - offset * offset));
        pushSegment(linePositions, axis.clone().multiplyScalar(offset).addScaledVector(u, -half).addScaledVector(v, -outer * 0.36), axis.clone().multiplyScalar(offset).addScaledVector(u, half).addScaledVector(v, outer * 0.36));
        pushSegment(linePositions, axis.clone().multiplyScalar(offset).addScaledVector(v, -half).addScaledVector(u, outer * 0.30), axis.clone().multiplyScalar(offset).addScaledVector(v, half).addScaledVector(u, -outer * 0.30));
      }
    }
    for (let i = 0; i < 56; i++) {
      const p = spherical(Math.acos(1 - 2 * (i + 0.5) / 56), i * Math.PI * (3 - Math.sqrt(5)), outer * (0.54 + 0.18 * seeded(i + 11)));
      pointPositions.push(p.x, p.y, p.z);
    }
  } else {
    const families = variant === 'harmonic-bloom' ? 5 : 14;
    for (let band = 0; band < families; band++) {
      const polyline: THREE.Vector3[] = [];
      const phase = seeded(band + 19) * TWO_PI;
      const tilt = new THREE.Euler(seeded(band + 2) * 1.6 - 0.8, seeded(band + 5) * TWO_PI, seeded(band + 8) * 1.4 - 0.7);
      for (let i = 0; i <= 160; i++) {
        const t = i / 160 * TWO_PI;
        const theta = Math.PI * (0.28 + 0.44 * seeded(band + 3)) + 0.18 * Math.sin(3 * t + phase);
        const phi = t + 0.22 * Math.sin(2 * t + phase);
        const r = variant === 'harmonic-bloom'
          ? inner + outer * (0.20 + 0.20 * Math.pow(Math.abs(Math.sin(4 * t + band)), 0.7))
          : outer * (0.56 + 0.13 * Math.sin(5 * t + phase));
        polyline.push(spherical(theta, phi, r).applyEuler(tilt));
      }
      pushPolyline(linePositions, polyline);
    }
    for (let i = 0; i < 48; i++) {
      const p = spherical(Math.acos(1 - 2 * (i + 0.5) / 48), i * Math.PI * (3 - Math.sqrt(5)), outer * (0.50 + 0.20 * seeded(i + 31)));
      pointPositions.push(p.x, p.y, p.z);
    }
  }

  return makeGeometry(linePositions, pointPositions, variant);
}

type ProceduralBackgroundProps = {
  variant: ProceduralBackgroundVariant;
  top: string;
  bottom: string;
  visible?: boolean;
  paused?: boolean;
  speed?: number;
};

export function ProceduralBackground({ variant, top, bottom, visible = true, paused = false, speed = 1 }: ProceduralBackgroundProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const time = useRef(0);
  // One material per variant: the variant is baked into the node graph.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const material = useMemo(() => createSkyMaterial({ variant, top, bottom }), [variant]);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const bag = skyUniforms(material);
    bag.uTop.value.set(top);
    bag.uBottom.value.set(bottom);
  }, [bottom, material, top]);

  useFrame((state, delta) => {
    if (!paused && visible) time.current += Math.min(delta, .1) * speed;
    skyUniforms(material).uTime.value = time.current;
    meshRef.current?.position.copy(state.camera.position);
  });

  return (
    <mesh ref={meshRef} material={material} renderOrder={-1000} frustumCulled={false} visible={visible} scale={[500, 500, 500]}>
      <sphereGeometry args={[1, 128, 64]} />
    </mesh>
  );
}

type ProceduralMathFieldProps = {
  variant: ProceduralBackgroundVariant;
  center: [number, number, number];
  radius: number;
  visible?: boolean;
  paused?: boolean;
  speed?: number;
};

export function ProceduralMathField({ variant, center, radius, visible = true, paused = false, speed = 1 }: ProceduralMathFieldProps) {
  const time = useRef(0);
  const groupRef = useRef<THREE.Group>(null);
  const lineMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const safeRadius = Math.max(18, Math.min(radius, 420));
  const field = useMemo(() => buildFieldGeometry(variant, safeRadius), [safeRadius, variant]);
  const pointSize = Math.max(0.16, safeRadius * 0.010);
  // WebGPU draws THREE.Points at 1 px, so the field's points are instanced
  // billboard sprites. PointsMaterial's attenuated size (px = size·H/2/depth)
  // equals a world quad of size·tan(fov/2); at the viewer's ~50° that is ≈ size/2.
  const pointMaterial = useMemo(() => {
    const material = new SpriteNodeMaterial({
      color: field.point,
      transparent: true,
      opacity: field.pointOpacity,
      sizeAttenuation: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    // An InstancedBufferAttribute (not the raw array): three r186 steps a
    // typed-array buffer node per vertex, which stretches quads across points.
    material.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(field.points, 3));
    material.scaleNode = float(pointSize * 0.47);
    return markBackgroundMaterial(material);
  }, [field, pointSize]);

  useEffect(() => () => {
    field.lines.dispose();
  }, [field]);

  useEffect(() => () => pointMaterial.dispose(), [pointMaterial]);

  useFrame((_state, delta) => {
    if (!paused && visible) time.current += Math.min(delta, .1) * speed;
    const t = time.current;
    const index = VARIANT_INDEX[variant] ?? 0;
    if (groupRef.current) {
      groupRef.current.rotation.y = t * (0.006 + index * 0.0018);
      groupRef.current.rotation.x = Math.sin(t * 0.045 + index) * 0.08;
      groupRef.current.rotation.z = Math.cos(t * 0.035 + index * 0.7) * 0.05;
    }
    const pulse = 0.86 + 0.14 * Math.sin(t * 0.55 + index);
    if (lineMaterialRef.current) lineMaterialRef.current.opacity = field.lineOpacity * pulse;
    pointMaterial.opacity = field.pointOpacity * (0.80 + 0.20 * pulse);
  });

  return (
    <group ref={groupRef} position={center} visible={visible} renderOrder={-30}>
      <lineSegments geometry={field.lines}>
        <lineBasicMaterial
          ref={lineMaterialRef}
          color={field.primary}
          transparent
          opacity={field.lineOpacity}
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          userData={BACKGROUND_MATERIAL_USER_DATA}
        />
      </lineSegments>
      <lineSegments geometry={field.lines} scale={[1.018, 1.018, 1.018]}>
        <lineBasicMaterial
          color={field.secondary}
          transparent
          opacity={field.lineOpacity * 0.42}
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          userData={BACKGROUND_MATERIAL_USER_DATA}
        />
      </lineSegments>
      {field.points.length > 0 && (
        <sprite material={pointMaterial} count={field.points.length / 3} frustumCulled={false} />
      )}
    </group>
  );
}
