/**
 * filterShellMaterial.ts — the "atmosphere" sphere around a molecule: one
 * camera-responsive fresnel surface, as a node material.
 *
 * A 1:1 TSL port of the v9 GLSL in MoleculeFilterShell.tsx: a fresnel rim
 * that shifts between the edge and accent colours with a pearl pattern, a
 * soft sheen highlight, and an alpha that is nearly clear face-on and dense
 * at grazing angles. Drawn from the inside (BackSide), transparent, without
 * depth writes. Output is linear colour.
 *
 * The bag exposes `uFill`, `uEdge`, `uAccent` and `uOpacity`;
 * `material.userData.lupiShader` is 'fresnel'.
 */
import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import {
  Fn,
  abs,
  dot,
  float,
  max,
  mix,
  normalView,
  normalize,
  positionLocal,
  positionView,
  pow,
  sin,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { LUPI_SHADER_TAG_KEY, attachLupiUniforms } from '@atlas/scene';

type N = any;

export interface FilterShellUniforms {
  [name: string]: { value: unknown };
  uFill: UniformNode<'color', THREE.Color>;
  uEdge: UniformNode<'color', THREE.Color>;
  uAccent: UniformNode<'color', THREE.Color>;
  uOpacity: UniformNode<'float', number>;
}

export interface FilterShellColors {
  fill: THREE.ColorRepresentation;
  edge: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
}

export function createFilterShellMaterial(colors: FilterShellColors, opacity: number): THREE.MeshBasicNodeMaterial {
  const bag: FilterShellUniforms = {
    uFill: uniform(new THREE.Color(colors.fill)),
    uEdge: uniform(new THREE.Color(colors.edge)),
    uAccent: uniform(new THREE.Color(colors.accent)),
    uOpacity: uniform(opacity),
  };

  const colorNode = Fn(() => {
    const local = normalize(positionLocal).toVar();
    const facing = abs(dot(normalize(normalView), normalize((positionView as N).negate()))).toVar();
    const fresnel = pow(float(1).sub(facing), 2.6).toVar();
    const pearl = sin(local.y.mul(4).add(local.x.mul(3)).add(facing.mul(6))).mul(0.5).add(0.5);
    const rim = mix(bag.uEdge, bag.uAccent, pearl);
    const color = mix(bag.uFill, rim, fresnel.mul(0.75).add(0.25)).toVar();
    const sheen = pow(max(0.0, dot(local, normalize(vec3(-0.5, 0.8, 0.4)))), 20.0).toVar();
    color.assign(mix(color, vec3(1.0), sheen.mul(0.5)));
    const alpha = bag.uOpacity.mul(fresnel.mul(0.9).add(0.035).add(sheen.mul(0.15)));
    return vec4(color, alpha);
  })();

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  material.name = 'lupi-filter-shell';
  material.colorNode = colorNode;
  material.userData[LUPI_SHADER_TAG_KEY] = 'fresnel';
  attachLupiUniforms(material, bag);
  return material;
}

export function filterShellUniforms(material: THREE.Material): FilterShellUniforms {
  return material.userData.lupiUniforms as FilterShellUniforms;
}
