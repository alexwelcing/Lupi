/**
 * bondImpostorMaterial.ts — the TSL ray-cast bond impostor (plan-final §5.8).
 *
 * One instanced box per bond, built in view space around the A→B segment in
 * the vertex stage. The fragment casts the view ray against the finite,
 * flat-capped cylinder (`rayCappedCylinder`), discards misses and faded-out
 * hits, writes the hit's depth (`depthNode`, D3) and shades it with the
 * impostor kit's `lupiSurface`. Port of the v9 GLSL BOND_IMPOSTOR_VERTEX /
 * BOND_IMPOSTOR_FRAGMENT (bondImpostor.ts before the port):
 * - the `uProgress` GPU lerp between two endpoint buffers per end;
 * - the display-motion offset (tsl/displayMotion.ts) on both ends, the same
 *   closed form and seed as the atoms, so bonds follow them; a bond the toys
 *   stretch thins like taffy and glows lime with the strain (a compressed
 *   one thickens a little), exactly as at rest while the motion is off;
 * - the two-tone split at the geometric midpoint;
 * - the distance fade (`uBondFadeStart`/`uBondFadeEnd`) times `uOpacity`;
 * - the Illustrate look (tsl/inkLook.ts): toon fills, ink along both edges,
 *   and thin bonds drawn as one ink stroke, mixed in by `uInkMix`;
 * - degenerate, sub-pixel and fully faded bonds collapse to a degenerate
 *   vertex (culling);
 * - orthographic cameras cast parallel rays (spike G11, D7).
 *
 * The box basis is right-handed, `(u, dir, cross(u, dir))` (spike G12): v9's
 * `cross(dir, u)` mirrored the box, so FrontSide drew its far faces.
 *
 * Instance layout (D4): endpoints and their targets as float32 ×3, the radius
 * as float32 ×1, and the endpoint colours as normalized Uint8×4 display-sRGB
 * bytes, decoded with `sRGBTransferEOTF` (WebGPU has no unorm8x3 format, and
 * a ×3 byte attribute is padded to ×4 on the CPU at every upload).
 *
 * Static frames and trajectories use different programs (`interpolate`), for
 * the same reason as the atoms (tsl/atomImpostorMaterial.ts): three r186's
 * WebGPU pipeline cache does not see whether two attribute names share one
 * buffer, so a program must never be drawn with both an aliased and a
 * separate target buffer. The static program never reads the targets.
 */
import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  attribute,
  cameraProjectionMatrix,
  clamp,
  cross,
  dot,
  float,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  normalize,
  positionGeometry,
  sRGBTransferEOTF,
  screenSize,
  select,
  smoothstep,
  sqrt,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { LUPI_SHADER_TAG_KEY, attachLupiUniforms, type LupiUniformBag } from './lupiUniforms';
import { DISPLAY_MOTION, lupiDisplayOffset } from './displayMotion';
import { ATOM_GLOW } from './atomGlow';
import { lupiFoilFinish, lupiFoilSweep } from './atomFoil';
import { INK_LOOK, INK_LOOK_TUNING, lupiInkSurface } from './inkLook';
import {
  cappedCylinderNormal,
  impostorDepthPrelude,
  lupiSurface,
  orthographicFlag,
  rayCappedCylinder,
  sphereOcclusion,
  viewRay,
  type LupiEnvBinding,
  type LupiLightUniforms,
} from './impostorKit';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** The instance attribute names (unchanged from v9). */
export const BOND_ATTR = {
  start: 'instanceStart',
  end: 'instanceEnd',
  startTarget: 'instanceStartTarget',
  endTarget: 'instanceEndTarget',
  radius: 'instanceRadius',
  colorStart: 'instanceColorStart',
  colorEnd: 'instanceColorEnd',
} as const;

/** Bytes per endpoint colour: display-sRGB RGB plus an unused 255. */
export const BOND_COLOR_STRIDE = 4;

/** The box half-width in radii: slightly conservative under float rounding. */
export const BOND_BOX_EXPAND = 1.05;

/** The v9 fade distances (view units): full strength before, gone after. */
export const BOND_FADE_START = 60;
export const BOND_FADE_END = 200;

/** Write one display-sRGB colour (components 0..1) as a Uint8×4 word. */
export function writeBondColor(
  out: Uint8Array,
  i: number,
  rgb: readonly [number, number, number],
): void {
  const base = i * BOND_COLOR_STRIDE;
  out[base] = Math.round(Math.max(0, Math.min(1, rgb[0])) * 255);
  out[base + 1] = Math.round(Math.max(0, Math.min(1, rgb[1])) * 255);
  out[base + 2] = Math.round(Math.max(0, Math.min(1, rgb[2])) * 255);
  out[base + 3] = 255;
}

export interface BondImpostorUniforms extends LupiUniformBag {
  /** GPU interpolation progress, 0..1 (clamped by the caller). */
  uProgress: UniformNode<'float', number>;
  /** Base metalness and roughness from the look preset (`bondMaterialParams`). */
  uMetalness: UniformNode<'float', number>;
  uRoughness: UniformNode<'float', number>;
  uSurfaceRoughness: UniformNode<'float', number>;
  uSurfacePolish: UniformNode<'float', number>;
  uSurfaceClearcoat: UniformNode<'float', number>;
  /** Output alpha; used only while the material is transparent. */
  uOpacity: UniformNode<'float', number>;
  uBondFadeStart: UniformNode<'float', number>;
  uBondFadeEnd: UniformNode<'float', number>;
  /** Bonds projecting under this many device pixels are culled. */
  uCullPixelRadius: UniformNode<'float', number>;
  /**
   * Radius of the atom spheres at the bond ends, for junction occlusion (the
   * stick darkens where it enters the ball). 0 disables it.
   */
  uJunctionRadius: UniformNode<'float', number>;
  uJunctionStrength: UniformNode<'float', number>;
}

/** The uniform bag shared by every tier's material of one bond layer (v9 defaults). */
export function createBondImpostorUniforms(): BondImpostorUniforms {
  return {
    uProgress: uniform(0),
    uMetalness: uniform(0.35),
    uRoughness: uniform(0.45),
    uSurfaceRoughness: uniform(0),
    uSurfacePolish: uniform(0),
    uSurfaceClearcoat: uniform(0),
    uOpacity: uniform(1),
    uBondFadeStart: uniform(BOND_FADE_START),
    uBondFadeEnd: uniform(BOND_FADE_END),
    uCullPixelRadius: uniform(0),
    uJunctionRadius: uniform(0),
    uJunctionStrength: uniform(0),
  };
}

export interface BondImpostorMaterialOptions {
  tier: 0 | 1 | 2;
  /**
   * Lerp the endpoints toward their targets by `uProgress`. Only for
   * geometries whose targets are their own buffers (see the file header).
   */
  interpolate?: boolean;
  /** From `createBondImpostorUniforms`; shared by the tiers of one layer. A fresh bag when omitted. */
  uniforms?: BondImpostorUniforms;
  lights: LupiLightUniforms;
  env: LupiEnvBinding;
}

/**
 * Build the bond impostor node material for one quality tier: tier 0 is the
 * analytic environment only, tier 1 adds image-based lighting, tier 2 adds
 * clearcoat (v9 LUPI_QUALITY).
 */
export function createBondImpostorMaterial({
  tier,
  interpolate = false,
  uniforms = createBondImpostorUniforms(),
  lights,
  env,
}: BondImpostorMaterialOptions): THREE.MeshBasicNodeMaterial {
  const u = uniforms as unknown as Record<keyof BondImpostorUniforms, N>;
  const isOrtho: N = orthographicFlag().isOrtho;

  // ── Vertex stage ────────────────────────────────────────────────────
  const start: N = attribute(BOND_ATTR.start, 'vec3');
  const end: N = attribute(BOND_ATTR.end, 'vec3');
  const restA: N = interpolate ? mix(start, attribute(BOND_ATTR.startTarget, 'vec3'), u.uProgress) : start;
  const restB: N = interpolate ? mix(end, attribute(BOND_ATTR.endTarget, 'vec3'), u.uProgress) : end;
  // Display-only motion: each end is a bit-exact copy of its atom's position,
  // so the same closed form and seed move it with the atom (a collapsed stale
  // bond, b = a, stays degenerate). Exactly zero at rest and in captures.
  const a: N = restA.add(lupiDisplayOffset(restA, start));
  const b: N = restB.add(lupiDisplayOffset(restB, end));
  const viewA: N = modelViewMatrix.mul(vec4(a, 1.0)).xyz;
  const viewB: N = modelViewMatrix.mul(vec4(b, 1.0)).xyz;
  const axis: N = viewB.sub(viewA);
  const len: N = length(axis);
  // Strain under display motion (stretched > 0): the bond thins as 1/√(1+ε)
  // (taffy keeps its volume) and glows with tension. With the motion off
  // (at rest, every capture) it is exactly 0 and the radius exactly as set.
  const motionLive: N = (DISPLAY_MOTION.uMotionWeight as N).greaterThan(0);
  const restLen: N = length(restB.sub(restA));
  const strain: N = select(motionLive, length(b.sub(a)).div(max(restLen, 1e-4)).sub(1), float(0));
  const thin: N = select(motionLive, clamp(float(1).div(sqrt(max(strain.add(1), 0.05))), 0.45, 1.3), float(1));
  const radius: N = attribute(BOND_ATTR.radius, 'float').mul(thin);
  const mid: N = viewA.add(viewB).mul(0.5);
  const viewDepth: N = max(mid.z.negate(), 1e-4);
  // Device pixels per world unit at unit depth: |P[1][1]| × target height / 2.
  // screenSize follows the bound render target (capture at any size).
  // `.element()` exists at runtime; @types/three 0.186 lacks it (G13).
  const pixelScale: N = abs((cameraProjectionMatrix as N).element(1).y).mul(screenSize.y).mul(0.5);
  const pixelRadius: N = select(isOrtho, radius.mul(pixelScale), radius.mul(pixelScale).div(viewDepth));
  // Degenerate, sub-pixel or fully faded bonds collapse to nothing.
  const culled: N = len
    .lessThanEqual(1e-6)
    .or(radius.lessThanEqual(0.0))
    .or(pixelRadius.lessThan(u.uCullPixelRadius))
    .or(viewDepth.greaterThan(u.uBondFadeEnd));

  const dir: N = axis.div(max(len, 1e-6));
  const ref: N = select(abs(dir.y).lessThan(0.99), vec3(0, 1, 0), vec3(1, 0, 0));
  const bu: N = normalize(cross(dir, ref));
  // Right-handed (bu, dir, bv): the box keeps the unit box's outward CCW
  // winding, so FrontSide rasterizes the near faces (G12).
  const bv: N = cross(bu, dir);
  const expand: N = radius.mul(BOND_BOX_EXPAND);
  const p: N = positionGeometry;
  const corner: N = mix(viewA, viewB, p.y.mul(0.5).add(0.5))
    .add(bu.mul(p.x.mul(expand)))
    .add(bv.mul(p.z.mul(expand)));
  const clip: N = cameraProjectionMatrix.mul(vec4(corner, 1.0));

  const vA: N = varying(viewA, 'vBondA');
  const vB: N = varying(viewB, 'vBondB');
  const vRadius: N = varying(radius, 'vBondRadius');
  const vViewPos: N = varying(corner, 'vBondViewPos');
  const vColorA: N = varying(sRGBTransferEOTF(attribute(BOND_ATTR.colorStart, 'vec4').rgb), 'vBondColorA');
  const vColorB: N = varying(sRGBTransferEOTF(attribute(BOND_ATTR.colorEnd, 'vec4').rgb), 'vBondColorB');
  const vPixelRadius: N = varying(pixelRadius, 'vBondPixelRadius');
  const vStrain: N = varying(strain, 'vBondStrain');
  const vFoilSweep: N = varying(lupiFoilSweep(mid), 'vBondFoilSweep');

  // ── Fragment ────────────────────────────────────────────────────────
  // Distance fade (LOD): far bonds thin out before the vertex cull drops them.
  const fadeAt = (viewZ: N): N => smoothstep(u.uBondFadeStart, u.uBondFadeEnd, viewZ.negate()).oneMinus();

  // The hit is built once and first materialized by the depth prelude, which
  // three sets up before the colour (G1/G2). A fully faded hit counts as a
  // miss, so the prelude discards it too.
  const hit: N = (Fn(() => {
    const { ro, rd } = viewRay(vViewPos, isOrtho);
    const cylinder = (rayCappedCylinder(ro, rd, vA, vB, vRadius) as N).toVar();
    const fade = fadeAt(cylinder.z).toVar();
    return vec4(cylinder.xyz, select(fade.lessThanEqual(0.001), float(-1), cylinder.w));
  }) as N)().toVar('bondHit');

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = `lupi-bond-impostor-t${tier}${interpolate ? '-lerp' : ''}`;
  material.side = THREE.FrontSide;
  material.fog = false;
  material.transparent = false;
  material.depthTest = true;
  material.depthWrite = true;

  material.vertexNode = select(culled, vec4(2.0, 2.0, 2.0, 1.0), clip);
  material.depthNode = impostorDepthPrelude(hit, isOrtho);

  material.colorNode = (Fn(() => {
    const segLen = length(vB.sub(vA)).toVar();
    const ax = vB.sub(vA).div(max(segLen, 1e-6)).toVar();
    const axial = dot(hit.xyz.sub(vA), ax).toVar();
    const normal = (cappedCylinderNormal(hit, vA, vB) as N).toVar();
    // Two-tone split at the geometric midpoint.
    const baseColor = select(axial.lessThan(segLen.mul(0.5)), vColorA, vColorB).toVar();
    // Junction occlusion: the end atoms as spheres around the hit point.
    const junction = float(1).toVar();
    If(u.uJunctionRadius.greaterThan(0.0).and(u.uJunctionStrength.greaterThan(0.0)), () => {
      const p = hit.xyz.toVar();
      const occ = (sphereOcclusion(p, normal, vA, u.uJunctionRadius) as N)
        .add(sphereOcclusion(p, normal, vB, u.uJunctionRadius));
      junction.assign(float(1).sub(min(occ.mul(u.uJunctionStrength), 0.82)));
    });
    // Tension glow (lime): zero unless display motion stretches the bond.
    const strainGlow = vec3(ATOM_GLOW.uGlowColor as N).mul(smoothstep(0.03, 0.4, vStrain).mul(0.75)).toVar();
    // The lit surface, the Illustrate surface (tsl/inkLook.ts), or a blend
    // while the look fades; uniform branches, as on the atoms.
    const inkMix: N = INK_LOOK.uInkMix as N;
    const lit = vec3(0).toVar();
    If(inkMix.lessThan(1.0), () => {
      lit.assign(lupiSurface(
        {
          normal,
          baseColor,
          metalness: u.uMetalness,
          roughness: u.uRoughness.add(u.uSurfaceRoughness),
          clearcoat: u.uSurfaceClearcoat,
          polish: u.uSurfacePolish,
          occlusion: junction,
          occlusionStrength: float(1),
          emission: strainGlow,
          pixelRadius: vPixelRadius,
          subsurface: float(0),
        },
        lights,
        env,
        tier,
      ) as N);
    });
    If(inkMix.greaterThan(0.0), () => {
      // The silhouette runs along both sides: measure across the stick, in
      // the plane square to its axis. Caps (and a stick seen end-on) have none.
      const inkEye: N = select(isOrtho, vec3(0.0, 0.0, 1.0), normalize(hit.xyz.negate())).toVar();
      const across: N = inkEye.sub(ax.mul(dot(inkEye, ax))).toVar();
      const acrossLength: N = length(across).toVar();
      const facing: N = clamp(abs(dot(normal, across.div(max(acrossLength, 1e-4)))), 0.0, 1.0).toVar();
      const sideEdge: N = vPixelRadius.mul(float(1).sub(sqrt(max(float(1).sub(facing.mul(facing)), 0.0))));
      const edgePx: N = select(hit.w.greaterThan(0.5).or(acrossLength.lessThan(0.05)), float(1e4), sideEdge);
      const ink = lupiInkSurface(
        {
          normal,
          baseColor,
          occlusion: junction,
          pixelRadius: vPixelRadius,
          edgePx,
          lineWidth: INK_LOOK_TUNING.bondLine,
          hit: hit.xyz,
          isOrtho,
          emission: strainGlow,
          thinSolid: true,
        },
        lights,
      ) as N;
      lit.assign(mix(lit, ink, clamp(inkMix, 0.0, 1.0)));
    });
    // Foil: gilded edges and the same finish as the atoms (none in captures,
    // and none under the Illustrate look, which is a drawing).
    const toEye: N = select(isOrtho, vec3(0.0, 0.0, 1.0), normalize(hit.xyz.negate()));
    const finished: N = lupiFoilFinish({
      lit,
      normal,
      facing: dot(normal, toEye),
      keyLightDir: lights.lightDir,
      pixelRadius: vPixelRadius,
      sweep: vFoilSweep,
      bond: true,
      mute: inkMix,
    });
    return vec4(finished, u.uOpacity.mul(fadeAt(hit.z)));
  }) as N)();

  attachLupiUniforms(material, uniforms);
  material.userData[LUPI_SHADER_TAG_KEY] = 'bond-impostor';
  return material;
}
