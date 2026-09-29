/**
 * domeMaterial.ts — the panorama backdrop (image/video dome, sphere or cube
 * backdrop, plain and grid patterns) as a node material.
 *
 * A 1:1 TSL port of the v9 GLSL in app/AppBackground.tsx: sample the
 * panorama through the mesh UVs (the dome geometry is mirrored, so the
 * panorama reads correctly from inside; UV sampling also avoids the mip seam
 * a per-pixel equirect lookup has at the wrap), or show the top/bottom
 * gradient for the `plain`/`grid` patterns, overlay the grid, then apply
 * saturation, contrast, brightness and the opacity fade toward the bottom
 * colour. Output is linear colour, opaque.
 *
 * The bag exposes `map` (the texture node; swap `.value`), `topColor`,
 * `bottomColor`, `opacity`, `brightness`, `saturation`, `contrast` and
 * `patternMode` (0 image, 1 plain, 2 grid).
 */
import * as THREE from 'three/webgpu';
import type { TextureNode, UniformNode } from 'three/webgpu';
import {
  Fn,
  clamp,
  dot,
  float,
  fract,
  max,
  mix,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { attachLupiUniforms } from '@atlas/scene';
import { markBackgroundMaterial } from '../postprocess/backgroundMask';

type N = any;

export type DomePatternMode = 0 | 1 | 2;

export interface DomeUniforms {
  [name: string]: { value: unknown };
  map: TextureNode;
  topColor: UniformNode<'color', THREE.Color>;
  bottomColor: UniformNode<'color', THREE.Color>;
  opacity: UniformNode<'float', number>;
  brightness: UniformNode<'float', number>;
  saturation: UniformNode<'float', number>;
  contrast: UniformNode<'float', number>;
  patternMode: UniformNode<'float', number>;
}

export interface DomeMaterialValues {
  map: THREE.Texture;
  top: THREE.ColorRepresentation;
  bottom: THREE.ColorRepresentation;
  opacity: number;
  brightness: number;
  saturation: number;
  contrast: number;
  patternMode: DomePatternMode;
}

export function createDomeMaterial(values: DomeMaterialValues): THREE.MeshBasicNodeMaterial {
  const bag: DomeUniforms = {
    // The graph samples this node itself, so swapping `.value` swaps the image.
    map: texture(values.map, uv()) as unknown as TextureNode,
    topColor: uniform(new THREE.Color(values.top)),
    bottomColor: uniform(new THREE.Color(values.bottom)),
    opacity: uniform(values.opacity),
    brightness: uniform(values.brightness),
    saturation: uniform(values.saturation),
    contrast: uniform(values.contrast),
    patternMode: uniform(values.patternMode),
  };

  const colorNode = Fn(() => {
    const vUv = uv().toVar();
    const texel = bag.map as N;
    const gradient = mix(bag.bottomColor, bag.topColor, smoothstep(0.0, 1.0, vUv.y));
    const mode = bag.patternMode as N;
    const color = vec3(select(mode.lessThan(0.5), texel.rgb, gradient)).toVar();

    const cell = fract(vUv.mul(vec2(24.0, 12.0))).toVar();
    const gridLine = max(
      max(float(1).sub(step(0.018, cell.x)), step(0.982, cell.x)),
      max(float(1).sub(step(0.024, cell.y)), step(0.976, cell.y)),
    );
    const gridColor = mix(vec3(0.92, 0.98, 1.0), vec3(0.15, 0.86, 0.9), 0.45);
    const isGrid = select(mode.greaterThan(1.5), float(1), float(0));
    color.assign(mix(color, gridColor, gridLine.mul(0.42).mul(isGrid)));

    const luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color.assign(mix(vec3(luma), color, bag.saturation));
    color.assign(color.sub(0.5).mul(bag.contrast).add(0.5));
    color.assign(color.mul(bag.brightness));
    color.assign(mix(bag.bottomColor, color, bag.opacity));
    return vec4(clamp(color, 0.0, 1.0), 1.0);
  })();

  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
  material.name = 'lupi-panorama-dome';
  material.colorNode = colorNode;
  attachLupiUniforms(material, bag);
  return markBackgroundMaterial(material);
}

export function domeUniforms(material: THREE.Material): DomeUniforms {
  return material.userData.lupiUniforms as DomeUniforms;
}

/** Push new values into a dome material's bag (no recompile). */
export function updateDomeMaterial(material: THREE.Material, values: DomeMaterialValues): void {
  const bag = domeUniforms(material);
  if (bag.map.value !== values.map) bag.map.value = values.map;
  bag.topColor.value.set(values.top);
  bag.bottomColor.value.set(values.bottom);
  bag.opacity.value = values.opacity;
  bag.brightness.value = values.brightness;
  bag.saturation.value = values.saturation;
  bag.contrast.value = values.contrast;
  bag.patternMode.value = values.patternMode;
}
