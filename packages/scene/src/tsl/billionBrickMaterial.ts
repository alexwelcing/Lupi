/**
 * billionBrickMaterial.ts — the procedural FCC lattice of <BillionAtomBlock />
 * as a TSL node material (port of the v9 GLSL3 ShaderMaterial).
 *
 * No per-atom data exists: the vertex stage derives every atom (or splat)
 * from `instanceIndex`:
 *
 *   instanceIndex → (brick slot, item) → brick coords (a texel of the active
 *   brick texture) → unit cell + FCC basis site (atom tier) or a chunk of
 *   `chunk`³ cells (splat tiers) → lattice position (+ deterministic,
 *   animated thermal displacement for atoms) → view-aligned quad.
 *
 * One factory builds all four LOD tiers; `chunk` (0 = atoms) and
 * `itemsPerBrick` specialize the graph at build time, so there is no runtime
 * branch (a TSL `select` lowers to if/else; spike G1).
 *
 * Portability (both WGSL and GLSL ES 3.0):
 * - integer maths is `uint` only, with explicit `uint()` constants (a JS number
 *   is a float node and would turn the operation into float maths); unsigned
 *   multiplication wraps modulo 2³² on both backends, which the hash relies on;
 * - the brick texture is RGBA32F, unfilterable on WebGPU, so it is read with
 *   `textureLoad` (no sampler) in the vertex stage;
 * - the FCC basis table is arithmetic (`step`), not an indexed const array.
 *
 * Colour: v9 shaded in display space and wrote the result raw; the port keeps
 * that shading, decodes it to linear and fogs toward the (linear) backdrop
 * colour, so the renderer output (D14) shows the same copper and the far tiers
 * sink into the page background.
 */
import * as THREE from 'three/webgpu';
import type { TextureNode, UniformNode } from 'three/webgpu';
import {
  Discard,
  Fn,
  cameraProjectionMatrix,
  clamp,
  dot,
  exp,
  float,
  instanceIndex,
  int,
  ivec2,
  length,
  max,
  mix,
  modelViewMatrix,
  normalize,
  positionGeometry,
  pow,
  sRGBTransferEOTF,
  sin,
  sqrt,
  step,
  texture,
  uint,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { LUPI_SHADER_TAG_KEY, attachLupiUniforms, type LupiUniformBag } from './lupiUniforms';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** Lattice geometry the shader bakes in (owned by BillionAtomBlock). */
export interface BillionLattice {
  /** FCC lattice constant, Å. */
  latticeA: number;
  /** Cells per brick axis. */
  brickCells: number;
  /** Bricks per block axis. */
  bricksPerAxis: number;
  /** Side of the square brick-slot texture (a power of two). */
  brickTexSize: number;
  /** Block edge length (the block is centred on the origin). */
  blockEdge: number;
}

/** Uniforms shared by the four tier materials of one block. */
export interface BillionBrickSharedUniforms extends LupiUniformBag {
  /** Seconds; drives the thermal shimmer. */
  uTime: UniformNode<'float', number>;
  /** Linear fog / backdrop colour. */
  uFogColor: UniformNode<'color', THREE.Color>;
  uFogDensity: UniformNode<'float', number>;
}

export interface BillionBrickUniforms extends BillionBrickSharedUniforms {
  /** RGBA32F brick-slot texture node: xyz = active brick coords per slot. */
  uBrickTex: TextureNode;
}

export function createBillionBrickSharedUniforms(fogColor: THREE.ColorRepresentation): BillionBrickSharedUniforms {
  return {
    uTime: uniform(0),
    uFogColor: uniform(new THREE.Color(fogColor)),
    uFogDensity: uniform(0.00028),
  };
}

/** The brick-slot texture: `size`² RGBA32F texels, nearest, no mipmaps. */
export function createBrickSlotTexture(size: number): { texture: THREE.DataTexture; data: Float32Array } {
  const data = new Float32Array(size * size * 4);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { texture: tex, data };
}

const ATOM_RADIUS = 1.28;
/** Quad half-size in radii (v9). */
const QUAD_SCALE = 1.12;

/**
 * Wang-style integer hash → [0, 1). Deterministic per atom id, so the
 * "thermal" displacement field is stable frame to frame.
 */
const hash1 = (Fn(([x0]: [N]) => {
  const x = (x0 as N).toVar();
  x.assign(x.bitXor(uint(61)).bitXor(x.shiftRight(uint(16))));
  x.assign(x.mul(uint(9)));
  x.assign(x.bitXor(x.shiftRight(uint(4))));
  x.assign(x.mul(uint(0x27d4eb2d)));
  x.assign(x.bitXor(x.shiftRight(uint(15))));
  return float(x.bitAnd(uint(0x00ffffff))).div(16777216.0);
}) as N).setLayout({
  name: 'lupiBillionHash',
  type: 'float',
  inputs: [{ name: 'x', type: 'uint' }],
}) as (x: N) => N;

export interface BillionBrickMaterialOptions {
  /** Cells per splat axis; 0 = one quad per atom. */
  chunk: number;
  /** Instances per active brick (atoms, or splats). */
  itemsPerBrick: number;
  lattice: BillionLattice;
  brickTexture: THREE.DataTexture;
  shared: BillionBrickSharedUniforms;
}

export function createBillionBrickMaterial({
  chunk,
  itemsPerBrick,
  lattice,
  brickTexture,
  shared,
}: BillionBrickMaterialOptions): { material: THREE.MeshBasicNodeMaterial; uniforms: BillionBrickUniforms } {
  const { latticeA: A, brickCells: cells, bricksPerAxis, brickTexSize, blockEdge } = lattice;
  if (!Number.isInteger(Math.log2(brickTexSize))) throw new Error(`brick texture size ${brickTexSize} is not a power of two`);
  if (chunk > 0 && cells % chunk !== 0) throw new Error(`chunk ${chunk} does not divide the ${cells}-cell brick`);

  const uniforms: BillionBrickUniforms = {
    ...shared,
    uBrickTex: texture(brickTexture) as unknown as TextureNode,
  };
  const u = uniforms as unknown as Record<keyof BillionBrickUniforms, N>;

  // ── Vertex stage ────────────────────────────────────────────────────
  const perBrick: N = uint(itemsPerBrick);
  const slot: N = (instanceIndex as N).div(perBrick);
  const item: N = (instanceIndex as N).sub(slot.mul(perBrick));

  const texel: N = ivec2(int(slot.bitAnd(uint(brickTexSize - 1))), int(slot.shiftRight(uint(Math.log2(brickTexSize)))));
  const brick: N = (u.uBrickTex.load(texel) as N).xyz; // brick coords (0 .. bricksPerAxis-1)
  const brickId: N = uint(brick.x.add(brick.y.mul(bricksPerAxis)).add(brick.z.mul(bricksPerAxis * bricksPerAxis)));

  let center: N;
  let radius: N;
  let seed: N;
  if (chunk === 0) {
    // Atom tier: item → cell + FCC basis site.
    const cell: N = item.shiftRight(uint(2));
    const basis: N = float(item.bitAnd(uint(3)));
    const cx: N = cell.mod(uint(cells));
    const cy: N = cell.div(uint(cells)).mod(uint(cells));
    const cz: N = cell.div(uint(cells * cells));
    const cellCoord: N = brick.mul(cells).add(vec3(float(cx), float(cy), float(cz)));
    // FCC basis in cell units: 0 (0,0,0), 1 (½,½,0), 2 (½,0,½), 3 (0,½,½).
    const is1: N = step(0.5, basis).mul(step(basis, 1.5));
    const is2: N = step(1.5, basis).mul(step(basis, 2.5));
    const is3: N = step(2.5, basis);
    const site: N = vec3(is1.add(is2), is1.add(is3), is2.add(is3)).mul(0.5);

    // Global atom id → deterministic thermal displacement, animated.
    seed = item.mul(uint(2654435761)).bitXor(brickId.mul(uint(40503)));
    const hx: N = hash1(seed);
    const hy: N = hash1(seed.bitXor(uint(0x68bc21eb)));
    const hz: N = hash1(seed.bitXor(uint(0x2c1b3c6d)));
    const phase: N = hash1(seed.bitXor(uint(0x5f356495))).mul(6.2831853);
    // ~0.1 Å RMS displacement, slow shimmer — reads as 300 K copper.
    const wobble: N = sin(u.uTime.mul(2.1).add(phase)).mul(0.4).add(0.6);
    center = cellCoord.add(site).mul(A).add(vec3(hx, hy, hz).sub(0.5).mul(0.24).mul(wobble));
    radius = float(ATOM_RADIUS);
  } else {
    // Splat tiers: item → chunk of chunk³ cells.
    const perAxis = cells / chunk;
    const sx: N = item.mod(uint(perAxis));
    const sy: N = item.div(uint(perAxis)).mod(uint(perAxis));
    const sz: N = item.div(uint(perAxis * perAxis));
    const chunkOrigin: N = brick.mul(cells).add(vec3(float(sx), float(sy), float(sz)).mul(chunk)).mul(A);
    const edge = chunk * A;
    center = chunkOrigin.add(edge * 0.5);
    // Slightly under the half-diagonal so neighbouring splats interlock into
    // a continuous surface instead of over-inflating the block.
    radius = float(edge * 0.62);
    seed = item.mul(uint(1103515245)).bitXor(brickId.mul(uint(12820163)));
  }
  center = center.sub(blockEdge / 2);

  // Copper with a per-atom/per-chunk mottle so aggregation doesn't read as a
  // flat texture.
  const tone: N = hash1(seed.bitXor(uint(0x9e3779b9))).mul(0.18).add(0.82);
  const color: N = vec3(0.885, 0.505, 0.322).mul(tone);

  const corner: N = positionGeometry.xy;
  const viewCenter: N = modelViewMatrix.mul(vec4(center, 1.0)).xyz;
  // Lattice units → view units (1 unless a parent scales the block; the view
  // matrix itself is rigid).
  const viewScale: N = length(modelViewMatrix.mul(vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  const quadView: N = vec3(viewCenter.xy.add(corner.mul(radius.mul(viewScale).mul(QUAD_SCALE))), viewCenter.z);

  const vColor: N = varying(color, 'vBrickColor');
  const vUv: N = varying(corner, 'vBrickUv');
  const vViewCenter: N = varying(viewCenter, 'vBrickViewCenter');

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = `lupi-billion-brick-${chunk === 0 ? 'atoms' : `chunk${chunk}`}`;
  material.side = THREE.DoubleSide;
  material.fog = false;
  material.transparent = false;
  material.depthTest = true;
  material.depthWrite = true;

  material.vertexNode = cameraProjectionMatrix.mul(vec4(quadView, 1.0));

  material.colorNode = (Fn(() => {
    const r2 = dot(vUv, vUv).toVar();
    Discard(r2.greaterThan(1.0));
    // Impostor sphere normal + cheap key/fill/rim shading.
    const nz = sqrt(max(r2.oneMinus(), 0.0)).toVar();
    const n = vec3(vUv, nz).toVar();
    const key = max(dot(n, normalize(vec3(0.42, 0.62, 0.66))), 0.0);
    const fill = max(dot(n, normalize(vec3(-0.5, -0.15, 0.6))), 0.0);
    const rim = pow(nz.oneMinus(), 2.4);
    const display = vColor
      .mul(key.mul(0.75).add(fill.mul(0.18)).add(0.22))
      .add(vec3(0.9, 0.6, 0.45).mul(rim).mul(0.22));
    // Exponential-squared depth fog for scale reading: far aggregate tiers
    // sink toward the backdrop instead of aliasing.
    const depth = length(vViewCenter);
    const density = u.uFogDensity.mul(depth);
    const fog = clamp(exp(density.mul(density).negate()).oneMinus(), 0.0, 1.0);
    const linear = sRGBTransferEOTF(clamp(display, 0.0, 1.0)) as N;
    const fogged = mix(linear, u.uFogColor, fog) as N;
    return vec4(fogged, 1.0);
  }) as N)();

  material.userData[LUPI_SHADER_TAG_KEY] = 'billion-brick';
  attachLupiUniforms(material, uniforms);
  return { material, uniforms };
}
