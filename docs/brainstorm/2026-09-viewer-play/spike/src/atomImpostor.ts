// TSL port of Lupi's ray-cast atom impostor (packages/scene/src/AtomsOptimized.tsx
// IMPOSTOR_VERTEX / IMPOSTOR_FRAGMENT). One instanced quad per atom, ray-sphere
// hit in the fragment, discard outside the silhouette, per-fragment depth via
// material.depthNode, palette lookups by a per-instance type slot, GPU lerp
// between instancePosition and instanceTargetPosition by uProgress.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, textureLoad, ivec2, int, float, vec3, vec4, mix, max, sqrt, dot,
  normalize, abs, select, fwidth, clamp, round, instanceIndex, positionGeometry, modelViewMatrix,
  cameraProjectionMatrix, screenSize, varying, Discard,
} from 'three/tsl';
import type { AtomSet } from './data';
import { isOrtho, viewRay, depthFromViewZ, lupiShade } from './shading';

type N = any;

export interface AtomPalettes {
  color: THREE.DataTexture; // 256x1 RGBA8 sRGB: slot -> CPK colour
  radius: THREE.DataTexture; // 256x1 R32F: slot -> world radius (0 = hidden)
  material: THREE.DataTexture; // 256x1 RGBA8 linear: (metalness, roughness, -, subsurface)
}

export function buildPalettes(
  color: (slot: number) => [number, number, number],
  radius: (slot: number) => number,
  material: (slot: number) => [number, number, number] = () => [0.05, 0.45, 0.0],
): AtomPalettes {
  const c = new Uint8Array(256 * 4);
  const r = new Float32Array(256);
  const m = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [cr, cg, cb] = color(i);
    c.set([cr, cg, cb, 255], i * 4);
    r[i] = radius(i);
    const [metal, rough, sss] = material(i);
    m.set([Math.round(metal * 255), Math.round(rough * 255), 0, Math.round(sss * 255)], i * 4);
  }
  const colorTex = new THREE.DataTexture(c, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  colorTex.colorSpace = THREE.SRGBColorSpace; // hardware sRGB decode on both backends (rgba8unorm-srgb / SRGB8_ALPHA8)
  const radiusTex = new THREE.DataTexture(r, 256, 1, THREE.RedFormat, THREE.FloatType);
  const materialTex = new THREE.DataTexture(m, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [colorTex, radiusTex, materialTex]) {
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  return { color: colorTex, radius: radiusTex, material: materialTex };
}

export interface AtomImpostorOptions {
  flat?: boolean; // unlit palette colour (for pixel classification)
  writeDepth?: boolean; // false = negative control: quad depth only
  alphaToCoverage?: boolean; // analytic edge coverage instead of a hard discard
  legacyAttributes?: boolean; // reproduce the v9 itemSize-1 u8/u16 layout (K22)
}

export function createAtomImpostor(atoms: AtomSet, pal: AtomPalettes, opts: AtomImpostorOptions = {}) {
  const n = atoms.count;

  // ── Geometry: unit quad + per-instance attributes ──────────────────────
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const pos = new THREE.InstancedBufferAttribute(atoms.positions, 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('instancePosition', pos);
  // Static frames alias the target to the position buffer, as the repo does.
  geo.setAttribute('instanceTargetPosition', atoms.targets ? new THREE.InstancedBufferAttribute(atoms.targets, 3) : pos);

  // K22 repack: type slot, occlusion and the u16 property in ONE normalized
  // Uint8x4 word -> WebGPU vertex format 'unorm8x4', WebGL2 UNSIGNED_BYTE normalized.
  // (Non-normalized u8/u16 attributes are silently widened to Uint32 by three;
  // normalized itemSize-1 u8/u16 fail with "Vertex format not supported yet".)
  const packed = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const prop = atoms.props ? atoms.props[i] : 0;
    packed[i * 4] = atoms.types[i];
    packed[i * 4 + 1] = atoms.occlusion ? atoms.occlusion[i] : 255;
    packed[i * 4 + 2] = prop & 0xff;
    packed[i * 4 + 3] = prop >> 8;
  }
  geo.setAttribute('instancePacked', new THREE.InstancedBufferAttribute(packed, 4, true));
  if (opts.legacyAttributes) {
    // v9 layout, kept only to reproduce the WebGPU failure.
    geo.setAttribute('instanceOcclusion', new THREE.InstancedBufferAttribute(new Uint8Array(n).fill(255), 1, true));
  }
  geo.instanceCount = n;

  // ── Uniforms ────────────────────────────────────────────────────────
  const u = {
    progress: uniform(0),
    cullPixelRadius: uniform(0),
    flat: uniform(opts.flat ? 1 : 0),
    occlusionStrength: uniform(0.6),
    highlightAtom: uniform(-1),
    materialIntensity: uniform(0),
  };

  // ── Vertex stage ────────────────────────────────────────────────────
  const aPacked: N = attribute('instancePacked', 'vec4');
  const slot: N = int(round(aPacked.x.mul(255.0))); // integer decode of a unorm byte
  const occlusion: N = opts.legacyAttributes ? attribute('instanceOcclusion', 'float') : aPacked.y;
  const radius: N = textureLoad(pal.radius, ivec2(slot, int(0))).x; // vertex-stage fetch: textureLoad, no sampler
  const baseColor: N = textureLoad(pal.color, ivec2(slot, int(0))).rgb;

  const center: N = mix(attribute('instancePosition', 'vec3'), attribute('instanceTargetPosition', 'vec3'), u.progress);
  const viewCenter: N = modelViewMatrix.mul(vec4(center, 1.0)).xyz;
  const viewDepth: N = max(viewCenter.z.negate(), 1e-4);
  // Device pixels per world unit at unit depth: |P[1][1]| * drawingBufferHeight / 2.
  // screenSize tracks the bound render target, replacing syncImpostorRenderTargetUniforms.
  const pixelScale: N = abs((cameraProjectionMatrix as N).element(1).y) /* .element() exists at runtime; @types/three 0.186 lacks it on UniformNode<mat4> */.mul(screenSize.y).mul(0.5);
  const pixelRadius: N = select(isOrtho, radius.mul(pixelScale), radius.mul(pixelScale).div(viewDepth));
  const culled: N = radius.lessThanEqual(0.0).or(pixelRadius.lessThan(u.cullPixelRadius));

  // Billboard on the sphere's front tangent plane (view-aligned quad, 1.3 r).
  const corner: N = positionGeometry.xy;
  const quadView: N = vec3(viewCenter.xy.add(corner.mul(radius.mul(1.3))), viewCenter.z.add(radius));
  const clip: N = cameraProjectionMatrix.mul(vec4(quadView, 1.0));

  // ── Varyings ────────────────────────────────────────────────────────
  const vViewCenter: N = varying(viewCenter, 'vViewCenter');
  const vRadius: N = varying(radius, 'vRadius');
  const vUv: N = varying(corner, 'vUv');
  const vColor: N = varying(baseColor, 'vColor');
  const vPixelRadius: N = varying(pixelRadius, 'vPixelRadius');
  const vOcclusion: N = varying(occlusion, 'vOcclusion');
  const vSlot: N = varying(float(slot), 'vSlot');
  const vAtomId: N = varying(float(instanceIndex), 'vAtomId');

  // ── Fragment ────────────────────────────────────────────────────────
  // GOTCHA (three r186 TSL codegen): a cached node (a .toVar() or a multiply-used
  // temp) that is FIRST built inside a select()/If branch is emitted inside that
  // branch only; later references outside the branch read an unassigned var.
  // setupDepth() runs before setupDiffuseColor(), so depthNode is the
  // unconditional "prelude": it materializes the hit at the top of main(), and
  // every select() below only references vars that already exist.
  const hit: N = Fn(() => {
    const proxy = vViewCenter.add(vec3(vUv.mul(vRadius.mul(1.3)), vRadius)).toVar();
    const { ro, rd } = viewRay(proxy);
    const roV = ro.toVar();
    const rdV = rd.toVar();
    const oc = roV.sub(vViewCenter).toVar();
    const b = dot(oc, rdV).toVar();
    const c = dot(oc, oc).sub(vRadius.mul(vRadius));
    const disc = b.mul(b).sub(c).toVar();
    const t = b.negate().sub(sqrt(max(disc, 0.0)));
    return vec4(roV.add(rdV.mul(t)), disc);
  })().toVar('atomHit');
  const hitPoint: N = hit.xyz;
  const disc: N = hit.w;
  const coverage: N = opts.alphaToCoverage
    ? clamp(disc.div(max(fwidth(disc), 1e-8)).add(0.5), 0.0, 1.0).toVar('atomCoverage')
    : null;

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.side = THREE.DoubleSide;
  mat.fog = false;
  mat.transparent = false;
  mat.depthTest = true;
  mat.depthWrite = true;

  mat.vertexNode = select(culled, vec4(2.0, 2.0, 2.0, 1.0), clip);

  mat.depthNode = Fn(() => {
    const hitZ = hitPoint.z.toVar('atomHitZ'); // first (unconditional) build of the hit
    if (coverage) {
      Discard(coverage.lessThanEqual(0.0));
    } else {
      Discard(disc.lessThan(0.0));
    }
    // Negative control (?nodepth=1): the quad's own constant view depth, i.e. what the
    // rasterizer would write without a depthNode.
    const z = opts.writeDepth === false ? vViewCenter.z.add(vRadius).toVar() : hitZ;
    return depthFromViewZ(z);
  })();

  if (coverage) {
    // Analytic silhouette coverage: disc ~ 2r * (distance inside the edge), so
    // disc / fwidth(disc) is a signed pixel distance. Needs MSAA (samples > 1).
    mat.alphaToCoverage = true;
    mat.opacityNode = coverage;
  }

  mat.colorNode = Fn(() => {
    const N = normalize(hitPoint.sub(vViewCenter)).toVar();
    const m = textureLoad(pal.material, ivec2(int(vSlot), int(0))).toVar();
    // .toVar() before select(): otherwise the whole BRDF is duplicated into both branches.
    const lit = lupiShade(N, vColor, m.x, m.y, vPixelRadius, vOcclusion, u.occlusionStrength, m.w).toVar();
    const highlighted = abs(vAtomId.sub(u.highlightAtom)).lessThan(0.5);
    const tinted = select(highlighted, mix(lit, vec3(0.835, 0.937, 0.612), 0.6), lit).toVar();
    const debugDepth = new URLSearchParams(location.search).get('debug') === 'depth';
    if (debugDepth) return vec4(vec3(hitPoint.z.negate().div(10.0)), 1.0);
    return vec4(select(u.flat.greaterThan(0.5), vColor, tinted), 1.0);
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; // the shared quad has no meaningful bound
  mesh.name = 'atoms';
  return { mesh, uniforms: u, geometry: geo, material: mat };
}
