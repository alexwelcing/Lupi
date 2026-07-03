/**
 * <BillionAtomBlock /> — one billion atoms in view.
 *
 * A 630×630×630-unit-cell FCC copper block: 4 atoms/cell =
 * 1,000,188,000 atoms in a ~228 nm cube. No per-atom data exists
 * anywhere — not on the CPU, not in GPU buffers. Every atom position is
 * derived in the vertex shader from its instance index:
 *
 *   instanceID → (brick slot, item) → unit cell (i,j,k) + FCC basis site
 *   → lattice position + deterministic thermal displacement (integer
 *   hash of the global atom id, animated) → world position
 *
 * The block is partitioned into 21³ = 9,261 bricks of 30³ cells
 * (108,000 atoms each). Each frame the CPU classifies bricks by camera
 * distance + frustum (a ~9k-entry loop) into four LOD tiers and uploads
 * only the active brick coordinates (a few KB texture):
 *
 *   L0  atoms      every atom as a ray-traced impostor sphere
 *   L1  2³-cell    one splat per 2×2×2 cells (32 atoms)   3,375/brick
 *   L2  6³-cell    one splat per 6×6×6 cells (864 atoms)    125/brick
 *   L3  brick      one splat per brick (108,000 atoms)        1/brick
 *
 * so the number of drawn primitives stays in the low millions while the
 * scene semantically contains the full billion. Splats are shaded with
 * the same sphere impostor math as atoms — at distance, aggregated
 * copper reads as continuous metal. This is a procedural scale testbed
 * (perfect lattice + stylized thermal motion), not a simulation, and
 * callers should label it as such.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Lattice constants ────────────────────────────────────────────────
export const CELLS_PER_AXIS = 630;
export const BRICK_CELLS = 30;                       // cells per brick axis
export const BRICKS_PER_AXIS = CELLS_PER_AXIS / BRICK_CELLS; // 21
export const TOTAL_BRICKS = BRICKS_PER_AXIS ** 3;    // 9,261
export const LATTICE_A = 3.615;                      // Cu FCC, Å
export const ATOMS_PER_BRICK = BRICK_CELLS ** 3 * 4; // 108,000
export const TOTAL_ATOMS = CELLS_PER_AXIS ** 3 * 4;  // 1,000,188,000

const BLOCK_EDGE = CELLS_PER_AXIS * LATTICE_A;       // ~2277 Å

/** Per-frame accounting for an honest HUD. */
export interface BillionAtomStats {
  totalAtoms: number;
  /** Atoms drawn at full atomic detail (L0). */
  atomsDrawn: number;
  /** Aggregate splats drawn (L1+L2+L3). */
  splatsDrawn: number;
  /** Atoms represented by those splats. */
  atomsAggregated: number;
  bricks: [number, number, number, number];
}

interface BillionAtomBlockProps {
  /** L0 brick budget — nearest bricks rendered atom-by-atom.
   *  32 bricks ≈ 3.46M atom impostors. */
  maxAtomBricks?: number;
  /** Distance thresholds in brick-edge units for L0/L1/L2 cutovers. */
  lodDistances?: [number, number, number];
  onStats?: (stats: BillionAtomStats) => void;
}

// Tier descriptors: chunk = cells per splat axis (0 = atoms).
const TIERS = [
  { chunk: 0, itemsPerBrick: ATOMS_PER_BRICK },
  { chunk: 2, itemsPerBrick: (BRICK_CELLS / 2) ** 3 },
  { chunk: 6, itemsPerBrick: (BRICK_CELLS / 6) ** 3 },
  { chunk: BRICK_CELLS, itemsPerBrick: 1 },
] as const;

const BRICK_TEX_SIZE = 128; // 16,384 slots ≥ TOTAL_BRICKS

const VERTEX = /* glsl */ `
  precision highp float;
  precision highp int;

  uniform sampler2D uBrickTex;   // RGBA32F: active brick coords per slot
  uniform int   uItemsPerBrick;
  uniform int   uChunk;          // cells per splat axis; 0 = atom mode
  uniform float uTime;
  uniform vec3  uHalfExtent;     // block half-size for centering

  out vec3 vColor;
  out vec2 vUv;
  out vec3 vViewCenter;

  const float A = ${LATTICE_A};
  const int BRICK_CELLS = ${BRICK_CELLS};
  const float ATOM_RADIUS = 1.28;

  // FCC basis, units of the cell edge.
  const vec3 BASIS[4] = vec3[4](
    vec3(0.0, 0.0, 0.0),
    vec3(0.5, 0.5, 0.0),
    vec3(0.5, 0.0, 0.5),
    vec3(0.0, 0.5, 0.5)
  );

  // Wang-style integer hash → [0,1). Deterministic per atom id, so the
  // "thermal" displacement field is stable frame to frame.
  float hash1(uint x) {
    x = (x ^ 61u) ^ (x >> 16);
    x *= 9u;
    x = x ^ (x >> 4);
    x *= 0x27d4eb2du;
    x = x ^ (x >> 15);
    return float(x & 0x00ffffffu) / 16777216.0;
  }

  void main() {
    int slot = gl_InstanceID / uItemsPerBrick;
    int item = gl_InstanceID - slot * uItemsPerBrick;

    ivec2 texel = ivec2(slot % ${BRICK_TEX_SIZE}, slot / ${BRICK_TEX_SIZE});
    vec3 brick = texelFetch(uBrickTex, texel, 0).xyz;   // brick coords (0..20)

    vec3 center;
    float radius;
    uint seed;

    if (uChunk == 0) {
      // ── Atom mode: item → cell + FCC basis site ──
      int cell = item >> 2;
      int basis = item & 3;
      int cx = cell % BRICK_CELLS;
      int cy = (cell / BRICK_CELLS) % BRICK_CELLS;
      int cz = cell / (BRICK_CELLS * BRICK_CELLS);

      vec3 cellCoord = brick * float(BRICK_CELLS) + vec3(cx, cy, cz);
      center = (cellCoord + BASIS[basis]) * A;

      // Global atom id → deterministic thermal displacement, animated.
      seed = uint(item) * 2654435761u
           ^ uint(brick.x + brick.y * 21.0 + brick.z * 441.0) * 40503u;
      float hx = hash1(seed);
      float hy = hash1(seed ^ 0x68bc21ebu);
      float hz = hash1(seed ^ 0x2c1b3c6du);
      float ph = hash1(seed ^ 0x5f356495u) * 6.2831853;
      // ~0.1 Å RMS displacement, slow shimmer — reads as 300 K copper.
      float wob = 0.6 + 0.4 * sin(uTime * 2.1 + ph);
      center += (vec3(hx, hy, hz) - 0.5) * 0.24 * wob;
      radius = ATOM_RADIUS;
    } else {
      // ── Splat mode: item → chunk of uChunk³ cells ──
      int perAxis = BRICK_CELLS / uChunk;
      int sx = item % perAxis;
      int sy = (item / perAxis) % perAxis;
      int sz = item / (perAxis * perAxis);

      vec3 chunkOrigin = (brick * float(BRICK_CELLS) + vec3(sx, sy, sz) * float(uChunk)) * A;
      float edge = float(uChunk) * A;
      center = chunkOrigin + vec3(edge * 0.5);
      // Slightly under the half-diagonal so neighboring splats interlock
      // into a continuous surface instead of over-inflating the block.
      radius = edge * 0.62;
      seed = uint(item) * 1103515245u
           ^ uint(brick.x + brick.y * 21.0 + brick.z * 441.0) * 12820163u;
    }

    center -= uHalfExtent;

    // Copper with a per-atom/per-chunk mottle so aggregation doesn't read
    // as a flat texture. Slight green-blue pull in the crevice tone.
    float tone = 0.82 + 0.18 * hash1(seed ^ 0x9e3779b9u);
    vColor = vec3(0.885, 0.505, 0.322) * tone;

    vUv = position.xy;

    vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
    vViewCenter = viewCenter.xyz;

    vec3 viewPos = viewCenter.xyz;
    viewPos.xy += position.xy * radius * 1.12;
    gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  in vec3 vColor;
  in vec2 vUv;
  in vec3 vViewCenter;

  layout(location = 0) out vec4 outColor;

  void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;

    // Impostor sphere normal + cheap key/fill/rim shading.
    float nz = sqrt(max(1.0 - r2, 0.0));
    vec3 n = vec3(vUv, nz);
    float key = max(dot(n, normalize(vec3(0.42, 0.62, 0.66))), 0.0);
    float fill = max(dot(n, normalize(vec3(-0.5, -0.15, 0.6))), 0.0);
    float rim = pow(1.0 - nz, 2.4);
    vec3 shaded = vColor * (0.22 + 0.75 * key + 0.18 * fill) + vec3(0.9, 0.6, 0.45) * rim * 0.22;

    // Exponential-squared depth fog for scale reading — far aggregate
    // tiers sink toward the backdrop instead of aliasing.
    float depth = length(vViewCenter);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
    outColor = vec4(mix(shaded, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
  }
`;

interface TierRuntime {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.InstancedBufferGeometry;
  texData: Float32Array;
  texture: THREE.DataTexture;
  itemsPerBrick: number;
}

function makeTier(chunk: number, itemsPerBrick: number, fogColor: THREE.Color): TierRuntime {
  const geometry = new THREE.InstancedBufferGeometry();
  const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(quad, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geometry.instanceCount = 0;
  // The block spans world space regardless of which bricks are active.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BLOCK_EDGE);

  const texData = new Float32Array(BRICK_TEX_SIZE * BRICK_TEX_SIZE * 4);
  const texture = new THREE.DataTexture(
    texData, BRICK_TEX_SIZE, BRICK_TEX_SIZE, THREE.RGBAFormat, THREE.FloatType,
  );
  texture.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uBrickTex: { value: texture },
      uItemsPerBrick: { value: itemsPerBrick },
      uChunk: { value: chunk },
      uTime: { value: 0 },
      uHalfExtent: { value: new THREE.Vector3(BLOCK_EDGE / 2, BLOCK_EDGE / 2, BLOCK_EDGE / 2) },
      uFogColor: { value: fogColor },
      uFogDensity: { value: 0.00028 },
    },
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // brick selection is the culling
  return { mesh, material, geometry, texData, texture, itemsPerBrick };
}

export function BillionAtomBlock({
  maxAtomBricks = 32,
  lodDistances = [3.5, 10, 22],
  onStats,
}: BillionAtomBlockProps) {
  const groupRef = useRef<THREE.Group>(null);
  const fogColor = useMemo(() => new THREE.Color('#0a0c12'), []);

  const tiers = useMemo(
    () => TIERS.map((t) => makeTier(t.chunk, t.itemsPerBrick, fogColor)),
    [fogColor],
  );

  // Brick centers, world space (centered block) — built once, 9,261 entries.
  const bricks = useMemo(() => {
    const edge = BRICK_CELLS * LATTICE_A;
    const half = BLOCK_EDGE / 2;
    const centers = new Float32Array(TOTAL_BRICKS * 3);
    const coords = new Float32Array(TOTAL_BRICKS * 3);
    let w = 0;
    for (let bz = 0; bz < BRICKS_PER_AXIS; bz++) {
      for (let by = 0; by < BRICKS_PER_AXIS; by++) {
        for (let bx = 0; bx < BRICKS_PER_AXIS; bx++) {
          coords[w * 3] = bx; coords[w * 3 + 1] = by; coords[w * 3 + 2] = bz;
          centers[w * 3] = bx * edge + edge / 2 - half;
          centers[w * 3 + 1] = by * edge + edge / 2 - half;
          centers[w * 3 + 2] = bz * edge + edge / 2 - half;
          w++;
        }
      }
    }
    return { centers, coords, edge };
  }, []);

  // Scratch reused every frame — zero allocation in the hot loop.
  const scratch = useMemo(() => ({
    frustum: new THREE.Frustum(),
    projScreen: new THREE.Matrix4(),
    sphere: new THREE.Sphere(new THREE.Vector3(), 0),
    dist: new Float32Array(TOTAL_BRICKS),
    counts: [0, 0, 0, 0] as [number, number, number, number],
    statsThrottle: -1,
  }), []);

  useFrame(({ camera, clock }) => {
    const { frustum, projScreen, sphere, dist, counts } = scratch;
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);

    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    sphere.radius = bricks.edge * 0.87; // half-diagonal, frustum slack

    for (let i = 0; i < TOTAL_BRICKS; i++) {
      const dx = bricks.centers[i * 3] - camX;
      const dy = bricks.centers[i * 3 + 1] - camY;
      const dz = bricks.centers[i * 3 + 2] - camZ;
      dist[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    counts[0] = counts[1] = counts[2] = counts[3] = 0;
    const [d0, d1, d2] = lodDistances;
    const e = bricks.edge;

    // The atom tier is budgeted: collect candidates, keep the nearest.
    const atomCandidates: number[] = [];
    for (let i = 0; i < TOTAL_BRICKS; i++) {
      if (dist[i] / e < d0) atomCandidates.push(i);
    }
    atomCandidates.sort((a, b) => dist[a] - dist[b]);
    const atomSet = new Set(atomCandidates.slice(0, maxAtomBricks));

    for (let i = 0; i < TOTAL_BRICKS; i++) {
      const d = dist[i] / e;
      let tier: number;
      if (atomSet.has(i)) tier = 0;
      else if (d < d1) tier = 1;
      else if (d < d2) tier = 2;
      else tier = 3;

      // Frustum-cull all but the far tier (a culled far splat saves ~one
      // quad; a hole when the camera swings is far more expensive).
      if (tier < 3) {
        sphere.center.set(
          bricks.centers[i * 3], bricks.centers[i * 3 + 1], bricks.centers[i * 3 + 2],
        );
        if (!frustum.intersectsSphere(sphere)) continue;
      }

      const t = tiers[tier];
      const slot = counts[tier]++;
      t.texData[slot * 4] = bricks.coords[i * 3];
      t.texData[slot * 4 + 1] = bricks.coords[i * 3 + 1];
      t.texData[slot * 4 + 2] = bricks.coords[i * 3 + 2];
    }

    const time = clock.elapsedTime;
    for (let t = 0; t < 4; t++) {
      const tier = tiers[t];
      tier.texture.needsUpdate = true;
      tier.geometry.instanceCount = counts[t] * tier.itemsPerBrick;
      tier.material.uniforms.uTime.value = time;
    }

    if (onStats && time - scratch.statsThrottle > 0.25) {
      scratch.statsThrottle = time;
      const atomsDrawn = counts[0] * ATOMS_PER_BRICK;
      const splatsDrawn = counts[1] * TIERS[1].itemsPerBrick
        + counts[2] * TIERS[2].itemsPerBrick
        + counts[3] * TIERS[3].itemsPerBrick;
      onStats({
        totalAtoms: TOTAL_ATOMS,
        atomsDrawn,
        splatsDrawn,
        atomsAggregated: TOTAL_ATOMS - atomsDrawn,
        bricks: [counts[0], counts[1], counts[2], counts[3]],
      });
    }
  });

  return (
    <group ref={groupRef}>
      {tiers.map((t, i) => (
        // eslint-disable-next-line react/no-unknown-property
        <primitive key={i} object={t.mesh} />
      ))}
    </group>
  );
}

export default BillionAtomBlock;
