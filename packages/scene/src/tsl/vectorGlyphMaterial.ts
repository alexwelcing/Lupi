/**
 * vectorGlyphMaterial.ts — per-atom vector arrows as a TSL node material
 * (port of the v9 GLSL in VectorGlyphs.tsx).
 *
 * One ribbon quad per glyph: x across [-1, 1], y along [0, 1]. The vertex
 * stage lerps position and vector by `uProgress`, orients the ribbon along the
 * vector and turns it about that axis to face the camera (a cylindrical
 * billboard), sizes it from the magnitude (`uScale`, capped at `uMaxLen`) and
 * looks the colour up in a 256×1 colormap by magnitude. The fragment carves the
 * shaft + head silhouette with a hard discard (as v9, plan-final D6) and
 * darkens toward the ribbon edge.
 *
 * - The colormap is an RGBA8 sRGB DataTexture read with `textureLoad` in the
 *   vertex stage (WGSL has no vertex-stage sampling); the hardware decodes it to
 *   linear, and the renderer output encodes once (D14): no colorspace chunk.
 * - The vertex stage uses `mix`/`step` instead of `select`: a select lowers to
 *   if/else, and a value it shares with a varying would be emitted inside one
 *   branch only (spike G1).
 * - The billboard works in the mesh's local space (the camera position is
 *   brought into it), so a transformed parent places the arrows correctly.
 * - Each arrow's foot rides display motion (arrival, ripple, the Play verbs)
 *   with its atom: the instance position holds the atom's own float32
 *   coordinates, so `lupiDisplayOffset` hashes the same seed and returns the
 *   atom's offset. Exactly zero at rest and in every capture.
 */
import * as THREE from 'three/webgpu';
import type { TextureNode, UniformNode } from 'three/webgpu';
import {
  Discard,
  Fn,
  abs,
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  clamp,
  cross,
  floor,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  modelViewMatrix,
  modelWorldMatrixInverse,
  normalize,
  positionGeometry,
  smoothstep,
  step,
  texture,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { LUPI_SHADER_TAG_KEY, attachLupiUniforms, type LupiUniformBag } from './lupiUniforms';
import { lupiDisplayOffset } from './displayMotion';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

export const GLYPH_ATTR = {
  position: 'instancePosition',
  target: 'instanceTargetPosition',
  vector: 'instanceVector',
  targetVector: 'instanceTargetVector',
} as const;

/** Colormap texels (v9: 256×1). */
export const GLYPH_COLORMAP_SIZE = 256;

export interface VectorGlyphUniforms extends LupiUniformBag {
  /** 0..1 frame interpolation. */
  uProgress: UniformNode<'float', number>;
  /** World length per magnitude unit. */
  uScale: UniformNode<'float', number>;
  /** World-length cap per arrow. */
  uMaxLen: UniformNode<'float', number>;
  /** Arrow half-width at the head, world units. */
  uWidth: UniformNode<'float', number>;
  /** Magnitude → colormap normalization (min, max). */
  uMagRange: UniformNode<'vec2', THREE.Vector2>;
  /** The colormap texture node; `.value` is the 256×1 RGBA8 sRGB DataTexture. */
  uColormap: TextureNode;
}

export interface VectorGlyphMaterial {
  material: THREE.MeshBasicNodeMaterial;
  uniforms: VectorGlyphUniforms;
}

/** An empty 256×1 RGBA8 sRGB colormap (nearest, no mipmaps) for the caller to fill. */
export function createGlyphColormapTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Uint8Array(GLYPH_COLORMAP_SIZE * 4),
    GLYPH_COLORMAP_SIZE,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createVectorGlyphMaterial(colormap: THREE.DataTexture): VectorGlyphMaterial {
  const uniforms: VectorGlyphUniforms = {
    uProgress: uniform(0),
    uScale: uniform(1),
    uMaxLen: uniform(3),
    uWidth: uniform(0.25),
    uMagRange: uniform(new THREE.Vector2(0, 1)),
    uColormap: texture(colormap) as unknown as TextureNode,
  };
  const u = uniforms as unknown as Record<keyof VectorGlyphUniforms, N>;

  // ── Vertex stage ────────────────────────────────────────────────────
  const rawP: N = attribute(GLYPH_ATTR.position, 'vec3');
  const restP: N = mix(rawP, attribute(GLYPH_ATTR.target, 'vec3'), u.uProgress);
  // The foot follows its atom's display offset (bit-identical seed source).
  const P: N = restP.add(lupiDisplayOffset(restP, rawP) as N).toVar('glyphFoot');
  const V: N = mix(attribute(GLYPH_ATTR.vector, 'vec3'), attribute(GLYPH_ATTR.targetVector, 'vec3'), u.uProgress);
  const mag: N = length(V);

  const t: N = clamp(mag.sub(u.uMagRange.x).div(max(u.uMagRange.y.sub(u.uMagRange.x), 1e-20)), 0.0, 1.0);
  // Nearest texel at u = t, as v9's texture2D(uColormap, vec2(t, 0.5)).
  const texel: N = int(min(floor(t.mul(GLYPH_COLORMAP_SIZE)), GLYPH_COLORMAP_SIZE - 1));
  const color: N = (u.uColormap.load(ivec2(texel, int(0))) as N).rgb;

  const len: N = min(mag.mul(u.uScale), u.uMaxLen);
  // v9: mag > 1e-12 ? V / mag : +z.
  const axis: N = mix(vec3(0.0, 0.0, 1.0), V.div(max(mag, 1e-30)), step(1e-12, mag));

  // Cylindrical billboard: turn the ribbon about the arrow axis to face the
  // camera. Degenerates only when the axis points straight at the camera;
  // then any side vector works.
  const cameraLocal: N = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
  const sideRaw: N = cross(axis, cameraLocal.sub(P));
  const sideLen: N = length(sideRaw);
  const fallbackSide: N = normalize(cross(axis, vec3(0.0, 1.0, 0.01)));
  const side: N = mix(fallbackSide, sideRaw.div(max(sideLen, 1e-6)), step(1e-6, sideLen));

  // Width tapers with very short arrows so tiny vectors don't read as blobs.
  const width: N = u.uWidth.mul(clamp(len.div(max(u.uMaxLen.mul(0.35), 1e-6)), 0.35, 1.0));

  const corner: N = positionGeometry.xy;
  const local: N = P.add(axis.mul(corner.y.mul(len))).add(side.mul(corner.x.mul(width)));

  const vColor: N = varying(color, 'vGlyphColor');
  const vUv: N = varying(corner, 'vGlyphUv');
  const vLen: N = varying(len, 'vGlyphLen');

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'lupi-vector-glyph';
  material.side = THREE.DoubleSide;
  material.fog = false;
  // Vector fields are an analytical overlay: drawn above the structure (see
  // VectorGlyphs.tsx), opaque, hard-edged.
  material.transparent = false;
  material.depthTest = false;
  material.depthWrite = false;

  material.vertexNode = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(local, 1.0)));

  material.colorNode = (Fn(() => {
    Discard(vLen.lessThanEqual(1e-6));
    // Arrow silhouette in ribbon space: shaft up to y = 0.62, head 0.62..1.
    const ax = abs(vUv.x).toVar();
    const inShaft = step(ax, 0.22).mul(step(vUv.y, 0.62));
    const headHalf = vUv.y.oneMinus().div(0.38).toVar(); // 1 at the head base → 0 at the tip
    const inHead = step(0.62, vUv.y).mul(step(ax, headHalf));
    Discard(inShaft.add(inHead).lessThan(0.5));
    // Cheap shading: darken toward the ribbon edge for a rounded read.
    const edge = smoothstep(0.0, 1.0, ax.div(max(headHalf, 0.22))).mul(0.35).oneMinus();
    return vec4(vColor.mul(edge), 1.0);
  }) as N)();

  material.userData[LUPI_SHADER_TAG_KEY] = 'vector-glyph';
  attachLupiUniforms(material, uniforms);
  return { material, uniforms };
}
