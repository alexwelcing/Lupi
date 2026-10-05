// The stand-in box of /scale (scale-spec §9.2: "a box in the aggregate
// colour, with optional lattice shading"). A solid node's box is exact up to
// atom bumps, so a googolplex at desk size is one box; the lattice is what
// shows the scale: lines every base^j grid units in the box's own units, the
// finest a few pixels apart, each level fading in as it opens up. A box and
// its descendant three levels down draw the same lines, so wraps (§8.8) leave
// the picture unchanged.

import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  ceil,
  float,
  fract,
  fwidth,
  log,
  max,
  min,
  normalGeometry,
  positionGeometry,
  pow,
  smoothstep,
  varying,
  vec3,
} from 'three/tsl';

// Graph-building code works on untyped nodes (as in packages/scene/src/tsl).
type N = any;

export const BOX_ATTR = { cells: 'aCells', grid: 'aGrid' } as const;

/** Pixels between the finest lines drawn. */
const MIN_PX = 5;

/** The unit cube [0, 1]³ the box instances scale. */
export function createBoxGeometry(capacity: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0.5, 0.5, 0.5);
  geometry.setAttribute(BOX_ATTR.cells, new THREE.InstancedBufferAttribute(new Float32Array(3 * capacity), 3));
  geometry.setAttribute(BOX_ATTR.grid, new THREE.InstancedBufferAttribute(new Float32Array(3 * capacity), 3));
  return geometry;
}

/** One axis's lines: three levels from the finest open one, in pixels. */
function axisLines(x: N, base: N, jMin: N): N {
  const fw: N = max(fwidth(x), float(1e-9));
  // The finest level whose lines are at least MIN_PX apart, never below the seed (jMin).
  const j0: N = max(jMin, ceil(log(fw.mul(MIN_PX)).div(log(base))));
  let strength: N = float(0);
  for (let i = 0; i < 3; i += 1) {
    const s: N = pow(base, j0.add(i));
    const px: N = s.div(fw);
    // Distance to the nearest line, in pixels; a 1 px line, antialiased.
    const d: N = abs(fract(x.div(s).add(0.5)).sub(0.5)).mul(px);
    const line: N = float(1).sub(smoothstep(0.35, 1.35, d));
    // Weight by spacing, so a level fades in as it opens up and no level pops.
    const weight: N = smoothstep(MIN_PX, MIN_PX * 40, px).mul(0.55).add(0.08);
    strength = max(strength, line.mul(weight).mul(smoothstep(MIN_PX * 0.8, MIN_PX * 1.6, px)));
  }
  return strength;
}

export function createBoxMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.02 });
  const cells: N = attribute(BOX_ATTR.cells, 'vec3');
  const grid: N = attribute(BOX_ATTR.grid, 'vec3');
  const gridPos: N = varying((positionGeometry as N).mul(cells), 'vScaleGridPos');
  const vGrid: N = varying(grid, 'vScaleGrid');
  const vNormal: N = varying(normalGeometry, 'vScaleGridNormal');
  const base: N = max(vGrid.x, float(2));
  const jMin: N = vGrid.y;
  // Only the two axes in a face's plane carry lines.
  const lx: N = axisLines(gridPos.x, base, jMin).mul(float(1).sub(abs(vNormal.x)));
  const ly: N = axisLines(gridPos.y, base, jMin).mul(float(1).sub(abs(vNormal.y)));
  const lz: N = axisLines(gridPos.z, base, jMin).mul(float(1).sub(abs(vNormal.z)));
  const lines: N = max(lx, max(ly, lz)).mul(vGrid.z);
  // Darker lines on the aggregate colour (instanceColor multiplies this).
  material.colorNode = vec3(float(1).sub(min(lines, float(0.8)).mul(0.6)));
  return material;
}

/** Splats (§9.2's stand-in for leaves and groups): plain lit spheres in the aggregate colour. */
export function createSplatMaterial(): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.0 });
}
