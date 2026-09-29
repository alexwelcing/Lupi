/**
 * lupiUniforms.ts — the uniform-bag convention for Lupi node materials.
 *
 * Every Lupi node material exposes its TSL `uniform()` nodes as
 * `material.userData.lupiUniforms` (plan-final §4.8). Tests, the export
 * readiness code and DevProbe read uniforms only through this bag, never
 * through GLSL `material.uniforms`, which node materials do not have.
 */
import type * as THREE from 'three/webgpu';

export type LupiUniformBag = Record<string, { value: unknown }>;

export const LUPI_UNIFORMS_KEY = 'lupiUniforms';

/**
 * `material.userData[LUPI_SHADER_TAG_KEY]` names what a node material is, where
 * a GLSL test used to search the shader source (e.g. 'fresnel' on the filter
 * shell).
 */
export const LUPI_SHADER_TAG_KEY = 'lupiShader';

/** Publish `bag` on the material and return it (typed) for the caller to keep. */
export function attachLupiUniforms<T extends LupiUniformBag>(m: THREE.Material, bag: T): T {
  m.userData[LUPI_UNIFORMS_KEY] = bag;
  return bag;
}

/** The bag attached to a material, if any. */
export function getLupiUniforms(m: THREE.Material): LupiUniformBag | undefined {
  return m.userData?.[LUPI_UNIFORMS_KEY] as LupiUniformBag | undefined;
}

/** The current value of one uniform in the material's bag. */
export function readLupiUniform<T = unknown>(m: THREE.Material, name: string): T | undefined {
  return getLupiUniforms(m)?.[name]?.value as T | undefined;
}
