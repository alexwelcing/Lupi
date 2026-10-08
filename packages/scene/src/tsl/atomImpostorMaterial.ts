/**
 * atomImpostorMaterial.ts — the TSL ray-cast atom impostor (plan-final §5.7).
 *
 * One view-aligned quad per atom instance, on the sphere's front tangent
 * plane and 1.3 radii wide. The fragment casts the view ray against the
 * sphere, discards misses, writes the hit's depth (`depthNode`, D3) and shades
 * the hit with the impostor kit's `lupiSurface`. Port of the v9 GLSL
 * IMPOSTOR_VERTEX / IMPOSTOR_FRAGMENT (AtomsOptimized.tsx before the port):
 * - type, uniform and property colour modes; property emission;
 * - per-element material palette blended toward a look preset;
 * - surface roughness/polish/clearcoat offsets; per-atom occlusion (the
 *   scalar density bake) and per-pixel contact occlusion (the neighbour bake,
 *   atomContactOcclusion.ts, plus bond stubs where bonds leave an atom);
 * - the etched-annotation stamp and (tier 2) the noise/scratched textures;
 * - the `uProgress` GPU lerp between two instance position buffers;
 * - the display-motion offset (tsl/displayMotion.ts) on the centre: arrival,
 *   ripple, scatter, tug, burst and heat, exactly zero at rest and in every
 *   capture; the morph arrival reads the atom's start at its instance index
 *   while the layer's `uMorphOn` gate is on;
 * - the hover, selection and grab glow and the heat tint (tsl/atomGlow.ts):
 *   a lime rim and a small swell, exactly absent in every capture;
 * - the Foil finishes of a Remix code (tsl/atomFoil.ts): Holo, Gold leaf
 *   and Pearl on the rims and highlights, exactly absent in every capture;
 * - the Illustrate look (tsl/inkLook.ts): toon fills and an ink outline at
 *   the disc's silhouette, mixed over the lit surface by `uInkMix`, or per
 *   fragment by the Light Fuse while one runs (tsl/inkFuse.ts);
 * - hidden types (zero palette radius) and sub-pixel atoms collapse to a
 *   degenerate vertex (culling);
 * - orthographic cameras cast parallel rays (spike G11, D7).
 *
 * Instance layout (D4, spike G5): `instancePosition` and
 * `instanceTargetPosition` (float32 ×3) and one normalized Uint8×4
 * `instanceAtomData` word per atom: `[typeSlot, occlusion, propHi, propLo]`.
 * Never an itemSize-1 u8/u16 attribute: WebGPU has no such vertex format and
 * three widens the non-normalized ones to u32 (K22).
 *
 * Static frames and trajectories use different materials (`interpolate`).
 * The static program never reads `instanceTargetPosition`, so a static
 * geometry may alias it to the position buffer. Trap (three r186, WebGPU):
 * the render-pipeline cache key names a geometry's attributes but not whether
 * two names share one buffer, so ONE program drawn with an aliased geometry
 * and with a separate target buffer reuses the first vertex-buffer layout and
 * the second draw silently shows nothing.
 *
 * Palettes are 256-texel DataTextures read with `textureLoad` (no sampler, so
 * the R32F radius palette works on every WebGPU adapter). The textures are
 * stable per component and updated in place; the base texture nodes live in
 * the uniform bag, so swapping a node's `.value` (the etch texture) reaches
 * every tier's material.
 */
import * as THREE from 'three/webgpu';
import type { TextureNode, UniformNode } from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  attribute,
  cameraProjectionMatrix,
  clamp,
  dot,
  float,
  floor,
  fract,
  instanceIndex,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  normalize,
  positionGeometry,
  round,
  screenSize,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  textureLoad,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { LUPI_SHADER_TAG_KEY, attachLupiUniforms, type LupiUniformBag } from './lupiUniforms';
import { lupiDisplayOffset } from './displayMotion';
import { lupiAtomGlow, lupiAtomGlowStrength, lupiAtomSwell } from './atomGlow';
import { lupiFoilFinish, lupiFoilSweep } from './atomFoil';
import { INK_LOOK, INK_LOOK_TUNING, lupiInkSurface } from './inkLook';
import { lupiAtomFuseHop, lupiFuseMix, lupiFuseSurfacePoint } from './inkFuse';
import { CONTACT_OCCLUSION_NEIGHBORS, CONTACT_TEXTURE_WIDTH } from '../atomContactOcclusion';
import {
  blendMaterialPreset,
  impostorDepthPrelude,
  lupiSurface,
  orthographicFlag,
  raySphere,
  sphereOcclusion,
  viewRay,
  type LupiEnvBinding,
  type LupiLightUniforms,
} from './impostorKit';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

export const ATOM_ATTR = {
  position: 'instancePosition',
  target: 'instanceTargetPosition',
  data: 'instanceAtomData',
} as const;

/** Byte offsets inside one `instanceAtomData` word. */
export const ATOM_DATA_SLOT = 0;
export const ATOM_DATA_OCCLUSION = 1;
export const ATOM_DATA_PROP_HI = 2;
export const ATOM_DATA_PROP_LO = 3;
export const ATOM_DATA_STRIDE = 4;

/** The billboard half-size in radii (it must cover the projected sphere). */
export const ATOM_IMPOSTOR_QUAD_SCALE = 1.3;

/** Quantize a [0,1] property to 16 bits (NaN reads as 0). */
export function quantizeAtomProp(prop01: number): number {
  if (!(prop01 > 0)) return 0;
  if (prop01 >= 1) return 65535;
  return Math.round(prop01 * 65535);
}

/** Write one atom's `[typeSlot, occlusion, propHi, propLo]` word. */
export function packAtomData(
  out: Uint8Array,
  i: number,
  typeSlot: number,
  occlusion01: number,
  prop01: number,
): void {
  const base = i * ATOM_DATA_STRIDE;
  const prop = quantizeAtomProp(prop01);
  out[base + ATOM_DATA_SLOT] = Math.max(0, Math.min(255, Math.trunc(typeSlot)));
  out[base + ATOM_DATA_OCCLUSION] = occlusion01 > 0 ? Math.min(255, Math.round(occlusion01 * 255)) : 0;
  out[base + ATOM_DATA_PROP_HI] = prop >> 8;
  out[base + ATOM_DATA_PROP_LO] = prop & 0xff;
}

/** The [0,1] property the shader decodes from one packed word (CPU mirror). */
export function unpackAtomProp(data: ArrayLike<number>, i: number): number {
  const base = i * ATOM_DATA_STRIDE;
  return (data[base + ATOM_DATA_PROP_HI] * 256 + data[base + ATOM_DATA_PROP_LO]) / 65535;
}

export interface AtomImpostorTextures {
  /** 256×1 RGBA8, sRGB: type slot → colour. */
  palette: THREE.DataTexture;
  /** 256×1 RGBA8, sRGB, linear filter: normalized property → colour. */
  colormap: THREE.DataTexture;
  /** 256×1 R32F: type slot → world radius (0 hides the slot). */
  radiusPalette: THREE.DataTexture;
  /** 256×2 RGBA8, linear data: row 0 (metalness, roughness, anisotropy, subsurface), row 1 emission (rgb, intensity). */
  materialPalette: THREE.DataTexture;
  /** The etched-annotation stamp (alpha is the mask), or null. */
  etch: THREE.Texture | null;
  /**
   * The contact-occlusion neighbour texture (RGBA8 linear data,
   * CONTACT_TEXTURE_WIDTH wide, K texels per atom), or null.
   */
  contact?: THREE.DataTexture | null;
}

export interface AtomImpostorUniforms extends LupiUniformBag {
  /** GPU interpolation progress, 0..1 (clamped by the caller). */
  uProgress: UniformNode<'float', number>;
  /** 0 = type palette, 1 = uniform colour, 2 = property colormap. */
  uColorMode: UniformNode<'float', number>;
  uUniformColor: UniformNode<'color', THREE.Color>;
  /** 0 = none, 1 = noise, 2 = scratched (tier 2 only). */
  uTextureMode: UniformNode<'float', number>;
  /** `materialPresetIndex()` of the look preset. */
  uMaterialPreset: UniformNode<'float', number>;
  uMaterialIntensity: UniformNode<'float', number>;
  uSurfaceRoughness: UniformNode<'float', number>;
  uSurfacePolish: UniformNode<'float', number>;
  uSurfaceClearcoat: UniformNode<'float', number>;
  uPropEmission: UniformNode<'float', number>;
  uEtchAtomId: UniformNode<'float', number>;
  uHasEtch: UniformNode<'float', number>;
  /** Atoms projecting under this many device pixels are culled. */
  uCullPixelRadius: UniformNode<'float', number>;
  uOcclusionStrength: UniformNode<'float', number>;
  /** 1 while the contact texture holds this layer's bake. */
  uHasContact: UniformNode<'float', number>;
  /** The bake's search radius (offsets are snorm8 of it). */
  uContactRange: UniformNode<'float', number>;
  /** Gain on the summed contact occlusion. */
  uContactStrength: UniformNode<'float', number>;
  /** Radius of the bond stub where a bond leaves an atom (0 = bonds hidden). */
  uBondStubRadius: UniformNode<'float', number>;
  /** Neighbours closer than this (world units) carry a bond stub. */
  uBondStubReach: UniformNode<'float', number>;
  /** 1 while the morph arrival's texture belongs to this layer's frame (tsl/displayMotion.ts). */
  uMorphOn: UniformNode<'float', number>;
  // Base texture nodes: set `.value` to swap a texture for every tier.
  uPalette: TextureNode;
  uColormap: TextureNode;
  uRadiusPalette: TextureNode;
  uMaterialPalette: TextureNode;
  tEtchTexture: TextureNode;
  tContactTexture: TextureNode;
}

let emptyEtch: THREE.DataTexture | null = null;

/** A 1×1 fully transparent stamp, bound while no etch texture is set. */
export function emptyEtchTexture(): THREE.DataTexture {
  if (!emptyEtch) {
    emptyEtch = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
    emptyEtch.needsUpdate = true;
  }
  return emptyEtch;
}

let emptyContact: THREE.DataTexture | null = null;

/** A 1×1 "no neighbour" texel, bound while a layer has no contact bake. */
export function emptyContactTexture(): THREE.DataTexture {
  if (!emptyContact) {
    emptyContact = new THREE.DataTexture(new Uint8Array([128, 128, 128, 0]), 1, 1);
    emptyContact.needsUpdate = true;
  }
  return emptyContact;
}

/** Contact occlusion never darkens a pixel by more than this (keeps CPK legible). */
export const CONTACT_OCCLUSION_MAX_DARKENING = 0.82;

/**
 * The uniform bag shared by every tier's material of one atom layer. Values
 * start at the v9 defaults.
 */
export function createAtomImpostorUniforms(textures: AtomImpostorTextures): AtomImpostorUniforms {
  return {
    uProgress: uniform(0),
    uColorMode: uniform(0),
    uUniformColor: uniform(new THREE.Color(0.6, 0.6, 0.6)),
    uTextureMode: uniform(0),
    uMaterialPreset: uniform(0),
    uMaterialIntensity: uniform(0),
    uSurfaceRoughness: uniform(0),
    uSurfacePolish: uniform(0),
    uSurfaceClearcoat: uniform(0),
    uPropEmission: uniform(0),
    uEtchAtomId: uniform(-1),
    uHasEtch: uniform(0),
    uCullPixelRadius: uniform(0),
    uOcclusionStrength: uniform(0),
    uHasContact: uniform(0),
    uContactRange: uniform(1),
    uContactStrength: uniform(0),
    uBondStubRadius: uniform(0),
    uBondStubReach: uniform(0),
    uMorphOn: uniform(0),
    uPalette: texture(textures.palette) as unknown as TextureNode,
    uColormap: texture(textures.colormap) as unknown as TextureNode,
    uRadiusPalette: texture(textures.radiusPalette) as unknown as TextureNode,
    uMaterialPalette: texture(textures.materialPalette) as unknown as TextureNode,
    tEtchTexture: texture(textures.etch ?? emptyEtchTexture()) as unknown as TextureNode,
    tContactTexture: texture(textures.contact ?? emptyContactTexture()) as unknown as TextureNode,
  };
}

/** v9's GLSL `rand`: a hash of a 2D coordinate into [0,1). */
function rand(co: N): N {
  return fract(sin(dot(co, vec2(12.9898, 78.233))).mul(43758.5453));
}

export interface AtomImpostorMaterialOptions {
  tier: 0 | 1 | 2;
  /**
   * Lerp `instancePosition` → `instanceTargetPosition` by `uProgress`. Only
   * for geometries whose target is its own buffer (see the file header).
   */
  interpolate: boolean;
  /** From `createAtomImpostorUniforms`; shared by the tiers of one layer. */
  uniforms: AtomImpostorUniforms;
  lights: LupiLightUniforms;
  env: LupiEnvBinding;
}

/**
 * Build the atom impostor node material for one quality tier: tier 0 is the
 * analytic environment only, tier 1 adds image-based lighting, tier 2 adds
 * clearcoat and the surface textures (v9 LUPI_QUALITY).
 */
export function createAtomImpostorMaterial({
  tier,
  interpolate,
  uniforms,
  lights,
  env,
}: AtomImpostorMaterialOptions): THREE.MeshBasicNodeMaterial {
  const u = uniforms as unknown as Record<keyof AtomImpostorUniforms, N>;
  const isOrtho: N = orthographicFlag().isOrtho;

  // ── Vertex stage ────────────────────────────────────────────────────
  const data: N = attribute(ATOM_ATTR.data, 'vec4');
  const slot: N = int(round(data.x.mul(255.0)));
  const occlusion: N = data.y;
  const prop: N = round(data.z.mul(255.0)).mul(256.0).add(round(data.w.mul(255.0))).div(65535.0);

  // The hovered or grabbed atom swells a little (exactly ×1 in captures).
  const atomId: N = float(instanceIndex);
  const paletteRadius: N = (textureLoad(u.uRadiusPalette, ivec2(slot, int(0))) as N).x;
  const radius: N = paletteRadius.mul(lupiAtomSwell(atomId));
  const typeColor: N = (textureLoad(u.uPalette, ivec2(slot, int(0))) as N).rgb;
  const mapColor: N = (texture(u.uColormap, vec2(prop, 0.5)) as N).level(0).rgb;
  // mix, not select: a select lowers to if/else, and `prop` (read again for
  // the vProp varying) would then be assigned inside one branch only (G1).
  const isUniformMode: N = step(0.5, u.uColorMode);
  const isPropertyMode: N = step(1.5, u.uColorMode);
  const baseColor: N = mix(mix(typeColor, vec3(u.uUniformColor), isUniformMode), mapColor, isPropertyMode);
  const materialParams: N = textureLoad(u.uMaterialPalette, ivec2(slot, int(0)));
  const emissionParams: N = textureLoad(u.uMaterialPalette, ivec2(slot, int(1)));

  const rawPosition: N = attribute(ATOM_ATTR.position, 'vec3');
  const restCenter: N = interpolate
    ? mix(rawPosition, attribute(ATOM_ATTR.target, 'vec3'), u.uProgress)
    : rawPosition;
  // ── Morph arrival source (tsl/displayMotion.ts) ──────────────────
  // The instance index is the atom index: this atom's texel in the morph
  // texture, read only while the layer's gate says the texture is this
  // frame's.
  const morphSource = { index: atomId, on: u.uMorphOn };
  // Display-only motion (arrival, morph, ripple, scatter, the verbs): exactly
  // zero at rest and in every capture; everything below follows the
  // displaced centre.
  const displayOffset: N = (lupiDisplayOffset(restCenter, rawPosition, morphSource) as N).toVar('atomDisplayOffset');
  const center: N = restCenter.add(displayOffset);
  const viewCenter: N = modelViewMatrix.mul(vec4(center, 1.0)).xyz;
  const viewDepth: N = max(viewCenter.z.negate(), 1e-4);
  // Device pixels per world unit at unit depth: |P[1][1]| × target height / 2.
  // screenSize follows the bound render target (capture at any size).
  // `.element()` exists at runtime; @types/three 0.186 lacks it (G13).
  const pixelScale: N = abs((cameraProjectionMatrix as N).element(1).y).mul(screenSize.y).mul(0.5);
  const pixelRadius: N = select(isOrtho, radius.mul(pixelScale), radius.mul(pixelScale).div(viewDepth));
  // Hidden types carry a zero palette radius; sub-pixel atoms collapse too:
  // a degenerate clip position draws no fragments.
  const culled: N = radius.lessThanEqual(0.0).or(pixelRadius.lessThan(u.uCullPixelRadius));

  const corner: N = positionGeometry.xy;
  const quadView: N = vec3(
    viewCenter.xy.add(corner.mul(radius.mul(ATOM_IMPOSTOR_QUAD_SCALE))),
    viewCenter.z.add(radius),
  );
  const clip: N = cameraProjectionMatrix.mul(vec4(quadView, 1.0));

  const vViewCenter: N = varying(viewCenter, 'vViewCenter');
  const vRadius: N = varying(radius, 'vRadius');
  const vUv: N = varying(corner, 'vUv');
  const vColor: N = varying(baseColor, 'vColor');
  const vPixelRadius: N = varying(pixelRadius, 'vPixelRadius');
  const vOcclusion: N = varying(occlusion, 'vOcclusion');
  const vProp: N = varying(prop, 'vProp');
  const vAtomId: N = varying(atomId, 'vAtomId');
  const vGlow: N = varying(lupiAtomGlowStrength(atomId), 'vGlow');
  const vMaterial: N = varying(materialParams, 'vMaterial');
  const vEmission: N = varying(emissionParams, 'vEmission');
  // Contact occlusion is baked at rest: it eases open while display motion
  // carries the atom away (an arrival, a scatter), and is whole at rest and in
  // every capture (the offset is exactly zero there).
  const vContactFade: N = varying(smoothstep(0.08, 0.8, length(displayOffset)).oneMinus(), 'vContactFade');
  // The Foil reveal (x revealed, y the passing glint); constant once revealed.
  const vFoilSweep: N = varying(lupiFoilSweep(viewCenter), 'vFoilSweep');

  // ── Fragment ────────────────────────────────────────────────────────
  // The hit is built once and first materialized by the depth prelude, which
  // three sets up before the colour (G1/G2).
  const hit: N = (Fn(() => {
    const proxy = vViewCenter.add(vec3(vUv.mul(vRadius.mul(ATOM_IMPOSTOR_QUAD_SCALE)), vRadius)).toVar();
    const { ro, rd } = viewRay(proxy, isOrtho);
    return raySphere(ro, rd, vViewCenter, vRadius);
  }) as N)().toVar('atomHit');

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = `lupi-atom-impostor-t${tier}${interpolate ? '-lerp' : ''}`;
  material.side = THREE.DoubleSide;
  material.fog = false;
  material.transparent = false;
  material.depthTest = true;
  material.depthWrite = true;

  material.vertexNode = select(culled, vec4(2.0, 2.0, 2.0, 1.0), clip);
  material.depthNode = impostorDepthPrelude(hit, isOrtho);

  material.colorNode = (Fn(() => {
    const normal = normalize(hit.xyz.sub(vViewCenter)).toVar();
    // Element identity (metalness, roughness, subsurface) toward the preset.
    const surface = (blendMaterialPreset(
      u.uMaterialPreset,
      u.uMaterialIntensity,
      vec3(vMaterial.x, vMaterial.y, vMaterial.w),
    ) as N).toVar();
    const roughness = clamp(surface.y.add(u.uSurfaceRoughness), 0.0, 1.0);

    let albedo: N = vColor;
    if (tier >= 2) {
      const noise = rand(vUv.mul(500.0));
      const scratch = rand(floor(vUv.mul(100.0))).greaterThan(0.95).and(rand(vUv.mul(50.0)).greaterThan(0.5));
      const noiseFactor = mix(0.7, 1.0, noise);
      const scratchFactor = select(scratch, float(0.5), float(1.0));
      const factor = select(
        u.uTextureMode.greaterThan(1.5),
        scratchFactor,
        select(u.uTextureMode.greaterThan(0.5), noiseFactor, float(1.0)),
      );
      albedo = vColor.mul(factor).toVar();
    }

    // Per-element emission plus, in property mode, the property glow.
    const propertyGlow = select(
      u.uColorMode.greaterThan(1.5),
      vColor.mul(vProp).mul(u.uPropEmission),
      vec3(0.0),
    );
    // Read by both the lit and the Illustrate surface: materialized before either branch (G1).
    const emission = vEmission.rgb.mul(vEmission.a).add(propertyGlow).toVar();

    // Contact occlusion: the K baked neighbours (and the bond stubs leaving
    // this atom) as analytic spheres around the hit point, in view space.
    const contactOpen = float(1).toVar();
    If(u.uHasContact.greaterThan(0.5), () => {
      const p: N = hit.xyz.toVar();
      const occ: N = float(0).toVar();
      const base: N = int(vAtomId.add(0.5)).mul(int(CONTACT_OCCLUSION_NEIGHBORS)).toVar();
      const toModelUnits = u.uContactRange.div(127.0);
      for (let k = 0; k < CONTACT_OCCLUSION_NEIGHBORS; k += 1) {
        const index: N = base.add(int(k)).toVar();
        const coord: N = ivec2(index.mod(int(CONTACT_TEXTURE_WIDTH)), index.div(int(CONTACT_TEXTURE_WIDTH)));
        const texel = (textureLoad(u.tContactTexture, coord) as N).toVar();
        const offsetBytes: N = (round(texel.xyz.mul(255.0)) as N).sub(128.0).toVar();
        const valid: N = (step(float(0.5), dot(offsetBytes, offsetBytes) as N) as N).toVar();
        const offsetModel = offsetBytes.mul(toModelUnits).toVar();
        const offsetView = (modelViewMatrix as N).mul(vec4(offsetModel, 0.0)).xyz.toVar();
        const neighborSlot = int(round(texel.w.mul(255.0)));
        const neighborRadius = (textureLoad(u.uRadiusPalette, ivec2(neighborSlot, int(0))) as N).x.toVar();
        const neighborCenter = vViewCenter.add(offsetView);
        occ.addAssign((sphereOcclusion(p, normal, neighborCenter, neighborRadius) as N).mul(valid));
        // A bond leaving toward a near neighbour: a small sphere sitting on
        // this atom's surface darkens the ring where the stick meets the ball.
        const distance = length(offsetModel);
        const bonded = valid
          .mul(step(distance, u.uBondStubReach))
          .mul(step(1e-4, neighborRadius))
          .mul(step(1e-4, u.uBondStubRadius));
        const stubDir = offsetView.div(max(length(offsetView), 1e-6));
        const stubCenter = vViewCenter.add(stubDir.mul(vRadius.add(u.uBondStubRadius.mul(0.6))));
        occ.addAssign((sphereOcclusion(p, normal, stubCenter, u.uBondStubRadius.mul(1.4)) as N).mul(bonded));
      }
      contactOpen.assign(
        float(1).sub(min(occ.mul(u.uContactStrength), CONTACT_OCCLUSION_MAX_DARKENING).mul(vContactFade)),
      );
    });
    // Scalar density occlusion (large scenes) times contact occlusion.
    const openness = mix(float(1), vOcclusion, u.uOcclusionStrength).mul(contactOpen).toVar();

    // The lit Specimen surface, the Illustrate surface (tsl/inkLook.ts), or a
    // blend of the two while the look fades. Uniform branches: a still look
    // runs one of them only.
    const inkMix: N = INK_LOOK.uInkMix as N;
    // The Light Fuse (tsl/inkFuse.ts): per fragment while a fuse runs, the
    // front reaching this atom at its hop; exactly `uInkMix` otherwise.
    const fusedMix: N = (lupiFuseMix(inkMix, lupiAtomFuseHop(vAtomId), lupiFuseSurfacePoint(hit.xyz)) as N).toVar();
    const lit = vec3(0).toVar();
    If(inkMix.lessThan(1.0), () => {
      lit.assign(lupiSurface(
        {
          normal,
          baseColor: vColor,
          albedo,
          metalness: surface.x,
          roughness,
          clearcoat: u.uSurfaceClearcoat,
          polish: u.uSurfacePolish,
          occlusion: openness,
          occlusionStrength: float(1),
          emission,
          pixelRadius: vPixelRadius,
          subsurface: surface.z,
        },
        lights,
        env,
        tier,
      ) as N);
    });
    If(inkMix.greaterThan(0.0), () => {
      // Pixels from the hit to the disc's silhouette: R·(1 − sin θ) on screen.
      const inkEye: N = select(isOrtho, vec3(0.0, 0.0, 1.0), normalize(hit.xyz.negate()));
      const facing: N = clamp(dot(normal, inkEye), 0.0, 1.0).toVar();
      const edgePx: N = vPixelRadius.mul(float(1).sub(sqrt(max(float(1).sub(facing.mul(facing)), 0.0))));
      const ink = lupiInkSurface(
        {
          normal,
          baseColor: albedo,
          occlusion: openness,
          pixelRadius: vPixelRadius,
          edgePx,
          lineWidth: INK_LOOK_TUNING.atomLine,
          hit: hit.xyz,
          center: vViewCenter,
          isOrtho,
          emission,
        },
        lights,
      ) as N;
      lit.assign(mix(lit, ink, fusedMix));
    });

    // Etched annotation: the view-space normal is the stamp UV (the text
    // faces the camera); only the targeted atom darkens where alpha is set.
    const etchUv = vec2(normal.x.mul(1.5).add(0.5), normal.y.negate().mul(1.5).add(0.5)).toVar();
    const inside = etchUv.x.greaterThan(0.0)
      .and(etchUv.x.lessThan(1.0))
      .and(etchUv.y.greaterThan(0.0))
      .and(etchUv.y.lessThan(1.0));
    const targeted = u.uHasEtch.greaterThan(0.5).and(abs(vAtomId.sub(u.uEtchAtomId)).lessThan(0.5));
    const etchAlpha = (texture(u.tEtchTexture, clamp(etchUv, 0.0, 1.0)) as N).a;
    const etch = select(targeted.and(inside), etchAlpha, float(0.0));
    const etched: N = mix(lit, lit.mul(0.32), etch);
    const toEye: N = select(isOrtho, vec3(0.0, 0.0, 1.0), normalize(hit.xyz.negate()));
    const facing: N = dot(normal, toEye).toVar();
    // A Remix code's Foil finish (exactly `etched` without one, and in captures).
    const shaded: N = lupiFoilFinish({
      lit: etched,
      normal,
      facing,
      keyLightDir: lights.lightDir,
      pixelRadius: vPixelRadius,
      sweep: vFoilSweep,
      // The Illustrate look is a drawing: a finish steps aside as ink comes in.
      mute: fusedMix,
    });
    // Hover / selection / grab rim and the heat tint (zero in captures).
    const glow = lupiAtomGlow(vGlow, facing);
    return vec4((shaded as N).add(glow), 1.0);
  }) as N)();

  attachLupiUniforms(material, uniforms);
  material.userData[LUPI_SHADER_TAG_KEY] = 'atom-impostor';
  return material;
}
