/**
 * glyphs — WP3a's testbed case: the scene package's secondary layers in one
 * frame, stacked for a portrait phone as well as the desktop (top to bottom):
 *
 * 1. VectorGlyphs: two single-arrow fields, `viridis` and `coolwarm`. Each
 *    arrow is its field's p95, so its head shows the colormap's last texel
 *    exactly: the colormap texture, its sRGB decode and the single output
 *    encode all hold.
 * 2. AtomClusters: a splat whose fade range is behind the camera distance
 *    (visible, "zoomed out") and one whose fade range is beyond it (faded,
 *    "zoomed in").
 * 3. AtomsTransmission: an O and a C atom through drei's MeshTransmissionMaterial
 *    in front of a white card, lit (a physical material skips its lighting
 *    model, transmission included, in an unlit scene). The O atom tints the
 *    refracted card red and C grey, which a missing or black transmission
 *    buffer cannot fake.
 * 4. BillionAtomBlock, shrunk to 0.8 units, with LOD distances that put bricks
 *    in all four tiers (atoms, 2³, 6³ and whole-brick splats).
 * 5. SimulationCell around everything. WebGPU draws 1-pixel lines, which a 3×3
 *    median probe cannot judge, so 12 cells 0.0025 apart stack their top edge
 *    into a band.
 *
 * `&layers=glyphs,cell` mounts a subset, for manual debugging.
 *
 * Assertions: no GLSL material is left in the scene (every material is a node
 * material), the transmission atoms carry MeshTransmissionMaterial, and every
 * billion-block tier draws instances.
 */
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import type { Frame, VectorFieldSpec } from '@atlas/core';
import {
  AtomClusters,
  AtomsTransmission,
  BillionAtomBlock,
  SimulationCell,
  VectorGlyphs,
  type Clusters,
} from '@atlas/scene';
import { harnessAssert, harnessHold, useHarnessProbe } from '../harness';

const FIELD: VectorFieldSpec = {
  id: 'v',
  label: 'Velocity',
  kind: 'velocity',
  components: ['vx', 'vy', 'vz'],
  magnitudeProperty: '|v|',
};

function frameOf(
  positions: number[],
  types: number[],
  properties: Record<string, number[]> = {},
): Frame {
  const natoms = types.length;
  return {
    timestep: 0,
    natoms,
    // A zero box: the glyph auto-scale falls back to its 1.2-unit reference length.
    boxBounds: new Float64Array(6),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z', ...Object.keys(properties)],
    identity: { kind: 'source-id', unique: true },
    ids: Int32Array.from(types, (_, index) => index + 1),
    types: Int32Array.from(types),
    typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
    positions: Float32Array.from(positions),
    bonds: new Int32Array(0),
    properties: new Map(Object.entries(properties).map(([name, values]) => [name, Float32Array.from(values)])),
  };
}

// ── Layout (world units; camera at z = 5, fov 50) ───────────────────────
const GLYPH_Y = 1.75;
const GLYPH_LENGTH = 0.8; // 1.2 reference length × scale
const GLYPH_SCALE = GLYPH_LENGTH / 1.2;
const GLYPH_LEFT_X = -0.95;
const GLYPH_RIGHT_X = 0.15;
/** Probe inside the arrow head, on its axis (edge shading = 1). */
const GLYPH_HEAD_AT = 0.72;

const CLUSTER_Y = 0.75;
const CLUSTER_X = 0.5;

const TRANSMISSION_Y = -0.35;
const TRANSMISSION_X = 0.45;

const BILLION_Y = -1.6;
const BILLION_SCALE = 0.00035; // the 2277 Å block → 0.8 units

const CELL_BOUNDS = [-1.0, 1.0, -2.05, 2.05, -0.15, 0.15] as const;
const CELL_STACK = 12;
const CELL_STEP = 0.0025;

/** One splat at the origin of its group. */
function singleCluster(color: [number, number, number], radius: number): Clusters {
  return {
    positions: new Float32Array([0, 0, 0]),
    radii: new Float32Array([radius]),
    colors: new Float32Array(color),
    atomCounts: new Int32Array([1]),
    count: 1,
    gridDim: 1,
  };
}

const LAYER_IDS = ['glyphs', 'clusters', 'transmission', 'billion', 'cell'] as const;
type LayerId = (typeof LAYER_IDS)[number];

/** `&layers=glyphs,cell` mounts a subset (manual debugging); all by default. */
function requestedLayers(): ReadonlySet<LayerId> {
  const param = new URLSearchParams(window.location.search).get('layers');
  if (!param) return new Set(LAYER_IDS);
  return new Set(LAYER_IDS.filter((id) => param.split(',').includes(id)));
}

function GlyphLayer() {
  const glyphFrame = useMemo(() => frameOf([0, 0, 0], [6], { vx: [1], vy: [0], vz: [0] }), []);
  // viridis(1) = (253,231,37), coolwarm(1) = (180,4,38)
  useHarnessProbe('glyph viridis head', [GLYPH_LEFT_X + GLYPH_HEAD_AT * GLYPH_LENGTH, GLYPH_Y, 0], { rgb: [253, 231, 37], tol: 8 });
  useHarnessProbe('glyph coolwarm head', [GLYPH_RIGHT_X + GLYPH_HEAD_AT * GLYPH_LENGTH, GLYPH_Y, 0], { rgb: [180, 4, 38], tol: 8 });
  useHarnessProbe('glyph gap', [0, GLYPH_Y, 0], 'plate');
  return (
    <>
      <group position={[GLYPH_LEFT_X, GLYPH_Y, 0]}>
        <VectorGlyphs frame={glyphFrame} field={FIELD} scale={GLYPH_SCALE} colormap="viridis" />
      </group>
      <group position={[GLYPH_RIGHT_X, GLYPH_Y, 0]}>
        <VectorGlyphs frame={glyphFrame} field={FIELD} scale={GLYPH_SCALE} colormap="coolwarm" />
      </group>
    </>
  );
}

function ClusterLayer() {
  const visibleCluster = useMemo(() => singleCluster([0.95, 0.6, 0.2], 0.35), []);
  const fadedCluster = useMemo(() => singleCluster([0.95, 0.6, 0.2], 0.35), []);
  useHarnessProbe('cluster visible (zoomed out)', [-CLUSTER_X, CLUSTER_Y, 0], 'not-plate');
  useHarnessProbe('cluster faded (zoomed in)', [CLUSTER_X, CLUSTER_Y, 0], 'plate');
  return (
    <>
      <group position={[-CLUSTER_X, CLUSTER_Y, 0]}>
        <AtomClusters clusters={visibleCluster} fadeNear={0} fadeFar={1} />
      </group>
      <group position={[CLUSTER_X, CLUSTER_Y, 0]}>
        <AtomClusters clusters={fadedCluster} fadeNear={40} fadeFar={120} />
      </group>
    </>
  );
}

function TransmissionLayer() {
  const transmissionFrame = useMemo(
    () => frameOf([-TRANSMISSION_X, 0, 0, TRANSMISSION_X, 0, 0], [8, 6]),
    [],
  );
  const cardMaterial = useMemo(() => new THREE.MeshBasicNodeMaterial({ color: '#ffffff' }), []);
  useEffect(() => () => cardMaterial.dispose(), [cardMaterial]);
  // O tints the refracted white card red; C stays neutral.
  useHarnessProbe('transmission O atom', [-TRANSMISSION_X, TRANSMISSION_Y, 0], { family: 'O' });
  useHarnessProbe('transmission C atom', [TRANSMISSION_X, TRANSMISSION_Y, 0], { family: 'C' });
  // A physical material runs its lighting model (and with it the
  // transmission backdrop) only when the scene has lights or an environment.
  return (
    <group position={[0, TRANSMISSION_Y, 0]}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[-3, 4, 2]} intensity={1.5} />
      <mesh position={[0, 0, -0.6]} material={cardMaterial}>
        <planeGeometry args={[2, 0.9]} />
      </mesh>
      <AtomsTransmission frame={transmissionFrame} atomColorSource="element" scale={0.6} />
    </group>
  );
}

function BillionLayer() {
  useHarnessProbe('billion bricks', [0, BILLION_Y, 0.4], 'not-plate');
  return (
    <group position={[0, BILLION_Y, 0]} scale={BILLION_SCALE}>
      {/* The block's LOD runs on the world camera against unscaled brick
          centres; these distances put bricks in every tier from z = 5. */}
      <BillionAtomBlock maxAtomBricks={1} lodDistances={[0.5, 1.05, 1.5]} />
    </group>
  );
}

function CellLayer() {
  const cellBounds = useMemo(
    () => Array.from({ length: CELL_STACK }, (_, k) => {
      const bounds = Float64Array.from(CELL_BOUNDS);
      bounds[3] -= k * CELL_STEP;
      return bounds;
    }),
    [],
  );
  // The middle of the stacked top-front edge band.
  useHarnessProbe('cell top edge', [0, CELL_BOUNDS[3] - ((CELL_STACK - 1) / 2) * CELL_STEP, CELL_BOUNDS[5]], 'not-plate');
  return (
    <>
      {cellBounds.map((bounds, k) => (
        <SimulationCell key={k} bounds={bounds} color="#d5ef9c" opacity={1} />
      ))}
    </>
  );
}

function Assertions({ layers }: { layers: ReadonlySet<LayerId> }) {
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const release = harnessHold('secondary layers');
    let frames = 0;
    let handle = 0;
    const judge = () => {
      // A few frames in: the billion block classifies its bricks per frame.
      if (++frames < 3) {
        handle = requestAnimationFrame(judge);
        return;
      }
      const glsl: string[] = [];
      let transmission: THREE.Material | null = null;
      const tiers = new Map<string, number>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.material) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!(material as THREE.NodeMaterial).isNodeMaterial) glsl.push(`${object.type}:${material.type}`);
          if ((material as { isMeshTransmissionMaterial?: boolean }).isMeshTransmissionMaterial) transmission = material;
          if (material.name.startsWith('lupi-billion-brick-')) {
            tiers.set(material.name, (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount);
          }
        }
      });
      harnessAssert('every material is a node material', glsl.length === 0, glsl.join(', ') || 'none left');
      if (layers.has('transmission')) {
        harnessAssert(
          'transmission atoms use MeshTransmissionMaterial',
          transmission !== null && (transmission as THREE.NodeMaterial).isNodeMaterial === true,
          transmission ? (transmission as THREE.Material).type : 'not found',
        );
      }
      if (layers.has('billion')) {
        const counts = [...tiers.entries()].map(([name, count]) => `${name}=${count}`).join(' ');
        harnessAssert(
          'billion block draws all four LOD tiers',
          tiers.size === 4 && [...tiers.values()].every((count) => count > 0),
          counts,
        );
      }
      release();
    };
    handle = requestAnimationFrame(judge);
    return () => {
      cancelAnimationFrame(handle);
      release();
    };
  }, [scene, layers]);
  return null;
}

export default function GlyphsCase() {
  const [layers] = useState(requestedLayers);
  return (
    <>
      {layers.has('glyphs') && <GlyphLayer />}
      {layers.has('clusters') && <ClusterLayer />}
      {layers.has('transmission') && <TransmissionLayer />}
      {layers.has('billion') && <BillionLayer />}
      {layers.has('cell') && <CellLayer />}
      <Assertions layers={layers} />
    </>
  );
}
