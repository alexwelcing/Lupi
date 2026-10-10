/**
 * backgroundMask.ts — which scene-pass pixels are the configured background.
 *
 * The toned presets (tone mapping and vignette) are for the molecule; the
 * background should read as the colour the user picked. ACES crushes the dark
 * plates (#101817 came out at about (3,5,5)) and the vignette darkened them
 * further, so the post chain composites the background back in untouched.
 *
 * The scene pass then writes one extra MRT output, `lupiContent`: 1 for every
 * draw that is scene content, 0 for background draws. It blends like the
 * material itself (coverage), so a translucent label over the plate counts
 * by its alpha. Background draws are three's own `scene.background` mesh and
 * every material flagged with `markBackgroundMaterial` (the panorama dome,
 * backdrops, the procedural sky and its field); cleared pixels read 0.
 *
 * Its second channel carries the Light Fuse's offset (scene tsl/inkFuse.ts,
 * `LUPI_FUSE_OFFSET`): how far an impostor fragment's ink mix stands from
 * the look's fade, `uInkMix`. It is 0 everywhere else, and everywhere when
 * no fuse burns, so `uInkMix` plus it is the live ink mix of every pixel,
 * which the post recipe follows while the look changes (postPipeline.ts).
 *
 * Only the pipeline's scene pass carries this output. A material never sets
 * `mrtNode` for it: a material-level MRT would replace the colour output of
 * every other render into a target (export capture, PMREM, transmission).
 */
import type * as THREE from 'three/webgpu';
import { Fn, diffuseColor, float, vec4 } from 'three/tsl';
import { LUPI_FUSE_OFFSET } from '@atlas/scene';

/** `material.userData` flag for background materials. */
export const LUPI_BACKGROUND_MATERIAL_KEY = 'lupiBackground';

/** The scene pass MRT output name that carries content coverage. */
export const LUPI_CONTENT_OUTPUT = 'lupiContent';

/** three's own material for `scene.background` textures and nodes. */
const THREE_BACKGROUND_MATERIAL_NAME = 'Background.material';

export function markBackgroundMaterial<T extends THREE.Material>(material: T): T {
  material.userData[LUPI_BACKGROUND_MATERIAL_KEY] = true;
  return material;
}

export function isBackgroundMaterial(material: THREE.Material | null | undefined): boolean {
  if (!material) return false;
  return material.name === THREE_BACKGROUND_MATERIAL_NAME
    || material.userData?.[LUPI_BACKGROUND_MATERIAL_KEY] === true;
}

/**
 * The `lupiContent` value for the material being built: (content, the fuse
 * offset, 0, the material's alpha), so material blending turns it into
 * coverage. Decided per material at build time; background and content
 * materials never share a graph, so they never share a compiled program.
 * Materials that never write the offset read its placeholder, 0.
 */
export const contentCoverage = Fn((builder) => {
  const background = isBackgroundMaterial(builder.material as THREE.Material | null | undefined);
  return vec4(float(background ? 0 : 1), LUPI_FUSE_OFFSET, 0, diffuseColor.a);
});
