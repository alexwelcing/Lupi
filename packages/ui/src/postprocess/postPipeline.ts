/**
 * postPipeline.ts — the TSL post graph behind ScenePostprocessing (WP4).
 *
 * One graph per *structure* (which effects are on, and the tone-mapping
 * mode); every strength, radius and focus value is a uniform, so preset
 * tweaks, the intensity knob and play/pause never rebuild it.
 *
 * Chain (the v9 order; every step in linear light):
 *   scene pass → GTAO (depth-reconstructed normals, denoised) → bloom →
 *   depth of field → tone mapping (renderOutput, linear out) → vignette
 * The pipeline's own output transform (`outputColorTransform = true`, with
 * the renderer at NoToneMapping) is then the single sRGB encode (plan-final
 * D14), so the renderer never tone-maps and nothing encodes twice.
 *
 * v9 → port parameter map:
 * - N8AO `aoRadius` (Å)       → GTAO `radius` (view-space units = Å)
 *   N8AO `intensity`          → GTAO `scale` (ao^scale; 0 = no occlusion)
 * - Bloom intensity/threshold/smoothing → BloomNode strength/threshold/smoothWidth
 * - DOF focusDistance/focusRange/bokehScale → dof focusDistance/focalLength/bokehScale
 *   (world units; `focalLength` is the distance from the focal plane to full blur)
 * - Vignette offset/darkness  → the postprocessing library's default vignette,
 *   `rgb *= smoothstep(0.8, offset*0.799, |uv-0.5|*(darkness+offset))`
 * - ToneMapping ACES_FILMIC / REINHARD → renderOutput(ACESFilmic / Reinhard)
 *
 * The configured background stays out of the look: when the graph tone-maps
 * or vignettes, the scene pass also writes content coverage (backgroundMask.ts)
 * and each pixel gets back, in proportion to how much of it is background,
 * the difference between its raw colour and what tone mapping and vignette
 * alone would make of it. A plate pixel therefore shows its configured
 * colour exactly, while glow and defocus spilling over it are kept.
 */
import * as THREE from 'three/webgpu';
import type { Camera, Node, PassNode, UniformNode } from 'three/webgpu';
import { distance, float, mrt, output, renderOutput, smoothstep, uniform, uv, vec2, vec4 } from 'three/tsl';
import { ao, type default as GTAONode } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom, type default as BloomNode } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { dof, type default as DepthOfFieldNode } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import type { PostprocessPresetConfig, PostStructure } from './presets';
import { LUPI_CONTENT_OUTPUT, contentCoverage } from './backgroundMask';

export interface PostChain {
  /** The pipeline's `outputNode` (linear, tone-mapped; the pipeline encodes sRGB). */
  output: Node;
  /**
   * What the pipeline callback registers in `state.passes`. A disabled effect
   * is present as `undefined`, which overwrites a previous build's entry.
   */
  passes: Record<'ao' | 'bloom' | 'dof', Node | undefined>;
  ao: GTAONode | null;
  bloom: BloomNode | null;
  dof: DepthOfFieldNode | null;
  focusDistance: UniformNode<'float', number>;
  focusRange: UniformNode<'float', number>;
  bokehScale: UniformNode<'float', number>;
  vignetteOffset: UniformNode<'float', number>;
  vignetteDarkness: UniformNode<'float', number>;
  dispose(): void;
}

const TONE_MAPPING = {
  aces: THREE.ACESFilmicToneMapping,
  reinhard: THREE.ReinhardToneMapping,
} as const;

/** GTAO sample count (a shader constant; changing it recompiles). */
const AO_SAMPLES = 16;

/** Bloom mip blend radius (0..1), fixed across presets. */
const BLOOM_RADIUS = 0.4;

export function buildPostChain(
  scenePass: PassNode,
  camera: Camera,
  structure: PostStructure,
  options: { aoResolutionScale: number },
): PostChain {
  const focusDistance = uniform(3);
  const focusRange = uniform(4);
  const bokehScale = uniform(1);
  const vignetteOffset = uniform(0.5);
  const vignetteDarkness = uniform(0.3);

  // Tone mapping and vignette would restyle the background; keep it as set.
  const keepBackground = structure.toneMapping !== 'none' || structure.vignette;
  if (keepBackground) {
    const passMrt = mrt({ output, [LUPI_CONTENT_OUTPUT]: contentCoverage() });
    passMrt.setBlendMode(LUPI_CONTENT_OUTPUT, new THREE.BlendMode(THREE.MaterialBlending));
    passMrt.setClearColor(LUPI_CONTENT_OUTPUT, 0x000000, 0);
    scenePass.setMRT(passMrt);
  } else {
    scenePass.setMRT(null);
  }

  const raw: Node<'vec4'> = scenePass.getTextureNode('output');
  let color: Node<'vec4'> = raw;

  let aoNode: GTAONode | null = null;
  if (structure.ao) {
    const depth = scenePass.getTextureNode('depth');
    // No normal pass: GTAO reconstructs normals from depth, which the
    // ray-cast impostors write per fragment (a normal/MRT pass would run the
    // override material, not the impostor shader). Both factories take a
    // null normal node at runtime; the typings do not say so.
    const noNormals = null as unknown as Node;
    aoNode = ao(depth, noNormals, camera);
    aoNode.resolutionScale = options.aoResolutionScale;
    aoNode.samples.value = AO_SAMPLES;
    const occlusion = denoise(aoNode.getTextureNode(), depth, noNormals, camera) as unknown as Node<'vec4'>;
    color = vec4(color.rgb.mul(occlusion.r), color.a);
  }

  let bloomNode: BloomNode | null = null;
  if (structure.bloom) {
    bloomNode = bloom(color);
    bloomNode.radius.value = BLOOM_RADIUS;
    color = vec4(color.rgb.add(bloomNode.rgb), color.a);
  }

  let dofNode: DepthOfFieldNode | null = null;
  if (structure.dof) {
    dofNode = dof(color, scenePass.getViewZNode(), focusDistance, focusRange, bokehScale);
    color = dofNode as unknown as Node<'vec4'>;
  }

  // Tone mapping then vignette: the "look" every pixel gets.
  const look = (input: Node<'vec4'>): Node<'vec4'> => {
    let styled = input;
    if (structure.toneMapping !== 'none') {
      // Tone map only; the working space stays linear. The pipeline's output
      // transform encodes sRGB after the vignette.
      styled = renderOutput(styled, TONE_MAPPING[structure.toneMapping], THREE.LinearSRGBColorSpace);
    }
    if (structure.vignette) {
      // The postprocessing library's default vignette, written as
      // 1 - smoothstep(lo, hi, x) so the edges stay ordered (lo < hi).
      const radial = distance(uv(), vec2(0.5, 0.5)).mul(vignetteDarkness.add(vignetteOffset));
      const falloff = float(1).sub(smoothstep(vignetteOffset.mul(0.799), float(0.8), radial));
      styled = vec4(styled.rgb.mul(falloff), styled.a);
    }
    return styled;
  };

  color = look(color);

  if (keepBackground) {
    // Undo the look on background coverage: raw - look(raw) is exactly what
    // tone mapping and vignette took from an otherwise untouched pixel.
    const content = scenePass.getTextureNode(LUPI_CONTENT_OUTPUT).r.clamp(0, 1);
    const restore = raw.rgb.sub(look(raw).rgb).mul(float(1).sub(content));
    color = vec4(color.rgb.add(restore).max(0), color.a);
  }

  const disposables: Array<{ dispose(): void } | null> = [aoNode, bloomNode, dofNode];
  // dof() renders a non-texture input into its own RTT node; a texture input
  // (the scene pass's own output) is used as is and is not ours to dispose.
  const dofInput = dofNode?.textureNode as unknown as { isRTTNode?: boolean; dispose(): void } | undefined;
  if (dofInput?.isRTTNode) disposables.push(dofInput);

  return {
    output: color,
    passes: {
      ao: aoNode ?? undefined,
      bloom: bloomNode ?? undefined,
      dof: dofNode ?? undefined,
    },
    ao: aoNode,
    bloom: bloomNode,
    dof: dofNode,
    focusDistance,
    focusRange,
    bokehScale,
    vignetteOffset,
    vignetteDarkness,
    dispose() {
      for (const item of disposables) item?.dispose();
    },
  };
}

/** Push a config's strengths into an existing chain (never rebuilds). */
export function applyPostParams(chain: PostChain, config: PostprocessPresetConfig): void {
  if (chain.ao) {
    chain.ao.radius.value = Math.max(0.01, config.ssao.radius);
    chain.ao.scale.value = Math.max(0, config.ssao.intensity);
  }
  if (chain.bloom) {
    chain.bloom.strength.value = Math.max(0, config.bloom.intensity);
    chain.bloom.threshold.value = config.bloom.threshold;
    chain.bloom.smoothWidth.value = Math.max(0.001, config.bloom.smoothing);
  }
  chain.focusDistance.value = Math.max(0, config.dof.focusDistance);
  chain.focusRange.value = Math.max(0.001, config.dof.focusRange);
  chain.bokehScale.value = Math.max(0, config.dof.bokehScale);
  chain.vignetteOffset.value = config.vignette.offset;
  chain.vignetteDarkness.value = config.vignette.darkness;
}

/**
 * Autofocus on the orbit target, as v9 did: focus at the target's distance,
 * with the focus range widened for far views.
 */
export function autofocus(chain: PostChain, config: PostprocessPresetConfig, distanceToTarget: number): void {
  chain.focusDistance.value = Math.max(0, distanceToTarget);
  chain.focusRange.value = Math.max(config.dof.focusRange, Math.min(90, distanceToTarget * 0.08), 0.001);
}
