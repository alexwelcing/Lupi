/**
 * The /scale canvas content: each frame steps the world (flight, wraps,
 * smash), cuts it when anything moved (scale-spec §9.5) and hands the cut
 * to three draw paths: instanced unit boxes with the lattice grid, instanced
 * splat spheres, and one AtomsOptimized impostor layer per body for the
 * materialized leaves. Atom positions live in the anchor's units, so a zoom
 * only rewrites a group matrix and the atoms' radius, never the buffer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync, useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import { ELEMENT_DATA } from '@atlas/core/elements';
import type { Frame } from '@atlas/core/types';
import type { Budgets } from '@atlas/core/scale';
import { AtomsOptimized } from '@atlas/scene/AtomsOptimized';
import { BOX_ATTR, createBoxGeometry, createBoxMaterial, createSplatMaterial } from './boxMaterial';
import { allocBoxes, allocSplats, collectAtoms, DrawCache, fillInstances, type AtomSet } from './draw';
import { CAMERA, type ScaleWorld, type Viewport } from './world';

export interface ScaleFrameInfo {
  viewport: Viewport;
  /** Milliseconds the last cut took. */
  cutMs: number;
  /** Nothing moves after this frame: the loop sleeps until the next input. */
  idle: boolean;
}

const BOX_CAPACITY = 4096;
const SPLAT_CAPACITY = 16384;

/** clamp(0.75 r_cov, 0.32, 0.90) Å, the toy radius the cut sizes boxes by (§9.2), over the viewer's display radius. */
function toyScales(): Record<number, number> {
  const out: Record<number, number> = {};
  for (let z = 1; z <= 118; z += 1) {
    const e = ELEMENT_DATA[z];
    if (!e) continue;
    const toy = Math.min(0.9, Math.max(0.32, 0.75 * e.radius));
    out[z] = e.displayRadius > 0 ? toy / e.displayRadius : 1;
  }
  return out;
}
const TOY_SCALES = toyScales();

function atomFrame(set: AtomSet): Frame {
  return {
    timestep: 0,
    natoms: set.count,
    boxBounds: new Float64Array([-1, 1, -1, 1, -1, 1]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    identity: { kind: 'source-id', unique: true },
    ids: Int32Array.from({ length: set.count }, (_, i) => i + 1),
    types: set.types,
    typeSemantics: { kind: 'atomic-number', provenance: 'procedural-symbol' },
    distanceSemantics: { kind: 'angstrom', provenance: 'procedural' },
    positions: set.positions,
    bonds: new Int32Array(),
    properties: new Map(),
  };
}

/** worldFromAtoms = worldFromAnchor · Scale(σ) · T(c(A)), into a three matrix. */
function writeAtomMatrix(m: THREE.Matrix4, world: ScaleWorld, set: AtomSet): number {
  const frame = world.bodies[set.body]?.frame;
  if (!frame) return 0;
  const s = frame.metresPerAnchorUnit;
  const r = frame.worldFromAnchor.r;
  const c = set.centre;
  const t = frame.worldFromAnchor.t;
  const tx = t[0] + s * (r[0] * c[0] + r[1] * c[1] + r[2] * c[2]);
  const ty = t[1] + s * (r[3] * c[0] + r[4] * c[1] + r[5] * c[2]);
  const tz = t[2] + s * (r[6] * c[0] + r[7] * c[1] + r[8] * c[2]);
  m.set(s * r[0], s * r[1], s * r[2], tx, s * r[3], s * r[4], s * r[5], ty, s * r[6], s * r[7], s * r[8], tz, 0, 0, 0, 1);
  // Metres per ångström: the impostor radius is in view units, not scaled by the model matrix.
  return s * set.angstrom;
}

interface AtomLayerProps {
  set: AtomSet;
  radius: number;
  quality: 0 | 1 | 2;
  groupRef: (g: THREE.Group | null) => void;
}

function AtomLayer({ set, radius, quality, groupRef }: AtomLayerProps) {
  const frame = useMemo(() => atomFrame(set), [set]);
  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      <AtomsOptimized
        frame={frame}
        atomColorSource="element"
        scale={radius}
        atomTypeScales={TOY_SCALES}
        qualityTier={quality}
        materialPreset="plastic"
        materialIntensity={0.35}
        surfaceClearcoat={0.4}
        cullPixelRadius={0.35}
      />
    </group>
  );
}

export interface ScaleSceneProps {
  world: ScaleWorld;
  budgets: Budgets;
  quality: 0 | 1 | 2;
  onFrame?: (info: ScaleFrameInfo) => void;
}

export function ScaleScene({ world, budgets, quality, onFrame }: ScaleSceneProps) {
  const size = useThree((s) => s.size);
  const viewportDpr = useThree((s) => s.viewport.dpr);
  const invalidate = useThree((s) => s.invalidate);
  const cache = useMemo(() => new DrawCache(Math.min(32 << 20, budgets.residentBytes / 2)), [budgets]);
  const boxes = useMemo(() => allocBoxes(BOX_CAPACITY), []);
  const splats = useMemo(() => allocSplats(SPLAT_CAPACITY), []);
  const boxGeometry = useMemo(() => createBoxGeometry(BOX_CAPACITY), []);
  const boxMaterial = useMemo(() => createBoxMaterial(), []);
  const splatGeometry = useMemo(() => new THREE.IcosahedronGeometry(1, 2), []);
  const splatMaterial = useMemo(() => createSplatMaterial(), []);
  const boxMesh = useMemo(() => {
    const mesh = new THREE.InstancedMesh(boxGeometry, boxMaterial, BOX_CAPACITY);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * BOX_CAPACITY), 3);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }, [boxGeometry, boxMaterial]);
  const splatMesh = useMemo(() => {
    const mesh = new THREE.InstancedMesh(splatGeometry, splatMaterial, SPLAT_CAPACITY);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3 * SPLAT_CAPACITY), 3);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }, [splatGeometry, splatMaterial]);
  useEffect(() => () => {
    boxGeometry.dispose();
    boxMaterial.dispose();
    splatGeometry.dispose();
    splatMaterial.dispose();
    boxMesh.dispose();
    splatMesh.dispose();
  }, [boxGeometry, boxMaterial, splatGeometry, splatMaterial, boxMesh, splatMesh]);

  const [atomSets, setAtomSets] = useState<AtomSet[]>([]);
  const [radii, setRadii] = useState<Record<string, number>>({});
  const setsRef = useRef<AtomSet[]>([]);
  const radiiRef = useRef<Record<string, number>>({});
  const groups = useRef(new Map<string, THREE.Group>());
  const scratch = useMemo(() => new THREE.Matrix4(), []);

  // A new world (entry, shared piece) starts from nothing.
  useEffect(() => {
    setsRef.current = [];
    radiiRef.current = {};
    setAtomSets([]);
    setRadii({});
    world.dirty = true;
    invalidate();
  }, [world, invalidate]);

  useFrame((_state, delta) => {
    const dt = Math.min(Math.max(delta, 1 / 240), 0.1);
    const moved = world.step(dt);
    const viewport: Viewport = { heightPx: Math.max(1, Math.round(size.height * viewportDpr)), aspect: size.width / Math.max(1, size.height) };
    let cutMs = 0;
    if (moved || world.dirty) {
      const t0 = performance.now();
      const cut = world.cutNow(viewport, budgets, performance.now() / 1000);
      cutMs = performance.now() - t0;
      const frames = world.bodies.map((b) => b.frame);
      const keys = world.bodies.map((b) => b.key);
      fillInstances(cut, frames, keys, cache, boxes, splats);
      uploadInstances(boxMesh, splatMesh, boxes, splats);
      const previous = new Map(setsRef.current.map((s) => [s.bodyKey, s]));
      const sets = collectAtoms(cut, frames, keys, cache, previous);
      const changed = sets.length !== setsRef.current.length || sets.some((s, i) => s.key !== setsRef.current[i]?.key);
      if (changed) {
        setsRef.current = sets;
        flushSync(() => setAtomSets(sets));
      } else {
        // Same atoms; the body index may have moved after a smash or isolate.
        setsRef.current = sets;
      }
    }
    // Atom groups follow their bodies every frame; their radius follows σ exactly (flushSync: this frame).
    const nextRadii: Record<string, number> = {};
    let radiiChanged = false;
    for (const set of setsRef.current) {
      const g = groups.current.get(set.bodyKey);
      const r = writeAtomMatrix(scratch, world, set);
      nextRadii[set.bodyKey] = r;
      if (Math.abs(r - (radiiRef.current[set.bodyKey] ?? 0)) > 1e-9 * r) radiiChanged = true;
      if (g) {
        g.matrix.copy(scratch);
        g.matrixWorldNeedsUpdate = true;
      }
    }
    if (radiiChanged) {
      radiiRef.current = nextRadii;
      flushSync(() => setRadii(nextRadii));
    }
    const busy = moved || world.dirty || world.flight !== null;
    if (busy) invalidate();
    onFrame?.({ viewport, cutMs, idle: !busy });
  });

  return (
    <>
      <hemisphereLight args={['#f4f7ee', '#1b2a24', 1.15]} />
      <directionalLight position={[1.6, 2.4, 2.2]} intensity={1.9} />
      <directionalLight position={[-2.2, -0.6, 1.2]} intensity={0.35} color="#d5ef9c" />
      <primitive object={boxMesh} />
      <primitive object={splatMesh} />
      {atomSets.map((set) => (
        <AtomLayer
          key={set.bodyKey}
          set={set}
          radius={radii[set.bodyKey] ?? 0}
          quality={quality}
          groupRef={(g) => {
            if (g) {
              groups.current.set(set.bodyKey, g);
              writeAtomMatrix(g.matrix, world, set);
              g.matrixWorldNeedsUpdate = true;
            } else groups.current.delete(set.bodyKey);
          }}
        />
      ))}
    </>
  );
}

function uploadInstances(
  boxMesh: THREE.InstancedMesh,
  splatMesh: THREE.InstancedMesh,
  boxes: ReturnType<typeof allocBoxes>,
  splats: ReturnType<typeof allocSplats>,
): void {
  boxMesh.count = boxes.count;
  (boxMesh.instanceMatrix.array as Float32Array).set(boxes.matrices.subarray(0, 16 * boxes.count));
  boxMesh.instanceMatrix.needsUpdate = true;
  (boxMesh.instanceColor!.array as Float32Array).set(boxes.colors.subarray(0, 3 * boxes.count));
  boxMesh.instanceColor!.needsUpdate = true;
  const cells = boxMesh.geometry.getAttribute(BOX_ATTR.cells) as THREE.InstancedBufferAttribute;
  const grid = boxMesh.geometry.getAttribute(BOX_ATTR.grid) as THREE.InstancedBufferAttribute;
  (cells.array as Float32Array).set(boxes.cells.subarray(0, 3 * boxes.count));
  (grid.array as Float32Array).set(boxes.grid.subarray(0, 3 * boxes.count));
  cells.needsUpdate = true;
  grid.needsUpdate = true;
  splatMesh.count = splats.count;
  (splatMesh.instanceMatrix.array as Float32Array).set(splats.matrices.subarray(0, 16 * splats.count));
  splatMesh.instanceMatrix.needsUpdate = true;
  (splatMesh.instanceColor!.array as Float32Array).set(splats.colors.subarray(0, 3 * splats.count));
  splatMesh.instanceColor!.needsUpdate = true;
}

/** The view ray through a point of the canvas (CSS pixels), in world (= camera) space. */
export function rayThrough(x: number, y: number, width: number, height: number): [number, number, number] {
  const tan = Math.tan(CAMERA.fovY / 2);
  const nx = (2 * x) / width - 1;
  const ny = 1 - (2 * y) / height;
  const d: [number, number, number] = [nx * tan * (width / height), ny * tan, -1];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}
