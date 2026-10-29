/**
 * captureLookPass.ts — the viewer's look on an export, on the GPU.
 *
 * renderSceneToPixels (renderTargetReadback.ts) assembles the supersampled
 * capture into output-sized targets: premultiplied linear HDR colour (alpha
 * holds the content coverage for an opaque capture whose look must leave the
 * background alone), and the nearest depth of each factor×factor block in a
 * depth texture. This pass then runs the configured look ONCE over the whole
 * assembled image, at the output resolution:
 *
 *   GTAO (depth-reconstructed normals, denoised) → bloom → depth of field →
 *   tone mapping → vignette, with the background restored where the look
 *   touched it (the live pipeline's backgroundMask rule)
 *
 * the same three nodes the live pipeline (postprocess/postPipeline.ts) uses,
 * on the same parameters. Running it after assembly, not per tile, is the
 * tile-seam answer: every stage sees the whole picture, so a multi-tile
 * 2160 px export has no seams, and bloom, AO and defocus keep the extent
 * relative to the image that the screen gives them at the export's size. It
 * also makes the look's cost independent of the supersampling factor.
 *
 * Determinism (per execution class): the node graphs are cached per shape and
 * fed through uniforms; every stage updates per render (not per frame), so two
 * captures in one frame each run every stage; the denoiser's noise texture is
 * replaced by a seeded one (three builds it with Math.random); the nodes read
 * the export's size through a drawing-buffer override held only for the pass.
 *
 * Transparent output keeps AO and tone mapping (on un-premultiplied colour);
 * captureLook.ts never asks it for bloom, defocus or a vignette.
 *
 * Under the Illustrate look there is no recipe, only the look's contour
 * (`look.inkContour`, postprocess/inkContour.ts, the node the live chain
 * runs): it inks the assembled image last, from the assembled depth and
 * coverage, with the line weight of an output-sized picture (one ink unit is
 * `inkPixelsPerUnit` output pixels, as the impostors drew it in the tiles).
 * Over a transparent background it inks the molecule only; the background
 * stays clear.
 */
import * as THREE from 'three/webgpu';
import type { Node, TextureNode } from 'three/webgpu';
import {
  distance,
  float,
  max,
  orthographicDepthToViewZ,
  perspectiveDepthToViewZ,
  renderOutput,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { ao, type default as GTAONode } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom, type default as BloomNode } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { dof, type default as DepthOfFieldNode } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { inkPixelsPerUnit } from '@atlas/scene';
import { toneMappingConstant } from '../postprocess/postPipeline';
import { inkContour } from '../postprocess/inkContour';
import { captureLookStructureKey, type CaptureLook } from './captureLook';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

/** GTAO sample count, as in the live pipeline. */
const AO_SAMPLES = 16;
/** Bloom mip blend radius, as in the live pipeline. */
const BLOOM_RADIUS = 0.4;
/** Seed of the denoiser's noise texture (fixed, so exports repeat). */
export const CAPTURE_LOOK_NOISE_SEED = 0x4c757069;

/** Recorded in the renderer fingerprint (DETERMINISM_V2.postprocessPipeline). */
export const CAPTURE_LOOK_PASS_ID = 'viewer-look-output-resolution.v1';

type LookCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

interface LookChain {
  material: THREE.NodeMaterial;
  quad: THREE.QuadMesh;
  camera: LookCamera;
  color: TextureNode;
  depth: TextureNode;
  ao: GTAONode | null;
  bloom: BloomNode | null;
  dof: DepthOfFieldNode | null;
  /** Nodes whose `updateBefore` must run on every capture render. */
  passes: Array<{ updateBeforeType: string }>;
  /** Internal targets to shrink after a capture (memory). */
  resizable: Array<{ setSize(width: number, height: number): void }>;
  near: { value: number };
  far: { value: number };
  focusDistance: { value: number };
  focusRange: { value: number };
  bokehScale: { value: number };
  vignetteOffset: { value: number };
  vignetteDarkness: { value: number };
  /** The ink contour: output pixels per ink unit, and its line widths (ink units). */
  inkUnit: { value: number };
  inkInner: { value: number };
  inkOuter: { value: number };
}

const chains = new Map<string, LookChain>();

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let seededNoise: THREE.DataTexture | null = null;

/** DenoiseNode's default noise (64², simplex), from a seeded generator. */
function seededDenoiseNoise(): THREE.DataTexture {
  if (seededNoise) return seededNoise;
  const size = 64;
  const simplex = new SimplexNoise({ random: mulberry32(CAPTURE_LOOK_NOISE_SEED) } as unknown as Math);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      const o = (i * size + j) * 4;
      data[o] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
      data[o + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
      data[o + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
      data[o + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
    }
  }
  const noise = new THREE.DataTexture(data, size, size);
  noise.wrapS = THREE.RepeatWrapping;
  noise.wrapT = THREE.RepeatWrapping;
  noise.needsUpdate = true;
  seededNoise = noise;
  return noise;
}

let placeholderColor: THREE.DataTexture | null = null;
function placeholder(): THREE.DataTexture {
  if (!placeholderColor) {
    placeholderColor = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    placeholderColor.needsUpdate = true;
  }
  return placeholderColor;
}

/** Make a node run its `updateBefore` on every render that uses it, not once per frame. */
function perRender(node: unknown, passes: LookChain['passes']): void {
  const target = node as { updateBeforeType?: string } | null;
  if (!target || typeof target.updateBeforeType !== 'string') return;
  target.updateBeforeType = 'render';
  passes.push(target as { updateBeforeType: string });
}

function buildChain(look: CaptureLook, transparent: boolean, coverage: boolean, orthographic: boolean): LookChain {
  const camera: LookCamera = orthographic ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera();
  const color: N = texture(placeholder());
  const depth: N = texture(placeholder());
  const near: N = uniform(0.1);
  const far: N = uniform(1000);
  const focusDistance: N = uniform(3);
  const focusRange: N = uniform(4);
  const bokehScale: N = uniform(1);
  const vignetteOffset: N = uniform(0.5);
  const vignetteDarkness: N = uniform(0.3);
  const inkUnit: N = uniform(1);
  const inkInner: N = uniform(1);
  const inkOuter: N = uniform(2);
  const passes: LookChain['passes'] = [];
  const resizable: LookChain['resizable'] = [];

  const raw: N = color.sample(uv());
  let lit: N = raw;

  let aoNode: GTAONode | null = null;
  if (look.ao) {
    const noNormals = null as unknown as Node;
    aoNode = ao(depth, noNormals, camera);
    aoNode.samples.value = AO_SAMPLES;
    aoNode.resolutionScale = 1;
    perRender(aoNode, passes);
    resizable.push(aoNode);
    const denoiser: N = denoise(aoNode.getTextureNode(), depth, noNormals, camera);
    perRender(denoiser, passes);
    if (denoiser.noiseNode) denoiser.noiseNode.value = seededDenoiseNoise();
    const occlusion: N = denoiser;
    lit = vec4(lit.rgb.mul(occlusion.r), lit.a);
  }

  let bloomNode: BloomNode | null = null;
  if (look.bloom && !transparent) {
    bloomNode = bloom(lit);
    bloomNode.radius.value = BLOOM_RADIUS;
    perRender(bloomNode, passes);
    resizable.push(bloomNode);
    lit = vec4(lit.rgb.add((bloomNode as N).rgb), lit.a);
  }

  let dofNode: DepthOfFieldNode | null = null;
  if (look.dof && !transparent) {
    const d: N = depth.sample(uv()).r;
    const viewZ: N = orthographic
      ? orthographicDepthToViewZ(d, near, far)
      : perspectiveDepthToViewZ(d, near, far);
    dofNode = dof(lit, viewZ, focusDistance, focusRange, bokehScale);
    perRender(dofNode, passes);
    resizable.push(dofNode as unknown as { setSize(width: number, height: number): void });
    const input = (dofNode as unknown as { textureNode?: unknown }).textureNode as
      { isRTTNode?: boolean; setSize?(w: number, h: number): void } | undefined;
    if (input?.isRTTNode) {
      perRender(input, passes);
      if (input.setSize) resizable.push(input as { setSize(w: number, h: number): void });
    }
    // The defocused colour; alpha (coverage or 1) stays the assembled one.
    lit = vec4((dofNode as N).rgb, raw.a);
  }

  const toneMapping = toneMappingConstant(look.toneMapping);
  const styled = (input: N): N => {
    // Tone map and vignette straight colour: a transparent capture is
    // premultiplied, an opaque one is not (its alpha is coverage).
    const alpha: N = input.a;
    let rgb: N = transparent ? input.rgb.div(max(alpha, 1e-4)) : input.rgb;
    if (toneMapping !== THREE.NoToneMapping) {
      rgb = (renderOutput(vec4(rgb, 1), toneMapping, THREE.LinearSRGBColorSpace) as N).rgb;
    }
    if (look.vignette && !transparent) {
      const radial = distance(uv(), vec2(0.5, 0.5)).mul(vignetteDarkness.add(vignetteOffset));
      const falloff = float(1).sub(smoothstep(vignetteOffset.mul(0.799), float(0.8), radial));
      rgb = rgb.mul(falloff);
    }
    return vec4(transparent ? rgb.mul(alpha) : rgb, alpha);
  };

  let out: N = styled(lit);
  if (coverage && !transparent) {
    // The background stays as configured: give back, in proportion to how
    // much of the pixel is background, what tone mapping and the vignette
    // alone took from it (postPipeline.ts).
    const content: N = raw.a.clamp(0, 1);
    const restore: N = raw.rgb.sub(styled(raw).rgb).mul(float(1).sub(content));
    out = vec4(out.rgb.add(restore).max(vec3(0)), out.a);
  }
  if (look.inkContour) {
    // The Illustrate look's contour, last: an opaque capture's alpha is its
    // coverage (and its colour straight), a transparent one's is its own.
    out = inkContour({
      color: out,
      alpha: transparent ? out.a : float(1),
      depth,
      coverage: (at: N) => color.sample(at).a,
      projectionMatrix: uniform(camera.projectionMatrix),
      viewMatrix: uniform(camera.matrixWorldInverse),
      near,
      far,
      unit: inkUnit,
      strength: float(1),
      inner: inkInner,
      outer: inkOuter,
    });
  }
  const final: N = transparent
    ? vec4(out.rgb.max(vec3(0)).min(vec3(out.a.clamp(0, 1))), out.a.clamp(0, 1))
    : vec4(out.rgb.max(vec3(0)), 1);

  const material = new THREE.NodeMaterial();
  material.name = `lupi-capture-look:${captureLookStructureKey(look, transparent, coverage)}`;
  material.fragmentNode = final;
  material.depthTest = false;
  material.depthWrite = false;
  material.blending = THREE.NoBlending;
  material.toneMapped = false;
  material.fog = false;

  return {
    material,
    quad: new THREE.QuadMesh(material),
    camera,
    color,
    depth,
    ao: aoNode,
    bloom: bloomNode,
    dof: dofNode,
    passes,
    resizable,
    near,
    far,
    focusDistance,
    focusRange,
    bokehScale,
    vignetteOffset,
    vignetteDarkness,
    inkUnit,
    inkInner,
    inkOuter,
  };
}

export interface CaptureLookPassOptions {
  renderer: THREE.WebGPURenderer;
  look: CaptureLook;
  transparent: boolean;
  /** Alpha of `color` carries content coverage (opaque, background-preserving look). */
  coverage: boolean;
  /** The capture camera with its full-image projection (no view offset). */
  camera: THREE.Camera;
  /** Assembled premultiplied linear colour, output-sized. */
  color: THREE.Texture;
  /** Assembled nearest depth, output-sized. */
  depth: THREE.Texture;
  /** Where the styled image goes (HalfFloat, output-sized). */
  target: THREE.RenderTarget;
  width: number;
  height: number;
}

/**
 * Run the look over the assembled capture into `target`. Synchronous: every
 * render happens in the call; renderer state is restored before it returns.
 */
export function renderCaptureLook(options: CaptureLookPassOptions): void {
  const { renderer, look, transparent, coverage, camera, width, height } = options;
  const orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
  const key = `${captureLookStructureKey(look, transparent, coverage)}|${orthographic ? 'ortho' : 'persp'}`;
  let chain = chains.get(key);
  if (!chain) {
    chain = buildChain(look, transparent, coverage, orthographic);
    chains.set(key, chain);
  }

  // The chain's own camera carries the capture camera's matrices in place,
  // so the AO and denoise uniforms (bound to its matrix objects) follow.
  (chain.camera as THREE.Camera).copy(camera as THREE.Camera, false);
  chain.camera.updateMatrixWorld(true);
  chain.camera.projectionMatrixInverse.copy(chain.camera.projectionMatrix).invert();
  const viewCamera = camera as LookCamera;
  chain.near.value = viewCamera.near ?? 0.1;
  chain.far.value = viewCamera.far ?? 1000;

  chain.color.value = options.color;
  chain.depth.value = options.depth;
  if (chain.ao && look.ao) {
    chain.ao.radius.value = Math.max(0.01, look.ao.radius);
    chain.ao.scale.value = Math.max(0, look.ao.intensity);
  }
  if (chain.bloom && look.bloom) {
    chain.bloom.strength.value = Math.max(0, look.bloom.intensity);
    chain.bloom.threshold.value = look.bloom.threshold;
    chain.bloom.smoothWidth.value = Math.max(0.001, look.bloom.smoothing);
  }
  if (look.dof) {
    chain.focusDistance.value = Math.max(0, look.dof.focusDistance);
    chain.focusRange.value = Math.max(0.001, look.dof.focusRange);
    chain.bokehScale.value = Math.max(0, look.dof.bokehScale);
  }
  if (look.vignette) {
    chain.vignetteOffset.value = look.vignette.offset;
    chain.vignetteDarkness.value = look.vignette.darkness;
  }
  if (look.inkContour) {
    chain.inkUnit.value = inkPixelsPerUnit({ pixelScale: 1, width, height });
    chain.inkInner.value = Math.max(0, look.inkContour.inner);
    chain.inkOuter.value = Math.max(0, look.inkContour.outer);
  }

  // The stages size their targets from the drawing buffer: give them the
  // export's size for exactly this pass.
  const host = renderer as unknown as { getDrawingBufferSize: (target: THREE.Vector2) => THREE.Vector2 };
  const hadOwn = Object.prototype.hasOwnProperty.call(host, 'getDrawingBufferSize');
  const previousOwn = host.getDrawingBufferSize;
  host.getDrawingBufferSize = (target: THREE.Vector2) => target.set(width, height);
  const previousTarget = renderer.getRenderTarget();
  const previousMrt = renderer.getMRT();
  const previousAutoClear = renderer.autoClear;
  try {
    renderer.setMRT(null);
    renderer.setRenderTarget(options.target);
    renderer.autoClear = false;
    chain.quad.render(renderer);
  } finally {
    if (hadOwn) host.getDrawingBufferSize = previousOwn;
    else delete (host as { getDrawingBufferSize?: unknown }).getDrawingBufferSize;
    renderer.autoClear = previousAutoClear;
    renderer.setMRT(previousMrt);
    renderer.setRenderTarget(previousTarget);
    // The texture nodes keep their last (soon disposed) targets: swapping in
    // a placeholder of another kind would change the compiled bindings.
    // Release the stages' export-sized targets; they regrow on the next capture.
    for (const stage of chain.resizable) stage.setSize(1, 1);
  }
}
