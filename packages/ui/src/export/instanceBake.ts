/**
 * instanceBake — bake an InstancedMesh into ONE merged indexed BufferGeometry.
 *
 * Extracted from USDZExportPipeline so the bake is a pure three-only module:
 * it powers the USDZ export path in the browser AND runs headless from Node
 * (tools/verify-exports.mjs). This is what lets USDZ scale: N instances become
 * a single mesh + palette texture instead of N scene-graph objects, so
 * three's USDZExporter writes one geometry prim rather than exploding the
 * .usda string (and the JS heap) with one Xform per atom.
 *
 * The instance-count loops are exposed as a generator (`bakeInstancedMeshSteps`)
 * so async callers can yield to the event loop between chunks; the sync
 * wrapper keeps the original drop-in `bakeInstancedMesh(im)` signature.
 */

import * as THREE from 'three';

const AR_EXPORT_DEBUG = (import.meta as any).env?.DEV;

// Pre-allocated objects for baking to avoid GC pauses
const _bakeMat4 = new THREE.Matrix4();
const _bakeMat3 = new THREE.Matrix3();
const _bakeCol = new THREE.Color();

export type InstancedSwap = {
  parent: THREE.Object3D;
  original: THREE.InstancedMesh;
  replacement: THREE.Object3D;
};

/** Encode Three's Linear-sRGB working value into one sRGB texture byte. */
export function linearChannelToSrgbByte(value: number): number {
  const linear = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const srgb = linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(srgb * 255)));
}

export function toExportSafeMaterial(
  src: THREE.Material,
  paletteTexture?: THREE.Texture,
): THREE.MeshStandardMaterial {
  const anySrc = src as any;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(1, 1, 1),
    vertexColors: !paletteTexture,
    transparent: anySrc.transparent === true,
    opacity: typeof anySrc.opacity === 'number' ? anySrc.opacity : 1.0,
    roughness: typeof anySrc.roughness === 'number' ? anySrc.roughness : 0.45,
    metalness: typeof anySrc.metalness === 'number' ? anySrc.metalness : 0.15,
    map: paletteTexture ?? anySrc.map ?? null,
    normalMap: anySrc.normalMap ?? null,
    roughnessMap: anySrc.roughnessMap ?? null,
    metalnessMap: anySrc.metalnessMap ?? null,
    emissiveMap: anySrc.emissiveMap ?? null,
    emissive: anySrc.emissive?.clone?.() ?? new THREE.Color(0, 0, 0),
    emissiveIntensity: typeof anySrc.emissiveIntensity === 'number' ? anySrc.emissiveIntensity : 1.0,
  });
  (mat as any).onBeforeCompile = undefined;
  return mat;
}

/** 1×N nearest-filtered sRGB palette strip. Browser gets a CanvasTexture
 *  (what USDZExporter's image pipeline expects); headless Node falls back to
 *  a DataTexture with identical pixels so the bake stays runnable there. */
function createPaletteTexture(data: Uint8ClampedArray, paletteSize: number): THREE.Texture {
  let texture: THREE.Texture;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = paletteSize;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(paletteSize, 1);
    imageData.data.set(data);
    ctx.putImageData(imageData, 0, 0);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = new THREE.DataTexture(new Uint8Array(data), paletteSize, 1, THREE.RGBAFormat);
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

export function buildPaletteFromColors(
  instanceColors: Float32Array,
  totalVerts: number,
  vPerInstance: number,
  instanceCount: number,
): { texture: THREE.Texture; uvs: Float32Array } {
  const uniqueMap = new Map<number, number>();
  const instancePaletteIndex = new Uint32Array(instanceCount);

  for (let i = 0; i < instanceCount; i++) {
    const off = i * 3;
    const r = linearChannelToSrgbByte(instanceColors[off]);
    const g = linearChannelToSrgbByte(instanceColors[off + 1]);
    const b = linearChannelToSrgbByte(instanceColors[off + 2]);
    const key = (r << 16) | (g << 8) | b;

    let idx = uniqueMap.get(key);
    if (idx === undefined) {
      idx = uniqueMap.size;
      uniqueMap.set(key, idx);
    }
    instancePaletteIndex[i] = idx;
  }

  const paletteSize = Math.max(uniqueMap.size, 1);
  const pixels = new Uint8ClampedArray(paletteSize * 4);
  for (const [key, idx] of uniqueMap) {
    const off = idx * 4;
    pixels[off] = (key >> 16) & 0xff;
    pixels[off + 1] = (key >> 8) & 0xff;
    pixels[off + 2] = key & 0xff;
    pixels[off + 3] = 255;
  }
  const texture = createPaletteTexture(pixels, paletteSize);

  const uvs = new Float32Array(totalVerts * 2);
  for (let i = 0; i < instanceCount; i++) {
    const u = (instancePaletteIndex[i] + 0.5) / paletteSize;
    const v = 0.5;
    const vBase = i * vPerInstance * 2;
    for (let vi = 0; vi < vPerInstance; vi++) {
      const off = vBase + vi * 2;
      uvs[off] = u;
      uvs[off + 1] = v;
    }
  }

  if (AR_EXPORT_DEBUG) {
    console.info('[AR export] palette texture', {
      uniqueColors: paletteSize,
      totalInstances: instanceCount
    });
  }

  return { texture, uvs };
}

export interface BakeStep {
  done: number;
  total: number;
}

export function* bakeInstancedMeshSteps(
  im: THREE.InstancedMesh,
  stepEvery = 25_000,
): Generator<BakeStep, THREE.Mesh> {
  const baseGeom = im.geometry;
  const basePos = baseGeom.getAttribute('position') as THREE.BufferAttribute;
  const baseNorm = baseGeom.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const baseIdx = baseGeom.getIndex();

  const vPerInstance = basePos.count;
  const iPerInstance = baseIdx ? baseIdx.count : 0;
  const N = im.count;

  const totalVerts = vPerInstance * N;
  const totalIdx = iPerInstance * N;

  const positions = new Float32Array(totalVerts * 3);
  const normals = baseNorm ? new Float32Array(totalVerts * 3) : null;
  const indices = baseIdx
    ? (totalVerts > 65535 ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx))
    : null;

  const instanceColors = new Float32Array(N * 3);
  const hasInstanceColor = (im as any).instanceColor != null;
  const posArr = basePos.array;
  const normArr = baseNorm ? baseNorm.array : null;

  // Bond mesh applies per-instance radius taper inside its custom shader via the
  // `radiusBT` instanced attribute. The USDZ exporter strips shaders, so we have
  // to bake the same `mix(radiusBT.x, radiusBT.y, position.y + 0.5)` lateral
  // scaling into the vertex positions here — otherwise every bond exports as a
  // unit-radius cylinder.
  const radiusBTAttr = baseGeom.getAttribute('radiusBT') as THREE.InstancedBufferAttribute | undefined;
  const radiusBTArr = radiusBTAttr ? (radiusBTAttr.array as ArrayLike<number>) : null;

  for (let i = 0; i < N; i++) {
    im.getMatrixAt(i, _bakeMat4);
    if (hasInstanceColor) im.getColorAt(i, _bakeCol);
    else _bakeCol.setRGB(1, 1, 1);

    _bakeMat3.getNormalMatrix(_bakeMat4);

    const m = _bakeMat4.elements;
    const m00 = m[0], m01 = m[4], m02 = m[8], m03 = m[12];
    const m10 = m[1], m11 = m[5], m12 = m[9], m13 = m[13];
    const m20 = m[2], m21 = m[6], m22 = m[10], m23 = m[14];

    const n = _bakeMat3.elements;
    const n00 = n[0], n01 = n[3], n02 = n[6];
    const n10 = n[1], n11 = n[4], n12 = n[7];
    const n20 = n[2], n21 = n[5], n22 = n[8];

    const rB = radiusBTArr ? radiusBTArr[i * 2]     : 1;
    const rT = radiusBTArr ? radiusBTArr[i * 2 + 1] : 1;

    const vBase = i * vPerInstance;
    for (let v = 0; v < vPerInstance; v++) {
      const srcOff = v * 3;
      let x = posArr[srcOff];
      const y = posArr[srcOff + 1];
      let z = posArr[srcOff + 2];

      if (radiusBTArr) {
        const r = rB + (rT - rB) * (y + 0.5);
        x *= r;
        z *= r;
      }

      const dstOff = (vBase + v) * 3;
      positions[dstOff]     = m00 * x + m01 * y + m02 * z + m03;
      positions[dstOff + 1] = m10 * x + m11 * y + m12 * z + m13;
      positions[dstOff + 2] = m20 * x + m21 * y + m22 * z + m23;

      if (normals && normArr) {
        const nx = normArr[srcOff];
        const ny = normArr[srcOff + 1];
        const nz = normArr[srcOff + 2];

        let rx = n00 * nx + n01 * ny + n02 * nz;
        let ry = n10 * nx + n11 * ny + n12 * nz;
        let rz = n20 * nx + n21 * ny + n22 * nz;

        const len = 1.0 / Math.sqrt(rx * rx + ry * ry + rz * rz);
        normals[dstOff]     = rx * len;
        normals[dstOff + 1] = ry * len;
        normals[dstOff + 2] = rz * len;
      }
    }

    const cOff = i * 3;
    instanceColors[cOff]     = _bakeCol.r;
    instanceColors[cOff + 1] = _bakeCol.g;
    instanceColors[cOff + 2] = _bakeCol.b;

    if (indices && baseIdx) {
      const iBase = i * iPerInstance;
      for (let k = 0; k < iPerInstance; k++) {
        indices[iBase + k] = baseIdx.getX(k) + vBase;
      }
    }

    if ((i + 1) % stepEvery === 0 && i + 1 < N) {
      yield { done: i + 1, total: N };
    }
  }

  const { texture: paletteTexture, uvs: paletteUVs } = buildPaletteFromColors(
    instanceColors, totalVerts, vPerInstance, N,
  );

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(paletteUVs, 2));

  if (indices) merged.setIndex(new THREE.BufferAttribute(indices, 1));
  if (!normals) merged.computeVertexNormals();

  const baseMat = (Array.isArray(im.material) ? im.material[0] : im.material) as THREE.Material;
  const exportMat = toExportSafeMaterial(baseMat, paletteTexture);

  if (AR_EXPORT_DEBUG) {
    const c0 = instanceColors.length >= 3 ? [instanceColors[0], instanceColors[1], instanceColors[2]] : ['n/a'];
    console.info('[AR export] baked instanced mesh', {
      name: im.name || '(unnamed)',
      instances: N,
      totalVerts,
      hasInstanceColor,
      sampleColor0: c0,
      materialType: baseMat.type,
      exportMaterialType: exportMat.type,
      hasPaletteTexture: true,
      paletteSize: (paletteTexture.image as { width: number }).width,
    });
  }

  const mesh = new THREE.Mesh(merged, exportMat);
  mesh.name = (im.name || 'instanced') + '_baked';
  mesh.position.copy(im.position);
  mesh.quaternion.copy(im.quaternion);
  mesh.scale.copy(im.scale);
  mesh.visible = im.visible;
  return mesh;
}

export function bakeInstancedMesh(im: THREE.InstancedMesh): THREE.Mesh {
  const steps = bakeInstancedMeshSteps(im);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

/** Dispose resources uniquely owned by one merged bake. */
function disposeBakedReplacement(
  original: THREE.InstancedMesh,
  replacement: THREE.Object3D,
): void {
  const mesh = replacement as THREE.Mesh;
  if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;

  if (mesh.geometry && mesh.geometry !== original.geometry) {
    mesh.geometry.dispose();
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const disposedTextures = new Set<THREE.Texture>();
  for (const material of materials) {
    // bakeInstancedMeshSteps creates this palette map for the replacement.
    // Other map slots can reference source-owned textures and must survive.
    const paletteTexture = (material as THREE.MeshStandardMaterial).map;
    if (paletteTexture && !disposedTextures.has(paletteTexture)) {
      disposedTextures.add(paletteTexture);
      paletteTexture.dispose();
    }
    material.dispose();
  }
}

function rollbackBakedSwaps(swaps: InstancedSwap[]): void {
  for (let index = swaps.length - 1; index >= 0; index--) {
    const swap = swaps[index];
    if (swap.original.parent !== swap.parent) swap.parent.add(swap.original);
    if (swap.replacement.parent === swap.parent) swap.parent.remove(swap.replacement);
    disposeBakedReplacement(swap.original, swap.replacement);
  }
}

/**
 * Replace every InstancedMesh under `root` with its merged bake, yielding to
 * the event loop between chunks so a 100k+ atom bake never freezes the tab.
 * Returns swaps compatible with USDZExportPipeline's restoreInstancedMeshes
 * (which disposes the merged geometry + palette texture on restore).
 */
export async function bakeInstancedMeshesForExport(
  root: THREE.Object3D,
  opts: { onProgress?: (done: number, total: number) => void; stepEvery?: number } = {},
): Promise<InstancedSwap[]> {
  // Ensure every InstancedMesh's local matrix/TRS is current before baking.
  root.updateMatrixWorld(true);

  const targets: THREE.InstancedMesh[] = [];
  root.traverse(obj => {
    if ((obj as any).isInstancedMesh && obj.parent && (obj as THREE.InstancedMesh).count > 0) {
      targets.push(obj as THREE.InstancedMesh);
    }
  });

  const totalInstances = targets.reduce((sum, im) => sum + im.count, 0);
  let bakedInstances = 0;

  const swaps: InstancedSwap[] = [];
  let pendingReplacement: { original: THREE.InstancedMesh; replacement: THREE.Object3D } | null = null;

  try {
    for (const im of targets) {
      const parent = im.parent;
      if (!parent) continue;

      const steps = bakeInstancedMeshSteps(im, opts.stepEvery);
      let result = steps.next();
      while (!result.done) {
        opts.onProgress?.(bakedInstances + result.value.done, totalInstances);
        await new Promise((resolve) => setTimeout(resolve, 0));
        result = steps.next();
      }

      // The merged mesh already owns GPU resources here. Track it before the
      // final progress callback, which is user code and may throw.
      pendingReplacement = { original: im, replacement: result.value };
      bakedInstances += im.count;
      opts.onProgress?.(bakedInstances, totalInstances);

      const swap = { parent, original: im, replacement: result.value };
      swaps.push(swap);
      pendingReplacement = null;
      swap.parent.add(swap.replacement);
      swap.parent.remove(swap.original);
    }

    root.updateMatrixWorld(true);
    return swaps;
  } catch (error) {
    if (pendingReplacement) {
      disposeBakedReplacement(
        pendingReplacement.original,
        pendingReplacement.replacement,
      );
    }
    rollbackBakedSwaps(swaps);
    root.updateMatrixWorld(true);
    throw error;
  }
}
