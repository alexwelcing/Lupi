/**
 * inkFuse.ts — the Light Fuse: the change between the lit surface and the
 * Illustrate look (tsl/inkLook.ts) travels through the molecule from a seed
 * atom like a lit fuse, instead of crossfading everywhere at once.
 *
 * - Hops: the viewer's ink driver gives every atom a hop, 0 at the seed and
 *   1 at the last atom the front reaches (bond steps through the drawn bond
 *   graph, or the distance from the seed; ui/src/ink/fuseHops.ts), and this
 *   module uploads them as an R32F texture indexed by atom (instances map 1:1
 *   onto atoms). Bonds read their two atoms' hops from a second texture,
 *   indexed by bond instance, and mix between them along the stick, so the
 *   front visibly runs down every bond.
 * - The edge is broken up like burning paper, after the Shaders NoiseDissolve
 *   (a 3-octave fbm coverage and a feathered front remapped so that progress
 *   0 and 1 are exact). The noise is taken at the hit point in the molecule's
 *   own space, so it sticks to the balls and sticks while the camera turns.
 * - Per fragment, `lupiFuse` returns the ink mix: `uFuseFrom` where the
 *   front has not arrived, `uFuseTo` where it has passed. With `uFuseActive`
 *   at 0 it returns exactly `clamp(uInkMix, 0, 1)`, behind one uniform branch.
 * - The ember: a thin band of the brand lime (FUSE_EMBER) rides the noisy
 *   front, wider on its light side, and fades in and out with the run. It
 *   reads the front's own progress, never time.
 * - The post recipe follows the front: each impostor fragment leaves its mix
 *   minus `uInkMix` in `LUPI_FUSE_OFFSET`, which the post chain's scene pass
 *   writes to its content target (ui postprocess/backgroundMask.ts), so AO,
 *   glow, defocus, tone mapping and vignette rest only where the ink is.
 *
 * The ink driver keeps `uInkMix` strictly between the two looks while a fuse
 * runs, so the impostors' uniform branches evaluate both surfaces; the mix
 * itself comes from here.
 *
 * Truth rules: the fuse is a look change in progress, never an artifact. The
 * capture guard below turns it off inside every capture render, where the ink
 * look's own guard has already set `uInkMix` to the configured look, so no
 * export, thumbnail or MCP raster carries a half-fused molecule or an ember
 * (the offset is then exactly 0).
 *
 * Module singletons, like inkLook's: one write reaches every atom and bond
 * impostor material.
 *
 * Adapted from Shaders (MIT), NoiseDissolve, packages/core/src/gpu/kit/reveal.ts
 * (`fbmCoverageCoord` and `revealMask`), in 3D and on the impostors' surface.
 */
import * as THREE from 'three/webgpu';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  cameraWorldMatrix,
  clamp,
  color,
  float,
  int,
  ivec2,
  max,
  mix,
  modelWorldMatrixInverse,
  mx_noise_float,
  property,
  select,
  smoothstep,
  texture,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { registerCaptureGuard } from '../captureGuards';
import { ATOM_GLOW_COLOR } from './atomGlow';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** Texels per row of the hop textures (atoms: one per atom; bonds: two per bond). */
export const FUSE_TEXTURE_WIDTH = 2048;

type FloatUniform = UniformNode<'float', number>;

export interface InkFuseUniforms {
  /** 1 while a fuse runs; exactly 0 otherwise and inside every capture render. */
  uFuseActive: FloatUniform;
  /** How far the front has burned, 0 (nothing reached) to 1 (everything passed). */
  uFuseFront: FloatUniform;
  /** Half-width of the front's soft edge, in normalised hops (NoiseDissolve's feather). */
  uFuseEdge: FloatUniform;
  /** How much the noise moves the front, 0 (a clean wavefront) to 1 (noise only). */
  uFuseNoise: FloatUniform;
  /** Noise cells per world unit. */
  uFuseScale: FloatUniform;
  /** The ink mix before the front arrives, and after it has passed (the direction). */
  uFuseFrom: FloatUniform;
  uFuseTo: FloatUniform;
  /** Per-atom hops (R32F, FUSE_TEXTURE_WIDTH wide). */
  tAtomHops: TextureNode;
  /** Per-bond-instance hops of its two atoms (R32F, two texels per bond). */
  tBondHops: TextureNode;
}

const f = (value: number) => uniform(value) as unknown as FloatUniform;

function hopTexture(rows: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Float32Array(FUSE_TEXTURE_WIDTH * rows),
    FUSE_TEXTURE_WIDTH,
    rows,
    THREE.RedFormat,
    THREE.FloatType,
  );
  tex.colorSpace = THREE.NoColorSpace;
  // Float textures are unfilterable on WebGPU; the shaders use textureLoad.
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** The shared fuse uniforms and hop textures (module singletons). */
export const INK_FUSE: InkFuseUniforms = {
  uFuseActive: f(0),
  uFuseFront: f(0),
  uFuseEdge: f(0.05),
  uFuseNoise: f(0.12),
  uFuseScale: f(1),
  uFuseFrom: f(0),
  uFuseTo: f(1),
  tAtomHops: texture(hopTexture(1)) as unknown as TextureNode,
  tBondHops: texture(hopTexture(1)) as unknown as TextureNode,
};

const F = INK_FUSE as unknown as Record<keyof InkFuseUniforms, N>;

/**
 * The ember (tuning points): a thin band of the brand lime on the front.
 * Widths are in front half-widths (`uFuseEdge`), so the band scales with
 * the edge: narrow on the ink side, wider on the side the light is on.
 */
export const FUSE_EMBER = {
  color: ATOM_GLOW_COLOR,
  /** Reach of the band into the light, and into the ink, in front half-widths. */
  lightWidth: 0.7,
  inkWidth: 0.22,
  /** How far the band's core turns toward the lime (0..1). */
  strength: 0.7,
  /** The lime's brightness at the core: a little above the surface, so it reads as a glow. */
  glow: 1.2,
  /** The band fades in over the run's first part and out over its last (progress). */
  fade: 0.12,
} as const;

/**
 * Each impostor fragment's ink mix minus `uInkMix`: 0 except where a Light
 * Fuse's front holds the fragment ahead of or behind the look's fade. Read
 * by the post chain's content output (ui postprocess/backgroundMask.ts);
 * every other material reads the placeholder, 0.
 */
export const LUPI_FUSE_OFFSET = property('float', 'LupiFuseOffset', float(0));

// ─── CPU: the hop textures ─────────────────────────────────────────────

let atomHops: Float32Array | null = null;
let bondPairs: ArrayLike<number> | null = null;

function rowsFor(texels: number): number {
  return Math.max(1, Math.ceil(texels / FUSE_TEXTURE_WIDTH));
}

/** The node's texture, grown (and the old one disposed) when `texels` no longer fit. */
function textureFor(node: TextureNode, texels: number): THREE.DataTexture {
  const current = node.value as THREE.DataTexture;
  const rows = rowsFor(texels);
  if (current.image.height >= rows) return current;
  const next = hopTexture(rows);
  node.value = next;
  current.dispose();
  return next;
}

function writeBondHops(): void {
  if (!atomHops || !bondPairs || bondPairs.length < 2) return;
  const pairs = bondPairs;
  const count = pairs.length >> 1;
  const tex = textureFor(INK_FUSE.tBondHops, count * 2);
  const data = tex.image.data as Float32Array;
  const hops = atomHops;
  for (let i = 0; i < count; i += 1) {
    const a = pairs[i * 2];
    const b = pairs[i * 2 + 1];
    data[i * 2] = a >= 0 && a < hops.length ? hops[a] : 1;
    data[i * 2 + 1] = b >= 0 && b < hops.length ? hops[b] : 1;
  }
  tex.needsUpdate = true;
}

/**
 * Upload the hops of the fuse about to run (one per atom, 0..1), or null
 * when none runs. The bonds' texture follows from the registered bond pairs.
 */
export function setInkFuseHops(hops: Float32Array | null): void {
  atomHops = hops;
  if (!hops) return;
  const tex = textureFor(INK_FUSE.tAtomHops, hops.length);
  const data = tex.image.data as Float32Array;
  data.set(hops);
  tex.needsUpdate = true;
  writeBondHops();
}

/**
 * The bond layer's drawn pairs, in instance order ([a0, b0, a1, b1, …]), or
 * null when no bonds are drawn. A change while a fuse runs rewrites the
 * bonds' hops at once.
 */
export function setInkFuseBondPairs(pairs: ArrayLike<number> | null): void {
  bondPairs = pairs;
  writeBondHops();
}

// Every capture renders the configured look (inkLook's guard sets uInkMix), never a fuse.
registerCaptureGuard({
  begin: () => {
    const saved = INK_FUSE.uFuseActive.value;
    INK_FUSE.uFuseActive.value = 0;
    return () => {
      INK_FUSE.uFuseActive.value = saved;
    };
  },
});

// ─── GPU ───────────────────────────────────────────────────────────────

function hopAt(textureNode: N, index: N): N {
  const coord = ivec2(index.mod(int(FUSE_TEXTURE_WIDTH)), index.div(int(FUSE_TEXTURE_WIDTH)));
  return (textureLoad(textureNode, coord) as N).x;
}

/** An atom's hop (its `instanceIndex` as a float varying). Read only inside the fuse's branch. */
export function lupiAtomFuseHop(atomId: Node): Node {
  return hopAt(F.tAtomHops, int((atomId as N).add(0.5)));
}

/** A bond fragment's hop: its two atoms' hops, mixed by `along` (0 at the start atom, 1 at the end). */
export function lupiBondFuseHop(bondId: Node, along: Node): Node {
  const first = int((bondId as N).add(0.5)).mul(int(2));
  return mix(hopAt(F.tBondHops, first), hopAt(F.tBondHops, first.add(int(1))), clamp(along as N, 0.0, 1.0));
}

/** A view-space point in the drawn object's own space, where the noise sticks. */
export function lupiFuseSurfacePoint(viewPoint: Node): Node {
  return (modelWorldMatrixInverse as N).mul((cameraWorldMatrix as N).mul(vec4(viewPoint as N, 1.0))).xyz;
}

/**
 * NoiseDissolve's coverage in 3D: a stable 3-octave Perlin fbm (MaterialX
 * noise) recentred onto [0, 1], with per-octave offsets that decorrelate them.
 */
function fbmCoverage(p: N): N {
  const n1 = mx_noise_float(p);
  const n2 = mx_noise_float(p.mul(2.0).add(vec3(17.3, 9.1, 5.3))).mul(0.5);
  const n3 = mx_noise_float(p.mul(4.0).add(vec3(41.7, 27.9, 13.1))).mul(0.25);
  const n = n1.add(n2).add(n3).div(1.75);
  return clamp(n.mul(0.9).add(0.5), 0.0, 1.0);
}

/**
 * The Light Fuse at one fragment: x, the ink mix; y, the ember (0 off the
 * front, up to FUSE_EMBER.strength on it). `hop` is read only while a fuse
 * runs (pass an unmaterialized node: it is built inside the branch).
 * `surface` is the fragment in the object's space (`lupiFuseSurfacePoint`).
 * Idle, the mix is exactly `clamp(inkMix, 0, 1)` and the ember 0. It also
 * leaves the fragment's offset from `inkMix` in LUPI_FUSE_OFFSET.
 */
export function lupiFuse(inkMix: Node, hop: Node, surface: Node): Node {
  return (Fn(() => {
    const look = clamp(inkMix as N, 0.0, 1.0).toVar();
    const mixed = look.toVar();
    const ember = float(0).toVar();
    If(F.uFuseActive.greaterThan(0.0), () => {
      // Coverage: when the front reaches this fragment, 0 (first) to 1 (last).
      // The hop orders it; the noise breaks up the edge. Both lie in [0, 1].
      const noise = fbmCoverage((surface as N).mul(F.uFuseScale));
      const coverage = mix(clamp(hop as N, 0.0, 1.0), noise, clamp(F.uFuseNoise, 0.0, 1.0));
      // NoiseDissolve's front, remapped by ±edge so that 0 and 1 are exact.
      const edge = max(F.uFuseEdge, 1e-4).toVar();
      const front = F.uFuseFront.mul(edge.mul(2.0).add(1.0)).sub(edge).toVar();
      const waiting = smoothstep(front.sub(edge), front.add(edge), coverage);
      mixed.assign(clamp(mix(F.uFuseTo, F.uFuseFrom, waiting), 0.0, 1.0));
      // The ember: how far past the front toward the light this fragment lies,
      // in edges (the light is behind the front when it burns toward light).
      const towardLight = select(F.uFuseTo.lessThan(F.uFuseFrom), float(-1.0), float(1.0));
      const ahead = coverage.sub(front).div(edge).mul(towardLight).toVar();
      const width = select(ahead.greaterThan(0.0), float(FUSE_EMBER.lightWidth), float(FUSE_EMBER.inkWidth));
      const band = float(1).sub(smoothstep(0.0, 1.0, abs(ahead).div(width)));
      const run = smoothstep(0.0, FUSE_EMBER.fade, F.uFuseFront)
        .mul(float(1).sub(smoothstep(1.0 - FUSE_EMBER.fade, 1.0, F.uFuseFront)));
      ember.assign(band.mul(run).mul(FUSE_EMBER.strength));
    });
    LUPI_FUSE_OFFSET.assign(mixed.sub(look));
    return vec2(mixed, ember);
  }) as N)();
}

const EMBER_RGB = new THREE.Color(FUSE_EMBER.color);

/** The ember over a finished fragment colour (exactly `rgb` where it is 0). */
export function lupiFuseEmber(rgb: Node, ember: Node): Node {
  return mix(rgb as N, (color(EMBER_RGB) as N).mul(FUSE_EMBER.glow), ember as N);
}
