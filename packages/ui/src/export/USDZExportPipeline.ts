import * as THREE from 'three';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { bakeInstancedMesh, toExportSafeMaterial, type InstancedSwap } from './instanceBake';

const AR_EXPORT_DEBUG = (import.meta as any).env?.DEV;

// Scratch objects for the shared-mesh (instance → many cheap Xform) path.
const _instMat4 = new THREE.Matrix4();
const _instCol = new THREE.Color();

// The merged bake (single geometry + palette texture per InstancedMesh) now
// lives in ./instanceBake so it can run headless from Node. Re-export the
// pieces this module historically owned.
export { bakeInstancedMesh, bakeInstancedMeshesForExport } from './instanceBake';
export type { InstancedSwap } from './instanceBake';

/**
 * Build a USDZ-safe MeshStandardMaterial whose flat color is a per-group RGB
 * (no vertex colors / no palette texture). All other surface params are carried
 * from the source InstancedMesh material so roughness/metalness/opacity match.
 */
function toExportSafeMaterialForColor(
  src: THREE.Material,
  color: THREE.Color,
): THREE.MeshStandardMaterial {
  const mat = toExportSafeMaterial(src);          // vertexColors:true, color white
  mat.vertexColors = false;                        // group color drives the surface
  mat.color.copy(color);
  return mat;
}

/**
 * True when the InstancedMesh carries a `radiusBT` attribute — the live Bonds.tsx
 * convention where the geometry is a UNIT cylinder and the real lateral radius (and
 * any bottom→top taper) lives in the attribute, applied by the runtime shader, NOT
 * by the instance matrix or the geometry. Such meshes MUST be vertex-baked so the
 * radius is materialized into positions; the shared-geometry path would export the
 * unit (radius-1) cylinder regardless of radiusBT.
 *
 * The actual export bonds (ExportManager) pre-size the cylinder geometry
 * (`CylinderGeometry(bondRadius, bondRadius, …)`) and carry NO radiusBT, so they
 * still take the cheap shared path — only live-style meshes fall back to the bake.
 */
function hasRadiusBT(im: THREE.InstancedMesh): boolean {
  return im.geometry.getAttribute('radiusBT') != null;
}

/**
 * Expand an InstancedMesh into many cheap THREE.Mesh objects that all SHARE the
 * SAME base geometry instance (`im.geometry`, same `geometry.id`) and a SMALL set
 * of materials (one per unique instance color). Each mesh carries only its
 * composed local `matrix`.
 *
 * This is the size/speed win for USDZ: USDZExporter dedupes geometry by
 * `geometry.id` and materials by `material.uuid`, so the unit sphere is written
 * ONCE and every atom becomes a tiny Xform that references it (≈GLB size), rather
 * than the old bake which merged all N spheres into one unique mega-geometry that
 * dedup could never help.
 *
 * Transform parity with `bakeInstancedMesh`: USDZExporter's `buildHierarchy` is
 * recursive and writes each prim's LOCAL `object.matrix`, composing the parent
 * chain. The returned Group is identity and is added under `im.parent`, so each
 * child mesh's local `matrix` must be `im.matrix * instanceMatrix_i` (im's OWN
 * local transform, NOT `im.matrixWorld`) — then the exporter re-applies the
 * `im.parent` chain exactly once, matching the bake path's
 * `im.parent.world * im.localTRS * instanceMatrix`. Using `matrixWorld` here would
 * double-count `im.parent.world` whenever an ancestor carries a transform.
 */
function instanceToSharedMeshes(im: THREE.InstancedMesh): THREE.Group {
  const group = new THREE.Group();
  group.name = (im.name || 'instanced') + '_shared';
  // Identity group placed under im.parent; the exporter composes the parent chain,
  // so children carry only `im.matrix * instanceMatrix` as their local transform.
  group.matrixAutoUpdate = false;
  group.visible = im.visible;

  // Share the source geometry directly — DO NOT clone/bake. Matching geometry.id
  // across all meshes is precisely what makes the exporter emit one USD geometry.
  const sharedGeo = im.geometry;

  const baseMat = (Array.isArray(im.material) ? im.material[0] : im.material) as THREE.Material;
  const hasInstanceColor = (im as any).instanceColor != null;

  // One material per unique packed-RGB color (elements → usually < ~10).
  const matByColor = new Map<number, THREE.MeshStandardMaterial>();

  // im's OWN local transform (matches bakeInstancedMesh, which copies im.position/
  // quaternion/scale). NOT matrixWorld — the exporter re-applies im.parent's chain.
  const localBase = im.matrix;
  const N = im.count;

  for (let i = 0; i < N; i++) {
    if (hasInstanceColor) im.getColorAt(i, _instCol);
    else _instCol.setRGB(1, 1, 1);

    const colorKey =
      (Math.round(_instCol.r * 255) << 16) |
      (Math.round(_instCol.g * 255) << 8) |
      Math.round(_instCol.b * 255);

    let material = matByColor.get(colorKey);
    if (!material) {
      material = toExportSafeMaterialForColor(baseMat, _instCol);
      matByColor.set(colorKey, material);
    }

    const mesh = new THREE.Mesh(sharedGeo, material);
    mesh.matrixAutoUpdate = false;
    im.getMatrixAt(i, _instMat4);
    mesh.matrix.multiplyMatrices(localBase, _instMat4); // im-local transform of instance i
    mesh.matrixWorldNeedsUpdate = true;
    group.add(mesh);
  }

  if (AR_EXPORT_DEBUG) {
    console.info('[AR export] shared-geometry instanced mesh', {
      name: im.name || '(unnamed)',
      instances: N,
      sharedGeometryId: sharedGeo.id,
      uniqueColors: matByColor.size,
      hasInstanceColor,
      materialType: baseMat.type,
    });
  }

  return group;
}

export function expandInstancedMeshes(root: THREE.Object3D): InstancedSwap[] {
  // Ensure every InstancedMesh's local `matrix` (and TRS) is current before we
  // read it to compose the replacement meshes' local transforms.
  root.updateMatrixWorld(true);

  const targets: THREE.InstancedMesh[] = [];
  root.traverse(obj => {
    if ((obj as any).isInstancedMesh && obj.parent && (obj as THREE.InstancedMesh).count > 0) {
      targets.push(obj as THREE.InstancedMesh);
    }
  });

  const swaps: InstancedSwap[] = [];
  for (const im of targets) {
    if (!im.parent) continue;

    // Spheres (dominant cost) and pre-sized bonds use the cheap shared-geometry
    // path. Only live-style meshes carrying a radiusBT attribute (unit cylinder +
    // shader-applied radius) fall back to the per-instance vertex bake, which
    // materializes that radius into positions (correctness over size).
    const replacement: THREE.Object3D = hasRadiusBT(im)
      ? bakeInstancedMesh(im)
      : instanceToSharedMeshes(im);

    swaps.push({ parent: im.parent, original: im, replacement });
    im.parent.add(replacement);
    im.parent.remove(im);
  }

  // Refresh world matrices so each replacement mesh's matrixWorld matches its
  // baked local matrix (the shared-mesh Group is identity, the baked Mesh uses
  // the InstancedMesh's own TRS).
  root.updateMatrixWorld(true);
  return swaps;
}

function disposeExportMaterial(mat: THREE.Material | THREE.Material[]) {
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list) {
    const std = m as THREE.MeshStandardMaterial;
    if (std.map) std.map.dispose();
    std.dispose();
  }
}

export function restoreInstancedMeshes(swaps: InstancedSwap[]) {
  for (const swap of swaps) {
    swap.parent.add(swap.original);
    swap.parent.remove(swap.replacement);

    const replacement = swap.replacement;
    const sharedGeoId = swap.original.geometry.id;

    if ((replacement as THREE.Group).isGroup) {
      // Shared-geometry path: each child Mesh references im.geometry (do NOT
      // dispose it — the original InstancedMesh still uses it). Dispose only the
      // per-color export materials, deduped so each is freed once.
      const seenMats = new Set<THREE.Material>();
      (replacement as THREE.Group).children.forEach(child => {
        const mesh = child as THREE.Mesh;
        const m = mesh.material;
        (Array.isArray(m) ? m : [m]).forEach(mat => {
          if (!seenMats.has(mat)) {
            seenMats.add(mat);
            disposeExportMaterial(mat);
          }
        });
      });
    } else {
      // Per-instance bake path: replacement owns a unique merged geometry +
      // material. Dispose both (but never the shared source geometry).
      const mesh = replacement as THREE.Mesh;
      if (mesh.geometry && mesh.geometry.id !== sharedGeoId) {
        mesh.geometry.dispose();
      }
      disposeExportMaterial(mesh.material);
    }
  }
}

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

export function USDZExportHelper({ trigger, onComplete }: { trigger: boolean, onComplete: () => void }) {
  const { scene } = useThree();

  useEffect(() => {
    if (!trigger) return;

    let cancelled = false;
    const runExport = async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (cancelled) return;

      const oldBackground = scene.background;
      scene.background = null;
      const swaps = expandInstancedMeshes(scene);

      try {
        const exporter = new USDZExporter();
        const arrayBuffer = await exporter.parseAsync(scene) as unknown as ArrayBuffer;

        if (AR_EXPORT_DEBUG) {
          console.info('[AR export] USDZ generated', {
            sizeBytes: arrayBuffer.byteLength,
            sizeMB: (arrayBuffer.byteLength / 1024 / 1024).toFixed(2),
          });
          const devBlob = new Blob([arrayBuffer], { type: 'model/vnd.usdz+zip' });
          const devUrl = URL.createObjectURL(devBlob);
          const devA = document.createElement('a');
          devA.href = devUrl;
          devA.download = 'atlas-molecule.usdz';
          devA.click();
          setTimeout(() => URL.revokeObjectURL(devUrl), 5000);
        }

        const blob = new Blob([arrayBuffer], { type: 'model/vnd.usdz+zip' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.rel = 'ar';
        a.style.position = 'absolute';
        a.style.opacity = '0';
        a.style.pointerEvents = 'none';

        const img = document.createElement('img');
        img.alt = 'AR';
        a.appendChild(img);
        document.body.appendChild(a);

        a.click();

        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);

        await new Promise<void>(resolve => setTimeout(resolve, 350));
      } catch (e) {
        console.error("USDZ Export failed", e);
        alert("Failed to export AR model for Quick Look.");
      } finally {
        restoreInstancedMeshes(swaps);
        scene.background = oldBackground;
        onComplete();
      }
    };
    runExport();
    return () => { cancelled = true; };
  }, [trigger, scene, onComplete]);

  return null;
}
