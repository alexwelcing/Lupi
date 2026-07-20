import * as THREE from 'three';

/** Three instance/vertex color attributes are linear-sRGB. Viewer palettes and
 * authored hex/colormap tuples are display-sRGB, so decode once before upload. */
export function writeDisplayRgbAsLinear(
  target: Float32Array,
  offset: number,
  displayRgb: readonly [number, number, number],
  scratch: THREE.Color,
): void {
  scratch.setRGB(displayRgb[0], displayRgb[1], displayRgb[2], THREE.SRGBColorSpace);
  target[offset] = scratch.r;
  target[offset + 1] = scratch.g;
  target[offset + 2] = scratch.b;
}
