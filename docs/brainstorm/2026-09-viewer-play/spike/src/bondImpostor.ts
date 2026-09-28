// TSL port of Lupi's ray-cast bond impostor (packages/scene/src/bondImpostor.ts):
// one instanced box per bond, built in view space around the A->B segment in
// the vertex stage; the fragment ray-casts a finite flat-capped cylinder,
// discards misses and writes exact depth through material.depthNode.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uniform, float, vec3, vec4, mix, max, min, sqrt, dot, length, cross,
  normalize, abs, select, If, Discard, positionGeometry, modelViewMatrix,
  cameraProjectionMatrix, screenSize, varying, sRGBTransferEOTF,
} from 'three/tsl';
import type { BondSet } from './data';
import { isOrtho, viewRay, depthFromViewZ, lupiShade } from './shading';

type N = any;

/** Unit box {-1,1}^3, 12 triangles, outward faces counter-clockwise (same as the repo). */
function createBondBoxGeometry(): THREE.InstancedBufferGeometry {
  const geo = new THREE.InstancedBufferGeometry();
  const corners = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
    0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
  ];
  geo.setAttribute('position', new THREE.BufferAttribute(corners, 3));
  geo.setIndex(indices);
  return geo;
}

export interface BondImpostorOptions {
  flat?: boolean;
  writeDepth?: boolean;
}

export function createBondImpostor(bonds: BondSet, opts: BondImpostorOptions = {}) {
  const geo = createBondBoxGeometry();
  const start = new THREE.InstancedBufferAttribute(bonds.starts, 3);
  const end = new THREE.InstancedBufferAttribute(bonds.ends, 3);
  geo.setAttribute('instanceStart', start);
  geo.setAttribute('instanceEnd', end);
  geo.setAttribute('instanceStartTarget', start); // static: alias, as in Bonds.tsx
  geo.setAttribute('instanceEndTarget', end);
  geo.setAttribute('instanceRadius', new THREE.InstancedBufferAttribute(bonds.radius, 1)); // f32 itemSize 1 is fine
  // Colours authored as Uint8 x4 normalized (unorm8x4). The repo's Uint8 x3 would be
  // padded to x4 by three on every upload (a CPU copy); x4 avoids that.
  geo.setAttribute('instanceColorStart', new THREE.InstancedBufferAttribute(bonds.colorStart, 4, true));
  geo.setAttribute('instanceColorEnd', new THREE.InstancedBufferAttribute(bonds.colorEnd, 4, true));
  geo.instanceCount = bonds.count;

  const u = {
    progress: uniform(0),
    cullPixelRadius: uniform(0),
    flat: uniform(opts.flat ? 1 : 0),
    metalness: uniform(0.35),
    roughness: uniform(0.45),
  };

  // ── Vertex ───────────────────────────────────────────────────────────
  const a: N = mix(attribute('instanceStart', 'vec3'), attribute('instanceStartTarget', 'vec3'), u.progress);
  const b: N = mix(attribute('instanceEnd', 'vec3'), attribute('instanceEndTarget', 'vec3'), u.progress);
  const viewA: N = modelViewMatrix.mul(vec4(a, 1.0)).xyz;
  const viewB: N = modelViewMatrix.mul(vec4(b, 1.0)).xyz;
  const axis: N = viewB.sub(viewA);
  const len: N = length(axis);
  const radius: N = attribute('instanceRadius', 'float');
  const mid: N = viewA.add(viewB).mul(0.5);
  const viewDepth: N = max(mid.z.negate(), 1e-4);
  const pixelScale: N = abs((cameraProjectionMatrix as N).element(1).y) /* .element() exists at runtime; @types/three 0.186 lacks it on UniformNode<mat4> */.mul(screenSize.y).mul(0.5);
  const pixelRadius: N = select(isOrtho, radius.mul(pixelScale), radius.mul(pixelScale).div(viewDepth));
  const culled: N = len.lessThanEqual(1e-6).or(radius.lessThanEqual(0.0)).or(pixelRadius.lessThan(u.cullPixelRadius));

  const dir: N = axis.div(max(len, 1e-6));
  const ref: N = select(abs(dir.y).lessThan(0.99), vec3(0, 1, 0), vec3(1, 0, 0));
  const bu: N = normalize(cross(dir, ref));
  // Right-handed basis (bu, dir, bv). The repo uses cross(dir, u), which is
  // left-handed (det = -1): the box's winding flips and FrontSide rasterizes
  // the FAR faces, violating its own layout(depth_greater) promise.
  const bv: N = cross(bu, dir);
  const expand: N = radius.mul(1.05);
  const p: N = positionGeometry;
  const corner: N = mix(viewA, viewB, p.y.mul(0.5).add(0.5))
    .add(bu.mul(p.x.mul(expand)))
    .add(bv.mul(p.z.mul(expand)));

  const vA: N = varying(viewA, 'vA');
  const vB: N = varying(viewB, 'vB');
  const vRadius: N = varying(radius, 'vBondRadius');
  const vViewPos: N = varying(corner, 'vBondViewPos');
  const vColorA: N = varying(sRGBTransferEOTF(attribute('instanceColorStart', 'vec4').rgb), 'vColorA');
  const vColorB: N = varying(sRGBTransferEOTF(attribute('instanceColorEnd', 'vec4').rgb), 'vColorB');
  const vPixelRadius: N = varying(pixelRadius, 'vBondPixelRadius');

  // ── Fragment: finite cylinder with flat caps ───────────────────────────
  // Returns (t, y along axis, capSign, 1): capSign 0 = side, -1 = A cap, +1 = B cap.
  const hit: N = Fn(() => {
    const { ro, rd } = viewRay(vViewPos);
    const segLen = length(vB.sub(vA)).toVar();
    const ax = vB.sub(vA).div(max(segLen, 1e-6)).toVar();
    const oc = ro.sub(vA).toVar();
    const card = dot(ax, rd).toVar();
    const caoc = dot(ax, oc).toVar();
    const dPerp = rd.sub(ax.mul(card)).toVar();
    const ocPerp = oc.sub(ax.mul(caoc)).toVar();
    const qa = dot(dPerp, dPerp).toVar();
    const qb = dot(dPerp, ocPerp).toVar();
    const qc = dot(ocPerp, ocPerp).sub(vRadius.mul(vRadius)).toVar();

    const t = float(-1).toVar();
    const y = float(0).toVar();
    const capSign = float(0).toVar();
    const sideHit = float(0).toVar();

    If(qa.greaterThan(1e-8), () => {
      const h = qb.mul(qb).sub(qa.mul(qc)).toVar();
      If(h.greaterThanEqual(0.0), () => {
        const ts = qb.negate().sub(sqrt(h)).div(qa).toVar();
        const ys = caoc.add(ts.mul(card)).toVar();
        If(ys.greaterThanEqual(0.0).and(ys.lessThanEqual(segLen)), () => {
          t.assign(ts);
          y.assign(ys);
          sideHit.assign(1);
        });
      });
    });

    If(sideHit.lessThan(0.5).and(abs(card).greaterThan(1e-6)), () => {
      const t0 = caoc.negate().div(card).toVar();
      const t1 = segLen.sub(caoc).div(card).toVar();
      // Entry cap first, exit cap as the fallback (same order as the GLSL).
      const tNear = min(t0, t1).toVar();
      const tFar = max(t0, t1).toVar();
      const yNear = select(t0.lessThan(t1), float(0.0), segLen).toVar();
      const yFar = select(t0.lessThan(t1), segLen, float(0.0)).toVar();
      const relNear = ro.add(rd.mul(tNear)).sub(vA).sub(ax.mul(yNear)).toVar();
      const relFar = ro.add(rd.mul(tFar)).sub(vA).sub(ax.mul(yFar)).toVar();
      const r2 = vRadius.mul(vRadius);
      If(dot(relNear, relNear).lessThanEqual(r2), () => {
        t.assign(tNear);
        y.assign(yNear);
        capSign.assign(select(yNear.lessThan(0.5 * 1e-6), float(-1), float(1)));
      }).ElseIf(dot(relFar, relFar).lessThanEqual(r2), () => {
        t.assign(tFar);
        y.assign(yFar);
        capSign.assign(select(yFar.lessThan(0.5 * 1e-6), float(-1), float(1)));
      });
    });

    Discard(t.lessThanEqual(0.0));
    return vec4(t, y, capSign, segLen);
  })().toVar('bondHit');

  // Materialize the hit point once, unconditionally (see the codegen GOTCHA in atomImpostor.ts).
  const hitPoint: N = Fn(() => {
    const { ro, rd } = viewRay(vViewPos);
    return ro.toVar().add(rd.toVar().mul(hit.x));
  })().toVar('bondHitPoint');

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.side = THREE.FrontSide; // near faces only, thanks to the right-handed basis
  mat.fog = false;
  mat.vertexNode = select(culled, vec4(2.0, 2.0, 2.0, 1.0), cameraProjectionMatrix.mul(vec4(corner, 1.0)));
  mat.depthNode = Fn(() => {
    const z = hitPoint.z.toVar('bondHitZ'); // first build: top of main(), runs the ray-cast + Discard
    // Negative control: the box face's own depth (vViewPos.z), i.e. no depthNode.
    return depthFromViewZ(opts.writeDepth === false ? vViewPos.z.toVar() : z);
  })();

  mat.colorNode = Fn(() => {
    const segLen = hit.w;
    const ax = vB.sub(vA).div(max(segLen, 1e-6)).toVar();
    const radial = normalize(hitPoint.sub(vA).sub(ax.mul(hit.y))).toVar();
    const N = select(abs(hit.z).greaterThan(0.5), ax.mul(hit.z), radial).toVar();
    const base = select(hit.y.div(max(segLen, 1e-6)).lessThan(0.5), vColorA, vColorB).toVar();
    const lit = (lupiShade as N)(N, base, u.metalness, u.roughness, vPixelRadius, float(1.0), float(0.0), float(0.0)).toVar();
    return vec4(select(u.flat.greaterThan(0.5), base, lit) as N, 1.0);
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'bonds';
  return { mesh, uniforms: u, geometry: geo, material: mat };
}
