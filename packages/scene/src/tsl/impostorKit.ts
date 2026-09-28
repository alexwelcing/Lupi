/**
 * impostorKit.ts — shared TSL pieces for Lupi's ray-cast impostors (atoms,
 * bonds): view rays, ray-sphere and ray-capped-cylinder hits, the depth
 * prelude, and the Lupi surface BRDF.
 *
 * The surface model is the v9 GLSL impostor BRDF (AtomsOptimized.tsx and
 * bondImpostor.ts before the port), per quality tier:
 * - every tier: GGX D + Smith G + Schlick F specular, Burley wrap diffuse,
 *   tinted fill, fresnel rim with a direction mask, subsurface backlight and
 *   the 8% visibility floor;
 * - tier >= 1: image-based lighting from `scene.environment` through
 *   `pmremTexture` when the env binding has an environment, else the analytic
 *   studio environment (tier 0 is always analytic);
 * - tier 2: the clearcoat lobe.
 * `blendMaterialPreset` is the v9 material-preset blend (matte, metallic,
 * glass, plastic over the per-element identity).
 *
 * Conventions:
 * - Light directions are WORLD space (toward the light); the conversion to
 *   view space happens in the graph through `cameraViewMatrix`, so a light
 *   uniform never races the camera.
 * - Shading happens in view space with V = +z, and returns linear RGB. The
 *   renderer output (or the post pipeline's renderOutput) encodes sRGB and
 *   tone-maps (plan-final D14).
 * - Depth (plan-final D3, spike G1/G2): build the hit once with `.toVar()`,
 *   make `impostorDepthPrelude(hit, isOrtho)` the material's `depthNode` (it
 *   runs before `colorNode`, so the hit is emitted unconditionally at the top
 *   of main()), and read the same hit in `colorNode`. `.toVar()` every
 *   non-trivial operand before a `select` (G3).
 */
import * as THREE from 'three/webgpu';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import {
  Discard,
  Fn,
  If,
  abs,
  cameraFar,
  cameraNear,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp,
  dot,
  float,
  length,
  max,
  min,
  mix,
  normalize,
  pmremTexture,
  pow,
  reflect,
  select,
  smoothstep,
  sqrt,
  texture,
  uniform,
  vec3,
  vec4,
  viewZToOrthographicDepth,
  viewZToPerspectiveDepth,
} from 'three/tsl';

// Graph-building code works on untyped nodes: the @types/three 0.186 node
// typings are too narrow for swizzles and chained math (spike G13).
type N = any;

// ─── Light and environment uniforms ─────────────────────────────────────

export interface LupiLightUniforms {
  /** Key light direction, world space, toward the light. */
  lightDir: UniformNode<'vec3', THREE.Vector3>;
  /** Fill light direction, world space. */
  fillLightDir: UniformNode<'vec3', THREE.Vector3>;
  /** Rim light direction, world space. */
  rimLightDir: UniformNode<'vec3', THREE.Vector3>;
  fillLightColor: UniformNode<'color', THREE.Color>;
  rimLightColor: UniformNode<'color', THREE.Color>;
  /** User rim-light boost (additive over the material rim). */
  rimLight: UniformNode<'float', number>;
  /** Multiplier on the direct key light (1 = the v9 look). */
  keyIntensity: UniformNode<'float', number>;
  /** Multiplier on ambient/environment irradiance (1 = the v9 look). */
  ambient: UniformNode<'float', number>;
}

/** A world-space direction from azimuth/elevation in degrees (v9 convention). */
export function lightDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
}

/** Light uniforms with the v9 defaults (key 40°/45°, fill -120°/10°, rim 160°/30°). */
export function createLupiLightUniforms(): LupiLightUniforms {
  return {
    lightDir: uniform(lightDirection(40, 45)),
    fillLightDir: uniform(lightDirection(-120, 10)),
    rimLightDir: uniform(lightDirection(160, 30)),
    fillLightColor: uniform(new THREE.Color('#8888ff')),
    rimLightColor: uniform(new THREE.Color('#ffffff')),
    rimLight: uniform(0),
    keyIntensity: uniform(1),
    ambient: uniform(1),
  };
}

export interface LupiEnvBinding {
  /** Texture node whose `.value` follows `scene.environment` (a placeholder when there is none). */
  envNode: TextureNode;
  /** Multiplier on image-based lighting (v9 uEnvIntensity); the analytic environment ignores it. */
  intensity: UniformNode<'float', number>;
  /** 1 when `scene.environment` is set. */
  hasEnv: UniformNode<'float', number>;
}

let placeholderEnvironment: THREE.DataTexture | null = null;

/** A 1×1 black texture, so the env node always has a valid value. */
function emptyEnvironment(): THREE.DataTexture {
  if (!placeholderEnvironment) {
    placeholderEnvironment = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    placeholderEnvironment.needsUpdate = true;
  }
  return placeholderEnvironment;
}

let pendingEnvironment: THREE.Texture | null = null;

/**
 * The value of the PMREM nodes while there is no environment: a texture with
 * no image, which `PMREMNode` skips (it keeps its own empty render-target
 * placeholder). Its render-target Y flip, fixed when a material compiles,
 * then matches the PMREMGenerator output that arrives later.
 */
function pendingPmremSource(): THREE.Texture {
  pendingEnvironment ??= new THREE.Texture();
  return pendingEnvironment;
}

interface EnvPmremState {
  /** The PMREM sample nodes built from this binding, one per lupiSurface IBL lookup. */
  nodes: Set<{ value: THREE.Texture }>;
  source: THREE.Texture | null;
  /** Height of the source when it was last bound: a resized PMREM re-derives its CubeUV constants. */
  height: number;
}

const envPmremState = new WeakMap<LupiEnvBinding, EnvPmremState>();

function pmremState(binding: LupiEnvBinding): EnvPmremState {
  let state = envPmremState.get(binding);
  if (!state) {
    state = { nodes: new Set(), source: null, height: 0 };
    envPmremState.set(binding, state);
  }
  return state;
}

function textureHeight(texture: THREE.Texture | null): number {
  const image = texture?.image as { height?: unknown } | undefined;
  return typeof image?.height === 'number' ? image.height : 0;
}

export function createLupiEnvBinding(): LupiEnvBinding {
  return {
    envNode: texture(emptyEnvironment()) as unknown as TextureNode,
    intensity: uniform(1),
    hasEnv: uniform(0),
  };
}

/**
 * Point the binding at `scene.environment`. Call it from a `lupi-uniforms`
 * job; it only swaps textures when the identity (or the PMREM size) changes.
 *
 * `scene.environment` may be a CubeUV PMREM (three/webgpu `PMREMGenerator`),
 * an equirectangular texture or a cube texture; `pmremTexture` prefilters the
 * last two itself (plan-final D13).
 */
export function syncLupiEnvBinding(binding: LupiEnvBinding, scene: THREE.Scene): void {
  const environment = scene.environment;
  const next = environment ?? emptyEnvironment();
  if (binding.envNode.value !== next) binding.envNode.value = next;
  binding.hasEnv.value = environment ? 1 : 0;

  const state = pmremState(binding);
  const height = textureHeight(environment);
  if (state.source === environment && state.height === height) return;
  state.source = environment;
  state.height = height;
  // PMREMNode's value setter drops its cached PMREM, so a same-identity
  // assignment also re-reads the CubeUV size.
  const source = environment ?? pendingPmremSource();
  for (const node of state.nodes) node.value = source;
}

/**
 * A prefiltered radiance lookup of the binding's environment along a
 * WORLD-space direction, blurred by roughness. Registered with the binding so
 * `syncLupiEnvBinding` retargets it.
 */
function sampleEnvironment(binding: LupiEnvBinding, worldDir: N, roughness: N): N {
  const state = pmremState(binding);
  const node = pmremTexture(state.source ?? pendingPmremSource(), worldDir, roughness) as N;
  state.nodes.add(node);
  return node;
}

// ─── Camera, rays and depth ─────────────────────────────────────────────

/**
 * A uniform that is 1 while an orthographic camera renders. Updated per
 * render call (onRenderUpdate), so it follows whichever camera draws,
 * including export cameras.
 */
export const orthographicFlag = (): { uOrtho: UniformNode<'float', number>; isOrtho: Node } => {
  const uOrtho = uniform(0).onRenderUpdate(({ camera }) =>
    (camera as THREE.OrthographicCamera | null)?.isOrthographicCamera ? 1 : 0,
  );
  return { uOrtho, isOrtho: (uOrtho as N).greaterThan(0.5) };
};

/**
 * The view-space ray through a view-space point on the proxy geometry.
 * Perspective: from the eye through the point. Orthographic: parallel to -z
 * through the point (v9 was perspective-only; spike G11, plan-final D7).
 */
export function viewRay(proxyViewPos: Node, isOrtho: Node): { ro: Node; rd: Node } {
  const p = proxyViewPos as N;
  const ro = select(isOrtho as N, vec3(p.xy, 0), vec3(0, 0, 0));
  const rd = select(isOrtho as N, vec3(0, 0, -1), normalize(p));
  return { ro, rd };
}

/**
 * Nearest ray-sphere hit: `vec4(hitPointView.xyz, disc)`. `disc < 0` is a
 * miss (the prelude discards it); `disc / fwidth(disc)` is a signed pixel
 * distance to the silhouette.
 */
export function raySphere(ro: Node, rd: Node, center: Node, radius: Node): Node {
  return (Fn(() => {
    const roV = (ro as N).toVar();
    const rdV = (rd as N).toVar();
    const oc = roV.sub(center).toVar();
    const b = dot(oc, rdV).toVar();
    const c = dot(oc, oc).sub((radius as N).mul(radius));
    const disc = b.mul(b).sub(c).toVar();
    const t = b.negate().sub(sqrt(max(disc, 0.0)));
    return vec4(roV.add(rdV.mul(t)), disc);
  }) as N)();
}

/**
 * Nearest hit on the finite, flat-capped cylinder from `a` to `b`:
 * `vec4(hitPointView.xyz, hitFlag)` with hitFlag -1 = miss, 0 = side,
 * 1 = cap. The axial coordinate is `dot(hit.xyz - a, axis)`; see
 * `cappedCylinderNormal`.
 */
export function rayCappedCylinder(ro: Node, rd: Node, a: Node, b: Node, r: Node): Node {
  return (Fn(() => {
    const roV = (ro as N).toVar();
    const rdV = (rd as N).toVar();
    const A = a as N;
    const radius = r as N;
    const segLen = length((b as N).sub(A)).toVar();
    const ax = (b as N).sub(A).div(max(segLen, 1e-6)).toVar();
    const oc = roV.sub(A).toVar();
    const card = dot(ax, rdV).toVar();
    const caoc = dot(ax, oc).toVar();
    const dPerp = rdV.sub(ax.mul(card)).toVar();
    const ocPerp = oc.sub(ax.mul(caoc)).toVar();
    const qa = dot(dPerp, dPerp).toVar();
    const qb = dot(dPerp, ocPerp).toVar();
    const qc = dot(ocPerp, ocPerp).sub(radius.mul(radius)).toVar();

    const t = float(-1).toVar();
    const flag = float(-1).toVar();

    // Side: the smaller root, if it lies within the segment.
    If(qa.greaterThan(1e-8), () => {
      const h = qb.mul(qb).sub(qa.mul(qc)).toVar();
      If(h.greaterThanEqual(0.0), () => {
        const ts = qb.negate().sub(sqrt(h)).div(qa).toVar();
        const ys = caoc.add(ts.mul(card)).toVar();
        If(ys.greaterThanEqual(0.0).and(ys.lessThanEqual(segLen)), () => {
          t.assign(ts);
          flag.assign(0);
        });
      });
    });

    // Caps: the entry cap first, the exit cap as the fallback (v9 order).
    If(flag.lessThan(0.0).and(abs(card).greaterThan(1e-6)), () => {
      const t0 = caoc.negate().div(card).toVar();
      const t1 = segLen.sub(caoc).div(card).toVar();
      const tNear = min(t0, t1).toVar();
      const tFar = max(t0, t1).toVar();
      const yNear = select(t0.lessThan(t1), float(0.0), segLen).toVar();
      const yFar = select(t0.lessThan(t1), segLen, float(0.0)).toVar();
      const relNear = roV.add(rdV.mul(tNear)).sub(A).sub(ax.mul(yNear)).toVar();
      const relFar = roV.add(rdV.mul(tFar)).sub(A).sub(ax.mul(yFar)).toVar();
      const r2 = radius.mul(radius);
      If(dot(relNear, relNear).lessThanEqual(r2), () => {
        t.assign(tNear);
        flag.assign(1);
      }).ElseIf(dot(relFar, relFar).lessThanEqual(r2), () => {
        t.assign(tFar);
        flag.assign(1);
      });
    });

    // A hit behind the ray origin is a miss.
    const hitFlag = select(t.lessThanEqual(0.0), float(-1), flag);
    return vec4(roV.add(rdV.mul(t)), hitFlag);
  }) as N)();
}

/** The view-space normal for a `rayCappedCylinder` hit. */
export function cappedCylinderNormal(hit: Node, a: Node, b: Node): Node {
  return (Fn(() => {
    const h = hit as N;
    const A = a as N;
    const segLen = length((b as N).sub(A)).toVar();
    const ax = (b as N).sub(A).div(max(segLen, 1e-6)).toVar();
    const axial = dot(h.xyz.sub(A), ax).toVar();
    const radial = normalize(h.xyz.sub(A).sub(ax.mul(axial))).toVar();
    const capNormal = select(axial.lessThan(segLen.mul(0.5)), ax.negate(), ax).toVar();
    return select(h.w.greaterThan(0.5), capNormal, radial);
  }) as N)();
}

/** Window-space [0,1] depth for a view-space z, for either camera type (both backends). */
export function depthFromViewZ(viewZ: Node, isOrtho: Node): Node {
  return select(
    isOrtho as N,
    viewZToOrthographicDepth(viewZ as N, cameraNear, cameraFar),
    viewZToPerspectiveDepth(viewZ as N, cameraNear, cameraFar),
  );
}

/**
 * The material's `depthNode` (plan-final D3): materializes the hit first (so
 * it is emitted at the top of main(), before colorNode reads it; G1), then
 * discards a miss (`hit.w < 0`; G2), then returns the hit's window depth.
 */
export function impostorDepthPrelude(hit: Node, isOrtho: Node): Node {
  return (Fn(() => {
    const h = hit as N;
    const hitZ = h.z.toVar();
    Discard(h.w.lessThan(0.0));
    return depthFromViewZ(hitZ, isOrtho);
  }) as N)();
}

// ─── Shading ────────────────────────────────────────────────────────────

/** A world-space direction in view space. */
function toView(worldDir: Node): N {
  return normalize(cameraViewMatrix.mul(vec4(worldDir as N, 0.0)).xyz);
}

/** A view-space direction in world space (for environment lookups). */
function toWorld(viewDir: Node): N {
  return normalize(cameraWorldMatrix.mul(vec4(viewDir as N, 0.0)).xyz);
}

/**
 * Analytic studio environment (view space): a cool sky / warm-neutral ground
 * hemisphere around world up, plus a broad overhead softbox band blurred by
 * roughness. No texture fetch.
 */
export const analyticEnvironment = (Fn(([dir, roughness]: [N, N]) => {
  const up = dot(dir, toView(vec3(0, 1, 0)));
  const sky = vec3(0.86, 0.9, 0.97);
  const horizon = vec3(0.62, 0.62, 0.64);
  const ground = vec3(0.3, 0.28, 0.27);
  const base = select(up.greaterThanEqual(0), mix(horizon, sky, up), mix(horizon, ground, up.negate()));
  const band = smoothstep(0.35, 0.95, up).mul(roughness.mul(0.7).oneMinus());
  return base.add(vec3(0.55).mul(band));
}) as N) as (dir: Node, roughness: Node) => Node;

// ─── Material presets ───────────────────────────────────────────────────

/**
 * The v9 look presets as (metalness, roughness, subsurface). Index 0 is the
 * per-element identity; 'transmission' falls back to 'glass' in impostors.
 */
export const LUPI_MATERIAL_PRESETS = {
  default: 0,
  matte: 1,
  metallic: 2,
  glass: 3,
  plastic: 4,
} as const;

export type LupiMaterialPresetName = keyof typeof LUPI_MATERIAL_PRESETS;

const PRESET_SURFACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], // unused: index 0 keeps the element's own values
  [0.05, 0.85, 0.0], // matte
  [0.8, 0.2, 0.0], // metallic
  [0.1, 0.1, 0.4], // glass
  [0.0, 0.4, 0.0], // plastic
];

/** The uniform value for a preset name (unknown names and 'transmission' as v9). */
export function materialPresetIndex(preset: string | undefined): number {
  if (preset === 'transmission') return LUPI_MATERIAL_PRESETS.glass;
  return (LUPI_MATERIAL_PRESETS as Record<string, number>)[preset ?? 'default'] ?? 0;
}

/**
 * Blend an element's own `vec3(metalness, roughness, subsurface)` toward a
 * preset by `intensity` (0 = element identity, 1 = full preset). Preset 0
 * leaves the element values unchanged at any intensity (v9 semantics).
 */
export function blendMaterialPreset(preset: Node, intensity: Node, element: Node): Node {
  return (Fn(() => {
    const p = preset as N;
    const elem = (element as N).toVar();
    const target = elem.toVar();
    for (let index = 1; index < PRESET_SURFACES.length; index += 1) {
      const [metal, rough, sss] = PRESET_SURFACES[index];
      If(p.equal(index), () => {
        target.assign(vec3(metal, rough, sss));
      });
    }
    return mix(elem, target, intensity as N);
  }) as N)();
}

// ─── Surface ────────────────────────────────────────────────────────────

export interface LupiSurfaceInput {
  /** View-space unit normal. */
  normal: Node;
  /** Linear base colour: the specular F0 tint and the metallic rim colour. */
  baseColor: Node;
  /**
   * Linear diffuse albedo when it differs from `baseColor` (the v9 texture
   * modes darken the diffuse, backlight and floor terms only). Defaults to
   * `baseColor`.
   */
  albedo?: Node;
  metalness: Node;
  /** Roughness including any user offset; the kit clamps it and adds specular AA. */
  roughness: Node;
  /** Clearcoat amount (tier 2). */
  clearcoat: Node;
  /** Surface polish offset, added to metalness (v9 uSurfacePolish). */
  polish: Node;
  /** Per-atom openness, 0 (buried) to 1. */
  occlusion: Node;
  occlusionStrength: Node;
  /** Linear emitted colour, added last. */
  emission: Node;
  /** Projected radius in device pixels (specular anti-aliasing). */
  pixelRadius: Node;
  subsurface: Node;
}

/**
 * Lupi's impostor BRDF in view space (V = +z). Returns linear RGB.
 * `tier` follows the v9 quality tiers (see the file header). Every value a
 * branch reads is materialized before the branch (G1).
 */
export function lupiSurface(
  s: LupiSurfaceInput,
  lights: LupiLightUniforms,
  env: LupiEnvBinding,
  tier: 0 | 1 | 2,
): Node {
  return (Fn(() => {
    const Nrm = (s.normal as N).toVar();
    const baseColor = (s.baseColor as N).toVar();
    const albedo = s.albedo ? (s.albedo as N).toVar() : baseColor;
    const V = vec3(0, 0, 1);
    const L = toView(lights.lightDir).toVar();
    const fillDir = toView(lights.fillLightDir).toVar();
    const rimDir = toView(lights.rimLightDir).toVar();
    const H = normalize(L.add(V));
    const NoL = max(dot(Nrm, L), 0.0).toVar();
    const NoV = max(dot(Nrm, V), 0.0).toVar();
    const NoH = max(dot(Nrm, H), 0.0).toVar();
    const LoH = max(dot(L, H), 0.0);

    const metalness = clamp((s.metalness as N).add(s.polish), 0.0, 1.0).toVar();
    const subsurface = (s.subsurface as N).toVar();
    const occlusion = s.occlusion as N;
    const occlusionStrength = s.occlusionStrength as N;
    // Specular AA: widen the lobe as the sphere's pixel footprint shrinks.
    const aaRoughness = clamp(float(1.6).div(max(s.pixelRadius as N, 1.0)), 0.0, 0.6).toVar();
    const roughness = max(clamp(s.roughness as N, 0.0, 1.0), aaRoughness).toVar();

    // Cook-Torrance: GGX D, Smith G, Schlick F.
    const alpha = roughness.mul(roughness);
    const a2 = alpha.mul(alpha);
    const dDen = NoH.mul(NoH).mul(a2.sub(1.0)).add(1.0);
    const D = a2.div(max(dDen.mul(dDen).mul(3.14159), 1e-6));
    const k = alpha.add(1.0).mul(alpha.add(1.0)).div(8.0);
    const G = NoV.div(NoV.mul(k.oneMinus()).add(k)).mul(NoL.div(NoL.mul(k.oneMinus()).add(k)));
    const F0 = mix(vec3(0.04), baseColor, metalness).toVar();
    const fresnelRamp = pow(LoH.oneMinus(), 5.0).toVar();
    const F = F0.add(vec3(1.0).sub(F0).mul(fresnelRamp)).toVar();
    const specular = F.mul(D.mul(G)).div(max(NoL.mul(NoV).mul(4.0), 1e-6)).toVar();

    if (tier >= 2) {
      // Clearcoat: a second, sharp dielectric lobe (F0 0.04, roughness 0.1)
      // over the base layer, which gives up the energy the coat reflects.
      const clearcoat = max(s.clearcoat as N, 0.0);
      const ccRoughness = max(float(0.1), aaRoughness);
      const ccAlpha = ccRoughness.mul(ccRoughness);
      const ccA2 = ccAlpha.mul(ccAlpha);
      const ccDen = NoH.mul(NoH).mul(ccA2.sub(1.0)).add(1.0);
      const ccD = ccA2.div(max(ccDen.mul(ccDen).mul(3.14159), 1e-6));
      const ccK = ccAlpha.add(1.0).mul(ccAlpha.add(1.0)).div(8.0);
      const ccG = NoV.div(NoV.mul(ccK.oneMinus()).add(ccK)).mul(NoL.div(NoL.mul(ccK.oneMinus()).add(ccK)));
      const ccF = vec3(0.04).add(vec3(0.96).mul(fresnelRamp));
      const ccSpecular = ccF.mul(ccD.mul(ccG)).div(max(NoL.mul(NoV).mul(4.0), 1e-6));
      specular.assign(specular.mul(vec3(1.0).sub(ccF.mul(clearcoat))).add(ccSpecular.mul(clearcoat)));
    }

    // Burley wrap diffuse, subsurface backlight, tinted fill.
    const wrapNoL = max(dot(Nrm, L).add(0.5).div(1.5), 0.0);
    const backLight = pow(max(dot(Nrm.negate(), L), 0.0), 3.0).mul(subsurface);
    const kD = vec3(1.0).sub(F).mul(metalness.oneMinus());
    const wrapNoL2 = max(dot(Nrm, fillDir).add(0.5).div(1.5), 0.0).mul(0.3);
    const ambientFloor = float(0.15).add(subsurface.mul(0.15)).add(metalness.mul(0.25));
    const openness = mix(1.0, occlusion, occlusionStrength).toVar();
    const directOcclusion = mix(1.0, occlusion, occlusionStrength.mul(0.5)).toVar();
    const key = lights.keyIntensity as N;

    // Fresnel rim: material-driven base plus the directional, tinted user rim.
    const rim = pow(NoV.oneMinus(), 4.0);
    const rimDirMask = max(dot(Nrm, rimDir), 0.0);
    const rimBase = mix(0.15, 0.5, metalness).add(subsurface.mul(0.4));
    const rimColor = mix(vec3(1.0), baseColor, metalness)
      .mul(rim)
      .mul(rimBase)
      .add((lights.rimLightColor as N).mul(rim).mul(lights.rimLight).mul(rimDirMask))
      .mul(openness);

    // Environment: the analytic studio, or (tier >= 1, with an environment)
    // the prefiltered scene.environment along world-space directions.
    const R = reflect(V.negate(), Nrm).toVar();
    const specRoughness = max(roughness, 0.18).toVar();
    const envSpec = vec3(0).toVar();
    const envAvg = vec3(0).toVar();
    const analytic = (): void => {
      envSpec.assign(analyticEnvironment(R, specRoughness));
      envAvg.assign((analyticEnvironment(Nrm, float(1.0)) as N).mul(0.8));
    };
    if (tier >= 1) {
      const worldR = toWorld(R).toVar();
      const worldN = toWorld(Nrm).toVar();
      If((env.hasEnv as N).greaterThan(0.5), () => {
        envSpec.assign(sampleEnvironment(env, worldR, specRoughness).rgb.mul(env.intensity));
        envAvg.assign(sampleEnvironment(env, worldN, float(1.0)).rgb.mul(env.intensity));
      }).Else(analytic);
    } else {
      analytic();
    }

    const envIrradiance = envAvg.mul(ambientFloor.add(0.4)).mul(openness).mul(lights.ambient);
    const diffuseIrradiance = envIrradiance
      .add(vec3(1.0).mul(wrapNoL).mul(0.7).mul(directOcclusion).mul(key))
      .add((lights.fillLightColor as N).mul(wrapNoL2).mul(openness));
    const color = kD
      .mul(albedo)
      .mul(diffuseIrradiance)
      .add(F0.mul(envSpec).mul(roughness.oneMinus().mul(0.5).add(0.5)).mul(openness))
      .add(specular.mul(NoL).mul(1.5).mul(directOcclusion).mul(key))
      .add(albedo.mul(backLight).mul(0.6))
      .add(rimColor)
      .add(s.emission as N);
    // Minimum visibility floor: no atom renders pure black.
    return max(color, albedo.mul(0.08).mul(openness));
  }) as N)();
}
