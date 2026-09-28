/**
 * skyMaterial.ts — the procedural mathematical sky (the `procedural`
 * background presets) as a node material, for WebGPU and its WebGL2 backend.
 *
 * A 1:1 TSL port of the v9 GLSL sky in ProceduralBackground.tsx: a vertical
 * top/bottom gradient, one of five animated fields (gyroid manifold, Hopf
 * currents, harmonic bloom, reaction lattice, moiré crystal) sampled on the
 * view direction and along ten shells of depth, fbm mist and a star field.
 *
 * The variant is baked into the graph (a new material per variant), so the
 * shader has no per-pixel variant branches. The output is linear colour; the
 * renderer output (or the post pipeline) encodes sRGB (plan-final D14), as
 * v9's composer did.
 *
 * The bag (`material.userData.lupiUniforms`) exposes `uTime`, `uTop` and
 * `uBottom`.
 */
import * as THREE from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import {
  Fn,
  Loop,
  abs,
  atan,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { attachLupiUniforms } from '@atlas/scene';
import type { ProceduralBackgroundVariant } from '../backgroundPresets';

// Graph-building code works on untyped nodes: the @types/three 0.186 node
// typings are too narrow for swizzles and chained math (spike G13).
type N = any;

export const SKY_VARIANT_INDEX: Record<ProceduralBackgroundVariant, number> = {
  'manifold-field': 0,
  'hopf-current': 1,
  'harmonic-bloom': 2,
  'reaction-lattice': 3,
  'moire-crystal': 4,
};

export interface SkyUniforms {
  [name: string]: { value: unknown };
  /** Seconds of animated time (advanced by the caller, scaled by speed). */
  uTime: UniformNode<'float', number>;
  uTop: UniformNode<'color', THREE.Color>;
  uBottom: UniformNode<'color', THREE.Color>;
}

const hash3 = Fn(([p]: [N]) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453123))).setLayout({
  name: 'lupiSkyHash',
  type: 'float',
  inputs: [{ name: 'p', type: 'vec3' }],
});

const noise3 = Fn(([p]: [N]) => {
  const i = (floor(p) as N).toVar();
  const f0 = (fract(p) as N).toVar();
  const f = (f0.mul(f0).mul(float(3).sub(f0.mul(2))) as N).toVar();
  const n000 = hash3(i);
  const n100 = hash3(i.add(vec3(1, 0, 0)));
  const n010 = hash3(i.add(vec3(0, 1, 0)));
  const n110 = hash3(i.add(vec3(1, 1, 0)));
  const n001 = hash3(i.add(vec3(0, 0, 1)));
  const n101 = hash3(i.add(vec3(1, 0, 1)));
  const n011 = hash3(i.add(vec3(0, 1, 1)));
  const n111 = hash3(i.add(vec3(1, 1, 1)));
  const nxy0 = mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y);
  const nxy1 = mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y);
  return mix(nxy0, nxy1, f.z);
}).setLayout({
  name: 'lupiSkyNoise',
  type: 'float',
  inputs: [{ name: 'p', type: 'vec3' }],
});

const fbm3 = Fn(([p0]: [N]) => {
  const value = float(0).toVar();
  const p = vec3(p0).toVar();
  let amp = 0.5;
  for (let octave = 0; octave < 4; octave += 1) {
    value.addAssign(noise3(p).mul(amp));
    p.assign(p.mul(2.03).add(vec3(9.17, 2.31, 5.73)));
    amp *= 0.5;
  }
  return value;
}).setLayout({
  name: 'lupiSkyFbm',
  type: 'float',
  inputs: [{ name: 'p', type: 'vec3' }],
});

const gyroid = (p: N): N => dot(sin(p) as N, cos(p.zxy) as N);

const line = (value: N, width: number): N => float(1).sub(smoothstep(0, width, abs(value)));

/** One variant's field at `p` and time `t` (the v9 `variantField`). */
function variantFieldFn(variant: number) {
  return Fn(([p, t]: [N, N]) => {
    if (variant === 1) {
      const lon = atan(p.z, p.x);
      const lat = atan(p.y, length(p.xz));
      return line(sin(lon.mul(12).add(lat.mul(10)).add(t.mul(1.75))), 0.1)
        .add(line(length(p.xz).sub(0.72), 0.12).mul(0.55));
    }
    if (variant === 2) {
      const wave = sin(p.x.mul(4).add(t))
        .add(sin(p.y.mul(5).sub(t.mul(0.7))))
        .add(sin(p.z.mul(6).add(t.mul(0.5))))
        .toVar();
      return smoothstep(1.0, 2.35, wave).add(line(sin(wave.mul(7)), 0.11).mul(0.35));
    }
    if (variant === 3) {
      const cells = fbm3(p.mul(3.2).add(vec3(t.mul(0.2), t.mul(-0.15), t.mul(0.1))));
      return line(sin(cells.mul(18).add(gyroid(p.mul(1.4)))), 0.18);
    }
    if (variant === 4) {
      const a = sin(dot(p, normalize(vec3(1.0, 0.2, 0.4))).mul(8).add(t)).toVar();
      const b = sin(dot(p, normalize(vec3(-0.5, 0.9, 0.2))).mul(8.4).sub(t.mul(0.8))).toVar();
      const c = sin(dot(p, normalize(vec3(0.35, 0.5, -0.8))).mul(7.6).add(t.mul(0.5)));
      return line(a, 0.08).mul(0.36)
        .add(line(b, 0.08).mul(0.34))
        .add(smoothstep(0.82, 0.995, abs(a.mul(b).mul(c))).mul(0.58));
    }
    return line(gyroid(p.mul(2.2).add(vec3(t.mul(0.5), t.mul(-0.3), t.mul(0.2)))), 0.17)
      .mul(fbm3(p.mul(1.6)).mul(0.5).add(0.55));
  }).setLayout({
    name: `lupiSkyField${variant}`,
    type: 'float',
    inputs: [
      { name: 'p', type: 'vec3' },
      { name: 't', type: 'float' },
    ],
  });
}

/** Rotate `v.xy` by `a` the way v9's `rotate2d(a) * v` did (column-major mat2(c,-s,s,c)). */
function rotate2d(v: N, a: N): N {
  const s = sin(a) as N;
  const c = cos(a) as N;
  return vec2(c.mul(v.x).add(s.mul(v.y)), s.negate().mul(v.x).add(c.mul(v.y)));
}

/** v9 `finish`: horizon shading, soft clamp and a slight gamma lift. */
function finish(color: N, d: N): N {
  const shaded = color.mul(mix(0.58, 1.0, smoothstep(-0.98, 0.7, d.z)));
  const clamped = clamp(shaded, 0.0, 1.7).toVar();
  const soft = clamped.div(clamped.mul(0.38).add(1.0));
  return pow(soft, vec3(0.92));
}

/**
 * The sky material for one variant. Drawn on the inside of a large sphere
 * that follows the camera, first (renderOrder -1000), without depth.
 */
export function createSkyMaterial(options: {
  variant: ProceduralBackgroundVariant;
  top: THREE.ColorRepresentation;
  bottom: THREE.ColorRepresentation;
}): THREE.MeshBasicNodeMaterial {
  const variant = SKY_VARIANT_INDEX[options.variant] ?? 0;
  const bag: SkyUniforms = {
    uTime: uniform(0),
    uTop: uniform(new THREE.Color(options.top)),
    uBottom: uniform(new THREE.Color(options.bottom)),
  };
  const variantField = variantFieldFn(variant);

  const colorNode = Fn(() => {
    const d = normalize(positionLocal).toVar();
    const t = bag.uTime.mul(0.085).toVar();
    const base = mix(bag.uBottom, bag.uTop, d.y.mul(0.42).add(0.48))
      .mul(pow(max(0.0, float(1).sub(abs(d.y))), 1.35).mul(0.14).add(0.7));
    const color = vec3(base).toVar();

    // v9: p.xy = rotate2d(t*0.25) * p.xy; p.yz = rotate2d(-t*0.16) * p.yz
    // (no swizzle assignment: WGSL has none).
    const p0 = d.mul(2.35).toVar();
    const xy = rotate2d(p0.xy, t.mul(0.25)).toVar();
    const yz = rotate2d(vec2(xy.y, p0.z), t.mul(-0.16)).toVar();
    const p = vec3(xy.x, yz.x, yz.y).toVar();
    const field = variantField(p, t).toVar();
    const mist = fbm3(p.mul(1.3).add(vec3(t.mul(0.2), t.mul(-0.1), t.mul(0.08)))).toVar();
    color.addAssign(vec3(0.1, 0.9, 1.0).mul(field).mul(mist.mul(0.35).add(0.3)));
    color.addAssign(vec3(1.0, 0.62, 0.24).mul(pow(field, 2.2)).mul(0.28));
    color.addAssign(vec3(0.5, 0.34, 1.0).mul(smoothstep(0.65, 0.96, mist)).mul(0.18));

    Loop(10, ({ i }: { i: N }) => {
      const fi = float(i);
      const depth = fi.mul(0.38).add(0.72).toVar();
      const q = d.mul(depth).add(
        vec3(sin(depth.add(t)), cos(depth.mul(0.7).sub(t)), sin(depth.mul(0.5))).mul(0.1),
      );
      const density = variantField(q, t)
        .mul(smoothstep(0.5, 1.2, depth))
        .mul(float(1).sub(smoothstep(4.8, 5.6, depth)));
      color.addAssign(mix(vec3(0.12, 0.9, 1.0), vec3(0.78, 0.48, 1.0), fi.div(9)).mul(density).mul(0.035));
    });

    const stars = smoothstep(0.988, 0.997, noise3(d.mul(180).add(vec3(11, 7, 3))));
    color.addAssign(vec3(0.72, 0.92, 1.0).mul(stars).mul(0.18));
    return vec4(finish(color, d), 1.0);
  })();

  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
  material.name = `lupi-sky-${options.variant}`;
  material.colorNode = colorNode;
  attachLupiUniforms(material, bag);
  return material;
}

export function skyUniforms(material: THREE.Material): SkyUniforms {
  return material.userData.lupiUniforms as SkyUniforms;
}
